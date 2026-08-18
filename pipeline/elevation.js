'use strict';
// Altimétrie : échantillonnage tous les 100 m (< 60 km) ou 250 m (au-delà).
// France : data.geopf.fr/altimetrie (ressource ign_rge_alti_wld, paquets de 150 points).
// Ailleurs : api.opentopodata.org/v1/eudem25m (100 points/req, max 1 req/s).
// Chaque paquet passe par elevation_cache. Stockage brut + lissé (moyenne glissante 1 500 m).

const { httpJson, isOffline } = require('./http');
const { cached } = require('./cache');
const { looksLikeFrance } = require('./geocode');
const { resamplePolyline, movingAverageByDistance } = require('./geo');
const { simElevations } = require('./simulator');

const GEOPF_BATCH = 150;
const OTD_BATCH = 100;

function r5(x) {
  return Math.round(x * 1e5) / 1e5;
}

async function geopfBatch(points) {
  const req = { pts: points.map((p) => [r5(p.lat), r5(p.lon)]) };
  try {
    const { value } = await cached('elevation', 'geopf-rge-alti', req, async () => {
      const lons = points.map((p) => r5(p.lon)).join('|');
      const lats = points.map((p) => r5(p.lat)).join('|');
      const url =
        `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` +
        `?lon=${lons}&lat=${lats}&resource=ign_rge_alti_wld&zonly=true&delimiter=|`;
      const json = await httpJson(url, { minDelayMs: 250 });
      const eles = (json.elevations || []).map((e) => (typeof e === 'number' ? e : e.z));
      if (eles.length !== points.length) throw new Error('Altimétrie Géoplateforme : réponse incomplète');
      return eles;
    });
    return value;
  } catch (err) {
    // URL trop longue ou paquet refusé : on scinde récursivement.
    if (points.length > 25) {
      const mid = Math.ceil(points.length / 2);
      const [a, b] = await Promise.all([geopfBatch(points.slice(0, mid)), geopfBatch(points.slice(mid))]);
      return a.concat(b);
    }
    throw err;
  }
}

async function opentopodataBatch(points) {
  const req = { pts: points.map((p) => [r5(p.lat), r5(p.lon)]), dataset: 'eudem25m' };
  const { value } = await cached('elevation', 'opentopodata', req, async () => {
    const locs = points.map((p) => `${r5(p.lat)},${r5(p.lon)}`).join('|');
    const url = `https://api.opentopodata.org/v1/eudem25m?locations=${locs}`;
    const json = await httpJson(url, { minDelayMs: 1100 }); // max 1 req/s
    if (json.status !== 'OK') throw new Error(`opentopodata : ${json.status}`);
    return json.results.map((r) => (r.elevation == null ? 0 : r.elevation));
  });
  return value;
}

/**
 * Altitudes (m) pour une liste de points [{lat,lon}], ordre préservé.
 * Partition France / hors-France, paquets adaptés à chaque fournisseur.
 */
async function sampleElevations(points, { onProgress } = {}) {
  if (isOffline()) {
    // Mise en cache par paquets pour rester symétrique du mode réel.
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i += GEOPF_BATCH) {
      const batch = points.slice(i, i + GEOPF_BATCH);
      const req = { pts: batch.map((p) => [r5(p.lat), r5(p.lon)]) };
      const { value } = await cached('elevation', 'simulateur', req, async () => simElevations(batch));
      for (let j = 0; j < batch.length; j++) out[i + j] = value[j];
      if (onProgress) {
        onProgress({
          step: 'altimétrie',
          detail: `${Math.min(i + GEOPF_BATCH, points.length)}/${points.length} points`,
          percent: Math.round((Math.min(i + GEOPF_BATCH, points.length) / points.length) * 100),
        });
      }
    }
    return out;
  }

  const out = new Array(points.length);
  const frIdx = [];
  const otherIdx = [];
  points.forEach((p, i) => (looksLikeFrance(p.lat, p.lon) ? frIdx : otherIdx).push(i));

  let done = 0;
  const report = () => {
    done = Math.min(done, points.length);
    if (onProgress) {
      onProgress({
        step: 'altimétrie',
        detail: `${done}/${points.length} points`,
        percent: Math.round((done / points.length) * 100),
      });
    }
  };

  for (let i = 0; i < frIdx.length; i += GEOPF_BATCH) {
    const idxs = frIdx.slice(i, i + GEOPF_BATCH);
    const eles = await geopfBatch(idxs.map((k) => points[k]));
    idxs.forEach((k, j) => (out[k] = eles[j]));
    done += idxs.length;
    report();
  }
  for (let i = 0; i < otherIdx.length; i += OTD_BATCH) {
    const idxs = otherIdx.slice(i, i + OTD_BATCH);
    const eles = await opentopodataBatch(idxs.map((k) => points[k]));
    idxs.forEach((k, j) => (out[k] = eles[j]));
    done += idxs.length;
    report();
  }
  return out;
}

/**
 * Profil altimétrique complet d'un tracé.
 * @param trackPoints polyligne routée [{lat,lon}]
 * @returns { samples: [{idx, dist, lat, lon, eleRaw, eleSmooth}], stepM, totalAscentM }
 */
async function buildProfile(trackPoints, { onProgress } = {}) {
  const resampled = resamplePolyline(trackPoints, 100); // pas provisoire pour connaître la longueur
  const totalM = resampled.length ? resampled[resampled.length - 1].dist : 0;
  const stepM = totalM < 60000 ? 100 : 250;
  const pts = stepM === 100 ? resampled : resamplePolyline(trackPoints, stepM);

  const raw = await sampleElevations(pts, { onProgress });
  const samples = pts.map((p, i) => ({ idx: i, dist: p.dist, lat: p.lat, lon: p.lon, ele: raw[i] }));
  const smooth = movingAverageByDistance(samples, 1500);

  let ascent = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = smooth[i] - smooth[i - 1];
    if (d > 0) ascent += d;
  }

  return {
    samples: samples.map((s, i) => ({
      idx: i,
      dist: s.dist,
      lat: s.lat,
      lon: s.lon,
      eleRaw: Math.round(s.ele * 10) / 10,
      eleSmooth: Math.round(smooth[i] * 10) / 10,
    })),
    stepM,
    totalAscentM: Math.round(ascent),
  };
}

module.exports = { sampleElevations, buildProfile, GEOPF_BATCH, OTD_BATCH };
