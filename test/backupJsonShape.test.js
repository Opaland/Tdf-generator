'use strict';
// Issue #492 (relecture adverse de #487) : POST /api/backup/import ne vérifiait
// que la syntaxe de plusieurs colonnes JSON. Une sauvegarde avec
// tracks.geojson = '{}' passait (200) puis faisait planter en 500 l'export
// HTML de l'étape, la carte et le mini-site de l'édition (stagePayload lit
// track.geojson.geometry.coordinates sans garde). Chaque colonne JSON est
// désormais refusée à l'import si sa forme diffère de ce que l'appli écrit —
// et une sauvegarde exportée par l'appli passe toujours.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backupjsonshape-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let exported;
let stageId;
let editionId;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const ed = await (await json('/api/editions', 'POST', { name: 'Éd', year: 2001 })).json();
  editionId = ed.id;
  const r = await json('/api/stages', 'POST', {
    name: 'B', edition_id: ed.id, date: '2001-07-07',
    // Pau sans coordonnées : géocodé (simulateur hors ligne) → waypoints.geocode écrit.
    waypoints: [{ label: 'Pau', kind: 'start' }, { label: 'Z', kind: 'finish', lat: 43.0, lon: -0.1, bonus_sec: [10, 6, 4] }],
  });
  assert.strictEqual(r.status, 200);
  stageId = (await r.json()).id;
  await require('../pipeline/generate').generateStage(stageId);
  // Colonnes qu'une génération hors ligne n'écrit pas : écrites ici par les
  // fonctions mêmes de l'appli (revêtement, communes) ou sous la forme de
  // l'import Wikipédia (source d'édition).
  const { summarizeSurfaces } = require('../pipeline/surface');
  const db = require('../backend/db').getDb();
  db.prepare('UPDATE tracks SET surfaces = ?, communes = ? WHERE stage_id = ?').run(
    JSON.stringify(summarizeSurfaces([{ fromM: 0, toM: 1000, cls: 'revetu', surfaces: ['asphalt'] }], 1000)),
    JSON.stringify({ communes: [{ nom: 'Pau', km: 0, departement: '64', code: '64445' }], points: 10, stepM: 500, pointsHorsFrance: 0, pointsSansCommune: 0 }),
    stageId,
  );
  db.prepare('UPDATE stages SET source = ? WHERE id = ?').run(JSON.stringify({ trace: 'gpx', points_bruts: 10 }), stageId);
  db.prepare('UPDATE editions SET source = ? WHERE id = ?').run(JSON.stringify({ wikipedia: 'https://fr.wikipedia.org/wiki/x', notes: 'n' }), ed.id);
  exported = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
  for (const [t, c] of [['tracks', 'geojson'], ['tracks', 'approx_segments'], ['tracks', 'surfaces'], ['tracks', 'communes'],
    ['stages', 'checks'], ['stages', 'source'], ['editions', 'source']]) {
    assert.ok(exported[t][0][c] != null, `${t}.${c} doit être rempli dans la sauvegarde de référence`);
  }
  assert.ok(exported.waypoints.some((w) => w.geocode != null), 'waypoints.geocode rempli');
  assert.ok(exported.waypoints.some((w) => w.bonus_sec != null), 'waypoints.bonus_sec rempli');
});
after(() => {
  appServer?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const tamper = (fn) => {
  const tables = JSON.parse(JSON.stringify(exported));
  fn(tables);
  return json('/api/backup/import', 'POST', { confirm: true, tables });
};
const wpWith = (t, c) => t.waypoints.find((w) => w[c] != null);
const geo = (coords) => JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

test('backup/import : la sauvegarde exportée par l\'appli passe telle quelle, et ses pages restent lisibles', async () => {
  const r = await tamper(() => {});
  assert.strictEqual(r.status, 200, await r.text());
  for (const p of [`/api/stages/${stageId}/export.html`, `/api/editions/${editionId}/mapdata`, `/api/editions/${editionId}/site`, `/api/stages/${stageId}`]) {
    assert.strictEqual((await fetch(`${base}${p}`)).status, 200, p);
  }
});

for (const [what, fn, re] of [
  // Scénario de l'issue #492 : 200 à l'import, puis 500 sur trois pages.
  ['tracks.geojson = {}', (t) => { t.tracks[0].geojson = '{}'; }, /tracks\[0\]\.geojson/],
  ['tracks.geojson en Point', (t) => { t.tracks[0].geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }); }, /tracks\[0\]\.geojson/],
  ['tracks.geojson avec une coordonnée texte', (t) => { t.tracks[0].geojson = geo([[0, 0], ['x', 1]]); }, /tracks\[0\]\.geojson/],
  ['tracks.geojson = null (JSON)', (t) => { t.tracks[0].geojson = 'null'; }, /tracks\[0\]\.geojson/],
  ['tracks.approx_segments en objet', (t) => { t.tracks[0].approx_segments = '{}'; }, /tracks\[0\]\.approx_segments/],
  ['tracks.approx_segments avec fromM texte', (t) => { t.tracks[0].approx_segments = JSON.stringify([{ fromM: 'a', toM: 1, reason: 'r' }]); }, /tracks\[0\]\.approx_segments/],
  ['tracks.surfaces sans meters', (t) => { t.tracks[0].surfaces = JSON.stringify({ stretches: [] }); }, /tracks\[0\]\.surfaces/],
  ['tracks.communes en tableau', (t) => { t.tracks[0].communes = '[]'; }, /tracks\[0\]\.communes/],
  ['tracks.communes mal formé (syntaxe)', (t) => { t.tracks[0].communes = '{'; }, /tracks\[0\]\.communes : JSON mal formé/],
  ['stages.checks = "x"', (t) => { t.stages[0].checks = '"x"'; }, /stages\[0\]\.checks/],
  ['stages.checks.items en objet', (t) => { t.stages[0].checks = JSON.stringify({ ok: true, items: {} }); }, /stages\[0\]\.checks/],
  ['stages.checks.items[] en texte', (t) => { t.stages[0].checks = JSON.stringify({ ok: true, items: ['x'] }); }, /stages\[0\]\.checks/],
  ['stages.source en tableau', (t) => { t.stages[0].source = '[1]'; }, /stages\[0\]\.source/],
  ['editions.source en texte', (t) => { t.editions[0].source = '"x"'; }, /editions\[0\]\.source/],
  ['waypoints.bonus_sec en objet', (t) => { wpWith(t, 'bonus_sec').bonus_sec = '{}'; }, /waypoints\[\d+\]\.bonus_sec/],
  ['waypoints.bonus_sec avec du texte', (t) => { wpWith(t, 'bonus_sec').bonus_sec = '["<b>"]'; }, /waypoints\[\d+\]\.bonus_sec/],
  // Relecture adverse de 38.4 : trois formes qui passaient encore.
  ['editions.source = null (JSON) — 500 sur export.html', (t) => { t.editions[0].source = 'null'; }, /editions\[0\]\.source/],
  ['stages.checks sans items — fiche plantée', (t) => { t.stages[0].checks = JSON.stringify({ ok: true }); }, /stages\[0\]\.checks/],
  ['tracks.geojson à un seul point — carte plantée', (t) => { t.tracks[0].geojson = geo([[0, 0]]); }, /tracks\[0\]\.geojson/],
  ['tracks.geojson sans point', (t) => { t.tracks[0].geojson = geo([]); }, /tracks\[0\]\.geojson/],
  ['waypoints.geocode en nombre', (t) => { wpWith(t, 'geocode').geocode = '42'; }, /waypoints\[\d+\]\.geocode/],
]) {
  test(`backup/import : ${what} → 400`, async () => {
    const r = await tamper(fn);
    assert.strictEqual(r.status, 400, await r.clone().text());
    assert.match((await r.json()).error, re);
  });
}

test('backup/import : formes légitimes non produites par la génération de référence (geojson à 3 coordonnées, checks d\'import de trace, segments vides, geocode null)', async () => {
  const r = await tamper((t) => {
    t.tracks[0].geojson = geo([[-0.37, 43.3, 200], [-0.1, 43.0, 300]]);
    t.tracks[0].approx_segments = '[]';
    t.stages[0].checks = JSON.stringify({ ok: true, items: [], offline: false, imported: true });
    wpWith(t, 'geocode').geocode = 'null';
  });
  assert.strictEqual(r.status, 200, await r.text());
});
