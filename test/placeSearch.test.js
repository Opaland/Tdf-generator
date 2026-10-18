'use strict';
// Recherche par lieu (Epic 32) : pipeline/placeSearch.js, GET /api/search/near,
// rendu frontend.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-placesearch-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { searchNear, curatedStages, buildItinerary, pointSegmentM, distanceToLineM } = require('../pipeline/placeSearch');

global.EF = { esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
const { nearResultsHtml } = require('../frontend/archives.js');

const M = 111195; // m par degré de latitude
const at = (dN, dE, base = { lat: 49, lon: 6 }) => ({ lat: base.lat + dN / M, lon: base.lon + dE / (M * Math.cos((base.lat * Math.PI) / 180)) });

test('pointSegmentM / distanceToLineM : distance au segment, pas seulement aux extrémités', () => {
  const p = at(0, 0);
  const a = at(-5000, 3000);
  const b = at(5000, 3000);
  assert.ok(Math.abs(pointSegmentM(p, a, b) - 3000) < 15);
  assert.ok(Math.abs(distanceToLineM(p, [[a.lon, a.lat], [b.lon, b.lat]]) - 3000) < 15);
  assert.strictEqual(distanceToLineM(p, []), Infinity);
});

test('searchNear : le tracé l\'emporte sur les points et sur la curation pour la même étape ; hors rayon exclu', () => {
  const place = at(0, 0);
  const line = [at(-10000, 2000), at(10000, 2000)].map((q) => [q.lon, q.lat]);
  const db = {
    tracked: [{ year: 1992, category: 'hommes', stageOrder: 10, stageId: 7, name: 'Étape 10', coords: line }],
    waypointed: [
      { year: 1992, category: 'hommes', stageOrder: 10, stageId: 7, name: 'doublon', waypoints: [at(0, 100)] },
      { year: 1960, category: 'hommes', stageOrder: 3, stageId: 8, name: 'Étape 3', waypoints: [at(0, 6000), at(0, 30000)] },
      { year: 1961, category: 'hommes', stageOrder: 4, stageId: 9, name: 'Loin', waypoints: [at(0, 40000)] },
    ],
  };
  const curated = [
    { year: 1992, category: 'hommes', stage: '10', points: [at(0, 50)] }, // doublon : ignoré
    { year: 1975, category: 'hommes', stage: '22', points: [at(-4000, -8000), at(4000, -8000)] },
    { year: 2022, category: 'femmes', stage: '1', points: [at(-1000, 4000), at(1000, -4000)] }, // segment qui passe au ras
  ];
  const { results, coverage } = searchNear(place, 10000, db, curated, [], []);
  assert.deepStrictEqual(results.map((r) => [r.year, r.stage, r.basis, Math.round(r.distanceM / 100) / 10]), [
    [1960, '3', 'waypoint', 6],
    [1975, '22', 'curated-segment', 8],
    [1992, '10', 'trace', 2],
    [2022, '1', 'curated-segment', 0],
  ]);
  assert.deepStrictEqual(coverage, { trackedStages: 1, waypointStages: 3, itineraryStages: 0, curatedStages: 2, townStages: 0 });
});

test('curatedStages : 1992/10 a des points de passage géolocalisés (Boulay-Moselle, Boucheporn…)', () => {
  const s = curatedStages().find((c) => c.year === 1992 && c.stage === '10');
  assert.ok(s && s.points.some((p) => p.label === 'Boucheporn'));
  assert.ok(s.points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});

test('curation réelle : Porcelette (coordonnées IGN) → 1992 étape 10 à moins de 5 km', () => {
  const { results } = searchNear({ lat: 49.165313, lon: 6.664131 }, 10000, { tracked: [], waypointed: [] }, curatedStages(), [], []);
  const r = results.find((x) => x.year === 1992 && x.stage === '10');
  assert.ok(r && r.distanceM < 5000, JSON.stringify(results));
  assert.strictEqual(r.basis, 'curated-segment');
});

test('itinéraire réel (profil officiel 1992/10) : Porcelette → Longeville-lès-Saint-Avold, km 83,5, source citée', () => {
  const { results } = searchNear({ lat: 49.163382, lon: 6.659574 }, 10000, { tracked: [], waypointed: [] });
  const r = results.find((x) => x.year === 1992 && x.stage === '10');
  assert.strictEqual(r.basis, 'itinerary-point');
  assert.strictEqual(r.nearestLabel, 'Longeville-lès-Saint-Avold');
  assert.strictEqual(r.nearestKm, 83.5);
  assert.ok(r.distanceM < 6000, String(r.distanceM));
  assert.match(r.sourceUrl, /^https:\/\/www\.ledicodutour\.com\//);
  assert.strictEqual(r.date, '1992-07-14');
});

test('itinéraire : prioritaire sur la curation, segment coupé par un point non placé, côte approchée écartée', () => {
  const place = at(0, 0);
  const pt = (label, km, dN, dE, extra = {}) => ({ label, km, ...at(dN, dE), ...extra });
  // Le vrai constructeur de stageItineraries() (relecture adverse : une copie dans le test ne testait rien).
  const itin = (stage, raw) => ({ year: 1992, category: 'hommes', stage, sourceUrl: 'https://exemple.test/p.jpg', ...buildItinerary(raw) });
  const curated = [{ year: 1992, category: 'hommes', stage: '10', points: [at(0, 100)] }];
  const its = [
    itin('10', [pt('A', 0, -4000, 3000), pt('B', 8, 4000, 3000)]), // segment à 3 km : masque la curation (0,1 km)
    itin('11', [pt('C', 0, -4000, 2000), { label: 'X', km: 4 }, pt('D', 8, 4000, 2000)]), // coupé : points à 4,5 km
    itin('12', [pt('E', 0, -30000, 0), pt('Côte de F', 30, 0, 500, { kind: 'côte', geocodeAs: 'F' }), pt('G', 60, 30000, 0)]),
    // Lieu-dit placé au centre de sa commune (geocodeAs) : écarté comme une côte.
    itin('14', [pt('K', 0, -30000, 0), pt('Hameau', 30, 0, 300, { kind: 'lieu-dit', geocodeAs: 'Commune' }), pt('L', 60, 30000, 0)]),
    // Côte écartée entre deux villes à 8 km l'une de l'autre : coupe aussi le segment.
    itin('13', [pt('H', 0, -4000, -1500), pt('Côte de I', 4, 0, -1600, { kind: 'côte', geocodeAs: 'I' }), pt('J', 8, 4000, -1500)]),
  ];
  const { results, coverage } = searchNear(place, 5000, { tracked: [], waypointed: [] }, curated, [], its);
  assert.deepStrictEqual(results.map((r) => [r.stage, r.basis, Math.round(r.distanceM / 100) / 10]), [
    ['10', 'itinerary-segment', 3],
    ['11', 'itinerary-point', 4.5],
    ['13', 'itinerary-point', 4.3],
  ]);
  assert.strictEqual(coverage.itineraryStages, 5);
  assert.strictEqual(coverage.curatedStages, 0);
});

test('stage_itineraries.json : source https citée, km croissants, chaque point placé atteignable depuis le précédent', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'stage_itineraries.json'), 'utf8'));
  const { haversine } = require('../pipeline/geo');
  for (const [year, ed] of Object.entries(doc.editions)) {
    for (const [stage, st] of Object.entries(ed.stages)) {
      const where = `${year}/${stage}`;
      assert.match(st.source_url, /^https:\/\//, where);
      let prev = null;
      st.towns.forEach((t, i) => {
        assert.ok(typeof t.label === 'string' && t.label && Number.isFinite(t.km), `${where} #${i}`);
        if (i) assert.ok(t.km > st.towns[i - 1].km, `${where} : km non croissant à ${t.label}`);
        if (!Number.isFinite(t.lat) || (t.geocodeAs && t.kind !== 'ville')) return;
        // Même contrainte que scripts/geocode-itineraries.js (marge du départ réel comprise).
        if (prev) assert.ok(haversine(prev, t) <= (t.km - prev.km) * 1000 + (prev.km === 0 ? 10000 : 3000), `${where} : ${prev.label} → ${t.label}`);
        prev = t;
      });
    }
  }
});

