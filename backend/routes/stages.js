'use strict';
// Étapes : CRUD, génération, étapes similaires.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { notifyGenerationFailure } = require('../notify');
const { getDb } = require('../db');
const { generateStage, loadStageFull } = require('../../pipeline/generate');
const { wrap, requireString, optionalString, optionalNumber, assertLatLonPaired, CLIMB_CATEGORY_RANK } = require('../apiHelpers');

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
        // détail des audits (~3 Ko par étape) reste dans GET /api/stages/:id.
        // Mesuré (scripts/scale-bench.js, 2 200 étapes) : la liste complète
        // pesait 5,2 Mo pour 251 ms, presque entièrement ce détail.
        if (checks && typeof checks === 'object') checks = { ok: checks.ok, offline: checks.offline };
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
