'use strict';
// Epic 35.17 (revue globale du 19/10/2026) : POST /api/backup/import ne
// revalidait ni les longueurs, ni les kinds, ni la catégorie, ni les
// colonnes JSON que les pages relisent sans garde. Ce que l'appli a pu écrire
// elle-même (nom long, date en texte libre) reste réimportable.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backuprevalid-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let exported;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const ed = await (await json('/api/editions', 'POST', { name: 'Éd', year: 2001 })).json();
  await json('/api/gear', 'POST', { name: 'Vélo', kind: 'velo' });
  const r = await json('/api/stages', 'POST', {
    name: 'B', edition_id: ed.id, date: '2001-07-07',
    waypoints: [{ label: 'A', kind: 'start', lat: 43.3, lon: -0.37, bonus_sec: [3, 2, 1] }, { label: 'Z', kind: 'finish', lat: 43.0, lon: -0.1 }],
  });
  assert.strictEqual(r.status, 200);
  exported = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const tamper = (fn) => {
  const tables = JSON.parse(JSON.stringify(exported));
  fn(tables);
  return json('/api/backup/import', 'POST', { confirm: true, tables });
};

test('backup/import : la sauvegarde telle qu\'exportée se réimporte', async () => {
  const r = await tamper(() => {});
  assert.strictEqual(r.status, 200, await r.text());
});

for (const [what, fn, re] of [
  ['kind inconnu', (t) => { t.waypoints[0].kind = 'teleport'; }, /waypoints\[0\]\.kind/],
  ['catégorie inconnue', (t) => { t.editions[0].category = 'mixte'; }, /editions\[0\]\.category/],
  ['bonus_sec en JSON mal formé', (t) => { t.waypoints[0].bonus_sec = '[3,2,'; }, /waypoints\[0\]\.bonus_sec : JSON mal formé/],
]) {
  test(`backup/import : ${what} → 400, base inchangée`, async () => {
    const r = await tamper(fn);
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, re);
    const again = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
    assert.deepStrictEqual(again.stages.map((s) => [s.name, s.date]), exported.stages.map((s) => [s.name, s.date]));
    assert.deepStrictEqual(again.waypoints.map((w) => [w.label, w.kind, w.bonus_sec]), exported.waypoints.map((w) => [w.label, w.kind, w.bonus_sec]));
  });
}

test('backup/import : un texte trop long est tronqué et compté, sans couper un emoji', async () => {
  const r = await tamper((t) => {
    t.stages[0].name = 'x'.repeat(199) + '🚴🚴';
    t.waypoints[1].label = 'y'.repeat(250);
    t.gear[0].name = 'z'.repeat(81);
  });
  const body = await r.json();
  assert.strictEqual(r.status, 200, JSON.stringify(body));
  assert.strictEqual(body.truncated_fields, 3);
  const again = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
  assert.strictEqual(again.stages[0].name, 'x'.repeat(199));
  assert.strictEqual(again.waypoints[1].label, 'y'.repeat(200));
  assert.strictEqual(again.gear[0].name, 'z'.repeat(80));
});

test('backup/import : une date en texte libre (import Wikipédia non reconnu) reste réimportable', async () => {
  const r = await tamper((t) => { t.stages[0].date = '1–2 Jul.'; });
  assert.strictEqual(r.status, 200, await r.text());
});

test('import de trace : un nom de 250 caractères (Suunto, Strava, fichier GPX) est borné à 200', async () => {
  const { importTrackAsStage } = require('../pipeline/importTrack');
  const pts = [];
  for (let k = 0; k < 20; k++) pts.push({ lat: 45 + k * 0.001, lon: 6, ele: 500 + k });
  const id = await importTrackAsStage(pts, { name: 'S'.repeat(250), source: 'suunto', status: 'trace Suunto' });
  const { getDb } = require('../backend/db');
  assert.strictEqual(getDb().prepare('SELECT length(name) n FROM stages WHERE id = ?').get(id).n, 200);
  const tables = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
  const r = await json('/api/backup/import', 'POST', { confirm: true, tables });
  const body = await r.json();
  assert.strictEqual(r.status, 200, JSON.stringify(body));
  assert.strictEqual(body.truncated_fields, 0);
});
