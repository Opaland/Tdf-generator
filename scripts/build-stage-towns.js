'use strict';
// Construit pipeline/data/stage_towns.json (Epic 32.4) : villes de départ et
// d'arrivée de toutes les étapes de toutes les éditions (Wikipédia, CC BY-SA),
// géocodées une fois, pour que la recherche par lieu couvre toute l'histoire
// du Tour et pas seulement les étapes curées.
//
// Usage : node scripts/build-stage-towns.js   (réseau requis, ~10-15 min)
//
// Géocodage : une commune française est cherchée dans l'index des communes
// de l'IGN (nom exact ; département Wikipédia s'il est donné ; sinon la plus
// peuplée — les villes-étapes sont des villes). Un homonyme de taille
// comparable est marqué `ambigu`. Une ville étrangère passe par le géocodeur
// général avec son pays. Un échec est consigné, jamais deviné (règle 12).

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.ETAPEFORGE_DATA_DIR = process.env.ETAPEFORGE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-towns-'));

const { fetchEditionHtml, parseStagesFromHtml, FRENCH_DEPARTMENTS } = require('../pipeline/wikipedia');
const { allTdfYears } = require('../pipeline/importer');
const { communeCandidates, geocode, normName } = require('../pipeline/geocode');
const { httpJson } = require('../pipeline/http');
const { haversine } = require('../pipeline/geo');

const OUT = path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json');
const FEMMES_YEARS = [2022, 2023, 2024, 2025, 2026];

const townCache = new Map();
async function resolveTown(label, country, department) {
  const key = `${label}|${country || ''}|${department || ''}`;
  if (townCache.has(key)) return townCache.get(key);
  let r = null;
  try {
    if (country && !/^france$/i.test(country)) {
      const g = await geocode(label, { countryHint: country });
      if (g && Number.isFinite(g.lat)) r = { lat: round(g.lat), lon: round(g.lon), how: 'geocode-pays', confidence: 'ok' };
    } else {
      let exact = (await communeCandidates(label)).filter((c) => normName(c.name) === normName(label));
      const dep = department ? FRENCH_DEPARTMENTS[department] : null;
      if (dep) exact = exact.filter((c) => c.depcode === dep);
      exact.sort((a, b) => (b.population || 0) - (a.population || 0));
      if (exact.length) {
        const [a, b] = exact;
        const ambiguous = !dep && b && (b.population || 0) * 10 >= (a.population || 0);
        r = { lat: round(a.lat), lon: round(a.lon), how: 'commune-ign', dep: a.depcode, confidence: ambiguous ? 'ambigu' : 'ok' };
      } else {
        const g = await geocode(label);
        if (g && Number.isFinite(g.lat)) r = { lat: round(g.lat), lon: round(g.lon), how: 'geocode', confidence: 'approx' };
      }
    }
  } catch (err) {
    r = { error: String(err.message || err).slice(0, 160) };
  }
  townCache.set(key, r);
  return r;
}

const round = (v) => Math.round(v * 1e5) / 1e5;

// ---------------------------------------------------------------- vérification

/** Contrainte physique : départ et arrivée d'une étape ne peuvent pas être
 * plus éloignés à vol d'oiseau que la longueur de l'étape (marge 10 % +
 * 10 km pour le géocodage au centre-ville). */
const maxCrowM = (km) => (km * 1.1 + 10) * 1000;

/** Identité d'une ville dans la vérification : libellé ET position. Un même
 * libellé peut être géocodé différemment selon l'édition (« Geneva » avec le
 * pays donné par Wikipédia → Suisse ; sans pays → homonyme français) : les
 * confondre faisait juger la bonne position à la place de la mauvaise. */
const townKey = (t) => `${t.label}@${Number.isFinite(t.lat) ? `${t.lat},${t.lon}` : '?'}`;
const keyLabel = (k) => k.slice(0, k.lastIndexOf('@'));

/** Arêtes (étapes) : [{ a, b, maxM }] où a/b sont des clés de ville (townKey). */
function stageEdges(editions) {
  const edges = [];
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) {
      if (!s.distanceKm || s.start.label === s.finish.label) continue;
      edges.push({ a: townKey(s.start), b: townKey(s.finish), maxM: maxCrowM(s.distanceKm), km: s.distanceKm });
    }
  }
  return edges;
}

