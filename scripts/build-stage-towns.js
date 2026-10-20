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

const { fetchEditionHtml, parseStagesFromHtml, FRENCH_DEPARTMENTS, KNOWN_COLS } = require('../pipeline/wikipedia');
const { allTdfYears } = require('../pipeline/importer');
const { communeCandidates, geocode, normName } = require('../pipeline/geocode');
const { httpJson } = require('../pipeline/http');
const { haversine } = require('../pipeline/geo');
const { cached } = require('../pipeline/cache');

const OUT = path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json');
const OVERRIDES = path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns_overrides.json');

/**
 * Réapplique les positions vérifiées à la main (Epic 33.9) : une
 * régénération redonnait sinon le centre du département pour le Puy de
 * Dôme, le centre du pays pour Luxembourg… Une occurrence précise
 * (« édition/étape/start|finish ») prime sur le libellé. Confiance « ok »
 * par défaut, l'entrée peut la fixer (« douteux » reste exclu de la
 * recherche). Retourne le nombre de positions réappliquées.
 */
function applyOverrides(editions, overrides) {
  const towns = overrides.towns || {};
  const occ = overrides.occurrences || {};
  let n = 0;
  for (const [key, ed] of Object.entries(editions)) {
    for (const s of ed.stages) {
      for (const side of ['start', 'finish']) {
        const t = s[side];
        if (!t) continue;
        const byOcc = occ[`${key}/${s.number}/${side}`];
        const o = byOcc || towns[t.label];
        if (!o) continue;
        // Une entrée sans coordonnées effacerait la position en silence.
        if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) throw new Error(`stage_towns_overrides : ${t.label} sans lat/lon valides`);
        // `label` : seulement par occurrence (Epic 33.18, nom pris à un lien
        // Wikipédia faux) ; par libellé, il renommerait toutes les éditions.
        if (o.label != null && (!byOcc || typeof o.label !== 'string' || !o.label.trim())) throw new Error(`stage_towns_overrides : label refusé pour ${t.label} (occurrence seulement, texte non vide)`);
        const label = o.label ? o.label.trim() : t.label;
        // Le département venait de l'ancien libellé : il ne suit pas un renommage.
        const dep = t.dep && label === t.label ? { dep: t.dep } : {};
        s[side] = { label, ...dep, lat: o.lat, lon: o.lon, how: o.how, confidence: o.confidence || 'ok', note: o.note };
        n++;
      }
    }
  }
  return n;
}

/** Fichier absent ou mal formé : erreur, jamais une régénération écrite
 * sans les corrections (relecture adverse). */
function readOverrides(file = OVERRIDES) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Seule écriture de stage_towns.json : positions vérifiées réappliquées
 * juste avant (régénération complète comme --verify-only). */
function writeStageTowns(doc, out = OUT, overrides = readOverrides()) {
  const n = applyOverrides(doc.editions, overrides);
  fs.writeFileSync(out, JSON.stringify(doc) + '\n');
  return n;
}
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
    const { value: r } = await cached('geocode', 'nominatim-towns', { q: label }, () => httpJson(url, { minDelayMs: 1100 }));
    // Lieux nommés seulement (localité, sommet/col, lac, site touristique) :
    // jamais une rue, un arrêt de bus, un bâtiment ou un bureau homonyme —
    // « Méribel » renvoyait d'abord un arrêt de bus près de Sallanches,
    // « Luxembourg City » une ambassade à Londres.
    const NAMED_PLACE = new Set(['place', 'boundary', 'natural', 'mountain_pass', 'tourism', 'leisure', 'landuse', 'water', 'waterway']);
    return (r || [])
      .filter((x) => NAMED_PLACE.has(x.class) || (x.class === 'highway' && x.type === 'mountain_pass'))
      .map((x) => ({ lat: round(Number(x.lat)), lon: round(Number(x.lon)), how: 'nominatim', osmClass: x.class, addresstype: x.addresstype || null }))
      .filter((c) => Number.isFinite(c.lat));
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

