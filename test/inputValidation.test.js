'use strict';
// Epic 35.6 (revue globale du 19/10/2026) : longueurs et valeurs bornées, et
// des erreurs de validation qui sortaient en 500 au lieu de 400.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-validation-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
const send = (method, p, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const wps = [{ label: 'Pau', kind: 'start', lat: 43.3, lon: -0.37 }, { label: 'Tarbes', kind: 'finish', lat: 43.23, lon: 0.07 }];

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('POST /api/stages : champs hors bornes refusés en 400', async () => {
  const cases = {
    'nom de 200 000 caractères': { name: 'x'.repeat(200000), waypoints: wps },
    'date libre': { name: 'A', date: 'pas-une-date', waypoints: wps },
    'date inexistante': { name: 'A', date: '2026-02-30', waypoints: wps },
    'kind inconnu': { name: 'A', waypoints: [{ ...wps[0], kind: 'bogus' }, wps[1]] },
    'libellé trop long': { name: 'A', waypoints: [{ ...wps[0], label: 'y'.repeat(201) }, wps[1]] },
    'type trop long': { name: 'A', stage_type: 'z'.repeat(41), waypoints: wps },
    'édition inexistante': { name: 'A', edition_id: 999, waypoints: wps },
  };
  for (const [label, body] of Object.entries(cases)) {
    const r = await send('POST', '/api/stages', body);
    assert.strictEqual(r.status, 400, label);
  }
  const ok = await send('POST', '/api/stages', { name: 'x'.repeat(200), date: '2026-07-14', stage_type: 'montagne', waypoints: [wps[0], { ...wps[1], kind: 'sprint' }, { label: 'Lourdes', kind: 'col', lat: 43.1, lon: -0.05 }] });
  assert.strictEqual(ok.status, 200);
  const empty = await send('POST', '/api/stages', { name: 'B', date: '', waypoints: wps });
  assert.strictEqual(empty.status, 200, 'date vide = pas de date');
});

test('PUT /api/stages/:id : mêmes bornes', async () => {
  const { id } = await (await send('POST', '/api/stages', { name: 'C', waypoints: wps })).json();
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { date: '18 juillet' })).status, 400);
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { edition_id: 4242 })).status, 400);
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { name: 'Renommée' })).status, 200);
});

test('import GPX/FIT : ?name répété donne 400, pas 500', async () => {
  const gpx = '<gpx><trk><trkseg><trkpt lat="43" lon="0"/><trkpt lat="43.01" lon="0.01"/></trkseg></trk></gpx>';
  const r = await fetch(`${base}/api/import/gpx?name=a&name=b`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml' }, body: gpx });
  assert.strictEqual(r.status, 400);
  const f = await fetch(`${base}/api/import/fit?name=a&name=b`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3]) });
  assert.ok([400].includes(f.status), String(f.status));
});

test('import de sauvegarde : une ligne null donne 400, pas 500', async () => {
  const r = await send('POST', '/api/backup/import', { confirm: true, tables: { gear: [null] } });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /gear\[0\]/);
});

test('POST /api/editions : nom borné', async () => {
  assert.strictEqual((await send('POST', '/api/editions', { name: 'e'.repeat(201) })).status, 400);
});
