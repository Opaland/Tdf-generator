'use strict';
// Serveur local ÉtapeForge : API REST + frontend statique. Aucun compte, aucune
// dépendance cloud propriétaire — tout est servi depuis cette machine, les appels
// externes (géocodage, routage, altimétrie, Wikipédia) passent par le cache SQLite.

const path = require('path');
const express = require('express');
const { getDb, DB_PATH } = require('./db');
const { generateStage, loadStageFull } = require('../pipeline/generate');
const { importEdition, importAllEditions, CATEGORIES } = require('../pipeline/importer');
const { historicHighlights } = require('../pipeline/wikipedia');
const { geocodeSuggest, reverseGeocode } = require('../pipeline/geocode');
const { isOffline, setOffline, httpText } = require('../pipeline/http');
const { stageToGpx, stageToTcx, stageToKml, stagePayload, tourToStandaloneHtml, stageToStandaloneHtml, stageToRoadbookHtml, ATTRIBUTIONS } = require('./exports');

const { suuntoRouter } = require('./suunto');
const { parseGpx, importTrackAsStage } = require('../pipeline/importTrack');
const { authRouter, requireAuth, AUTH_REQUIRED } = require('./auth');
const { startScheduledBackups, getBackupStatus } = require('./backup');
const notify = require('./notify');
const { notifyGenerationFailure } = notify;
const { getUsageStats: getApiUsageStats } = require('../pipeline/apiUsage');

const PORT = parseInt(process.env.PORT || '4567', 10);
const SERVER_START_TIME = new Date().toISOString();
const app = express();
// Derrière un reverse proxy (déploiement public), fait foi de X-Forwarded-For
// pour que req.ip (utilisé par le limiteur de tentatives login/register)
// reflète l'IP réelle du client plutôt que celle du proxy.
if (AUTH_REQUIRED) app.set('trust proxy', 1);
// 20mb (pas 2mb) : un dump complet pour /api/backup/import (voir plus bas)
// dépasse vite l'ancienne limite de 2 Mo dès quelques dizaines d'étapes
// générées (~55 Ko/étape mesuré, surtout elevation_samples — 7 étapes
// suffisent déjà à dépasser 1,8 Mo en pratique). Un second body-parser
// scopé à cette seule route ne fonctionne PAS : Express traite les
// middlewares dans l'ordre d'enregistrement, donc le premier express.json()
// qui matche le Content-Type rejette (413) une requête surdimensionnée
// avant même d'atteindre un second parseur plus permissif plus loin dans la
// chaîne — vérifié empiriquement avant de choisir cette approche plutôt
// qu'un contournement par Content-Type (relecture adverse : ce contournement
// laissait une route qui échouait silencieusement avec le Content-Type
// standard application/json, la seule route ici qui a besoin d'un gros
// body, donc pas de raison de complexifier les autres avec une limite plus
// large qu'elles ne portent jamais.
app.use(express.json({ limit: '20mb' }));
app.use('/api/import/gpx', express.text({ type: '*/*', limit: '30mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
// Comptes email/mot de passe : mur d'accès actif seulement en ETAPEFORGE_PUBLIC=1
// (voir backend/auth.js). En usage local/Synology par défaut, requireAuth ne fait
// rien — le comportement historique « aucun compte » est inchangé.
app.use('/api/auth', authRouter);
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Leaflet servi localement (aucune dépendance CDN pour l'application elle-même).
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));

// Générations en cours (une par étape).
const running = new Map(); // stageId -> Promise

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err.status) return res.status(err.status).json({ error: err.message }); // rejet de validation attendu, pas de log
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  });

// Validation d'entrée minimale : SQLite (better-sqlite3) n'accepte comme
// paramètre lié qu'un nombre, une chaîne, un bigint, un buffer ou null — un
// objet/tableau/booléen envoyé par erreur (ou par un client hostile) fait
// planter .run() avec une exception non gérée (500 + fuite de stack trace).
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function requireString(v, field) {
  if (typeof v !== 'string' || !v.trim()) throw httpError(400, `${field} doit être une chaîne non vide`);
  return v;
}
function optionalString(v, field) {
  if (v == null) return null;
  if (typeof v !== 'string') throw httpError(400, `${field} doit être une chaîne (ou absent)`);
  return v;
}
function optionalNumber(v, field) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) throw httpError(400, `${field} doit être un nombre (ou absent)`);
  return n;
}
// lat/optionalNumber(lon) sont validés indépendamment ci-dessus (chacun
// accepte null séparément) — un waypoint avec lat défini et lon absent (ou
// l'inverse) passait donc la validation et finissait en base ainsi.
// frontend/editor.js:85 fait `wp.lon.toFixed(4)` dès que `wp.lat != null`,
// sans re-vérifier lon : une paire dépareillée y lève une TypeError qui
// casse tout le rendu de la liste de waypoints (trouvaille de sprint dédié).
function assertLatLonPaired(waypoints, prefix) {
  waypoints.forEach((w, i) => {
    if ((w.lat == null) !== (w.lon == null)) {
      throw httpError(400, `${prefix}[${i}] : lat et lon doivent être fournis ensemble ou absents tous les deux`);
    }
  });
}

