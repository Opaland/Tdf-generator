'use strict';
// Story 41.6 (issue #631) : routes GET locales des itinéraires curés, mêmes
// données que le site statique.
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-itin-route-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const ep = require('../pipeline/editionPages');

let server;
let base;
before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/itineraries : index des éditions curées', async () => {
  const res = await fetch(`${base}/api/itineraries`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), ep.editionIndex());
});

test('GET /api/itineraries/:annee : édition curée, 400 si invalide, 404 si absente', async () => {
  const ok = await fetch(`${base}/api/itineraries/1965`);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), ep.editionPage(1965));
  assert.strictEqual((await fetch(`${base}/api/itineraries/abcd`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/itineraries/1800`)).status, 404);
});

test('GET /api/passages : index des lieux de passage (story 41.7)', async () => {
  const res = await fetch(`${base}/api/passages`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, ep.passagesIndex());
  assert.ok(body.places.length > 1000);
});