/** Violations par ville avec les positions actuelles `pos` (label → {lat, lon}). */
function violations(edges, pos) {
  const v = new Map();
  for (const e of edges) {
    const pa = pos.get(e.a);
    const pb = pos.get(e.b);
    if (!pa || !pb || haversine(pa, pb) <= e.maxM) continue;
    v.set(e.a, (v.get(e.a) || 0) + 1);
    v.set(e.b, (v.get(e.b) || 0) + 1);
  }
  return v;
}

async function nominatimCandidates(label) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(label)}`;
  try {
    const r = await httpJson(url, { minDelayMs: 1100 });
    return (r || []).map((x) => ({ lat: round(Number(x.lat)), lon: round(Number(x.lon)), how: 'nominatim' })).filter((c) => Number.isFinite(c.lat));
  } catch {
    return [];
  }
}

/** Un REMPLACEMENT doit être plausible, pas seulement compatible : sur une
 * étape de plus de 30 km, la distance à vol d'oiseau ne dépasse pas 90 % de
 * la longueur de l'étape (une route n'est jamais presque droite). Sans cela,
 * « Les Arcs » (Savoie) se retrouvait en Haute-Saône, à une distance
 * compatible mais au mauvais endroit. Pas de borne basse : une étape en
 * boucle (Leeds → Harrogate, 190 km pour 25 km à vol d'oiseau) est réelle. */
function plausible(edges, pos, label, c) {
  for (const e of edges) {
    if (e.a !== label && e.b !== label) continue;
    const other = pos.get(e.a === label ? e.b : e.a);
    if (!other) continue;
    const d = haversine(c, other);
    if (d > e.maxM) return false;
    if (e.km > 30 && d > e.km * 1000 * 0.9) return false;
  }
  return true;
}

/** Nombre d'étapes (arêtes) par ville. */
function degrees(edges) {
  const d = new Map();
  for (const e of edges) for (const t of [e.a, e.b]) d.set(t, (d.get(t) || 0) + 1);
  return d;
}

/**
 * Corrige les villes en contradiction avec la longueur des étapes voisines.
 * Une ville est SUSPECTE si sa position est déjà incertaine (approx/ambigu)
 * et contredite au moins une fois, ou si la MAJORITÉ de ses étapes la
 * contredisent — jamais une grande ville cohérente avec des dizaines
 * d'étapes parce qu'une seule (voisine mal placée, distance Wikipédia mal
 * lue) la contredit (premier jet : Lyon, Toulouse retirées à tort). Pour une
 * suspecte : d'autres candidats (communes IGN, noms composés type « Vire
 * Normandie », puis Nominatim sans filtre de pays) ; le premier qui ne
 * contredit aucune voisine fiable est gardé, sinon la position est retirée.
 */
async function realCandidates(label) {
  // Communes au nom exact, ou commune nouvelle qui le prolonge (« Vire » →
  // « Vire Normandie ») — jamais une correspondance partielle (« Grand
  // Colombier » → une commune « Colombier » de la Loire).
  const want = normName(label);
  const named = (await communeCandidates(label)).filter((c) => {
    const n = normName(c.name);
    return n === want || n.startsWith(`${want} `) || n.startsWith(`${want}-`);
  });
  return [
    ...named.map((c) => ({ lat: round(c.lat), lon: round(c.lon), how: 'commune-ign' })),
    ...(await nominatimCandidates(label)),
  ];
}

async function verify(editions, failures, candidatesFor = realCandidates, log = console.log) {
  const edges = stageEdges(editions);
  const deg = degrees(edges);
  const pos = new Map();
  const conf = new Map();
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) {
      for (const t of [s.start, s.finish]) {
        if (Number.isFinite(t.lat)) { pos.set(townKey(t), { lat: t.lat, lon: t.lon }); conf.set(townKey(t), t.confidence); }
      }
    }
  }
  const fixed = new Map();
  for (let pass = 0; pass < 3; pass++) {
    const v = violations(edges, pos);
    const suspects = [...v.entries()]
      .filter(([label, n]) => !fixed.has(label) && ((conf.get(label) !== 'ok' && n >= 1) || n * 2 > (deg.get(label) || 0)))
      // Positions déjà incertaines d'abord : quand une ville fiable est
      // contredite par des voisines mal placées, ce sont elles les fautives.
      .sort((x, y) => (conf.get(x[0]) === 'ok') - (conf.get(y[0]) === 'ok') || y[1] / deg.get(y[0]) - x[1] / deg.get(x[0]))
      .map(([label]) => label);
    if (!suspects.length) break;
    for (const label of suspects) {
      if (!violations(edges, pos).get(label)) continue; // déjà résolu par la correction d'une voisine
      const cands = await candidatesFor(keyLabel(label));
      const count = (c) => { const before = pos.get(label); pos.set(label, c); const n = violations(edges, pos).get(label) || 0; if (before) pos.set(label, before); else pos.delete(label); return n; };
      const good = cands.find((c) => count(c) === 0 && plausible(edges, pos, label, c));
      if (good) {
        pos.set(label, good);
        fixed.set(label, { ...good, confidence: 'verifie' });
      } else {
        pos.delete(label);
        fixed.set(label, null);
        failures.push({ label: keyLabel(label), error: 'aucune position compatible avec la longueur des étapes voisines — retirée' });
      }
      log(`  ${good ? '↻' : '✗'} ${keyLabel(label)}${good ? ` → ${good.lat}, ${good.lon} (${good.how})` : ' : position retirée'}`);
    }
  }
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) {
      for (const k of ['start', 'finish']) {
        const key = townKey(s[k]);
        if (!fixed.has(key)) continue;
        const f = fixed.get(key);
        s[k] = f ? { label: s[k].label, lat: f.lat, lon: f.lon, how: f.how, confidence: f.confidence } : { label: s[k].label };
      }
    }
  }
  // Contradictions restantes : entre deux villes fiables (distance Wikipédia
  // probablement mal lue) — positions conservées, étapes listées.
  const left = [];
  for (const e of edges) {
    const pa = pos.get(e.a);
    const pb = pos.get(e.b);
    if (pa && pb && haversine(pa, pb) > e.maxM) left.push(`${keyLabel(e.a)} → ${keyLabel(e.b)}`);
  }
  return left;
}

async function main() {
  if (process.argv.includes('--verify-only')) {
    const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const left = await verify(doc.editions, doc.failures);
    doc.unverifiedStages = left;
    fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
    console.log(`Vérification : ${left.length} étape(s) encore contradictoire(s) → ${path.relative(process.cwd(), OUT)}`);
    return;
  }
  const editions = {};
  const failures = [];
  const jobs = [...allTdfYears().map((y) => [y, 'hommes']), ...FEMMES_YEARS.map((y) => [y, 'femmes'])];
  for (const [year, category] of jobs) {
    const key = category === 'femmes' ? `${year}-femmes` : String(year);
    let stages;
    try {
      stages = parseStagesFromHtml(await fetchEditionHtml(year, category), year);
    } catch (err) {
      failures.push({ edition: key, error: String(err.message || err).slice(0, 160) });
      console.log(`✗ ${key} : ${err.message}`);
      continue;
    }
    const out = [];
    for (const s of stages) {
      const start = await resolveTown(s.start, s.startCountry, s.startDepartment);
      const finish = s.finish === s.start && s.finishCountry === s.startCountry ? start : await resolveTown(s.finish, s.finishCountry, s.finishDepartment);
      for (const [label, t] of [[s.start, start], [s.finish, finish]]) {
        if (!t || t.error) failures.push({ edition: key, stage: s.number, label, error: t?.error || 'introuvable' });
      }
      out.push({
        number: s.number, prologue: !!s.isPrologue, date: s.dateIso || null, distanceKm: s.distanceKm ?? null,
        start: { label: s.start, ...(start && !start.error ? start : {}) },
        finish: { label: s.finish, ...(finish && !finish.error ? finish : {}) },
      });
    }
    editions[key] = { category, stages: out };
    console.log(`✔ ${key} : ${out.length} étapes`);
  }
  console.log('\nVérification par la longueur des étapes…');
  const left = await verify(editions, failures);
  console.log(`${left.length} étape(s) encore contradictoire(s) entre deux villes fiables : ${left.join(' ; ')}`);
  const doc = {
    _notes: "Villes de départ/arrivée de chaque étape (Wikipédia anglais, CC BY-SA), géocodées par scripts/build-stage-towns.js (Epic 32.4). " +
      "confidence : ok | ambigu (homonyme de taille comparable, la plus peuplée retenue) | approx (géocodeur général, pas l'index des communes) | verifie (position corrigée : la seule compatible avec la longueur des étapes voisines). " +
      'Toute position contredisant la longueur d\'une étape a été corrigée ou retirée (failures). ' +
      'Points seulement : le parcours entre les deux villes n\'est pas connu ici.',
    generatedAt: new Date().toISOString().slice(0, 10),
    editions,
    failures,
    unverifiedStages: left,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  const n = Object.values(editions).reduce((a, e) => a + e.stages.length, 0);
  console.log(`\n${Object.keys(editions).length} éditions, ${n} étapes, ${failures.length} échec(s) → ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { verify, maxCrowM };
