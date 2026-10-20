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

/** Zones stockées (réglage JSON) ; une valeur illisible vaut « aucune zone ». */
function parseZones(stored) {
  if (!stored) return [];
  try {
    return validateZones(typeof stored === 'string' ? JSON.parse(stored) : stored);
  } catch {
    return [];
  }
}

const inZone = (p, zones) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && zones.some((z) => haversine(p, z) <= z.radiusM);

/**
 * Copie d'une étape complète (loadStageFull) sans les points situés dans une
 * zone : échantillons, tracé, points de passage. Ne touche qu'aux traces
 * importées (`track.router === 'trace'`) : une étape historique ne passe pas
 * chez quelqu'un. Sans zone, renvoie l'objet tel quel.
 */
function maskStage(full, zones) {
  if (!full || !zones.length || full.track?.router !== 'trace') return full;
  const keep = (p) => !inZone(p, zones);
  const coords = full.track.geojson?.geometry?.coordinates;
  return {
    ...full,
    samples: full.samples.filter(keep),
    waypoints: (full.waypoints || []).filter((w) => w.lat == null || keep(w)),
    track: {
      ...full.track,
      geojson: Array.isArray(coords)
        ? { ...full.track.geojson, geometry: { ...full.track.geojson.geometry, coordinates: coords.filter((c) => keep({ lat: c[1], lon: c[0] })) } }
        : full.track.geojson,
    },
    privacyMasked: true,
  };
}

module.exports = { PRIVACY_ZONES_KEY, validateZones, parseZones, inZone, maskStage, MAX_ZONES, MIN_RADIUS_M, MAX_RADIUS_M };