/**
 * Contre-vérification indépendante (relecture adverse) : la contrainte de
 * longueur ne voit pas une position fausse quand les étapes voisines sont
 * longues (Les Menuires placées à Romans-sur-Isère, Luxembourg-Ville à
 * Nommern). Toute position qui ne vient PAS de l'index des communes IGN est
 * comparée au premier résultat Nominatim (sans filtre de pays) :
 * - à moins de 10 km → confirmée (`ok`) ;
 * - désaccord → la position Nominatim n'est retenue (`verifie`) que si elle
 *   est plausible avec au moins une étape voisine contraignante ET que
 *   l'actuelle ne l'est pas ; sinon `douteux`. Sans ce garde-fou, une ville
 *   sans contrainte (étapes en circuit : « West Berlin ») partait au New
 *   Jersey, et une position juste (« Evian ») était remplacée par un
 *   homonyme valdôtain plausible lui aussi ;
 * - aucun résultat → `douteux`.
 * Une position `douteux` reste dans le fichier (traçabilité) mais n'est
 * jamais utilisée par la recherche (pipeline/placeSearch.js).
 */
// L'index IGN donne le centre géographique de la commune, pas la ville :
// Pau à 3 km, Avignon 3,7, Limoges 4,1, Bagnères-de-Bigorre 7,7 (Epic
// 33.10). Une commune IGN est recalée sur le point OSM de localité du même
// nom le plus proche, à moins de SNAP_M — même règle que
// scripts/geocode-itineraries.js (snapToTown), jamais un quartier ni une
// entité administrative (« municipality » d'Avignon : 11 km à l'est).
const SNAP_M = 8000;
const SNAP_TYPES = new Set(['city', 'town', 'village', 'hamlet']);
async function snapCommuneAnchors(editions, candidatesFor = nominatimCandidates, log = console.log) {
  const done = new Map();
  let n = 0;
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) {
      for (const k of ['start', 'finish']) {
        const t = s[k];
        if (!t || t.how !== 'commune-ign' || !Number.isFinite(t.lat)) continue;
        const key = `${t.label}|${t.lat},${t.lon}`;
        if (!done.has(key)) {
          let best = null;
          for (const c of await candidatesFor(t.label)) {
            if (!(c.osmClass === 'place' || c.osmClass === 'boundary') || !SNAP_TYPES.has(c.addresstype)) continue;
            const d = haversine(t, c);
            if (d <= SNAP_M && (!best || d < best.d)) best = { d, lat: c.lat, lon: c.lon };
          }
          done.set(key, best);
          if (best && best.d >= 1000) log(`  ⌖ ${t.label} : ${(best.d / 1000).toFixed(1)} km → bourg OSM`);
        }
        const b = done.get(key);
        if (b) { Object.assign(t, { lat: b.lat, lon: b.lon }); n++; }
      }
    }
  }
  return n;
}

