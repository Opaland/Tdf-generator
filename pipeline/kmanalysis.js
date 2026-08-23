'use strict';
// Analyse km par km : pour chaque kilomètre du tracé — altitude début/fin,
// pente moyenne, pente max sur 100 m (ou la résolution d'échantillonnage
// si > 100 m), D+ du km et D+ cumulé.

/**
 * @param samples [{dist, eleRaw, eleSmooth}] triés par dist (m)
 * @returns [{ km, eleStart, eleEnd, avgGradient, maxGradient100, ascent, cumAscent }]
 */
function analyzeByKm(samples) {
  if (samples.length < 2) return [];
  const smooth = (s) => (s.eleSmooth != null ? s.eleSmooth : s.ele);
  const raw = (s) => (s.eleRaw != null ? s.eleRaw : smooth(s));
  const totalM = samples[samples.length - 1].dist;
  const nKm = Math.ceil(totalM / 1000);

  const eleAt = (target) => {
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].dist <= target) lo = mid;
      else hi = mid;
    }
    const d0 = samples[lo].dist;
    const d1 = samples[hi].dist;
    const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    return smooth(samples[lo]) + t * (smooth(samples[hi]) - smooth(samples[lo]));
  };

  const rows = [];
  let cumAscent = 0;
  let si = 0;
  for (let km = 0; km < nKm; km++) {
    const fromM = km * 1000;
    const toM = Math.min((km + 1) * 1000, totalM);
    const eleStart = eleAt(fromM);
    const eleEnd = eleAt(toM);

    let maxGradient = 0;
    let ascent = 0;
    while (si < samples.length - 1 && samples[si + 1].dist <= toM) {
      const a = samples[si];
      const b = samples[si + 1];
      const dd = b.dist - a.dist;
      if (dd > 0 && a.dist >= fromM - 1) {
        const g = ((raw(b) - raw(a)) / dd) * 100;
        if (g > maxGradient) maxGradient = g;
        const ds = smooth(b) - smooth(a);
        if (ds > 0) ascent += ds;
      }
      si++;
    }

    cumAscent += ascent;
    rows.push({
      km: km + 1,
      eleStart: Math.round(eleStart),
      eleEnd: Math.round(eleEnd),
      avgGradient: Math.round(((eleEnd - eleStart) / (toM - fromM)) * 1000) / 10,
      maxGradient100: Math.round(maxGradient * 10) / 10,
      ascent: Math.round(ascent),
      cumAscent: Math.round(cumAscent),
    });
  }
  return rows;
}

const { MIN_AVG_GRADIENT } = require('./climbs');

// Faux-plat : portion longue et régulière sous le seuil de détection des
// côtes (< MIN_AVG_GRADIENT, importé de climbs.js pour ne jamais diverger
// silencieusement des deux définitions) mais sensiblement au-dessus du plat.
// Backlog issue #10, section C — ni signalé comme côte, ni distingué du plat
// aujourd'hui, alors qu'une longue portion à 1-3 % use plus l'organisme que
// le D+ ne le montre.
const FAUXPLAT_MIN_GRADIENT = 1; // %
const FAUXPLAT_MIN_LENGTH_KM = 3; // en dessous, un faux-plat isolé est du bruit de profil, pas un vrai segment notable

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }

/** Cap initial grand-cercle de (lat1,lon1) vers (lat2,lon2), en degrés [0, 360). */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Rose des vents à 8 directions — suffisant pour signaler une exposition
// probable au vent (backlog issue #10, section C), pas une prévision météo.
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
function compassLabel(deg) {
  return COMPASS_POINTS[Math.round(deg / 45) % 8];
}

/** lat/lon interpolés au point du tracé à `targetM` (mètres) — même principe
 * que l'interpolation d'altitude d'analyzeByKm, appliqué aux coordonnées. */
function latLonAt(samples, targetM) {
  if (!samples || samples.length < 2) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].dist_m <= targetM) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const t = b.dist_m > a.dist_m ? (targetM - a.dist_m) / (b.dist_m - a.dist_m) : 0;
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
}

/**
 * Cap du tronçon (début → fin, ligne directe) — pas une moyenne suivant les
 * courbes de la route, ce qui correspond à la notion utile pour l'exposition
 * au vent (un faux-plat qui va globalement plein ouest expose au vent
 * dominant même si la route serpente localement).
 */
function segmentBearing(samples, fromKm, toKm) {
  const a = latLonAt(samples, fromKm * 1000);
  const b = latLonAt(samples, toKm * 1000);
  if (!a || !b) return null;
  return Math.round(bearingDeg(a.lat, a.lon, b.lat, b.lon));
}

/**
 * @param kmRows [{ km, avgGradient|avg_gradient }] triés par km (sortie de analyzeByKm
 *               ou lignes km_analysis rechargées depuis la base — les deux formes de clé
 *               sont acceptées).
 * @param samples [{ dist_m, lat, lon }] optionnel, triés par dist_m — si fourni, chaque
 *               segment détecté porte aussi `bearingDeg`/`compass` (backlog issue #10,
 *               section C, "exposition au vent / orientation des tronçons").
 * @returns [{ fromKm, toKm, lengthKm, avgGradient, bearingDeg?, compass? }]
 */
function detectFauxPlats(kmRows, samples) {
  const grad = (r) => (r.avgGradient != null ? r.avgGradient : r.avg_gradient);
  const segments = [];
  let cur = null;
  for (const r of kmRows) {
    const inRange = grad(r) >= FAUXPLAT_MIN_GRADIENT && grad(r) < MIN_AVG_GRADIENT;
    if (inRange) {
      if (!cur) cur = { fromKm: r.km - 1, toKm: r.km, gradients: [grad(r)] };
      else { cur.toKm = r.km; cur.gradients.push(grad(r)); }
    } else if (cur) {
      segments.push(cur);
      cur = null;
    }
  }
  if (cur) segments.push(cur);
  return segments
    .filter((s) => s.toKm - s.fromKm >= FAUXPLAT_MIN_LENGTH_KM)
    .map((s) => {
      const fp = {
        fromKm: s.fromKm,
        toKm: s.toKm,
        lengthKm: s.toKm - s.fromKm,
        avgGradient: Math.round((s.gradients.reduce((a, b) => a + b, 0) / s.gradients.length) * 10) / 10,
      };
      const bearing = samples ? segmentBearing(samples, s.fromKm, s.toKm) : null;
      if (bearing != null) {
        fp.bearingDeg = bearing;
        fp.compass = compassLabel(bearing);
      }
      return fp;
    });
}

module.exports = {
  analyzeByKm, detectFauxPlats, FAUXPLAT_MIN_GRADIENT, FAUXPLAT_MIN_LENGTH_KM,
  bearingDeg, compassLabel, segmentBearing,
};
