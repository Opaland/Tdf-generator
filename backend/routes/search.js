'use strict';
// Recherche par lieu (Epic 32) : GET /api/search/near?q=Porcelette&radiusKm=10.
// Calcul dans pipeline/placeSearch.js ; ici, lecture de la base et géocodage.

const { getDb } = require('../db');
const { wrap, httpError } = require('../apiHelpers');
const { geocode } = require('../../pipeline/geocode');
const { searchNear } = require('../../pipeline/placeSearch');

const MAX_Q = 100;

function loadDbStages(db) {
  // Éditions historiques seulement : ni tour personnalisé, ni trace personnelle.
  const tracked = db.prepare(
    `SELECT s.id, s.stage_order, s.name, s.date, s.official_distance_km, s.generated_distance_km,
            e.year, e.category, t.geojson
     FROM stages s JOIN editions e ON e.id = s.edition_id JOIN tracks t ON t.stage_id = s.id
     WHERE e.year IS NOT NULL AND e.is_custom = 0 AND s.state = 'done' AND t.router != 'trace'`
  ).all().map((r) => {
    let coords = [];
    try { coords = JSON.parse(r.geojson).geometry.coordinates || []; } catch { /* tracé illisible : ignoré */ }
    return { year: r.year, category: r.category, stageOrder: r.stage_order, stageId: r.id, name: r.name, date: r.date,
      coords, officialKm: r.official_distance_km, generatedKm: r.generated_distance_km };
  }).filter((s) => Array.isArray(s.coords) && s.coords.length);
  const trackedIds = new Set(tracked.map((s) => s.stageId));
  const wps = db.prepare(
    `SELECT s.id, s.stage_order, s.name, s.date, e.year, e.category, w.label, w.lat, w.lon
     FROM stages s JOIN editions e ON e.id = s.edition_id JOIN waypoints w ON w.stage_id = s.id
     WHERE e.year IS NOT NULL AND e.is_custom = 0 AND w.lat IS NOT NULL AND w.lon IS NOT NULL
     ORDER BY s.id, w.idx`
  ).all();
  const byStage = new Map();
  for (const r of wps) {
    if (trackedIds.has(r.id)) continue;
    if (!byStage.has(r.id)) byStage.set(r.id, { year: r.year, category: r.category, stageOrder: r.stage_order, stageId: r.id, name: r.name, date: r.date, waypoints: [] });
    byStage.get(r.id).waypoints.push({ label: r.label, lat: r.lat, lon: r.lon });
  }
  return { tracked, waypointed: [...byStage.values()] };
}

module.exports = function register(app) {
  app.get('/api/search/near', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > MAX_Q) throw httpError(400, `q : nom de lieu de 2 à ${MAX_Q} caractères`);
    const radiusKm = req.query.radiusKm === undefined ? 10 : Number(req.query.radiusKm);
    if (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 50) throw httpError(400, 'radiusKm : entier de 1 à 50');
    const place = await geocode(q);
    if (!place || place.lat == null || place.lon == null) throw httpError(404, `Lieu introuvable : « ${q} »`);
    // Hors ligne, le simulateur invente une position pour un lieu qu'il ne
    // connaît pas : chercher autour serait une réponse fausse (règle 12).
    if (place.provider === 'simulateur' && place.kind === 'unknown') {
      throw httpError(404, `« ${q} » est inconnu du géocodeur hors ligne (position simulée) : recherche impossible sans réseau`);
    }
    const { results, coverage } = searchNear(place, radiusKm * 1000, loadDbStages(getDb()));
    res.json({ place: { label: place.label || q, lat: place.lat, lon: place.lon, provider: place.provider || null }, radiusKm, results, coverage });
  }));
};