async function crossCheck(editions, candidatesFor = nominatimCandidates, log = console.log) {
  const edges = stageEdges(editions);
  const pos = new Map();
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) for (const t of [s.start, s.finish]) if (Number.isFinite(t.lat)) pos.set(townKey(t), { lat: t.lat, lon: t.lon });
  }
  const decided = new Map();
  for (const ed of Object.values(editions)) {
    for (const s of ed.stages) {
      for (const k of ['start', 'finish']) {
        const t = s[k];
        if (!Number.isFinite(t.lat) || t.how === 'commune-ign' || t.confidence === 'verifie') continue;
        const key = townKey(t);
        if (!decided.has(key)) {
          // Col du référentiel du dépôt (known_cols.json, coordonnées déjà
          // vérifiées) : source prioritaire quand le libellé y figure.
          const known = KNOWN_COLS[t.label];
          const [top] = known && Number.isFinite(known.lat) ? [{ lat: known.lat, lon: known.lon }] : await candidatesFor(t.label);
          const constrained = edges.some((e) => (e.a === key || e.b === key) && pos.has(e.a === key ? e.b : e.a));
          // La position actuelle n'est jamais « confirmée » par le seul fait que
          // le candidat Nominatim soit implausible (« Luxembourg City » restait
          // à Nommern) : il faut l'accord des deux sources.
          const curOk = constrained && plausible(edges, pos, key, t);
          const topOk = constrained && top && plausible(edges, pos, key, top);
          let d;
          if (top && haversine(top, t) <= 10000) d = { lat: t.lat, lon: t.lon, how: `${t.how}+nominatim`, confidence: 'ok' };
          else if (topOk && !curOk) d = { lat: top.lat, lon: top.lon, how: 'nominatim', confidence: 'verifie' };
          else d = { lat: t.lat, lon: t.lon, how: t.how, confidence: 'douteux' };
          if (d.confidence !== 'ok') log(`  ${d.confidence === 'verifie' ? '↻' : '?'} ${t.label} : ${t.lat}, ${t.lon} → ${d.confidence === 'verifie' ? `${d.lat}, ${d.lon}` : 'douteux (exclu de la recherche)'}`);
          decided.set(key, d);
        }
        const d = decided.get(key);
        s[k] = { label: t.label, lat: d.lat, lon: d.lon, how: d.how, confidence: d.confidence };
      }
    }
  }
}

async function main() {
  if (process.argv.includes('--verify-only')) {
    const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    console.log('Contre-vérification Nominatim…');
    await crossCheck(doc.editions);
    const left = await verify(doc.editions, doc.failures);
    doc.unverifiedStages = left;
    console.log(`${writeStageTowns(doc)} position(s) vérifiée(s) réappliquée(s)`);
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
  console.log('\nContre-vérification Nominatim…');
  console.log('\nRecalage des communes IGN sur leur bourg…');
  await snapCommuneAnchors(editions);
  await crossCheck(editions);
  const left = await verify(editions, failures);
  console.log(`${left.length} étape(s) encore contradictoire(s) entre deux villes fiables : ${left.join(' ; ')}`);
  const doc = {
    _notes: "Villes de départ/arrivée de chaque étape (Wikipédia anglais, CC BY-SA), géocodées par scripts/build-stage-towns.js (Epic 32.4). " +
      "confidence : ok (commune IGN, ou géocodeur général confirmé par Nominatim à moins de 10 km) | ambigu (homonyme de taille comparable, la plus peuplée retenue) | " +
      "verifie (position corrigée, compatible et plausible avec la longueur des étapes voisines) | douteux (non confirmée : conservée pour traçabilité, jamais utilisée par la recherche). " +
      "Vérification par la longueur des étapes : elle ne détecte une position fausse que si une étape voisine la contredit (une étape longue laisse beaucoup de marge). " +
      "unverifiedStages : étapes encore contradictoires entre deux villes jugées fiables (distance Wikipédia probablement mal lue, ou l'une des deux fausse). " +
      "Sources : Wikipédia anglais (CC BY-SA), IGN/Géoplateforme, Nominatim/OpenStreetMap (ODbL) — voir NOTICE.md. " +
      'Points seulement : le parcours entre les deux villes n\'est pas connu ici.',
    generatedAt: new Date().toISOString().slice(0, 10),
    editions,
    failures,
    unverifiedStages: left,
  };
  console.log(`${writeStageTowns(doc)} position(s) vérifiée(s) réappliquée(s)`);
  const n = Object.values(editions).reduce((a, e) => a + e.stages.length, 0);
  console.log(`\n${Object.keys(editions).length} éditions, ${n} étapes, ${failures.length} échec(s) → ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { snapCommuneAnchors, verify, crossCheck, maxCrowM, nominatimCandidates, applyOverrides, writeStageTowns, readOverrides };
