'use strict';
// Recherche par lieu (Epic 32) : « un Tour de France est-il passé près de ce
// village, et en quelle année ? » — la question d'origine du projet.
//
// Cinq sources, de la plus fiable à la moins fiable, et la plus fiable
// l'emporte pour une même étape :
//   1. tracé reconstitué en base (route réelle, distance au tracé) ;
//   2. points de passage en base, étape importée mais pas générée ;
//   3. itinéraire détaillé du profil officiel (Epic 33,
//      pipeline/data/stage_itineraries.json) : toutes les villes traversées,
//      avec leur kilomètre ;
//   4. points de passage curés de pipeline/data/historic_routes.json, même
//      pour une édition jamais importée (distance au point, et au segment
//      droit entre deux points consécutifs — une estimation, signalée) ;
//   5. villes de départ et d'arrivée seulement (stage_towns.json).
// Une étape absente de ces sources n'est PAS cherchée : la réponse dit
// toujours ce qu'elle couvre, pour qu'un « aucun résultat » ne se lise jamais
// comme « aucun Tour n'est passé ici ».

const { haversine } = require('./geo');
const { HISTORIC_ROUTES, KNOWN_COLS, resolveViaCoords } = require('./wikipedia');

/** Distance (m) d'un point au segment [a, b], en projection locale
 * équirectangulaire — précise à mieux que 1 % sur quelques dizaines de km. */
function pointSegmentM(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * k;
  const ay = a.lat - p.lat;
  const bx = (b.lon - p.lon) * k;
  const by = b.lat - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 111195;
}

/** Plus courte distance d'un point à une polyligne [[lon, lat], …]. */
function distanceToLineM(p, coords) {
  if (!coords || !coords.length) return Infinity;
  if (coords.length === 1) return haversine(p, { lon: coords[0][0], lat: coords[0][1] });
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const d = pointSegmentM(p, { lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
    if (d < best) best = d;
  }
  return best;
}

/** Point de passage le plus proche : { d, label }. */
function nearestPoint(p, pts) {
  let best = { d: Infinity, label: null };
  for (const w of pts) {
    if (w.lat == null || w.lon == null) continue;
    const d = haversine(p, w);
    if (d < best.d) best = { d, label: w.label };
  }
  return best;
}

/** Points de passage curés (avec coordonnées) d'historic_routes.json, par
 * étape : [{ year, category, stage, points: [{label, lat, lon}] }]. */
function curatedStages() {
  const out = [];
  for (const [key, ed] of Object.entries(HISTORIC_ROUTES)) {
    const m = /^(\d{4})(?:-(\w+))?$/.exec(key);
    if (!m) continue;
    for (const [stage, entry] of Object.entries(ed.stages || {})) {
      const raw = [entry.start, ...(entry.vias || []), entry.finish].filter(Boolean)
        .map((v) => (typeof v === 'string' ? { label: v } : v));
      const points = raw.map((v) => ({ label: v.label, ...resolveViaCoords(v, KNOWN_COLS[v.label]) }))
        .filter((v) => v.lat != null && v.lon != null);
      out.push({ year: Number(m[1]), category: m[2] || 'hommes', stage, points });
    }
  }
  return out;
}

// Au-delà, la ligne droite entre deux points de passage consécutifs n'est
// plus une estimation défendable de la route (relecture adverse : jusqu'à
// 57 km entre deux points curés, « 0 km » affiché au milieu d'une vallée non
// parcourue). p90 des écarts curés réels : 7,5 km.
const MAX_SEGMENT_M = 10000;

/** Plus courte distance aux segments droits [p_i, p_i+1] de moins de
 * MAX_SEGMENT_M ; Infinity s'il n'y en a aucun. */
function nearestShortSegmentM(place, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    if (haversine(pts[i - 1], pts[i]) > MAX_SEGMENT_M) continue;
    best = Math.min(best, pointSegmentM(place, pts[i - 1], pts[i]));
  }
  return best;
}

/** Villes de départ/arrivée de toutes les éditions (Epic 32.4,
 * pipeline/data/stage_towns.json, construit par scripts/build-stage-towns.js) :
 * [{ year, category, stage, towns: [{label, role, lat, lon, confidence}] }].
 * Fichier absent → [] (la recherche reste limitée aux autres sources). */
