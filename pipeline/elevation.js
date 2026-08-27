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

// Bornes de plausibilité physique : de -500 m (large marge sous le point le
// plus bas de France métropolitaine, l'étang du Lavalduc à -11 m, pour
// rester valide aussi hors-France via opentopodata) à 6000 m (au-dessus du
// Mont-Blanc, 4809 m). Toute valeur hors de cette plage n'est jamais une
// vraie mesure de terrain.
//
// Trouvaille en générant en masse des étapes réelles avec un vrai accès
// réseau (26/08/2026) : le Géoplateforme (RGE ALTI) ne renvoie pas
// toujours un sentinel « pas de donnée » propre. Un point franchement hors
// couverture (mer ouverte) renvoie le nombre littéral -99999 — mais un
// point à la LIMITE de la couverture (littoral, ex. Le Havre → Cherbourg
// le long de la Manche) renvoie une valeur INTERPOLÉE entre une case
// valide et une case -99999 voisine : des fractions comme -74017.5 ou
// -56315.9, jamais -99999 pile. Un test d'égalité stricte (`e ===
// -99999`) manquait donc cette zone de transition, laissant passer des
// altitudes fantômes qui gonflaient le dénivelé cumulé de dizaines de
// milliers de mètres (jusqu'à +100 000 m observés sur une étape réelle).
const PLAUSIBLE_ELE_MIN_M = -500;
const PLAUSIBLE_ELE_MAX_M = 6000;

function plausibleEle(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= PLAUSIBLE_ELE_MIN_M && v <= PLAUSIBLE_ELE_MAX_M
    ? v
    : null;
}

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
      // Un point hors couverture RGE ALTI (mer, hors France métropolitaine
      // malgré looksLikeFrance()) renvoie un objet sans `z` numérique
      // exploitable, ou un nombre littéral hors de toute plage physique
      // plausible (voir plausibleEle() : sentinel -99999, ou valeur
      // interpolée à la frontière de couverture) — normalisé explicitement
      // en `null` plutôt que de laisser passer une fausse mesure (voir
      // buildProfile() plus bas : la distinction entre "0 m mesuré" et
      // "non mesuré" doit survivre jusqu'à pipeline/checks.js, qui audite
      // les trous d'altimétrie).
      const eles = (json.elevations || []).map((e) => {
        if (typeof e === 'number') return plausibleEle(e);
        return plausibleEle(e?.z);
      });
      if (eles.length !== points.length) throw new Error('Altimétrie Géoplateforme : réponse incomplète');
      return eles;
    });
    // Revalidé même sur un coup de cache (trouvaille de relecture adverse,
    // 26/08/2026) : `cached()` sert la valeur telle qu'écrite en base sans
    // jamais repasser par plausibleEle — une entrée déjà en cache AVANT ce
    // correctif (ou un futur resserrement des bornes) continuerait sinon à
    // renvoyer une fausse mesure jusqu'à expiration du TTL (180 jours par
    // défaut), silencieusement, malgré le code corrigé et déployé.
    // Idempotent sur une valeur déjà filtrée : coût négligeable.
    return value.map(plausibleEle);
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
    // Comme geopfBatch ci-dessus (plausibleEle()) : un point sans donnée
    // (eudem25m ne couvre pas certaines zones maritimes/polaires) reste
    // `null`, jamais coercé en 0 m ni laissé passer sous une forme
    // sentinel/interpolée hors plage physique plausible — un 0 fabriqué
    // serait indiscernable d'une vraie mesure au niveau de la mer, et
    // invisible à l'audit de checks.js.
    return json.results.map((r) => plausibleEle(r.elevation));
  });
  // Revalidé même sur un coup de cache — voir le commentaire équivalent
  // dans geopfBatch ci-dessus (relecture adverse, 26/08/2026).
  return value.map(plausibleEle);
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
  // movingAverageByDistance additionne .ele directement (`sum += s.ele`) —
  // un trou `null` non comblé y serait coercé arithmétiquement en 0 (JS :
  // `sum += null` ⇒ `sum += 0`), biaisant silencieusement la moyenne de
  // toute la fenêtre qui le recouvre, pas seulement l'échantillon manquant
  // lui-même. Comblé par le voisin valide le plus proche AVANT le lissage —
  // uniquement pour ce calcul : eleRaw ci-dessous reste le vrai `null`, pour
  // que le trou reste détectable par pipeline/checks.js.
  const filledEles = fillNearestValid(samples.map((s) => s.ele));
  const smooth = movingAverageByDistance(
    samples.map((s, i) => ({ dist: s.dist, ele: filledEles[i] })),
    1500
  );

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
      eleRaw: Number.isFinite(s.ele) ? Math.round(s.ele * 10) / 10 : null,
      eleSmooth: Math.round(smooth[i] * 10) / 10,
    })),
    stepM,
    totalAscentM: Math.round(ascent),
  };
}

/**
 * Comble les altitudes non finies (null/undefined/NaN) par le voisin valide
 * le plus proche — même idiome que fillInvalidElevations
 * (pipeline/climbs.js) et l'import de traces (pipeline/importTrack.js).
 * 0 en dernier recours si le tableau est entièrement invalide (jamais
 * observé en pratique : un paquet d'altimétrie totalement vide échoue plus
 * tôt dans sampleElevations, avant d'atteindre ce point).
 */
function fillNearestValid(eles) {
  const filled = eles.map((e) => (Number.isFinite(e) ? e : null));
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] == null) {
      let a = i;
      let b = i;
      while (a > 0 && filled[a] == null) a--;
      while (b < filled.length - 1 && filled[b] == null) b++;
      filled[i] = filled[a] ?? filled[b] ?? 0;
    }
  }
  return filled;
}

module.exports = { sampleElevations, buildProfile, fillNearestValid, plausibleEle, GEOPF_BATCH, OTD_BATCH };
