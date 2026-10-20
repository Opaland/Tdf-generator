'use strict';
// Backlog 34.7 : zones de confidentialité autour du domicile, appliquées aux
// exports et mini-sites des traces importées et à la carte des traces.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-privacy-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { validateZones, inZone } = require('../pipeline/privacy');

let appServer;
let base;
let traceId;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Trace de 45,000 à 45,100 de latitude (≈ 11 km), domicile au départ.
function gpx() {
  let pts = '';
  for (let i = 0; i <= 200; i++) pts += `<trkpt lat="${(45 + i * 0.0005).toFixed(6)}" lon="6.000000"><ele>${300 + i}</ele></trkpt>`;
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>t</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
const HOME = { lat: 45.0, lon: 6.0, radiusM: 1000 };

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const r = await fetch(`${base}/api/import/gpx?name=Depuis%20chez%20moi`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml' }, body: gpx() });
  traceId = (await r.json()).id;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('validateZones : bornes et types, rien d\'accepté à moitié', () => {
  assert.deepStrictEqual(validateZones([HOME]), [HOME]);
  for (const bad of [[{ lat: 95, lon: 6, radiusM: 500 }], [{ lat: 45, lon: 6, radiusM: 50 }], [{ lat: 45, lon: 6, radiusM: 9000 }], [{ lat: '45', lon: 6, radiusM: 500 }], [null], 'x', Array(6).fill(HOME)]) {
    assert.throws(() => validateZones(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  assert.ok(inZone({ lat: 45.005, lon: 6 }, [HOME]) && !inZone({ lat: 45.02, lon: 6 }, [HOME]));
});

test('PUT /api/profile : zones enregistrées sans toucher à la FC max, invalides refusées en 400', async () => {
  assert.strictEqual((await json('/api/profile', 'PUT', { hrMaxBpm: 185 })).status, 200);
  assert.strictEqual((await json('/api/profile', 'PUT', { privacyZones: [{ lat: 45, lon: 6, radiusM: 10 }] })).status, 400);
  const r = await (await json('/api/profile', 'PUT', { privacyZones: [HOME] })).json();
  assert.deepStrictEqual(r, { hrMaxBpm: 185, privacyZones: [HOME] });
  assert.strictEqual((await json('/api/profile', 'PUT', {})).status, 400);
});

test('exports d\'une trace : aucun point dans la zone (GPX, JSON, carte des traces) ; la fiche reste complète', async () => {
  const lat = (s) => [...s.matchAll(/lat="([\d.]+)"/g)].map((m) => Number(m[1]));
  const gpxOut = await (await fetch(`${base}/api/stages/${traceId}/export.gpx`)).text();
  const lats = lat(gpxOut);
  assert.ok(lats.length > 50, `${lats.length} points exportés`);
  assert.ok(lats.every((l) => !inZone({ lat: l, lon: 6 }, [HOME])), 'un point exporté tombe dans la zone');
  const full = await (await fetch(`${base}/api/stages/${traceId}/export.json`)).json();
  assert.ok(full.samples.every((s) => !inZone(s, [HOME])));
  assert.ok(full.track.geojson.geometry.coordinates.every((c) => !inZone({ lat: c[1], lon: c[0] }, [HOME])));
  const { lines } = await (await fetch(`${base}/api/traces/lines`)).json();
  assert.ok(lines[0].coords.every(([la, lo]) => !inZone({ lat: la, lon: lo }, [HOME])));
  const html = await (await fetch(`${base}/api/stages/${traceId}/export.html`)).text();
  assert.doesNotMatch(html, /"lat":45(\.000|,)/, 'le mini-site embarque un point de la zone');
  // Dans l'application, la trace n'est pas tronquée.
  const app = await (await fetch(`${base}/api/stages/${traceId}`)).json();
  assert.ok(app.samples.some((s) => inZone(s, [HOME])));
});
