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

module.exports = { analyzeByKm };