// ---------------------------------------------------------------- statut
app.get('/api/status', (req, res) => {
  const db = getDb();
  const counts = {
    stages: db.prepare('SELECT COUNT(*) n FROM stages').get().n,
    editions: db.prepare('SELECT COUNT(*) n FROM editions').get().n,
    geocode_cache: db.prepare('SELECT COUNT(*) n FROM geocode_cache').get().n,
    elevation_cache: db.prepare('SELECT COUNT(*) n FROM elevation_cache').get().n,
  };
  res.json({
    offline: isOffline(), authRequired: AUTH_REQUIRED, db: DB_PATH, counts,
    attributions: ATTRIBUTIONS, backup: getBackupStatus(),
    notify: { enabled: !!notify.WEBHOOK_URL, format: notify.FORMAT },
  });
});

// Tout ce qui suit nécessite une session valide quand ETAPEFORGE_PUBLIC=1
// (GET /api/status ci-dessus reste accessible sans compte : sonde de santé).
app.use('/api', requireAuth);

app.post('/api/offline', (req, res) => {
  setOffline(!!req.body.offline);
  res.json({ offline: isOffline() });
});

// Diagnostic de connectivité vers chaque API externe (une micro-requête par
// service, timeout 8 s, sans cache) — pour vérifier le mode « live » chez soi.
// Sondes extraites dans pipeline/diagnostic.js (réutilisées par
// scripts/demo.js --online, Chantier L "CI de vérification croisée périodique").
app.get('/api/diagnostic', wrap(async (req, res) => {
  const { runDiagnostic } = require('../pipeline/diagnostic');
  const { allOk, results } = await runDiagnostic();
  res.json({ allOk, offline: isOffline(), results });
}));

// Compteur de requêtes envoyées à chaque hôte externe depuis le démarrage du
// process (backlog issue #10, section E, « dashboard de consommation des
// quotas API ») — en mémoire, pas d'historique persistant (voir
// pipeline/apiUsage.js).
app.get('/api/quota', (req, res) => {
  res.json({ since: SERVER_START_TIME, usage: getApiUsageStats() });
});

// ---------------------------------------------------------------- géocodage
app.get('/api/geocode', wrap(async (req, res) => {
  res.json(await geocodeSuggest(String(req.query.q || '')));
}));
app.get('/api/reverse', wrap(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon requis' });
  res.json(await reverseGeocode(lat, lon));
}));

