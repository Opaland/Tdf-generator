'use strict';
// Temps par côte entre sorties (Epic 31.3) : GET /api/traces/climb-efforts.
// Calcul dans pipeline/climbEfforts.js ; seules les traces importées
// terminées comptent (même marqueur que GET /api/traces/summary).

const { getDb } = require('../db');
const { wrap } = require('../apiHelpers');
const { climbEfforts } = require('../../pipeline/climbEfforts');

module.exports = function register(app) {
  app.get('/api/traces/climb-efforts', wrap(async (req, res) => {
    const db = getDb();
    const traces = db.prepare(
      `SELECT s.id, s.name, s.date FROM stages s JOIN tracks t ON t.stage_id = s.id
       WHERE t.router = 'trace' AND s.state = 'done'`
    ).all().map((t) => ({ ...t, date: t.date != null && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null }));
    const ids = new Set(traces.map((t) => t.id));
    const climbsByStage = new Map();
    for (const c of db.prepare('SELECT stage_id, name, category, start_km, end_km, summit_ele_m FROM climbs ORDER BY stage_id, start_km').all()) {
      if (!ids.has(c.stage_id)) continue;
      if (!climbsByStage.has(c.stage_id)) climbsByStage.set(c.stage_id, []);
      climbsByStage.get(c.stage_id).push(c);
    }
    // Échantillons des seules traces qui ont au moins une côte.
    const samplesByStage = new Map();
    const stmt = db.prepare('SELECT dist_m, lat, lon, elapsed_s FROM elevation_samples WHERE stage_id = ? ORDER BY idx');
    for (const id of climbsByStage.keys()) samplesByStage.set(id, stmt.all(id));
    res.json({ climbs: climbEfforts(traces, climbsByStage, samplesByStage) });
  }));
};
