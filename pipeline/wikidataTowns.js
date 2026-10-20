'use strict';
// Recoupement des villes de départ et d'arrivée avec Wikidata (backlog 34.1).
// Wikidata (CC0) relie chaque étape d'une édition (P361 « partie de ») à sa
// ville de départ (P1427) et d'arrivée (P1444), avec la distance (P3157) et
// la date (P585) ; la ville porte ses coordonnées (P625). Un écart de
// position avec pipeline/data/stage_towns.json désigne vraisemblablement un
// homonyme géocodé à la place de la bonne ville.
//
// Ce module ne modifie aucune donnée : il produit un rapport. Toute
// correction passe par la curation, source citée (CLAUDE.md règle 12).

const { haversine } = require('./geo');

// Au-delà, la ville géocodée n'est pas celle de Wikidata (même seuil que la
// confirmation Nominatim de scripts/build-stage-towns.js).
const TOWN_MISMATCH_M = 10000;
// Écart de distance signalé : 5 %, la tolérance de la curation.
const DISTANCE_MISMATCH_PCT = 5;

/** Requête SPARQL d'une édition, par son libellé anglais exact. */
function editionQuery(year, category) {
  const label = category === 'femmes' ? `${year} Tour de France Femmes` : `${year} Tour de France`;
  return `SELECT ?s ?d ?start ?startLabel ?sc ?end ?endLabel ?ec ?dist WHERE {
  ?ed rdfs:label "${label}"@en .
  ?s wdt:P361 ?ed .
  OPTIONAL { ?s wdt:P585 ?d }
  OPTIONAL { ?s wdt:P1427 ?start . OPTIONAL { ?start wdt:P625 ?sc } }
  OPTIONAL { ?s wdt:P1444 ?end . OPTIONAL { ?end wdt:P625 ?ec } }
  OPTIONAL { ?s wdt:P3157 ?dist }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}`;
}

/** « Point(lon lat) » → { lat, lon }, null si absent ou illisible. */
function parsePoint(wkt) {
  const m = /^Point\((-?[\d.]+) (-?[\d.]+)\)$/.exec(wkt || '');
  return m ? { lat: Number(m[2]), lon: Number(m[1]) } : null;
}

const qid = (uri) => (uri ? String(uri).split('/').pop() : null);

/**
 * Lignes SPARQL (JSON « results.bindings ») → étapes Wikidata. Une étape
 * peut avoir plusieurs lignes (deux coordonnées pour une ville) : la
 * première est gardée.
 */
function stagesFromBindings(bindings) {
  const byStage = new Map();
  for (const b of bindings || []) {
    const id = qid(b.s?.value);
    if (!id || byStage.has(id)) continue;
    const dist = b.dist ? Number(b.dist.value) : null;
    byStage.set(id, {
      qid: id,
      date: b.d ? b.d.value.slice(0, 10) : null,
      distanceKm: Number.isFinite(dist) ? dist : null,
      start: b.start ? { qid: qid(b.start.value), label: b.startLabel?.value || null, ...(parsePoint(b.sc?.value) || {}) } : null,
      finish: b.end ? { qid: qid(b.end.value), label: b.endLabel?.value || null, ...(parsePoint(b.ec?.value) || {}) } : null,
    });
  }
  return [...byStage.values()];
}

// Une date peut différer d'un jour (parfois deux) entre les deux sources :
// au-delà, ce n'est plus la même étape.
const DATE_WINDOW_DAYS = 2;
// Écart de distance ignoré en dessous de ce seuil absolu : les prologues de
// quelques km dépassent 5 % sur un simple arrondi (4 km contre 4,3).
const DISTANCE_MIN_GAP_KM = 1;

const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const near = (a, b) => a && b && Number.isFinite(a.lat) && Number.isFinite(b.lat) && haversine(a, b) <= TOWN_MISMATCH_M;
/** Mêmes villes de départ et d'arrivée (à 10 km près) : la même étape. */
const sameTowns = (o, w) => near(o.start, w.start) && near(o.finish, w.finish);

/**
 * Apparie nos étapes et celles de Wikidata (relecture adverse : la date
 * seule appariait l'étape voisine quand les deux sources diffèrent d'un
 * jour, ce qui fabriquait de faux homonymes et de fausses « absences »).
 * 1. mêmes villes, même jour ; 2. mêmes villes, à ±2 jours (date
 *    décalée, signalée comme telle) ; 3. pour le reste, même jour, distance
 *    la plus proche (demi-étapes) — c'est là qu'un homonyme se voit.
 * Chaque étape Wikidata sert au plus une fois.
 * @returns [{ ours, wd, dateShift }] (wd null si aucune étape ne convient)
 */