// ---------------------------------------------------------------- étapes
app.get('/api/stages', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.date, s.stage_type, s.status, s.state, s.stage_order,
              s.official_distance_km, s.generated_distance_km, s.total_ascent_m,
              s.edition_id, s.is_transfer, e.name AS edition_name, e.year AS edition_year
       FROM stages s LEFT JOIN editions e ON e.id = s.edition_id
       ORDER BY COALESCE(e.year, 9999), s.stage_order, s.id`
    )
    .all();
  res.json(rows);
});

app.post('/api/stages', (req, res) => {
  const body = req.body || {};
  const name = requireString(body.name, 'name');
  if (!Array.isArray(body.waypoints) || body.waypoints.length < 2) {
    return res.status(400).json({ error: 'name et au moins 2 waypoints requis' });
  }
  const date = optionalString(body.date, 'date');
  const stage_type = optionalString(body.stage_type, 'stage_type');
  const status = optionalString(body.status, 'status');
  const edition_id = optionalNumber(body.edition_id, 'edition_id');
  const stage_order = optionalNumber(body.stage_order, 'stage_order');
  const waypoints = body.waypoints.map((w, i) => ({
    label: typeof w?.label === 'string' && w.label ? w.label : `Point ${i + 1}`,
    kind: optionalString(w?.kind, `waypoints[${i}].kind`) || 'via',
    lat: optionalNumber(w?.lat, `waypoints[${i}].lat`),
    lon: optionalNumber(w?.lon, `waypoints[${i}].lon`),
    altitude_hint_m: optionalNumber(w?.altitude_hint_m, `waypoints[${i}].altitude_hint_m`),
    source: optionalString(w?.source, `waypoints[${i}].source`) || 'éditeur',
  }));
  assertLatLonPaired(waypoints, 'waypoints');
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO stages (name, date, stage_type, status, edition_id, stage_order, state)
       VALUES (?, ?, ?, ?, ?, ?, 'draft')`
    )
    .run(name, date, stage_type, status, edition_id, stage_order);
  const id = r.lastInsertRowid;
  const ins = db.prepare(
    `INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon, altitude_hint_m, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  waypoints.forEach((w, i) =>
    ins.run(id, i, w.label || `Point ${i + 1}`, w.kind || 'via', w.lat ?? null, w.lon ?? null, w.altitude_hint_m ?? null, w.source || 'éditeur')
  );
  res.json({ id });
});

app.put('/api/stages/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const stage = db.prepare('SELECT id FROM stages WHERE id = ?').get(id);
  if (!stage) return res.status(404).json({ error: 'Étape introuvable' });
  const body = req.body || {};
  const name = optionalString(body.name, 'name');
  const date = optionalString(body.date, 'date');
  const stage_type = optionalString(body.stage_type, 'stage_type');
  const status = optionalString(body.status, 'status');
  const edition_id = optionalNumber(body.edition_id, 'edition_id');
  const stage_order = optionalNumber(body.stage_order, 'stage_order');
  db.prepare(
    `UPDATE stages SET name = COALESCE(?, name), date = COALESCE(?, date),
       stage_type = COALESCE(?, stage_type), status = COALESCE(?, status),
       edition_id = COALESCE(?, edition_id), stage_order = COALESCE(?, stage_order),
       updated_at = datetime('now') WHERE id = ?`
  ).run(name, date, stage_type, status, edition_id, stage_order, id);
  if (Array.isArray(body.waypoints) && body.waypoints.length >= 2) {
    const waypoints = body.waypoints.map((w, i) => ({
      label: typeof w?.label === 'string' && w.label ? w.label : `Point ${i + 1}`,
      kind: optionalString(w?.kind, `waypoints[${i}].kind`) || 'via',
      lat: optionalNumber(w?.lat, `waypoints[${i}].lat`),
      lon: optionalNumber(w?.lon, `waypoints[${i}].lon`),
      altitude_hint_m: optionalNumber(w?.altitude_hint_m, `waypoints[${i}].altitude_hint_m`),
      source: optionalString(w?.source, `waypoints[${i}].source`) || 'éditeur',
    }));
    assertLatLonPaired(waypoints, 'waypoints');
    db.prepare('DELETE FROM waypoints WHERE stage_id = ?').run(id);
    const ins = db.prepare(
      `INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon, altitude_hint_m, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    waypoints.forEach((w, i) =>
      ins.run(id, i, w.label, w.kind, w.lat, w.lon, w.altitude_hint_m, w.source)
    );
    db.prepare(`UPDATE stages SET state = 'draft' WHERE id = ?`).run(id);
  }
  res.json({ ok: true });
});

app.delete('/api/stages/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  const stage = db.prepare('SELECT id FROM stages WHERE id = ?').get(id);
  if (!stage) return res.status(404).json({ error: 'Étape introuvable' });
  db.prepare('DELETE FROM stages WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/stages/:id', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full) return res.status(404).json({ error: 'Étape introuvable' });
  res.json(full);
});

app.post('/api/stages/:id/generate', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (running.has(id)) return res.status(202).json({ running: true });
  const p = generateStage(id)
    .catch((err) => {
      console.error(`Génération étape ${id} :`, err.message);
      const stage = getDb().prepare('SELECT name FROM stages WHERE id = ?').get(id);
      notifyGenerationFailure({ stageId: id, stageName: stage?.name || `#${id}`, error: err.message });
    })
    .finally(() => running.delete(id));
  running.set(id, p);
  res.status(202).json({ running: true });
}));

/** Rang numérique d'une catégorie de côte (plus haut = plus dur) — pour comparer
 * des étapes entre elles, pas pour un affichage (voir climbs.js pour le libellé). */
const CLIMB_CATEGORY_RANK = { HC: 5, 1: 4, 2: 3, 3: 2, 4: 1 };

/** Signature de profil d'une étape : D+ total et, parmi ses côtes, la catégorie
 * la plus dure et la pente la plus raide — utilisée par /similar pour rapprocher
 * des étapes au ressenti proche (backlog #10, section D, "étapes similaires"). */
function stageSignature(stage, climbsByStage) {
  const climbs = climbsByStage.get(stage.id) || [];
  let maxCategoryRank = 0;
  let maxCategory = null;
  let maxGradient = 0;
  for (const c of climbs) {
    const rank = CLIMB_CATEGORY_RANK[c.category] || 0;
    if (rank > maxCategoryRank) { maxCategoryRank = rank; maxCategory = c.category; }
    if (c.max_gradient > maxGradient) maxGradient = c.max_gradient;
  }
  return { totalAscentM: stage.total_ascent_m || 0, maxCategoryRank, maxCategory, maxGradient };
}

/** Distance heuristique entre deux signatures — échelles choisies pour que
 * 1000 m de D+, 1 catégorie de côte et 5 % de pente pèsent grossièrement pareil
 * dans le rapprochement ; pas une formule validée, juste un ordre de grandeur
 * raisonnable (même esprit documenté que pipeline/pain.js). */