let townsCache = null;
function stageTowns() {
  if (townsCache) return townsCache;
  let doc;
  try {
    doc = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'stage_towns.json'), 'utf8'));
  } catch {
    townsCache = [];
    return townsCache;
  }
  townsCache = [];
  for (const [key, ed] of Object.entries(doc.editions || {})) {
    const m = /^(\d{4})(?:-(\w+))?$/.exec(key);
    if (!m) continue;
    const stages = ed.stages || [];
    const labels = stageLabels(stages.map((s) => s.number));
    stages.forEach((s, i) => {
      // `douteux` : position non confirmée par une seconde source — jamais
      // utilisée pour affirmer un passage (relecture adverse).
      const towns = [['départ', s.start], ['arrivée', s.finish]]
        .filter(([, t]) => t && Number.isFinite(t.lat) && Number.isFinite(t.lon) && t.confidence !== 'douteux' && t.confidence !== 'approx')
        .map(([role, t]) => ({ label: t.label, role, lat: t.lat, lon: t.lon, confidence: t.confidence || 'ok' }));
      townsCache.push({ year: Number(m[1]), category: m[2] || 'hommes', stage: labels[i], date: s.date || null, towns });
    });
  }
  return townsCache;
}

/** Libellés d'étape d'une édition, dans l'ordre : le numéro seul, ou suffixé
 * a/b/c quand plusieurs étapes partagent ce numéro (étape scindée) — même
 * convention que stageCurationKey() (pipeline/wikipedia.js). Sans suffixe,
 * une demi-étape masquait les autres (relecture adverse : 114 étapes, dont
 * Cholet, arrivée de 1936/19b). */
function stageLabels(numbers) {
  const count = new Map();
  for (const n of numbers) count.set(String(n), (count.get(String(n)) || 0) + 1);
  const seenN = new Map();
  return numbers.map((n) => {
    const k = String(n);
    const i = seenN.get(k) || 0;
    seenN.set(k, i + 1);
    return count.get(k) > 1 ? `${k}${String.fromCharCode(97 + i)}` : k;
  });
}

/** Itinéraires détaillés (Epic 33) : [{ year, category, stage, sourceUrl,
 * points: [{label, km, lat, lon}], segments: [[a, b]] }]. Seuls les points
 * placés comptent ; une côte placée au village éponyme (geocodeAs) est
 * écartée, sa position n'étant pas celle de la route. Un segment ne relie
 * que deux points voisins du profil, sans point non placé entre eux (la
 * route peut y faire un détour inconnu). Fichier absent → []. */
function buildItinerary(towns) {
  const points = [];
  const segments = [];
  let prev = null;
  for (const t of towns) {
    // Point écarté (côte au village éponyme) ou non placé : il coupe le
    // segment, la route peut y faire un détour inconnu.
    if ((t.geocodeAs && t.kind !== 'ville') || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) { prev = null; continue; }
    const p = { label: t.label, km: t.km, lat: t.lat, lon: t.lon, confidence: t.confidence || 'ok' };
    if (prev) segments.push([prev, p]);
    points.push(p);
    prev = p;
  }
  return { points, segments };
}

let itinCache = null;
function stageItineraries() {
  if (itinCache) return itinCache;
  let doc;
  try {
    doc = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'stage_itineraries.json'), 'utf8'));
  } catch {
    itinCache = [];
    return itinCache;
  }
  itinCache = [];
  for (const [key, ed] of Object.entries(doc.editions || {})) {
    const m = /^(\d{4})(?:-(\w+))?$/.exec(key);
    if (!m) continue;
    for (const [stage, st] of Object.entries(ed.stages || {})) {
      const { points, segments } = buildItinerary(st.towns || []);
      const rc = st.route_check;
      const routeCheck = rc && Number.isFinite(rc.delta_pct) && Number.isFinite(rc.tolerance_pct)
        ? { deltaPct: rc.delta_pct, tolerancePct: rc.tolerance_pct, coveragePct: rc.coverage_pct ?? null, carLegs: rc.car_legs ?? null, legs: rc.legs ?? null } : null;
      itinCache.push({ year: Number(m[1]), category: m[2] || 'hommes', stage, sourceUrl: st.source_url || null, routeCheck, points, segments });
    }
  }
  return itinCache;
}

const stageKey = (year, category, stage) => `${year}|${category}|${String(stage).toLowerCase()}`;

/**
 * @param place {lat, lon}
 * @param radiusM rayon de recherche
 * @param db { tracked: [{year, category, stageOrder, stageId, name, date, coords, officialKm, generatedKm}],
 *             waypointed: [{year, category, stageOrder, stageId, name, date, waypoints: [{label, lat, lon}]}] }
 * @param curated curatedStages() (injectable pour les tests)
 */