function matchStages(ours, wdStages) {
  const free = new Set(wdStages);
  const out = ours.map((o) => ({ ours: o, wd: null, dateShift: 0 }));
  const take = (m, w) => { m.wd = w; m.dateShift = m.ours.date && w.date ? dayDiff(w.date, m.ours.date) : 0; free.delete(w); };
  for (const pass of [(d) => d === 0, (d) => Math.abs(d) <= DATE_WINDOW_DAYS]) {
    for (const m of out) {
      if (m.wd || !m.ours.date) continue;
      const w = [...free].find((x) => x.date && pass(dayDiff(x.date, m.ours.date)) && sameTowns(m.ours, x));
      if (w) take(m, w);
    }
  }
  for (const m of out) {
    if (m.wd) continue;
    const pool = [...free].filter((w) => w.date && w.date === m.ours.date);
    if (!pool.length) continue;
    const gap = (w) => (Number.isFinite(w.distanceKm) && Number.isFinite(m.ours.distanceKm) ? Math.abs(w.distanceKm - m.ours.distanceKm) : Infinity);
    take(m, pool.reduce((a, b) => (gap(b) < gap(a) ? b : a)));
  }
  return out;
}

/** Libellé unique d'une étape (deux demi-étapes portent le même numéro). */
function stageKeys(key, ours) {
  const seen = new Map();
  for (const o of ours) seen.set(o.number, (seen.get(o.number) || 0) + 1);
  const rank = new Map();
  return ours.map((o) => {
    if (o.prologue) return `${key}/prologue`;
    if (seen.get(o.number) === 1) return `${key}/${o.number}`;
    const r = (rank.get(o.number) || 0) + 1;
    rank.set(o.number, r);
    return `${key}/${o.number}${String.fromCharCode(96 + r)}`;
  });
}

/**
 * Écarts d'une édition : position de ville (> 10 km de la ville Wikidata),
 * distance (> 5 % et > 1 km), date décalée, étape sans correspondance. Une
 * donnée manquante d'un côté n'est jamais comptée comme un écart.
 */
function compareEdition(key, ourStages, wdStages) {
  const findings = [];
  const keys = stageKeys(key, ourStages);
  matchStages(ourStages, wdStages).forEach(({ ours, wd, dateShift }, idx) => {
    const where = keys[idx];
    if (!wd) { findings.push({ where, kind: 'absente', detail: `aucune étape Wikidata aux mêmes villes à ±${DATE_WINDOW_DAYS} jours, ni le même jour (${ours.date || 'date inconnue'})` }); return; }
    if (dateShift) findings.push({ where, kind: 'date', qid: wd.qid, detail: `le ${ours.date} ici, le ${wd.date} sur Wikidata (mêmes villes)` });
    for (const end of ['start', 'finish']) {
      const a = ours[end];
      const b = wd[end];
      if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;
      const d = haversine(a, b);
      if (d > TOWN_MISMATCH_M) {
        findings.push({
          where, kind: end === 'start' ? 'départ' : 'arrivée', qid: b.qid,
          detail: `« ${a.label} » placé à ${Math.round(d / 1000)} km de « ${b.label} » (Wikidata ${b.qid})`,
          distanceM: Math.round(d), confidence: a.confidence || null,
        });
      }
    }
    if (Number.isFinite(ours.distanceKm) && Number.isFinite(wd.distanceKm) && wd.distanceKm > 0) {
      const gap = ours.distanceKm - wd.distanceKm;
      const pct = (gap / wd.distanceKm) * 100;
      if (Math.abs(pct) > DISTANCE_MISMATCH_PCT && Math.abs(gap) >= DISTANCE_MIN_GAP_KM) {
        findings.push({ where, kind: 'distance', qid: wd.qid, detail: `${ours.distanceKm} km ici, ${wd.distanceKm} km sur Wikidata (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)` });
      }
    }
  });
  return findings;
}

module.exports = { editionQuery, parsePoint, stagesFromBindings, matchStages, compareEdition, stageKeys, TOWN_MISMATCH_M, DISTANCE_MISMATCH_PCT, DATE_WINDOW_DAYS, DISTANCE_MIN_GAP_KM };
