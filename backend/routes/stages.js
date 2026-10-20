'use strict';
// Étapes : CRUD, génération, étapes similaires.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { notifyGenerationFailure } = require('../notify');
const { getDb } = require('../db');
const { generateStage, loadStageFull } = require('../../pipeline/generate');
const { wrap, httpError, requireString, optionalString, optionalNumber, assertLatLonPaired, CLIMB_CATEGORY_RANK } = require('../apiHelpers');
const { isOffline } = require('../../pipeline/http');
const { communesAlong } = require('../../pipeline/communes');

/** Waypoints reçus par POST/PUT /api/stages → lignes validées (règle 8).
 * Tous les champs que l'import d'une édition écrit (pipeline/importer.js)
 * sont acceptés et réécrits : le PUT supprime puis réinsère les waypoints,
 * et l'ancien INSERT n'avait ni bonus_sec, ni country_hint, ni region_hint —
 * modifier le nom d'une étape curée depuis l'éditeur effaçait ces données et
 * la provenance « parcours curé » (revue globale du 19/10/2026). */
function parseWaypoints(list) {
  const waypoints = list.map((w, i) => {
    const f = `waypoints[${i}]`;
    const bonus = w?.bonus_sec;
    if (bonus != null && !(Array.isArray(bonus) && bonus.length <= 10 && bonus.every((b) => Number.isFinite(b) && b >= 0))) {
      throw httpError(400, `${f}.bonus_sec doit être une liste de secondes (ou absent)`);
    }
    return {
      label: typeof w?.label === 'string' && w.label ? w.label : `Point ${i + 1}`,
      kind: optionalString(w?.kind, `${f}.kind`) || 'via',
      lat: optionalNumber(w?.lat, `${f}.lat`),
      lon: optionalNumber(w?.lon, `${f}.lon`),
      altitude_hint_m: optionalNumber(w?.altitude_hint_m, `${f}.altitude_hint_m`),
      bonus_sec: bonus && bonus.length ? JSON.stringify(bonus) : null,
      source: optionalString(w?.source, `${f}.source`) || 'éditeur',
      country_hint: optionalString(w?.country_hint, `${f}.country_hint`),
      region_hint: optionalString(w?.region_hint, `${f}.region_hint`),
    };
  });
  assertLatLonPaired(waypoints, 'waypoints');
  return waypoints;
}

