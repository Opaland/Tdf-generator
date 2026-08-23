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

/**
 * @param kmRows [{ km, avgGradient|avg_gradient }] triés par km (sortie de analyzeByKm
 *               ou lignes km_analysis rechargées depuis la base — les deux formes de clé
 *               sont acceptées).
 * @returns [{ fromKm, toKm, lengthKm, avgGradient }]
 */
function detectFauxPlats(kmRows) {
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
    .map((s) => ({
      fromKm: s.fromKm,
      toKm: s.toKm,
      lengthKm: s.toKm - s.fromKm,
      avgGradient: Math.round((s.gradients.reduce((a, b) => a + b, 0) / s.gradients.length) * 10) / 10,
    }));
}

module.exports = { analyzeByKm, detectFauxPlats, FAUXPLAT_MIN_GRADIENT, FAUXPLAT_MIN_LENGTH_KM };
