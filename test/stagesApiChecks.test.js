'use strict';
// GET /api/stages (frontend/editor.js) n'incluait jamais stages.checks —
// EF.stateBadge() ne pouvait donc pas distinguer une étape "générée" saine
// d'une étape "générée" dont l'audit qualité a échoué dans le tableau de
// l'éditeur (voir test/stateBadgeCheckFail.test.js pour le badge lui-même).
// GET /api/editions/:id l'avait déjà (SELECT * sur stages, JSON.parse déjà
// en place) — seule cette route manquait le champ.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-stagesapichecks-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let getDb;

before(async () => {
  const { app } = require('../backend/server');
  ({ getDb } = require('../backend/db'));
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM stages').run();
});

test('GET /api/stages : checks est renvoyé et déjà parsé en objet (pas une chaîne JSON brute)', async () => {
  const db = getDb();
  db.prepare(`INSERT INTO stages (name, state, checks) VALUES ('Étape', 'done', ?)`)
    .run(JSON.stringify({ ok: false, items: [{ status: 'fail' }] }));
  const rows = await (await fetch(`${base}/api/stages`)).json();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(typeof rows[0].checks, 'object');
  assert.strictEqual(rows[0].checks.ok, false);
});

test('GET /api/stages : checks absent (null) → champ checks: null, pas d\'exception', async () => {
  const db = getDb();
  db.prepare(`INSERT INTO stages (name, state) VALUES ('Étape sans checks', 'draft')`).run();
  const res = await fetch(`${base}/api/stages`);
  assert.strictEqual(res.status, 200);
  const rows = await res.json();
  assert.strictEqual(rows[0].checks, null);
});

test('GET /api/stages : checks corrompu (JSON invalide) → checks: null pour cette ligne, pas d\'exception globale', async () => {
  const db = getDb();
  db.prepare(`INSERT INTO stages (name, state, checks) VALUES ('Étape corrompue', 'done', 'pas du json')`).run();
  db.prepare(`INSERT INTO stages (name, state, checks) VALUES ('Étape saine', 'done', ?)`).run(JSON.stringify({ ok: true, items: [] }));
  const res = await fetch(`${base}/api/stages`);
  assert.strictEqual(res.status, 200, 'une ligne corrompue ne doit jamais faire échouer toute la liste');
  const rows = await res.json();
  assert.strictEqual(rows.length, 2);
  const corrupted = rows.find((r) => r.name === 'Étape corrompue');
  const healthy = rows.find((r) => r.name === 'Étape saine');
  assert.strictEqual(corrupted.checks, null);
  assert.strictEqual(healthy.checks.ok, true);
});