function signatureDistance(a, b) {
  const dAscent = (a.totalAscentM - b.totalAscentM) / 1000;
  const dCategory = a.maxCategoryRank - b.maxCategoryRank;
  const dGradient = (a.maxGradient - b.maxGradient) / 5;
  return Math.sqrt(dAscent ** 2 + dCategory ** 2 + dGradient ** 2);
}

app.get('/api/stages/:id/similar', wrap(async (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const target = db.prepare('SELECT * FROM stages WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Étape introuvable' });
  if (target.state !== 'done') return res.json({ similar: [] });

  const candidates = db
    .prepare(
      `SELECT s.id, s.name, s.stage_type, s.total_ascent_m, e.year AS edition_year, e.name AS edition_name
       FROM stages s LEFT JOIN editions e ON e.id = s.edition_id
       WHERE s.state = 'done' AND s.id != ?
       ORDER BY s.id`
    )
    .all(id);
  if (!candidates.length) return res.json({ similar: [] });

  const allClimbs = db.prepare('SELECT stage_id, category, max_gradient FROM climbs').all();
  const climbsByStage = new Map();
  for (const c of allClimbs) {
    if (!climbsByStage.has(c.stage_id)) climbsByStage.set(c.stage_id, []);
    climbsByStage.get(c.stage_id).push(c);
  }

  const targetSig = stageSignature(target, climbsByStage);
  const ranked = candidates
    .map((c) => ({ ...c, signature: stageSignature({ id: c.id, total_ascent_m: c.total_ascent_m }, climbsByStage) }))
    .map((c) => ({ ...c, distance: signatureDistance(targetSig, c.signature) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((c) => ({
      id: c.id, name: c.name, stage_type: c.stage_type, edition_year: c.edition_year, edition_name: c.edition_name,
      total_ascent_m: c.total_ascent_m, max_category: c.signature.maxCategory, max_gradient: c.signature.maxGradient,
    }));
  res.json({ similar: ranked });
}));

// ---------------------------------------------------------------- import de traces

/** Bilan personnel « année en cols » (backlog #10, section D) : agrège les
 * traces importées. Marqueur fiable : `tracks.router = 'trace'`, posé par
 * une seule ligne de code (pipeline/importTrack.js) qui n'est jamais
 * atteinte par un autre chemin — ni valeur littérale ailleurs dans le
 * dépôt, ni champ de requête que POST/PUT /api/stages laisserait passer.
 * `stages.stage_type` a été écarté volontairement : relecture adverse,
 * `stage_type` est une chaîne libre acceptée telle quelle par
 * POST/PUT /api/stages (optionalString, aucune liste blanche) — un
 * brouillon créé à la main dans l'éditeur avec stage_type: 'trace' se
 * routerait normalement, finirait state='done', et se ferait passer pour
 * une sortie réellement parcourue sans jamais toucher importTrackAsStage.
 * Cols gravis dédupliqués par nom : une même côte grimpée deux fois compte
 * une fois dans la liste, avec un compteur d'ascensions et l'altitude
 * sommet la plus haute observée. */
app.get('/api/traces/summary', wrap(async (req, res) => {
  const db = getDb();
  const traces = db
    .prepare(
      `SELECT s.id, s.generated_distance_km, s.total_ascent_m
       FROM stages s JOIN tracks t ON t.stage_id = s.id
       WHERE t.router = 'trace' AND s.state = 'done'`
    )
    .all();
  if (!traces.length) {
    return res.json({ traceCount: 0, totalDistanceKm: 0, totalAscentM: 0, highestSummit: null, climbs: [] });
  }
  const traceIds = new Set(traces.map((t) => t.id));
  const allClimbs = db.prepare('SELECT stage_id, name, category, summit_ele_m FROM climbs').all();

  const byName = new Map();
  let highestSummit = null;
  for (const c of allClimbs) {
    if (!traceIds.has(c.stage_id) || !c.name) continue;
    // c.summit_ele_m peut être null (schéma sans NOT NULL, backend/db.js) —
    // atteignable via un import de sauvegarde (POST /api/backup/import).
    // Même classe de bug que CLAUDE.md règle 10 : sans le filtre != null,
    // `c.summit_ele_m > highestSummit.summit_ele_m` coercerait un null de
    // part ou d'autre en 0 — un col sans altitude connue, traité en premier,
    // empêcherait alors un col réel négatif suivant de devenir "le plus
    // haut" (vérifié : -30 > 0 est faux). entry.maxSummitM ci-dessous n'a
    // PAS ce risque malgré le même `|| 0` apparent : initialisé à 0 et mis à
    // jour par Math.max(), il ne peut jamais descendre sous 0 de toute façon
    // (Math.max(0, x) plancherait déjà x au même endroit) — un vrai
    // changement de comportement y aurait été un no-op, vérifié en écrivant
    // le test avant de le garder (voir tracesSummary.test.js).
    if (c.summit_ele_m != null && (!highestSummit || c.summit_ele_m > highestSummit.summit_ele_m)) {
      highestSummit = { name: c.name, summit_ele_m: c.summit_ele_m };
    }
    const entry = byName.get(c.name) || { name: c.name, count: 0, maxSummitM: 0, bestCategory: null };
    entry.count += 1;
    entry.maxSummitM = Math.max(entry.maxSummitM, c.summit_ele_m || 0);
    if (CLIMB_CATEGORY_RANK[c.category] > (CLIMB_CATEGORY_RANK[entry.bestCategory] || 0)) entry.bestCategory = c.category;
    byName.set(c.name, entry);
  }

  res.json({
    traceCount: traces.length,
    totalDistanceKm: Math.round(traces.reduce((sum, t) => sum + (t.generated_distance_km || 0), 0) * 10) / 10,
    totalAscentM: Math.round(traces.reduce((sum, t) => sum + (t.total_ascent_m || 0), 0)),
    highestSummit,
    climbs: [...byName.values()].sort((a, b) => b.maxSummitM - a.maxSummitM),
  });
}));

// GPX brut dans le corps de la requête → étape « trace » (pipeline aval identique).
app.post('/api/import/gpx', wrap(async (req, res) => {
  const { points, name } = parseGpx(String(req.body || ''));
  if (points.length < 2) return res.status(400).json({ error: 'GPX illisible : aucun point de trace (trkpt/rtept)' });
  const id = await importTrackAsStage(points, {
    name: req.query.name || name || 'Trace GPX importée',
    source: 'gpx',
  });
  res.json({ id, points: points.length });
}));

// Import depuis un lien d'export direct (ex. Suunto app → « télécharger GPX »,
// qui ne fournit pas de fichier local mais un lien signé api.sports-tracker.com —
// backend historique de l'appli Suunto). Le navigateur ne peut pas le récupérer
// lui-même (pas de CORS côté sports-tracker.com), donc le serveur le fait à sa
// place. Liste blanche d'hôtes stricte : un lien saisi par l'utilisateur ne doit
// jamais permettre au serveur d'aller sonder une adresse interne (SSRF).
const ALLOWED_IMPORT_LINK_HOSTS = [/(^|\.)sports-tracker\.com$/i];

app.post('/api/import/link', wrap(async (req, res) => {
  const url = requireString(req.body?.url, 'url');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, 'URL invalide');
  }
  if (parsed.protocol !== 'https:') throw httpError(400, 'Seules les URL https:// sont acceptées');
  if (!ALLOWED_IMPORT_LINK_HOSTS.some((re) => re.test(parsed.hostname))) {
    throw httpError(400, `Domaine non autorisé pour l'import par lien (${parsed.hostname}). Domaines acceptés : sports-tracker.com (export Suunto).`);
  }
  const text = await httpText(url, { retries: 1 });
  const { points, name } = parseGpx(text);
  if (points.length < 2) {
    throw httpError(400, "Le lien n'a pas renvoyé un GPX exploitable — vérifie que l'export choisi (dans Suunto/Sports-Tracker) est bien au format GPX.");
  }
  const id = await importTrackAsStage(points, {
    name: (typeof req.body?.name === 'string' && req.body.name.trim()) || name || 'Trace importée (lien)',
    source: 'import-link',
  });
  res.json({ id, points: points.length });
}));

