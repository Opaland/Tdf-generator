'use strict';
// Inventaire matériel (issue #228, phase 7, Epic 29) : vélos, chaussures…
// associés aux traces importées, avec cumul kilométrique par matériel.

const { getDb } = require('../db');
const { wrap, httpError, requireString } = require('../apiHelpers');

const GEAR_KINDS = ['velo', 'chaussures', 'autre'];
const MAX_NAME_LEN = 80;

function gearName(v) {
  const name = requireString(v, 'name').trim();
  if (name.length > MAX_NAME_LEN) throw httpError(400, `name : ${MAX_NAME_LEN} caractères au plus`);
  return name;
}

function gearKind(v) {
  if (!GEAR_KINDS.includes(v)) throw httpError(400, `kind doit valoir ${GEAR_KINDS.join(', ')}`);
  return v;
}

/** Identifiant d'URL : entier strictement positif, sinon 404 (jamais un
 * `parseInt('3abc')` qui viserait silencieusement la ligne 3). */
function routeId(raw) {
  if (!/^[1-9]\d*$/.test(raw)) throw httpError(404, 'introuvable');
  return Number(raw);
}

/** Cumuls par matériel, sur les seules traces importées terminées — même
 * marqueur que GET /api/traces/summary (`tracks.router = 'trace'`). La durée
 * reste null tant qu'aucune sortie n'est horodatée (CLAUDE.md règle 10) :
 * `timedCount` dit sur combien de sorties elle porte. */
function listGear(db) {
  const gear = db.prepare('SELECT id, name, kind, retired, created_at FROM gear ORDER BY retired, name COLLATE NOCASE, id').all();
  const totals = db.prepare(
    `SELECT s.gear_id,
            COUNT(*) AS n,
            SUM(COALESCE(s.generated_distance_km, 0)) AS km,
            SUM(COALESCE(s.total_ascent_m, 0)) AS asc,
            SUM(s.elapsed_time_s) AS t,
            COUNT(s.elapsed_time_s) AS timed
     FROM stages s JOIN tracks tr ON tr.stage_id = s.id
     WHERE tr.router = 'trace' AND s.state = 'done' AND s.gear_id IS NOT NULL
     GROUP BY s.gear_id`
  ).all();
  const byId = new Map(totals.map((r) => [r.gear_id, r]));
  return gear.map((g) => {
    const t = byId.get(g.id);
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      retired: g.retired === 1,
      createdAt: g.created_at,
      traceCount: t ? t.n : 0,
      distanceKm: t ? Math.round(t.km * 10) / 10 : 0,
      ascentM: t ? Math.round(t.asc) : 0,
      elapsedTimeS: t && t.timed ? Math.round(t.t) : null,
      timedCount: t ? t.timed : 0,
    };
  });
}

module.exports = function register(app) {
  app.get('/api/gear', wrap(async (req, res) => {
    res.json({ gear: listGear(getDb()) });
  }));

  app.post('/api/gear', wrap(async (req, res) => {
    const body = req.body || {};
    const name = gearName(body.name);
    const kind = body.kind == null ? 'velo' : gearKind(body.kind);
    const db = getDb();
    const id = db.prepare('INSERT INTO gear (name, kind) VALUES (?, ?)').run(name, kind).lastInsertRowid;
    res.status(201).json(listGear(db).find((g) => g.id === id));
  }));

  app.put('/api/gear/:id', wrap(async (req, res) => {
    const id = routeId(req.params.id);
    const body = req.body || {};
    const db = getDb();
    if (!db.prepare('SELECT 1 FROM gear WHERE id = ?').get(id)) throw httpError(404, 'matériel introuvable');
    const name = body.name === undefined ? null : gearName(body.name);
    const kind = body.kind === undefined ? null : gearKind(body.kind);
    if (body.retired !== undefined && typeof body.retired !== 'boolean') throw httpError(400, 'retired doit être un booléen');
    // better-sqlite3 refuse un booléen lié (CLAUDE.md règle 8) : converti ici.
    const retired = body.retired === undefined ? null : body.retired ? 1 : 0;
    db.prepare('UPDATE gear SET name = COALESCE(?, name), kind = COALESCE(?, kind), retired = COALESCE(?, retired) WHERE id = ?')
      .run(name, kind, retired, id);
    res.json(listGear(db).find((g) => g.id === id));
  }));

  // Réservée à l'admin en mode public (ADMIN_ROUTES, backend/server.js),
  // comme DELETE /api/stages/:id. Les sorties sont détachées, jamais
  // supprimées (ON DELETE SET NULL, migration 7).
  app.delete('/api/gear/:id', wrap(async (req, res) => {
    const id = routeId(req.params.id);
    const r = getDb().prepare('DELETE FROM gear WHERE id = ?').run(id);
    if (!r.changes) throw httpError(404, 'matériel introuvable');
    res.json({ ok: true });
  }));

  app.put('/api/traces/:id/gear', wrap(async (req, res) => {
    const id = routeId(req.params.id);
    const gearId = req.body?.gearId;
    if (gearId !== null && !(Number.isInteger(gearId) && gearId > 0)) {
      throw httpError(400, 'gearId doit être un entier positif, ou null pour détacher');
    }
    const db = getDb();
    // Seule une trace importée porte un matériel : une étape reconstruite
    // ou un brouillon d'éditeur n'a jamais été « roulé » avec.
    const isTrace = db.prepare(`SELECT 1 FROM stages s JOIN tracks t ON t.stage_id = s.id WHERE s.id = ? AND t.router = 'trace'`).get(id);
    if (!isTrace) throw httpError(404, 'trace importée introuvable');
    if (gearId !== null && !db.prepare('SELECT 1 FROM gear WHERE id = ?').get(gearId)) throw httpError(400, 'matériel inexistant');
    db.prepare('UPDATE stages SET gear_id = ? WHERE id = ?').run(gearId, id);
    res.json({ id, gearId });
  }));
};

module.exports.GEAR_KINDS = GEAR_KINDS;
module.exports.MAX_NAME_LEN = MAX_NAME_LEN;
