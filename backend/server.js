'use strict';
// Serveur local ÉtapeForge : API REST + frontend statique. Aucun compte, aucune
// dépendance cloud propriétaire — tout est servi depuis cette machine, les appels
// externes (géocodage, routage, altimétrie, Wikipédia) passent par le cache SQLite.

const path = require('path');
const express = require('express');
const { getDb, DB_PATH } = require('./db');
const { generateStage, loadStageFull } = require('../pipeline/generate');
const { importEdition } = require('../pipeline/importer');
const { geocodeSuggest, reverseGeocode } = require('../pipeline/geocode');
const { isOffline, setOffline, httpText } = require('../pipeline/http');
const { stageToGpx, stagePayload, tourToStandaloneHtml, ATTRIBUTIONS } = require('./exports');

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
app.use(express.json({ limit: '2mb' }));
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
app.get('/api/diagnostic', wrap(async (req, res) => {
  const { USER_AGENT } = require('../pipeline/http');
  const probe = async (name, url, check) => {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctl.signal });
      clearTimeout(timer);
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* réponse non-JSON (proxy, page d'erreur…) */ }
      const ok = r.ok && body != null && (!check || check(body));
      return {
        name, ok, ms: Date.now() - t0,
        detail: ok ? `HTTP ${r.status}` : `HTTP ${r.status} — ${body == null ? text.slice(0, 80) : 'réponse inattendue'}`,
      };
    } catch (err) {
      return { name, ok: false, ms: Date.now() - t0, detail: String(err.cause?.message || err.message) };
    }
  };
  const results = [];
  results.push(await probe('Géoplateforme — géocodage',
    'https://data.geopf.fr/geocodage/search?q=Paris&limit=1', (b) => (b.features || []).length > 0));
  results.push(await probe('Géoplateforme — altimétrie (RGE ALTI)',
    'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=2.35&lat=48.85&resource=ign_rge_alti_wld&zonly=true', (b) => (b.elevations || []).length > 0));
  results.push(await probe('OSRM — routage',
    'https://router.project-osrm.org/route/v1/driving/2.35,48.85;2.37,48.86?overview=false', (b) => b.code === 'Ok'));
  results.push(await probe('Nominatim — géocodage hors France',
    'https://nominatim.openstreetmap.org/search?q=Barcelona&format=jsonv2&limit=1', (b) => Array.isArray(b) && b.length > 0));
  results.push(await probe('opentopodata — altimétrie hors France',
    'https://api.opentopodata.org/v1/eudem25m?locations=41.38,2.17', (b) => b.status === 'OK'));
  results.push(await probe('Wikipédia — archives',
    'https://en.wikipedia.org/api/rest_v1/page/summary/Tour_de_France', (b) => !!b.title));
  const allOk = results.every((r) => r.ok);
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

// ---------------------------------------------------------------- import de traces
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
      `SELECT c.*, s.name AS stage_name, s.date AS stage_date, s.state AS stage_state,
              e.name AS edition_name, e.year AS edition_year, e.id AS edition_id
       FROM climbs c
       JOIN stages s ON s.id = c.stage_id
       LEFT JOIN editions e ON e.id = s.edition_id
       WHERE s.state = 'done'  -- une étape modifiée (draft) garde ses anciennes côtes jusqu'à regénération
       ORDER BY c.summit_ele_m DESC`
    )
    .all()
    .map((c) => ({ ...c, km_blocks: c.km_blocks ? JSON.parse(c.km_blocks) : [] }));
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

app.post('/api/editions', (req, res) => {
  const body = req.body || {};
  const name = requireString(body.name, 'name');
  const year = optionalNumber(body.year, 'year');
  const db = getDb();
  const r = db
    .prepare('INSERT INTO editions (year, name, is_custom) VALUES (?, ?, ?)')
    .run(year, name, body.is_custom ? 1 : 0);
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
  const year = parseInt((req.body || {}).year, 10);
  const result = await importEdition(year);
  res.json({ edition: result.edition, stages: result.stages });
}));

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
