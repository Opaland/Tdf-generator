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
const { searchNear, curatedStages, pointSegmentM, distanceToLineM } = require('../pipeline/placeSearch');

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
  const { results, coverage } = searchNear(place, 10000, db, curated);
  assert.deepStrictEqual(results.map((r) => [r.year, r.stage, r.basis, Math.round(r.distanceM / 100) / 10]), [
    [1960, '3', 'waypoint', 6],
    [1975, '22', 'curated-segment', 8],
    [1992, '10', 'trace', 2],
    [2022, '1', 'curated-segment', 0],
  ]);
  assert.deepStrictEqual(coverage, { trackedStages: 1, waypointStages: 3, curatedStages: 2 });
});

test('curatedStages : 1992/10 a des points de passage géolocalisés (Boulay-Moselle, Boucheporn…)', () => {
  const s = curatedStages().find((c) => c.year === 1992 && c.stage === '10');
  assert.ok(s && s.points.some((p) => p.label === 'Boucheporn'));
  assert.ok(s.points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});

test('curation réelle : Porcelette (coordonnées IGN) → 1992 étape 10 à moins de 5 km', () => {
  const { results } = searchNear({ lat: 49.165313, lon: 6.664131 }, 10000, { tracked: [], waypointed: [] });
  const r = results.find((x) => x.year === 1992 && x.stage === '10');
  assert.ok(r && r.distanceM < 5000, JSON.stringify(results));
  assert.strictEqual(r.basis, 'curated-segment');
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
  const none = nearResultsHtml({ ...data, results: [] });
  assert.match(none, /pas la preuve qu'aucun Tour n'y est passé/);
});
