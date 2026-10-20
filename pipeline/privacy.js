'use strict';
// Zones de confidentialité (backlog 34.7, idée geo-activity-playground) :
// autour du domicile (ou de tout lieu à taire), les points d'une trace
// importée sont retirés des exports, des mini-sites et de la carte « toutes
// mes traces ». La trace elle-même n'est pas modifiée en base : la fiche dans
// l'application reste complète pour qui y a accès.

const { haversine, inLatLonBounds } = require('./geo');

// Clé du réglage (backend/settings.js), lue par le profil et les exports.
const PRIVACY_ZONES_KEY = 'privacy_zones';
const MAX_ZONES = 5;
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 5000;

/**
 * Valide une liste de zones envoyée par le client. Lève une erreur
 * (status 400) au premier défaut : jamais de zone partiellement acceptée.
 * @returns [{ lat, lon, radiusM }]
 */
function validateZones(zones) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!Array.isArray(zones)) throw bad('privacyZones doit être une liste');
  if (zones.length > MAX_ZONES) throw bad(`privacyZones : ${MAX_ZONES} zones au plus`);
  return zones.map((z, i) => {
    const f = `privacyZones[${i}]`;
    if (!z || typeof z !== 'object') throw bad(`${f} : objet attendu`);
    const { lat, lon, radiusM } = z;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !inLatLonBounds(lat, lon)) throw bad(`${f} : lat entre -90 et 90, lon entre -180 et 180`);
    if (!Number.isInteger(radiusM) || radiusM < MIN_RADIUS_M || radiusM > MAX_RADIUS_M) throw bad(`${f}.radiusM : entier de ${MIN_RADIUS_M} à ${MAX_RADIUS_M} m`);
    return { lat, lon, radiusM };
  });
}

/**
 * Zones stockées (réglage JSON). Une zone invalide est écartée seule — les
 * autres protègent toujours (relecture adverse : une seule zone fautive
 * désactivait toutes les zones). Un réglage illisible (JSON cassé, pas une
 * liste) renvoie `null` : les appelants retirent alors TOUS les points des
 * traces, plutôt que de les publier faute de savoir où sont les zones.
 * @returns [{ lat, lon, radiusM }] | null
 */
function parseZones(stored) {
  if (stored == null || stored === '') return [];
  let list;
  try {
    list = typeof stored === 'string' ? JSON.parse(stored) : stored;
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const zones = [];
  for (const z of list.slice(0, MAX_ZONES)) {
    try { zones.push(...validateZones([z])); } catch { /* zone écartée seule */ }
  }
  return zones;
}

const inZone = (p, zones) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && zones.some((z) => haversine(p, z) <= z.radiusM);

/**
 * Copie d'une étape complète (loadStageFull) telle qu'elle peut sortir de
 * l'application. Ne touche qu'aux traces importées (`track.router ===
 * 'trace'`) : une étape historique ne passe pas chez quelqu'un. Retire :
 * - les échantillons, points du tracé et points de passage dans une zone ;
 * - les côtes, descentes, faux-plats et lignes du km par km qui recouvrent
 *   une portion masquée (nom, altitude et position du lieu caché) ;
 * - la commune, la région et le pays déduits du premier point, s'il est
 *   masqué (`city_hint`, géocodage inverse du départ).
 * `zones === null` (réglage illisible) : tout est retiré de la trace.
 */
function maskStage(full, zones) {
  if (!full || full.track?.router !== 'trace' || (zones && !zones.length)) return full;
  const hidden = (p) => zones === null || inZone(p, zones);
  const removed = full.samples.filter(hidden).map((sm) => sm.dist_m);
  if (!removed.length && zones !== null) return full;
  // Portion [aM, bM] recouvrant au moins un échantillon masqué.
  const touches = (aM, bM) => removed.some((d) => d >= aM && d <= bM);
  const byKm = (a, b) => (row) => !touches(Number(row[a]) * 1000, Number(row[b]) * 1000);
  const coords = full.track.geojson?.geometry?.coordinates;
  const startHidden = full.samples.length && hidden(full.samples[0]);
  return {
    ...full,
    stage: startHidden ? { ...full.stage, city_hint: null, region_hint: null, country_hint: null } : full.stage,
    samples: full.samples.filter((p) => !hidden(p)),
    waypoints: (full.waypoints || []).filter((w) => w.lat == null || !hidden(w)),
    climbs: (full.climbs || []).filter(byKm('start_km', 'end_km')),
    descents: (full.descents || []).filter(byKm('start_km', 'end_km')),
    fauxPlats: (full.fauxPlats || []).filter(byKm('fromKm', 'toKm')),
    kmAnalysis: (full.kmAnalysis || []).filter((r) => !touches((Number(r.km) - 1) * 1000, Number(r.km) * 1000)),
    track: {
      ...full.track,
      geojson: Array.isArray(coords)
        ? { ...full.track.geojson, geometry: { ...full.track.geojson.geometry, coordinates: coords.filter((c) => !hidden({ lat: c[1], lon: c[0] })) } }
        : full.track.geojson,
    },
    privacyMasked: true,
  };
}

module.exports = { PRIVACY_ZONES_KEY, validateZones, parseZones, inZone, maskStage, MAX_ZONES, MIN_RADIUS_M, MAX_RADIUS_M };