let appServer;
let base;
before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/search/near : tracé en base trouvé, traces personnelles et tours perso exclus', async () => {
  const { getDb } = require('../backend/db');
  const db = getDb();
  const metz = { lat: 49.1202, lon: 6.1778 }; // position du simulateur hors ligne pour « Metz »
  const line = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.1778, 49.10], [6.1778, 49.14]] } });
  const add = (year, isCustom, router) => {
    const ed = db.prepare('INSERT INTO editions (year, name, is_custom) VALUES (?, ?, ?)').run(year, `Ed ${year}`, isCustom).lastInsertRowid;
    const st = db.prepare("INSERT INTO stages (edition_id, stage_order, name, state) VALUES (?, 5, 'Étape 5', 'done')").run(ed, ).lastInsertRowid;
    db.prepare('INSERT INTO tracks (stage_id, geojson, distance_m, router) VALUES (?, ?, 1000, ?)').run(st, line, router);
    return st;
  };
  const id = add(1950, 0, 'brouter');
  add(1951, 1, 'brouter'); // tour personnalisé
  add(1952, 0, 'trace'); // ne devrait pas exister, mais jamais compté comme un Tour
  const r = await (await fetch(`${base}/api/search/near?q=Metz&radiusKm=5`)).json();
  assert.strictEqual(r.place.lat, metz.lat);
  assert.deepStrictEqual(r.results.filter((x) => x.basis === 'trace').map((x) => [x.year, x.stageId, x.distanceM]), [[1950, id, 0]]);
  assert.strictEqual(r.coverage.trackedStages, 1);
});