// Connecteur Suunto (OAuth2, liste des sorties, import FIT).
app.use('/api/suunto', suuntoRouter);

// ---------------------------------------------------------------- catalogue des cols
// Toutes les côtes détectées, toutes étapes confondues (liste dense façon VeloViewer).
app.get('/api/climbs', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.*, s.name AS stage_name, s.date AS stage_date, s.state AS stage_state, s.checks AS stage_checks,
              e.name AS edition_name, e.year AS edition_year, e.id AS edition_id
       FROM climbs c
       JOIN stages s ON s.id = c.stage_id
       LEFT JOIN editions e ON e.id = s.edition_id
       WHERE s.state = 'done'  -- une étape modifiée (draft) garde ses anciennes côtes jusqu'à regénération
       ORDER BY c.summit_ele_m DESC`
    )
    .all()
    .map((c) => {
      // simulated : reprend le même drapeau offline posé à la génération
      // (pipeline/generate.js, stages.checks JSON) plutôt qu'un nouveau
      // JOIN sur tracks — un profil de montée généré par le simulateur peut
      // afficher des pentes irréalistes (ex. 17,7 % de moyenne sur 8 km,
      // aucune ascension réelle n'en approche), jusqu'ici signalé
      // uniquement par un bandeau global de page, jamais par ligne dans ce
      // catalogue qui prétend cataloguer « toutes les côtes détectées »
      // (trouvaille de revue-personas, persona ancien coureur).
      let simulated = false;
      try { simulated = JSON.parse(c.stage_checks || '{}').offline === true; } catch { /* stage_checks absent/corrompu : simulated reste false, pas de crash */ }
      delete c.stage_checks; // détail d'implémentation, pas une donnée à exposer
      return { ...c, km_blocks: c.km_blocks ? JSON.parse(c.km_blocks) : [], simulated };
    });
  res.json(rows);
});

// ---------------------------------------------------------------- éditions / tours
app.get('/api/editions', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      // COUNT(DISTINCT ...) partout : la jointure waypoints multiplie les lignes
      // par étape (plusieurs waypoints par étape), un SUM/COUNT non-distinct sur
      // s.id ou s.state compterait alors chaque étape plusieurs fois.
      `SELECT e.*,
              COUNT(DISTINCT s.id) AS stage_count,
              COUNT(DISTINCT CASE WHEN s.state = 'done' THEN s.id END) AS done_count,
              COUNT(DISTINCT CASE WHEN w.source = 'parcours curé' THEN s.id END) AS curated_stage_count
       FROM editions e
       LEFT JOIN stages s ON s.edition_id = e.id
       LEFT JOIN waypoints w ON w.stage_id = s.id
       GROUP BY e.id ORDER BY e.year, e.name`
    )
    .all()
    .map((e) => ({ ...e, source: e.source ? JSON.parse(e.source) : null }));
  res.json(rows);
});

/** Éditions pré-2020 marquées "mythiques" dans historic_routes.json (backlog
 * #10, section D) — pour les vignettes cliquables de l'écran Archives. Pure
 * lecture de données statiques, aucun accès DB nécessaire. */
app.get('/api/editions/highlights', (req, res) => {
  res.json(historicHighlights());
});

/** Suggestion de prochaine étape à générer (backlog #10) : pondérée par
 * variété de terrain déjà produite, pas par ordre d'ajout — parmi les
 * brouillons, celui dont le stage_type est le moins représenté dans les
 * étapes déjà terminées. Sans étape terminée, aucun signal de variété
 * n'existe : on suggère la première étape brouillon en le disant
 * explicitement, plutôt que de fabriquer une pertinence qui n'existe pas
 * encore (CLAUDE.md règle 9). */
app.get('/api/suggest-next', (req, res) => {
  const db = getDb();
  const done = db.prepare(`SELECT stage_type FROM stages WHERE state = 'done'`).all();
  const drafts = db
    .prepare(`SELECT id, name, stage_type, edition_id FROM stages WHERE state = 'draft' ORDER BY id`)
    .all();
  if (!drafts.length) return res.json({ suggestion: null });
  if (!done.length) {
    return res.json({
      suggestion: drafts[0],
      reason: `Aucune étape terminée pour l'instant : première étape brouillon, sans signal de variété.`,
    });
  }
  const counts = {};
  for (const d of done) {
    const t = d.stage_type || 'inconnu';
    counts[t] = (counts[t] || 0) + 1;
  }
  let best = drafts[0];
  let bestCount = Infinity;
  for (const s of drafts) {
    const c = counts[s.stage_type || 'inconnu'] || 0;
    if (c < bestCount) { bestCount = c; best = s; }
  }
  const typeLabel = best.stage_type || 'inconnu';
  const reason = bestCount === 0
    ? `Type « ${typeLabel} » absent des étapes déjà générées.`
    : `Type « ${typeLabel} » sous-représenté (${bestCount} étape${bestCount > 1 ? 's' : ''} déjà générée${bestCount > 1 ? 's' : ''} de ce type).`;
  res.json({ suggestion: best, reason });
});

