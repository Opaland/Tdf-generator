'use strict';
// Recherche par lieu (Epic 32) : GET /api/search/near?q=Porcelette&radiusKm=10,
// ou ?lat=&lon=&label= une fois un homonyme choisi. Calcul dans
// pipeline/placeSearch.js ; ici, résolution du lieu et lecture de la base.

const { getDb } = require('../db');
const { wrap, httpError } = require('../apiHelpers');
const { geocode, communeCandidates, normName } = require('../../pipeline/geocode');
const { searchNear, stageLabels } = require('../../pipeline/placeSearch');

const MAX_Q = 100;

/** Libellé d'étape par id (« 19 », ou « 19a »/« 19b » pour une étape
 * scindée), même convention que la curation et les villes-étapes. */
function stageLabelsById(db) {
  const rows = db.prepare('SELECT id, edition_id, stage_order FROM stages WHERE edition_id IS NOT NULL ORDER BY edition_id, stage_order, id').all();
  const byEdition = new Map();
  for (const r of rows) {
    if (!byEdition.has(r.edition_id)) byEdition.set(r.edition_id, []);
    byEdition.get(r.edition_id).push(r);
  }
  const out = new Map();
  for (const list of byEdition.values()) {
    const labels = stageLabels(list.map((r) => r.stage_order));
    list.forEach((r, i) => out.set(r.id, labels[i]));
  }
  return out;
}

function readDbStages(db) {
  const labelOf = stageLabelsById(db);
  // Éditions historiques seulement : ni tour personnalisé, ni trace personnelle.
  const tracked = db.prepare(
    `SELECT s.id, s.stage_order, s.name, s.date, s.official_distance_km, s.generated_distance_km,
            e.year, e.category, t.geojson
     FROM stages s JOIN editions e ON e.id = s.edition_id JOIN tracks t ON t.stage_id = s.id
     WHERE e.year IS NOT NULL AND e.is_custom = 0 AND s.state = 'done' AND t.router != 'trace'`
  ).all().map((r) => {
    let coords = [];
    try { coords = JSON.parse(r.geojson).geometry.coordinates || []; } catch { /* tracé illisible : ignoré */ }
    return { year: r.year, category: r.category, stageOrder: r.stage_order, stage: labelOf.get(r.id), stageId: r.id, name: r.name, date: r.date,
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
    if (!byStage.has(r.id)) byStage.set(r.id, { year: r.year, category: r.category, stageOrder: r.stage_order, stage: labelOf.get(r.id), stageId: r.id, name: r.name, date: r.date, waypoints: [] });
    byStage.get(r.id).waypoints.push({ label: r.label, lat: r.lat, lon: r.lon });
  }
  return { tracked, waypointed: [...byStage.values()] };
}

// Cache des tracés parsés : relire et parser tous les GeoJSON à chaque
// recherche bloquait le serveur ~0,7 s pour 2 300 étapes (relecture adverse).
// Clé bon marché qui change à toute génération, régénération ou suppression.
let cache = { key: null, value: null };
function loadDbStages(db) {
  const k = db.prepare(
    `SELECT (SELECT COUNT(*) FROM tracks) || ':' || (SELECT TOTAL(LENGTH(geojson)) FROM tracks) || ':' ||
            (SELECT COUNT(*) FROM waypoints WHERE lat IS NOT NULL) || ':' || (SELECT TOTAL(stage_id) FROM tracks) || ':' ||
            (SELECT COUNT(*) FROM stages) || ':' ||
            -- Renommage, changement de date, d'édition ou de coordonnées à
            -- nombre constant : la clé n'en voyait rien et servait des
            -- résultats périmés (revue globale du 19/10/2026).
            (SELECT TOTAL(LENGTH(name)) + TOTAL(LENGTH(COALESCE(date, ''))) + TOTAL(COALESCE(edition_id, 0)) FROM stages) || ':' ||
            (SELECT COALESCE(MAX(updated_at), '') FROM stages) || ':' ||
            (SELECT TOTAL(lat) + TOTAL(lon) FROM waypoints) || ':' ||
            (SELECT COUNT(*) + TOTAL(LENGTH(name)) + TOTAL(COALESCE(year, 0)) FROM editions) AS k`
  ).get().k;
  if (cache.key !== k) cache = { key: k, value: readDbStages(db) };
  return cache.value;
}

/** Lieu à chercher : coordonnées choisies par l'utilisateur, commune
 * française unique, ou liste d'homonymes à lui faire choisir. */
async function resolvePlace(query) {
  if (query.lat !== undefined || query.lon !== undefined) {
    const lat = Number(query.lat);
    const lon = Number(query.lon);
    const label = typeof query.label === 'string' ? query.label.trim().slice(0, 120) : '';
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !label) {
      throw httpError(400, 'lat, lon (nombres) et label requis ensemble');
    }
    return { place: { label, lat, lon, provider: 'choix' } };
  }
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length < 2 || q.length > MAX_Q) throw httpError(400, `q : nom de lieu de 2 à ${MAX_Q} caractères`);
  const communes = await communeCandidates(q);
  const exact = communes.filter((c) => normName(c.name) === normName(q));
  const pool = exact.length ? exact : communes;
  if (pool.length === 1) {
    const c = pool[0];
    return { place: { label: `${c.name} (${c.context.split(',')[0].trim()})`, lat: c.lat, lon: c.lon, provider: 'geopf-commune' } };
  }
  if (pool.length > 1) return { candidates: pool.map((c) => ({ label: `${c.name} (${c.context})`, lat: c.lat, lon: c.lon })) };
  // Aucune commune française : lieu à l'étranger (le Tour y passe aussi) ou
  // mode hors ligne — géocodeur général.
  let place;
  try {
    place = await geocode(q);
  } catch {
    place = null;
  }
  if (!place || place.lat == null || place.lon == null) throw httpError(404, `Lieu introuvable : « ${q} »`);
  // Hors ligne, le simulateur invente une position pour un lieu qu'il ne
  // connaît pas : chercher autour serait une réponse fausse (règle 12).
  if (place.provider === 'simulateur' && place.kind === 'unknown') {
    throw httpError(404, `« ${q} » est inconnu du géocodeur hors ligne (position simulée) : recherche impossible sans réseau`);
  }
  return { place: { label: place.label || q, lat: place.lat, lon: place.lon, provider: place.provider || null } };
}

module.exports = function register(app) {
  app.get('/api/search/near', wrap(async (req, res) => {
    const radiusKm = req.query.radiusKm === undefined ? 10 : Number(req.query.radiusKm);
    if (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 50) throw httpError(400, 'radiusKm : entier de 1 à 50');
    const resolved = await resolvePlace(req.query);
    if (resolved.candidates) return res.json({ candidates: resolved.candidates, radiusKm });
    const { place } = resolved;
    const { results, coverage } = searchNear(place, radiusKm * 1000, loadDbStages(getDb()));
    res.json({ place, radiusKm, results, coverage });
  }));
};
