'use strict';
// Epic 35.1, relecture adverse : POST /api/backup/import écrivait des
// waypoints hors bornes (lat 999), et la génération saturait ensuite la
// mémoire. Mode local (pas de mur d'accès) : la route répond vraiment.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backupbounds-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('backup/import : waypoint hors bornes refusé en 400, base inchangée', async () => {
  const created = await json('/api/stages', 'POST', { name: 'B', waypoints: [{ label: 'A', kind: 'start', lat: 43.3, lon: -0.37 }, { label: 'Z', kind: 'finish', lat: 43.0, lon: -0.1 }] });
  assert.strictEqual(created.status, 200);
  const exp = await (await fetch(`${base}/api/backup/export`)).json();
  const tables = JSON.parse(JSON.stringify(exp.tables));
  tables.waypoints[0].lat = 999;
  tables.waypoints[0].lon = -500;
  const r = await json('/api/backup/import', 'POST', { confirm: true, tables });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /waypoints\[0\]/);
  const again = await (await fetch(`${base}/api/backup/export`)).json();
  assert.strictEqual(again.tables.waypoints[0].lat, 43.3);
});

test('génération : un waypoint déjà en base hors bornes donne une erreur, pas un plantage', async () => {
  const { getDb } = require('../backend/db');
  const { generateStage } = require('../pipeline/generate');
  const db = getDb();
  const id = db.prepare('SELECT id FROM stages LIMIT 1').get().id;
  db.prepare('UPDATE waypoints SET lat = 999, lon = -500 WHERE stage_id = ? AND kind = ?').run(id, 'start');
  await assert.rejects(() => generateStage(id), /hors bornes/);
});