function searchNear(place, radiusM, db, curated = curatedStages(), towns = stageTowns(), itineraries = stageItineraries()) {
  const results = [];
  const seen = new Set();
  for (const s of db.tracked) {
    const d = distanceToLineM(place, s.coords);
    seen.add(stageKey(s.year, s.category, s.stage ?? s.stageOrder));
    if (d <= radiusM) {
      results.push({ year: s.year, category: s.category, stage: String(s.stage ?? s.stageOrder), stageId: s.stageId, name: s.name,
        date: s.date || null, distanceM: Math.round(d), basis: 'trace', nearestLabel: null,
        officialKm: s.officialKm ?? null, generatedKm: s.generatedKm ?? null });
    }
  }
  for (const s of db.waypointed) {
    const k = stageKey(s.year, s.category, s.stage ?? s.stageOrder);
    if (seen.has(k)) continue;
    const near = nearestPoint(place, s.waypoints);
    if (!Number.isFinite(near.d)) continue;
    seen.add(k);
    // Même règle que la curation : segment court seulement, signalé.
    const seg = nearestShortSegmentM(place, s.waypoints.filter((w) => w.lat != null && w.lon != null));
    const d = Math.min(near.d, seg);
    if (d <= radiusM) {
      results.push({ year: s.year, category: s.category, stage: String(s.stage ?? s.stageOrder), stageId: s.stageId, name: s.name,
        date: s.date || null, distanceM: Math.round(d), basis: seg < near.d ? 'waypoint-segment' : 'waypoint',
        nearestLabel: near.label, nearestPointM: Math.round(near.d) });
    }
  }
  // Itinéraire du profil officiel : distance à la ville traversée la plus
  // proche, ou au segment droit court entre deux villes voisines (estimation).
  let itineraryCovered = 0;
  const dateOf = new Map(towns.map((t) => [stageKey(t.year, t.category, t.stage), t.date]));
  for (const it of itineraries) {
    if (it.points.length === 0) continue;
    const k = stageKey(it.year, it.category, it.stage);
    if (seen.has(k)) continue;
    seen.add(k);
    itineraryCovered++;
    let near = { d: Infinity, p: null };
    for (const p of it.points) {
      const d = haversine(place, p);
      if (d < near.d) near = { d, p };
    }
    let seg = Infinity;
    for (const [a, b] of it.segments) {
      if (haversine(a, b) > MAX_SEGMENT_M) continue;
      seg = Math.min(seg, pointSegmentM(place, a, b));
    }
    const d = Math.min(near.d, seg);
    if (d <= radiusM) {
      results.push({ year: it.year, category: it.category, stage: it.stage, stageId: null, name: null, date: dateOf.get(k) || null,
        distanceM: Math.round(d), basis: seg < near.d ? 'itinerary-segment' : 'itinerary-point',
        nearestLabel: near.p.label, nearestKm: near.p.km, nearestPointM: Math.round(near.d), sourceUrl: it.sourceUrl,
        geocodeConfidence: near.p.confidence, routeCheck: it.routeCheck ?? null });
    }
  }
  let curatedCovered = 0;
  for (const c of curated) {
    if (c.points.length === 0) continue;
    const k = stageKey(c.year, c.category, c.stage);
    if (seen.has(k)) continue;
    seen.add(k);
    curatedCovered++;
    const near = nearestPoint(place, c.points);
    // Segment droit entre deux points curés consécutifs (moins de
    // MAX_SEGMENT_M) : la route réelle peut s'en écarter — estimation,
    // jamais présentée comme le tracé.
    const seg = nearestShortSegmentM(place, c.points);
    const d = Math.min(near.d, seg);
    if (d <= radiusM) {
      results.push({ year: c.year, category: c.category, stage: c.stage, stageId: null, name: null, date: null,
        distanceM: Math.round(d), basis: seg < near.d ? 'curated-segment' : 'curated-point',
        nearestLabel: near.label, nearestPointM: Math.round(near.d) });
    }
  }
  // Dernier recours : villes de départ/arrivée seulement, pour toutes les
  // éditions. Le parcours entre les deux n'est pas connu : la distance est
  // celle à la ville, jamais à une route supposée.
  let townsCovered = 0;
  for (const t of towns) {
    if (!t.towns.length) continue;
    const k = stageKey(t.year, t.category, t.stage);
    if (seen.has(k)) continue;
    seen.add(k);
    townsCovered++;
    let best = null;
    for (const w of t.towns) {
      const d = haversine(place, w);
      if (!best || d < best.d) best = { d, w };
    }
    if (best.d <= radiusM) {
      results.push({ year: t.year, category: t.category, stage: t.stage, stageId: null, name: null, date: t.date,
        distanceM: Math.round(best.d), basis: 'endpoint', nearestLabel: best.w.label, endpointRole: best.w.role,
        geocodeConfidence: best.w.confidence });
    }
  }
  results.sort((a, b) => a.year - b.year || parseInt(a.stage, 10) - parseInt(b.stage, 10) || a.distanceM - b.distanceM);
  return {
    results,
    coverage: { trackedStages: db.tracked.length, waypointStages: db.waypointed.length, itineraryStages: itineraryCovered,
      curatedStages: curatedCovered, townStages: townsCovered },
  };
}

module.exports = { searchNear, curatedStages, stageTowns, stageItineraries, buildItinerary, stageLabels, distanceToLineM, pointSegmentM, MAX_SEGMENT_M };
