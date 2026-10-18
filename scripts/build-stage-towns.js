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

async function main() {
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
  const doc = {
    _notes: "Villes de départ/arrivée de chaque étape (Wikipédia anglais, CC BY-SA), géocodées par scripts/build-stage-towns.js (Epic 32.4). " +
      "confidence : ok | ambigu (homonyme de taille comparable, la plus peuplée retenue) | approx (géocodeur général, pas l'index des communes). " +
      'Points seulement : le parcours entre les deux villes n\'est pas connu ici.',
    generatedAt: new Date().toISOString().slice(0, 10),
    editions,
    failures,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  const n = Object.values(editions).reduce((a, e) => a + e.stages.length, 0);
  console.log(`\n${Object.keys(editions).length} éditions, ${n} étapes, ${failures.length} échec(s) → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
