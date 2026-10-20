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

/**
 * Apparie nos étapes et celles de Wikidata : par date, puis, pour plusieurs
 * étapes le même jour (demi-étapes), par distance la plus proche.
 * @returns [{ ours, wd }] (wd null si aucune étape Wikidata ce jour-là)
 */
function matchStages(ours, wdStages) {
  const byDate = new Map();
  for (const w of wdStages) {
    if (!w.date) continue;
    if (!byDate.has(w.date)) byDate.set(w.date, []);
    byDate.get(w.date).push(w);
  }
  return ours.map((o) => {
    const pool = byDate.get(o.date) || [];
    if (!pool.length) return { ours: o, wd: null };
    let best = 0;
    if (pool.length > 1 && Number.isFinite(o.distanceKm)) {
      const gap = (w) => (Number.isFinite(w.distanceKm) ? Math.abs(w.distanceKm - o.distanceKm) : Infinity);
      pool.forEach((w, i) => { if (gap(w) < gap(pool[best])) best = i; });
    }
    return { ours: o, wd: pool.splice(best, 1)[0] };
  });
}

/**
 * Écarts d'une édition : position de ville (> 10 km de la ville Wikidata),
 * distance (> 5 %), étape absente de Wikidata. Une donnée manquante d'un
 * côté n'est jamais comptée comme un écart (rien à comparer).
 */
function compareEdition(key, ourStages, wdStages) {
  const findings = [];
  for (const { ours, wd } of matchStages(ourStages, wdStages)) {
    const where = `${key}/${ours.prologue ? 'prologue' : ours.number}`;
    if (!wd) { findings.push({ where, kind: 'absente', detail: `aucune étape Wikidata le ${ours.date || '?'}` }); continue; }
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
      const pct = ((ours.distanceKm - wd.distanceKm) / wd.distanceKm) * 100;
      if (Math.abs(pct) > DISTANCE_MISMATCH_PCT) {
        findings.push({ where, kind: 'distance', qid: wd.qid, detail: `${ours.distanceKm} km ici, ${wd.distanceKm} km sur Wikidata (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)` });
      }
    }
  }
  return findings;
}

module.exports = { editionQuery, parsePoint, stagesFromBindings, matchStages, compareEdition, TOWN_MISMATCH_M, DISTANCE_MISMATCH_PCT };