test('GET /api/search/near : validation, et refus d\'une position inventée par le simulateur', async () => {
  for (const qs of ['q=x', 'q=Metz&radiusKm=0', 'q=Metz&radiusKm=51', 'q=Metz&radiusKm=2.5', 'q=Metz&radiusKm=abc', `q=${'a'.repeat(101)}`]) {
    assert.strictEqual((await fetch(`${base}/api/search/near?${qs}`)).status, 400, qs);
  }
  const res = await fetch(`${base}/api/search/near?q=Porcelette`);
  assert.strictEqual(res.status, 404);
  assert.match((await res.json()).error, /position simulée/);
});

test('nearResultsHtml : échappement, couverture toujours affichée, « aucun résultat » jamais présenté comme une preuve', () => {
  const data = {
    place: { label: '<img src=x>', lat: 49, lon: 6 }, radiusKm: 10,
    coverage: { trackedStages: 0, waypointStages: 0, curatedStages: 74 },
    results: [{ year: 1992, category: 'hommes', stage: '10', stageId: null, name: null, distanceM: 4371, basis: 'curated-segment', nearestLabel: '<b>B</b>' }],
  };
  const html = nearResultsHtml(data);
  assert.ok(!html.includes('<img') && !html.includes('<b>B</b>'));
  assert.match(html, /4,4 km/);
  assert.match(html, /estimation/);
  assert.match(html, /74 étape\(s\) curée\(s\)/);
  const itin = nearResultsHtml({ ...data, coverage: { ...data.coverage, itineraryStages: 1 },
    results: [{ ...data.results[0], basis: 'itinerary-point', nearestLabel: 'Longeville', nearestKm: 83.5, sourceUrl: 'https://x.test/a"b.jpg' }] });
  assert.match(itin, /près de Longeville \(km 83,5\)/);
  assert.match(nearResultsHtml({ ...data, results: [{ ...data.results[0], basis: 'itinerary-point', geocodeConfidence: 'ambigu' }] }), /homonyme possible/);
  assert.match(itin, /href="https:\/\/x\.test\/a&quot;b\.jpg"[^>]*>profil officiel/);
  assert.match(itin, /1 étape\(s\) au profil officiel détaillé/);
  const bad = nearResultsHtml({ ...data, results: [{ ...data.results[0], sourceUrl: 'javascript:alert(1)' }] });
  assert.ok(!bad.includes('javascript:'));
  assert.match(html, /village traversé en cours d'étape peut manquer/);
  const none = nearResultsHtml({ ...data, results: [] });
  assert.match(none, /pas la preuve qu'aucun Tour n'y est passé/);
});

test('segments : au-delà de 10 km entre deux points, plus d\'estimation en ligne droite (seule la distance aux points compte)', () => {
  const place = at(0, 0);
  const curated = [{ year: 2002, category: 'hommes', stage: '12', points: [at(-24000, 0), at(25000, 0)] }];
  assert.deepStrictEqual(searchNear(place, 10000, { tracked: [], waypointed: [] }, curated, [], []).results, []);
  // Même configuration en base (étape importée non générée) : même règle.
  const db = { tracked: [], waypointed: [{ year: 2002, category: 'hommes', stageOrder: 12, stageId: 3, name: 'x', waypoints: [at(-24000, 0), at(25000, 0)] }] };
  assert.deepStrictEqual(searchNear(place, 10000, db, [], [], []).results, []);
  // Segment court : estimation retenue et signalée.
  const short = [{ year: 2002, category: 'hommes', stage: '13', points: [at(-4000, 1000), at(4000, 1000)] }];
  assert.strictEqual(searchNear(place, 10000, { tracked: [], waypointed: [] }, short, [], []).results[0].basis, 'curated-segment');
});

test('GET /api/search/near en ligne : homonymes proposés au choix, commune unique cherchée, lieu introuvable → 404', async () => {
  const { setOffline } = require('../pipeline/http');
  const realFetch = global.fetch;
  const COMMUNES = {
    'Saint-Martin': [['Saint-Martin', '65, Hautes-Pyrénées, Occitanie', [0.0816, 43.158]], ['Saint-Martin', '67, Bas-Rhin, Grand Est', [7.2928, 48.3511]]],
    Porcelette: [['Porcelette', '57, Moselle, Grand Est', [6.659574, 49.163382]]],
    xqzvbnm: [],
  };
  // Mock limité à data.geopf.fr (CLAUDE.md règle 6) : les appels au serveur de test passent.
  global.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.hostname !== 'data.geopf.fr') return realFetch(url, opts);
    const list = COMMUNES[u.searchParams.get('q')] || [];
    const features = u.searchParams.get('type') === 'municipality'
      ? list.map(([name, context, coordinates], i) => ({ properties: { name, context, citycode: String(i) }, geometry: { coordinates } }))
      : [];
    return { ok: true, status: 200, json: async () => ({ features }), text: async () => JSON.stringify({ features }) };
  };
  setOffline(false);
  try {
    let r = await (await fetch(`${base}/api/search/near?q=Saint-Martin`)).json();
    assert.deepStrictEqual(r.candidates.map((c) => c.label), ['Saint-Martin (65, Hautes-Pyrénées, Occitanie)', 'Saint-Martin (67, Bas-Rhin, Grand Est)']);
    assert.strictEqual(r.results, undefined, 'aucune recherche tant que le lieu n\'est pas choisi');
    r = await (await fetch(`${base}/api/search/near?q=Porcelette&radiusKm=10`)).json();
    assert.strictEqual(r.place.label, 'Porcelette (57)');
    assert.ok(r.results.some((x) => x.year === 1992 && x.stage === '10'));
    // Lieu choisi parmi des homonymes : coordonnées passées telles quelles.
    r = await (await fetch(`${base}/api/search/near?lat=49.163382&lon=6.659574&label=Porcelette%20(57)`)).json();
    assert.ok(r.results.some((x) => x.year === 1992));
    for (const qs of ['lat=abc&lon=6&label=x', 'lat=49&lon=6', 'lat=91&lon=6&label=x']) {
      assert.strictEqual((await fetch(`${base}/api/search/near?${qs}`)).status, 400, qs);
    }
  } finally {
    global.fetch = realFetch;
    setOffline(true);
  }
});