app.post('/api/editions', (req, res) => {
  const body = req.body || {};
  const name = requireString(body.name, 'name');
  const year = optionalNumber(body.year, 'year');
  const category = body.category || 'hommes';
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category doit être ${CATEGORIES.join(' ou ')}` });
  }
  const db = getDb();
  const r = db
    .prepare('INSERT INTO editions (year, name, is_custom, category) VALUES (?, ?, ?, ?)')
    .run(year, name, body.is_custom ? 1 : 0, category);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/editions/:id', (req, res) => {
  const db = getDb();
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
  const curatedStageIds = new Set(
    db
      .prepare(
        `SELECT DISTINCT s.id FROM stages s
         JOIN waypoints w ON w.stage_id = s.id
         WHERE s.edition_id = ? AND w.source = 'parcours curé'`
      )
      .all(edition.id)
      .map((r) => r.id)
  );
  const stages = db
    .prepare('SELECT * FROM stages WHERE edition_id = ? ORDER BY stage_order, id')
    .all(edition.id)
    .map((s) => ({
      ...s,
      checks: s.checks ? JSON.parse(s.checks) : null,
      progress: s.progress ? JSON.parse(s.progress) : null,
      source: s.source ? JSON.parse(s.source) : null,
      is_curated: curatedStageIds.has(s.id),
    }));
  res.json({ ...edition, source: edition.source ? JSON.parse(edition.source) : null, stages });
});

app.post('/api/editions/import', wrap(async (req, res) => {
  const body = req.body || {};
  const year = parseInt(body.year, 10);
  const category = body.category || 'hommes';
  const result = await importEdition(year, { category });
  res.json({ edition: result.edition, stages: result.stages });
}));

// Import en masse (toutes les éditions 1903 → LAST_KNOWN_YEAR, hors guerres
// mondiales) : même idiome fire-and-forget que `running` pour la génération
// d'étape ci-dessus, mais il n'y a pas de ligne DB existante sur laquelle
// accrocher une progression (contrairement à une étape) — un objet de
// module suffit, un seul import en masse a du sens à la fois sur une
// instance locale mono-utilisateur.
let importAllJob = null; // { running, total, done, imported, failed, startedAt, error? }

app.post('/api/editions/import-all', (req, res) => {
  if (importAllJob && importAllJob.running) {
    return res.status(409).json({ error: 'Import en masse déjà en cours' });
  }
  importAllJob = { running: true, total: 0, done: 0, imported: [], failed: [], startedAt: new Date().toISOString() };
  importAllEditions({
    onProgress: (p) => {
      importAllJob.total = p.total;
      importAllJob.done = p.index;
    },
  })
    .then((result) => {
      importAllJob.imported = result.imported;
      importAllJob.failed = result.failed;
      importAllJob.total = result.total;
      importAllJob.done = result.total;
    })
    .catch((err) => {
      importAllJob.error = String(err.message || err);
    })
    .finally(() => {
      importAllJob.running = false;
    });
  res.status(202).json({ started: true });
});

app.get('/api/editions/import-all/status', (req, res) => {
  res.json(importAllJob || { running: false, total: 0, done: 0, imported: [], failed: [] });
});

/** Données carte globale d'un tour : tracés décimés + profils miniatures. */
app.get('/api/editions/:id/mapdata', wrap(async (req, res) => {
  const db = getDb();
  const editionId = parseInt(req.params.id, 10);
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(editionId);
  if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
  const ids = db.prepare('SELECT id FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(editionId);
  const stages = ids.map((r) => stagePayload(loadStageFull(r.id), { maxSamples: 200, maxTrack: 500 }));
  res.json({ edition: { ...edition, source: edition.source ? JSON.parse(edition.source) : null }, stages });
}));

// ---------------------------------------------------------------- exports
app.get('/api/stages/:id/export.json', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full) return res.status(404).json({ error: 'Étape introuvable' });
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.json"`);
  res.json(full);
});

