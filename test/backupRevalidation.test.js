'use strict';
// Epic 35.17 (revue globale du 19/10/2026) : POST /api/backup/import ne
// revalidait ni les longueurs, ni les dates, ni les kinds, ni la catégorie,
// ni les colonnes JSON que les pages relisent sans garde.

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
  ['nom d\'étape trop long', (t) => { t.stages[0].name = 'x'.repeat(201); }, /stages\[0\]\.name : 200 caractères au plus/],
  ['libellé de waypoint trop long', (t) => { t.waypoints[1].label = 'x'.repeat(201); }, /waypoints\[1\]\.label/],
  ['nom de matériel trop long', (t) => { t.gear[0].name = 'x'.repeat(81); }, /gear\[0\]\.name : 80/],
  ['date inexistante', (t) => { t.stages[0].date = '2001-02-30'; }, /stages\[0\]\.date : date inexistante/],
  ['date au mauvais format', (t) => { t.stages[0].date = '07/07/2001'; }, /AAAA-MM-JJ/],
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
