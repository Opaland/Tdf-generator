'use strict';
// Côtes = segments (Epic 31.3, option A décidée le 18/10/2026) : temps de
// montée d'une même côte d'une sortie à l'autre.
//
// La détection automatique (pipeline/climbs.js) ne place pas forcément le pied
// d'une même côte au même endroit d'une sortie à l'autre : comparer les durées
// de montée brutes comparerait des longueurs différentes. Chaque côte reçoit
// donc des repères fixes — pied et sommet de son PREMIER passage
// chronologique — et chaque passage est chronométré entre ces deux mêmes
// points. Un passage qui ne passe pas par les deux repères n'a pas de temps,
// avec sa raison ; rien n'est estimé.

const { haversine } = require('./geo');

// Deux sommets à moins de cette distance sont la même côte.
const SAME_SUMMIT_M = 150;
// Un échantillon est « au repère » à moins de cette distance. Les
// échantillons sont espacés de 100 m (250 m au-delà de 60 km,
// pipeline/importTrack.js) : la tolérance doit dépasser le demi-pas.
const AT_POINT_M = 150;
// Le pied de référence est cherché au plus à cette distance avant le sommet.
const MAX_CLIMB_SEARCH_M = 40000;

function nearestByDist(samples, targetM) {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i].dist_m - targetM) < Math.abs(samples[best].dist_m - targetM)) best = i;
  }
  return best;
}

/**
 * @param traces [{id, name, date}] — traces terminées
 * @param climbsByStage Map id → [{name, category, start_km, end_km, summit_ele_m}]
 * @param samplesByStage Map id → [{dist_m, lat, lon, elapsed_s}] triés par dist_m
 * @returns [{name, category, summitEleM, refLengthKm, count, timedCount, bestTimeS, passages}]
 */
function climbEfforts(traces, climbsByStage, samplesByStage) {
  // Ordre chronologique (date puis id) : le premier passage fixe les repères.
  const ordered = [...traces].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id - b.id);
  const groups = [];
  for (const t of ordered) {
    const samples = samplesByStage.get(t.id) || [];
    if (samples.length < 2) continue;
    for (const c of climbsByStage.get(t.id) || []) {
      if (c.start_km == null || c.end_km == null) continue;
      const si = nearestByDist(samples, c.start_km * 1000);
      const ei = nearestByDist(samples, c.end_km * 1000);
      if (ei <= si) continue;
      const summit = samples[ei];
      let g = groups.find((x) => haversine(x.refSummit, summit) <= SAME_SUMMIT_M);
      if (!g) {
        g = {
          refStart: samples[si], refSummit: summit,
          refLengthKm: Math.round((summit.dist_m - samples[si].dist_m) / 100) / 10,
          names: new Map(), category: null, summitEleM: null, passages: [],
        };
        groups.push(g);
      }
      if (c.name) g.names.set(c.name, (g.names.get(c.name) || 0) + 1);
      if (c.summit_ele_m != null && (g.summitEleM == null || c.summit_ele_m > g.summitEleM)) g.summitEleM = c.summit_ele_m;
      if (CATEGORY_RANK[c.category] > (CATEGORY_RANK[g.category] || 0)) g.category = c.category;
      // Numéro de montée dans la sortie : une côte gravie deux fois le même
      // jour donne deux passages, distingués à l'affichage.
      const ascent = g.passages.filter((p) => p.stageId === t.id).length + 1;
      g.passages.push({ stageId: t.id, stageName: t.name, date: t.date || null, ascent, ...passageTime(samples, ei, g) });
    }
  }
  return groups.map((g) => {
    const timed = g.passages.filter((p) => p.timeS != null);
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    return {
      name,
      category: g.category,
      summitEleM: g.summitEleM,
      refLengthKm: g.refLengthKm,
      count: g.passages.length,
      timedCount: timed.length,
      bestTimeS: timed.length ? Math.min(...timed.map((p) => p.timeS)) : null,
      passages: g.passages,
    };
  }).sort((a, b) => b.count - a.count || (b.summitEleM ?? -Infinity) - (a.summitEleM ?? -Infinity));
}

const { CATEGORY_RANK } = require('./climbs');

/** Temps entre le pied de référence et le sommet, sur ce passage-ci.
 * Le pied retenu est le DERNIER passage près du pied de référence avant le
 * sommet (premier rencontré en remontant), pas le plus proche sur 40 km : sur
 * une boucle qui part du pied puis y repasse, le départ — plus proche — aurait
 * chronométré la boucle entière (relecture adverse). Et la portion mesurée
 * doit avoir la longueur de référence, à 15 % ou 300 m près. */
function passageTime(samples, summitIdx, g) {
  if (haversine(samples[summitIdx], g.refSummit) > AT_POINT_M) return { timeS: null, reason: 'sommet' };
  let best = -1;
  let bestD = Infinity;
  for (let i = summitIdx - 1; i >= 0 && samples[summitIdx].dist_m - samples[i].dist_m <= MAX_CLIMB_SEARCH_M; i--) {
    const d = haversine(samples[i], g.refStart);
    if (d <= AT_POINT_M) {
      if (d < bestD) { bestD = d; best = i; }
    } else if (best !== -1) {
      break; // sorti du voisinage du pied le plus récent : on s'arrête là
    }
  }
  if (best === -1) return { timeS: null, reason: 'pied' };
  const lengthM = samples[summitIdx].dist_m - samples[best].dist_m;
  const refM = g.refLengthKm * 1000;
  if (Math.abs(lengthM - refM) > Math.max(300, refM * 0.15)) return { timeS: null, reason: 'pied' };
  const a = samples[best].elapsed_s;
  const b = samples[summitIdx].elapsed_s;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { timeS: null, reason: 'sans-temps' };
  if (!(b > a)) return { timeS: null, reason: 'sans-temps' };
  return { timeS: Math.round(b - a), reason: null };
}

module.exports = { climbEfforts, SAME_SUMMIT_M, AT_POINT_M };