app.get('/api/stages/:id/export.gpx', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.gpx"`);
  res.send(stageToGpx(full));
});

app.get('/api/stages/:id/export.tcx', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
  res.setHeader('Content-Type', 'application/vnd.garmin.tcx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.tcx"`);
  res.send(stageToTcx(full));
});

app.get('/api/stages/:id/export.kml', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.kml"`);
  res.send(stageToKml(full));
});

app.get('/api/stages/:id/export.html', wrap(async (req, res) => {
  const html = stageToStandaloneHtml(parseInt(req.params.id, 10));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="etape-${req.params.id}.html"`);
  res.send(html);
}));

// Roadbook imprimable — affiché inline (pas en téléchargement) pour être
// immédiatement imprimable (Ctrl+P) depuis l'onglet ouvert.
app.get('/api/stages/:id/roadbook.html', wrap(async (req, res) => {
  const html = stageToRoadbookHtml(parseInt(req.params.id, 10));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// Prévisualisation de la fiche autonome (sans téléchargement).
app.get('/api/stages/:id/site', wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(stageToStandaloneHtml(parseInt(req.params.id, 10)));
}));

app.get('/api/editions/:id/export.html', wrap(async (req, res) => {
  const html = tourToStandaloneHtml(parseInt(req.params.id, 10));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tour-${req.params.id}.html"`);
  res.send(html);
}));

// Prévisualisation du mini-site (sans téléchargement).
app.get('/api/editions/:id/site', wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(tourToStandaloneHtml(parseInt(req.params.id, 10)));
}));