test('nearCandidatesHtml : un bouton par homonyme, libellés échappés', () => {
  const { nearCandidatesHtml } = require('../frontend/archives.js');
  const html = nearCandidatesHtml({ candidates: [{ label: '<b>A</b> (65)', lat: 1, lon: 2 }, { label: 'B (67)', lat: 3, lon: 4 }] });
  assert.strictEqual((html.match(/data-cand=/g) || []).length, 2);
  assert.ok(!html.includes('<b>A</b>'));
});

test('villes de départ/arrivée : dernier recours, distance à la ville seulement, jamais si une source plus fiable couvre l\'étape', () => {
  const place = at(0, 0);
  const towns = [
    { year: 1960, category: 'hommes', stage: '5', date: '1960-07-01', towns: [{ label: 'Ville A', role: 'départ', ...at(3000, 0), confidence: 'ok' }, { label: 'Ville B', role: 'arrivée', ...at(200000, 0), confidence: 'ambigu' }] },
    { year: 1975, category: 'hommes', stage: '22', date: null, towns: [{ label: 'Doublon', role: 'arrivée', ...at(100, 0), confidence: 'ok' }] },
    { year: 1980, category: 'hommes', stage: '1', date: null, towns: [{ label: 'Loin', role: 'départ', ...at(50000, 0), confidence: 'ok' }] },
  ];
  const curated = [{ year: 1975, category: 'hommes', stage: '22', points: [at(0, 9000)] }];
  const { results, coverage } = searchNear(place, 10000, { tracked: [], waypointed: [] }, curated, towns, []);
  assert.deepStrictEqual(results.map((r) => [r.year, r.stage, r.basis, r.nearestLabel, r.endpointRole]), [
    [1960, '5', 'endpoint', 'Ville A', 'départ'],
    [1975, '22', 'curated-point', undefined, undefined], // la curation masque la ville d'arrivée
  ]);
  assert.strictEqual(results[0].date, '1960-07-01');
  assert.strictEqual(coverage.townStages, 2);
});

test('nearResultsHtml : ville de départ/arrivée signalée comme telle, homonyme possible signalé', () => {
  const html = nearResultsHtml({
    place: { label: 'X', lat: 49, lon: 6 }, radiusKm: 10, coverage: { trackedStages: 0, waypointStages: 0, curatedStages: 0, townStages: 2000 },
    results: [{ year: 1960, category: 'hommes', stage: '0', stageId: null, name: null, date: '1960-06-26', distanceM: 2500, basis: 'endpoint', nearestLabel: 'Metz', endpointRole: 'arrivée', geocodeConfidence: 'ambigu' }],
  });
  assert.match(html, /prologue/);
  assert.match(html, /de Metz \(ville d'arrivée\)/);
  assert.match(html, /parcours entre les deux n'est pas connu/);
  assert.match(html, /homonyme possible/);
  assert.match(html, /26\/06\/1960/);
  assert.match(html, /2000 autre\(s\) étape\(s\)/);
});
