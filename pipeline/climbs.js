'use strict';
// Détection des côtes sur le profil lissé : segment continu ≥ 1,5 km à ≥ 3 % de
// moyenne, fusion de deux montées séparées par un replat/descente < 500 m.
// Catégorisation approx ASO : score = longueur_km × pente_moyenne_%.
//   > 80 → HC ; > 32 → cat.1 ; > 16 → cat.2 ; > 6 → cat.3 ; sinon cat.4.

const MIN_LENGTH_M = 1500;
const MIN_AVG_GRADIENT = 3; // %
const MERGE_GAP_M = 500;

function categorize(score) {
  if (score > 80) return 'HC';
  if (score > 32) return '1';
  if (score > 16) return '2';
  if (score > 6) return '3';
  return '4';
}

/**
 * Détecte les côtes.
 * @param samples [{dist, eleRaw?, eleSmooth}] triés par dist (m) — la détection
 *                utilise eleSmooth ; l'altitude de sommet rapportée utilise
 *                eleRaw si présent.
 * @returns [{ startM, endM, lengthKm, startEle, summitEle, avgGradient,
 *             maxGradient, score, category, kmBlocks }]
 */
function detectClimbs(samples) {
  if (samples.length < 3) return [];
  const ele = (s) => (s.eleSmooth != null ? s.eleSmooth : s.ele);

  // 1) Segments élémentaires en montée (pente > 0 entre échantillons consécutifs).
  //    On repère les portions montantes, puis on les fusionne si l'interruption
  //    (replat ou légère descente) fait moins de MERGE_GAP_M.
  const rises = [];
  let cur = null;
  for (let i = 1; i < samples.length; i++) {
    const dd = samples[i].dist - samples[i - 1].dist;
    if (dd <= 0) continue;
    const de = ele(samples[i]) - ele(samples[i - 1]);
    const g = (de / dd) * 100;
    if (g > 0.5) {
      if (!cur) cur = { startIdx: i - 1, endIdx: i };
      else cur.endIdx = i;
    } else if (cur) {
      rises.push(cur);
      cur = null;
    }
  }
  if (cur) rises.push(cur);

  // 2) Fusion des montées proches (< MERGE_GAP_M entre fin et début suivant).
  const merged = [];
  for (const r of rises) {
    const last = merged[merged.length - 1];
    if (last && samples[r.startIdx].dist - samples[last.endIdx].dist < MERGE_GAP_M) {
      last.endIdx = r.endIdx;
    } else {
      merged.push({ ...r });
    }
  }

  // 3) Ajustement des bornes : on rogne la tête/queue tant que la pente moyenne
  //    du candidat est < MIN_AVG_GRADIENT (replats de fusion en bordure).
  const climbs = [];
  for (const m of merged) {
    let s = m.startIdx;
    let e = m.endIdx;
    const avg = (i, j) =>
      ((ele(samples[j]) - ele(samples[i])) / Math.max(1, samples[j].dist - samples[i].dist)) * 100;
    while (e > s + 1 && avg(s, e) < MIN_AVG_GRADIENT) {
      // rogne le côté le moins pentu
      if (avg(s, s + 1) < avg(e - 1, e)) s++;
      else e--;
    }
    const lengthM = samples[e].dist - samples[s].dist;
    const avgGradient = avg(s, e);
    if (lengthM < MIN_LENGTH_M || avgGradient < MIN_AVG_GRADIENT) continue;

    // Pente max sur une fenêtre de 100 m (ou la résolution d'échantillonnage).
    let maxGradient = 0;
    for (let i = s + 1; i <= e; i++) {
      const dd = samples[i].dist - samples[i - 1].dist;
      if (dd > 0) maxGradient = Math.max(maxGradient, ((ele(samples[i]) - ele(samples[i - 1])) / dd) * 100);
    }

    // Altitude de sommet : max du brut sur la montée si disponible.
    let summitEle = ele(samples[e]);
    if (samples[0].eleRaw != null) {
      for (let i = s; i <= e; i++) summitEle = Math.max(summitEle, samples[i].eleRaw);
    }

    const lengthKm = lengthM / 1000;
    const score = lengthKm * avgGradient;

    // Blocs de 1 km pour la fiche « côte par côte » (profil type ASO).
    const kmBlocks = [];
    const startM = samples[s].dist;
    const nBlocks = Math.ceil(lengthM / 1000);
    for (let b = 0; b < nBlocks; b++) {
      const fromM = startM + b * 1000;
      const toM = Math.min(startM + (b + 1) * 1000, samples[e].dist);
      const eAt = (target) => {
        let i = s;
        while (i < e && samples[i + 1].dist <= target) i++;
        if (i >= e) return ele(samples[e]);
        const d0 = samples[i].dist;
        const d1 = samples[i + 1].dist;
        const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
        return ele(samples[i]) + t * (ele(samples[i + 1]) - ele(samples[i]));
      };
      const ele0 = eAt(fromM);
      const ele1 = eAt(toM);
      const len = toM - fromM;
      if (len < 50) continue;
      kmBlocks.push({
        fromM: Math.round(fromM),
        toM: Math.round(toM),
        ele0: Math.round(ele0),
        ele1: Math.round(ele1),
        gradient: Math.round(((ele1 - ele0) / len) * 1000) / 10,
      });
    }

    climbs.push({
      startM: Math.round(samples[s].dist),
      endM: Math.round(samples[e].dist),
      lengthKm: Math.round(lengthKm * 100) / 100,
      startEle: Math.round(ele(samples[s])),
      summitEle: Math.round(summitEle),
      avgGradient: Math.round(avgGradient * 10) / 10,
      maxGradient: Math.round(maxGradient * 10) / 10,
      score: Math.round(score * 10) / 10,
      category: categorize(score),
      kmBlocks,
    });
  }
  return climbs;
}

/**
 * Nomme chaque côte : waypoint de type col le plus proche du sommet (< 1 km le
 * long du tracé), sinon géocodage inverse du point sommet.
 */
async function nameClimbs(climbs, waypointsOnTrack, samples, reverseGeocodeFn) {
  const ele = (s) => (s.eleSmooth != null ? s.eleSmooth : s.ele);
  for (const c of climbs) {
    const summitWp = (waypointsOnTrack || []).find(
      (w) => (w.kind === 'col' || w.kind === 'peak') && Math.abs(w.alongM - c.endM) < 1500
    );
    if (summitWp) {
      c.name = summitWp.label;
      c.nameSource = 'waypoint';
      continue;
    }
    // Point du sommet → géocodage inverse.
    let si = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i].dist - c.endM) < Math.abs(samples[si].dist - c.endM)) si = i;
    }
    try {
      const r = await reverseGeocodeFn(samples[si].lat, samples[si].lon);
      c.name = r && r.label ? `Côte de ${r.label}` : `Côte du km ${(c.endM / 1000).toFixed(0)}`;
      c.nameSource = 'reverse-geocode';
    } catch {
      c.name = `Côte du km ${(c.endM / 1000).toFixed(0)}`;
      c.nameSource = 'defaut';
    }
    void ele;
  }
  return climbs;
}

module.exports = { detectClimbs, nameClimbs, categorize, MIN_LENGTH_M, MIN_AVG_GRADIENT, MERGE_GAP_M };
