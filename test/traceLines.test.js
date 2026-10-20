'use strict';
// Backlog 34.3 : carte de toutes ses traces — GET /api/traces/lines.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-tracelines-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

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

function gpx(n) {
  let pts = '';
  for (let i = 0; i <= n; i++) pts += `<trkpt lat="${(45 + i * 0.0005).toFixed(6)}" lon="6.000000"><ele>${300 + i}</ele></trkpt>`;
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>t</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

test('traces/lines : une ligne par trace importée, en [lat, lon], au plus 400 points', async () => {
  const r = await fetch(`${base}/api/import/gpx?name=Sortie`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml' }, body: gpx(2000) });
  assert.strictEqual(r.status, 200, await r.text());
  // Une étape ordinaire (pas une trace) n'apparaît pas.
  await fetch(`${base}/api/stages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pas une trace', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }) });
  const { lines } = await (await fetch(`${base}/api/traces/lines`)).json();
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].name, 'Sortie');
  assert.ok(lines[0].coords.length >= 2 && lines[0].coords.length <= 400, `${lines[0].coords.length} points`);
  const [lat, lon] = lines[0].coords[0];
  assert.ok(Math.abs(lat - 45) < 0.01 && Math.abs(lon - 6) < 0.01, `[lat, lon] attendu, reçu [${lat}, ${lon}]`);
});

test('traces/lines : un geojson illisible écarte la trace, pas toute la carte', async () => {
  await fetch(`${base}/api/import/gpx?name=Deux`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml' }, body: gpx(50) });
  const { getDb } = require('../backend/db');
  const db = getDb();
  const first = db.prepare("SELECT stage_id FROM tracks WHERE router = 'trace' ORDER BY stage_id LIMIT 1").get().stage_id;
  db.prepare('UPDATE tracks SET geojson = ? WHERE stage_id = ?').run('{pas du json', first);
  const res = await fetch(`${base}/api/traces/lines`);
  assert.strictEqual(res.status, 200);
  const { lines } = await res.json();
  assert.deepStrictEqual(lines.map((l) => l.name), ['Deux']);
});
