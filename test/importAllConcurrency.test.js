'use strict';
// POST /api/editions/import-all doit refuser (409) un second démarrage tant
// qu'un import en masse tourne déjà (backend/server.js, importAllJob). Le
// vrai importAllEditions() hors-ligne est trop rapide pour fiablement
// « attraper » l'état running dans un test réel (aucun délai réseau — les
// fixtures locales sont lues en synchrone). On mocke donc
// pipeline/importer.js AVANT le premier require de backend/server.js, qui
// destructure importAllEditions à l'import (CLAUDE.md règle 4 : la
// réassignation doit précéder ce premier require, sinon server.js garde sa
// référence déjà liée à l'original).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-importall-concurrency-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const importerModule = require('../pipeline/importer');
const originalImportAllEditions = importerModule.importAllEditions;
let releaseGate = null;
importerModule.importAllEditions = async (...args) => {
  await new Promise((resolve) => { releaseGate = resolve; });
  return originalImportAllEditions(...args);
};

let appServer;
let base;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  importerModule.importAllEditions = originalImportAllEditions;
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('un second POST pendant qu\'un import en masse tourne déjà renvoie 409', async () => {
  const first = await fetch(`${base}/api/editions/import-all`, { method: 'POST' });
  assert.strictEqual(first.status, 202);

  // Le job de fond est bloqué sur releaseGate (encore null tant que le mock
  // n'a pas été invoqué) — on attend qu'il le soit avant de vérifier le 409,
  // pour ne pas dépendre d'un ordre d'exécution microtask non garanti.
  const deadline = Date.now() + 5000;
  while (!releaseGate && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(releaseGate, 'le mock doit avoir été invoqué (job démarré) avant ce délai');

  const second = await fetch(`${base}/api/editions/import-all`, { method: 'POST' });
  assert.strictEqual(second.status, 409);
  const body = await second.json();
  assert.match(body.error, /en cours/);

  releaseGate();
  let status = { running: true };
  const doneDeadline = Date.now() + 20000;
  while (status.running && Date.now() < doneDeadline) {
    await new Promise((r) => setTimeout(r, 20));
    status = await (await fetch(`${base}/api/editions/import-all/status`)).json();
  }
  assert.strictEqual(status.running, false, 'le job débloqué doit se terminer dans le délai du test');
});