// ------------------------------------------------- sauvegarde portable (export/import)
// Complète (ne remplace pas) la sauvegarde automatique de fichier .sqlite
// (backend/backup.js, ETAPEFORGE_BACKUP_DIR) : celle-ci sert la reprise
// après sinistre sur la même installation ; ceci sert la portabilité —
// déplacer ses données vers une autre instance, ou en garder une copie
// hors rotation. Format JSON lisible plutôt qu'un dump binaire, pour rester
// inspectable/diffable. Périmètre volontairement limité aux tables de
// données produit : ni users/sessions (jamais exporter un hash de mot de
// passe ou un identifiant de session, même haché), ni les caches d'appels
// externes (geocode_cache/elevation_cache/api_cache — régénérables, pas des
// données produit).
const BACKUP_TABLES = ['editions', 'stages', 'waypoints', 'tracks', 'elevation_samples', 'climbs', 'descents', 'km_analysis'];

// Number.isFinite, pas juste typeof === 'number' : better-sqlite3 accepte
// NaN/Infinity comme paramètre lié sans se plaindre (vérifié directement),
// contrairement à optionalNumber() plus haut qui les rejette déjà pour les
// routes /api/stages. Un fichier de sauvegarde forgé (ou corrompu) avec
// `1e999` sur un champ numérique — JSON.parse('1e999') === Infinity, valeur
// JSON syntaxiquement valide — passait cette garde et empoisonnait
// silencieusement une colonne (distance, D+, altitude) avec Infinity/NaN
// (trouvaille de sprint dédié).
function isBindable(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'bigint';
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

app.get('/api/backup/export', (req, res) => {
  const db = getDb();
  const tables = {};
  for (const t of BACKUP_TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="etapeforge-sauvegarde-${stamp}.json"`);
  res.json({ version: 1, exported_at: db.prepare(`SELECT datetime('now') d`).get().d, tables });
});

/**
 * Réimport complet : REMPLACE le contenu des tables de données produit par
 * celui du fichier fourni — pas de fusion, pas de synchronisation
 * multi-instance. Toute donnée produit absente du fichier est perdue.
 * `confirm: true` explicite requis pour qu'un appel accidentel ne vide pas
 * la base. Chaque colonne est validée (nom connu du schéma réel, valeur
 * d'un type accepté par better-sqlite3) avant toute écriture — CLAUDE.md
 * règle 8 — et l'ensemble tourne dans une transaction : un fichier
 * incompatible laisse la base inchangée, jamais à moitié vidée.
 */
app.post('/api/backup/import', (req, res) => {
  const body = req.body || {};
  if (body.confirm !== true) {
    return res.status(400).json({ error: 'confirm: true requis — cette opération remplace toutes les données produit existantes.' });
  }
  if (!body.tables || typeof body.tables !== 'object' || Array.isArray(body.tables)) {
    return res.status(400).json({ error: 'tables (objet) requis' });
  }
  const db = getDb();
  const perTable = {};
  for (const t of BACKUP_TABLES) {
    const rows = Array.isArray(body.tables[t]) ? body.tables[t] : [];
    if (!rows.length) { perTable[t] = { cols: [], rows: [] }; continue; }
    const allowed = new Set(tableColumns(db, t));
    const cols = Object.keys(rows[0]);
    for (const c of cols) {
      if (!allowed.has(c)) return res.status(400).json({ error: `${t}.${c} : colonne inconnue, fichier incompatible avec ce schéma` });
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowCols = Object.keys(row);
      if (rowCols.length !== cols.length || !rowCols.every((c) => cols.includes(c))) {
        return res.status(400).json({ error: `${t}[${i}] : colonnes incohérentes avec les autres lignes de cette table` });
      }
      for (const c of cols) {
        if (!isBindable(row[c])) return res.status(400).json({ error: `${t}[${i}].${c} : type non pris en charge (${typeof row[c]})` });
      }
    }
    perTable[t] = { cols, rows };
  }
  const run = db.transaction(() => {
    for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of BACKUP_TABLES) {
      const { cols, rows } = perTable[t];
      if (!rows.length) continue;
      const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const row of rows) stmt.run(cols.map((c) => row[c]));
    }
  });
  try {
    run();
  } catch (err) {
    return res.status(400).json({ error: `Réimport échoué, base inchangée (transaction annulée) : ${err.message}` });
  }
  res.json({ ok: true, counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, perTable[t].rows.length])) });
});

// Gestionnaire d'erreur global (4 arguments — signature reconnue par Express
// pour un middleware d'erreur) : filet de sécurité pour toute exception
// synchrone non interceptée par une route (ex. requireString/optionalNumber
// ci-dessus, ou un bug futur). Sans ce middleware, Express renvoie sa page
// HTML par défaut qui inclut la stack trace complète — donc les chemins de
// fichiers internes du serveur — trouvée en pratique lors d'un fuzzing de
// l'API (payloads de type non-primitif dans des champs attendus en chaîne).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ error: err.message }); // rejet de validation attendu, pas de log
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ÉtapeForge démarré : http://localhost:${PORT}`);
    if (isOffline()) console.log('Mode hors-ligne actif (ETAPEFORGE_OFFLINE=1) : données simulées.');
  });
  startScheduledBackups();
}

module.exports = { app };
