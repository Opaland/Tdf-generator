'use strict';
// GET /api/climbs (catalogue des côtes, frontend/cols.html) : aucun test
// dédié n'existait avant ce fichier — trouvaille de revue-personas (persona
// ancien coureur). Un profil de montée généré en mode simulateur (hors
// ligne) peut afficher des pentes irréalistes (ex. Tourmalet à 17,7 % de
// moyenne sur 8 km — aucune ascension réelle n'en approche), jusqu'ici
// signalé uniquement par un bandeau global de page, jamais par ligne dans
// ce catalogue qui prétend cataloguer « toutes les côtes détectées ».
//
// `simulated` reprend le drapeau `offline` déjà posé dans stages.checks à
// la génération (pipeline/generate.js) — pas un nouveau JOIN sur tracks.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-climbsapi-test-${process.pid}`);
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
  for (const t of ['climbs', 'stages']) db.prepare(`DELETE FROM ${t}`).run();
});

function insertStage(db, { name, checks, state = 'done' }) {
  const r = db.prepare(
    `INSERT INTO stages (name, state, checks) VALUES (?, ?, ?)`
  ).run(name, state, checks != null ? JSON.stringify(checks) : null);
  const stageId = r.lastInsertRowid;
  db.prepare(`INSERT INTO climbs (stage_id, name, category, summit_ele_m, start_km, end_km) VALUES (?, 'Col test', '1', 1500, 0, 10)`).run(stageId);
  return stageId;
}

test('GET /api/climbs : côte issue d\'une étape générée en mode hors-ligne (checks.offline true) → simulated: true', async () => {
  const db = getDb();
  insertStage(db, { name: 'Étape simulée', checks: { items: [], offline: true } });
  const rows = await (await fetch(`${base}/api/climbs`)).json();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].simulated, true);
});

test('GET /api/climbs : côte issue d\'une étape générée en ligne (checks.offline false) → simulated: false', async () => {
  const db = getDb();
  insertStage(db, { name: 'Étape réelle', checks: { items: [], offline: false } });
  const rows = await (await fetch(`${base}/api/climbs`)).json();
  assert.strictEqual(rows[0].simulated, false);
});

test('GET /api/climbs : stages.checks absent (null) → simulated: false, pas d\'exception', async () => {
  const db = getDb();
  insertStage(db, { name: 'Étape sans checks', checks: null });
  const res = await fetch(`${base}/api/climbs`);
  assert.strictEqual(res.status, 200);
  const rows = await res.json();
  assert.strictEqual(rows[0].simulated, false);
});

test('GET /api/climbs : stages.checks corrompu (JSON invalide) → simulated: false, pas d\'exception', async () => {
  const db = getDb();
  const r = db.prepare(`INSERT INTO stages (name, state, checks) VALUES ('Étape corrompue', 'done', 'pas du json')`).run();
  db.prepare(`INSERT INTO climbs (stage_id, name, category, summit_ele_m, start_km, end_km) VALUES (?, 'Col test', '1', 1500, 0, 10)`).run(r.lastInsertRowid);
  const res = await fetch(`${base}/api/climbs`);
  assert.strictEqual(res.status, 200);
  const rows = await res.json();
  assert.strictEqual(rows[0].simulated, false);
});

test('GET /api/climbs : le champ interne stage_checks ne fuit jamais dans la réponse JSON', async () => {
  const db = getDb();
  insertStage(db, { name: 'Étape', checks: { items: [], offline: true } });
  const rows = await (await fetch(`${base}/api/climbs`)).json();
  assert.strictEqual(rows[0].stage_checks, undefined, 'le JSON brut de stages.checks est un détail d\'implémentation, pas une donnée à exposer');
});