function insertWaypoints(db, stageId, waypoints) {
  const ins = db.prepare(
    `INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon, altitude_hint_m, bonus_sec, source, country_hint, region_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  waypoints.forEach((w, i) =>
    ins.run(stageId, i, w.label, w.kind, w.lat, w.lon, w.altitude_hint_m, w.bonus_sec, w.source, w.country_hint, w.region_hint)
  );
}

module.exports = function register(app) {
  // Générations en cours (une par étape).
  const running = new Map(); // stageId -> Promise

  // ---------------------------------------------------------------- étapes
  app.get('/api/stages', (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT s.id, s.name, s.date, s.stage_type, s.status, s.state, s.stage_order,
                s.official_distance_km, s.generated_distance_km, s.total_ascent_m, s.checks,
                s.edition_id, s.is_transfer, e.name AS edition_name, e.year AS edition_year
         FROM stages s LEFT JOIN editions e ON e.id = s.edition_id
         ORDER BY COALESCE(e.year, 9999), s.stage_order, s.id`
      )
      .all()
      .map((s) => {
        let checks = null;
        try { checks = s.checks ? JSON.parse(s.checks) : null; } catch { /* checks corrompu : ignoré plutôt que de faire planter toute la liste */ }
        // Liste : résumé seulement ({ ok, offline }, seuls champs lus par les
        // écrans de liste — badge d'état, frontend/common.js stateBadge). Le
        // détail des audits (~2 Ko par étape) reste dans GET /api/stages/:id.
        // Mesuré (scripts/scale-bench.js, 2 200 étapes) : la liste complète
        // pesait 5,2 Mo pour 251 ms, presque entièrement ce détail.
        // Toute autre forme (tableau, scalaire — jamais écrite par le pipeline) : null.
        checks = checks && typeof checks === 'object' && !Array.isArray(checks) ? { ok: checks.ok, offline: checks.offline } : null;
        return { ...s, checks };
      });
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
    const waypoints = parseWaypoints(body.waypoints);
    const db = getDb();
    const r = db
      .prepare(
        `INSERT INTO stages (name, date, stage_type, status, edition_id, stage_order, state)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')`
      )
      .run(name, date, stage_type, status, edition_id, stage_order);
    const id = r.lastInsertRowid;
    insertWaypoints(db, id, waypoints);
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
    // Waypoints validés AVANT toute écriture, et le tout en une transaction :
    // un waypoint invalide renvoyait 400 après avoir déjà renommé l'étape.
    const waypoints = Array.isArray(body.waypoints) && body.waypoints.length >= 2 ? parseWaypoints(body.waypoints) : null;
    db.transaction(() => {
      db.prepare(
        `UPDATE stages SET name = COALESCE(?, name), date = COALESCE(?, date),
           stage_type = COALESCE(?, stage_type), status = COALESCE(?, status),
           edition_id = COALESCE(?, edition_id), stage_order = COALESCE(?, stage_order),
           updated_at = datetime('now') WHERE id = ?`
      ).run(name, date, stage_type, status, edition_id, stage_order, id);
      if (waypoints) {
        db.prepare('DELETE FROM waypoints WHERE stage_id = ?').run(id);
        insertWaypoints(db, id, waypoints);
        db.prepare(`UPDATE stages SET state = 'draft' WHERE id = ?`).run(id);
      }
    })();
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

  // Communes traversées, à la demande (Epic 12, option B) : ~1 requête
  // geo.api.gouv.fr par km de tracé, donc jamais pendant la génération.
  // Synchrone (≈ 45 s pour 170 km), une seule à la fois par étape.
  const communesRunning = new Set();
  app.post('/api/stages/:id/communes', wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isOffline()) {
      throw Object.assign(new Error('Calcul des communes traversées indisponible hors ligne (geo.api.gouv.fr requis)'), { status: 503 });
    }
    const full = loadStageFull(id);
    if (!full) throw Object.assign(new Error(`Étape ${id} introuvable`), { status: 404 });
    if (!full.track || !full.samples?.length) throw Object.assign(new Error('Étape non générée : aucun tracé'), { status: 409 });
    if (communesRunning.has(id)) throw Object.assign(new Error('Calcul déjà en cours pour cette étape'), { status: 409 });
    if (running.has(id)) throw Object.assign(new Error('Génération en cours : relancer le calcul une fois l\'étape générée'), { status: 409 });
    // Tracé exact sur lequel porte le calcul : une régénération pendant les
    // minutes d'attente remplace la ligne tracks — l'écriture finale est
    // conditionnée à ce même tracé, sinon la liste de l'ancien tracé serait
    // posée sur le nouveau (trouvaille de relecture adverse).
    const trackBefore = getDb().prepare('SELECT geojson FROM tracks WHERE stage_id = ?').get(id)?.geojson;
    communesRunning.add(id);
    try {
      let result;
      try {
        result = await communesAlong(full.samples);
      } catch (err) {
        throw Object.assign(new Error(`geo.api.gouv.fr injoignable ou en erreur : ${err.message}`), { status: 502 });
      }
      const written = getDb().prepare('UPDATE tracks SET communes = ? WHERE stage_id = ? AND geojson = ?')
        .run(JSON.stringify(result), id, trackBefore).changes;
      if (!written) throw Object.assign(new Error('Étape régénérée pendant le calcul : relancer le calcul sur le nouveau tracé'), { status: 409 });
      res.json(result);
    } finally {
      communesRunning.delete(id);
    }
  }));

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
};
