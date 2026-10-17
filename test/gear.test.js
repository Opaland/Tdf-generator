'use strict';
// Inventaire matériel (issue #228, phase 7, Epic 29) : backend/routes/gear.js,
// migration 7, sauvegarde portable.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-gear-test-${process.pid}`);
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
  for (const t of ['tracks', 'stages', 'gear']) db.prepare(`DELETE FROM ${t}`).run();
});

const call = async (method, route, body) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

function insertStage(db, { router = 'trace', state = 'done', distanceKm = 0, ascentM = 0, elapsedTimeS = null, gearId = null } = {}) {
  const id = db.prepare(
    `INSERT INTO stages (name, state, generated_distance_km, total_ascent_m, elapsed_time_s, gear_id) VALUES ('S', ?, ?, ?, ?, ?)`
  ).run(state, distanceKm, ascentM, elapsedTimeS, gearId).lastInsertRowid;
  if (router) db.prepare(`INSERT INTO tracks (stage_id, geojson, distance_m, router) VALUES (?, '{}', 0, ?)`).run(id, router);
  return id;
}

test('POST /api/gear : création, nom rogné, type par défaut vélo, cumuls à zéro et durée null', async () => {
  const r = await call('POST', '/api/gear', { name: '  Vélo route  ' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.name, 'Vélo route');
  assert.strictEqual(r.body.kind, 'velo');
  assert.strictEqual(r.body.retired, false);
  assert.strictEqual(r.body.traceCount, 0);
  assert.strictEqual(r.body.distanceKm, 0);
  assert.strictEqual(r.body.elapsedTimeS, null);
});

test('POST/PUT /api/gear : chaque champ validé avant SQL (jamais un 500)', async () => {
  for (const bad of [{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: ['x'] }, { name: { a: 1 } },
    { name: 'x'.repeat(81) }, { name: 'ok', kind: 'voiture' }, { name: 'ok', kind: ['velo'] }]) {
    assert.strictEqual((await call('POST', '/api/gear', bad)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await call('POST', '/api/gear', { name: 'x'.repeat(80) })).status, 201);
  const { body: g } = await call('POST', '/api/gear', { name: 'Gravel' });
  for (const bad of [{ retired: 1 }, { retired: 'true' }, { name: null }, { kind: 'x' }]) {
    assert.strictEqual((await call('PUT', `/api/gear/${g.id}`, bad)).status, 400, JSON.stringify(bad));
  }
  for (const id of ['0', '-1', '1.5', '3abc', 'x']) {
    assert.strictEqual((await call('PUT', `/api/gear/${id}`, { name: 'y' })).status, 404, id);
  }
});

test('PUT /api/gear/:id : renommage et retrait partiels, le reste inchangé', async () => {
  const { body: g } = await call('POST', '/api/gear', { name: 'Chaussures', kind: 'chaussures' });
  let r = await call('PUT', `/api/gear/${g.id}`, { retired: true });
  assert.strictEqual(r.body.retired, true);
  assert.strictEqual(r.body.name, 'Chaussures');
  r = await call('PUT', `/api/gear/${g.id}`, { name: 'Chaussures route' });
  assert.strictEqual(r.body.name, 'Chaussures route');
  assert.strictEqual(r.body.kind, 'chaussures');
  assert.strictEqual(r.body.retired, true);
  r = await call('PUT', `/api/gear/${g.id}`, { retired: false });
  assert.strictEqual(r.body.retired, false);
  assert.strictEqual((await call('PUT', '/api/gear/999999', { name: 'x' })).status, 404);
});

test('cumuls : seules les traces importées terminées comptent ; durée sur les sorties horodatées seulement', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo' });
  insertStage(db, { distanceKm: 40.04, ascentM: 500.4, elapsedTimeS: 3600, gearId: g.id });
  insertStage(db, { distanceKm: 20, ascentM: 100, elapsedTimeS: null, gearId: g.id }); // sans horodatage
  insertStage(db, { distanceKm: 999, router: 'osrm', gearId: g.id }); // étape routée : forgée, jamais comptée
  insertStage(db, { distanceKm: 999, state: 'error', gearId: g.id }); // trace en échec
  insertStage(db, { distanceKm: 7 }); // trace sans matériel
  const [row] = (await call('GET', '/api/gear')).body.gear;
  assert.strictEqual(row.traceCount, 2);
  assert.strictEqual(row.distanceKm, 60);
  assert.strictEqual(row.ascentM, 600);
  assert.strictEqual(row.elapsedTimeS, 3600);
  assert.strictEqual(row.timedCount, 1);

  // Aucune sortie horodatée : null, jamais 0 (CLAUDE.md règle 10).
  const { body: g2 } = await call('POST', '/api/gear', { name: 'Autre vélo' });
  insertStage(db, { distanceKm: 5, gearId: g2.id });
  const row2 = (await call('GET', '/api/gear')).body.gear.find((x) => x.id === g2.id);
  assert.strictEqual(row2.elapsedTimeS, null);
  assert.strictEqual(row2.timedCount, 0);
});

test('PUT /api/traces/:id/gear : trace seulement, matériel existant, null détache', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo' });
  const trace = insertStage(db);
  const routed = insertStage(db, { router: 'osrm' });
  const draft = insertStage(db, { router: null, state: 'draft' });

  assert.strictEqual((await call('PUT', `/api/traces/${trace}/gear`, { gearId: g.id })).status, 200);
  assert.strictEqual(db.prepare('SELECT gear_id FROM stages WHERE id = ?').get(trace).gear_id, g.id);
  assert.strictEqual((await call('PUT', `/api/traces/${routed}/gear`, { gearId: g.id })).status, 404);
  assert.strictEqual((await call('PUT', `/api/traces/${draft}/gear`, { gearId: g.id })).status, 404);
  assert.strictEqual((await call('PUT', '/api/traces/999999/gear', { gearId: g.id })).status, 404);
  assert.strictEqual((await call('PUT', `/api/traces/${trace}/gear`, { gearId: 999999 })).status, 400);
  for (const bad of [{}, { gearId: '1' }, { gearId: 1.5 }, { gearId: 0 }, { gearId: true }, { gearId: [g.id] }]) {
    assert.strictEqual((await call('PUT', `/api/traces/${trace}/gear`, bad)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual(db.prepare('SELECT gear_id FROM stages WHERE id = ?').get(trace).gear_id, g.id, 'refus sans effet');
  assert.strictEqual((await call('PUT', `/api/traces/${trace}/gear`, { gearId: null })).status, 200);
  assert.strictEqual(db.prepare('SELECT gear_id FROM stages WHERE id = ?').get(trace).gear_id, null);
});

test('DELETE /api/gear/:id : détache les sorties sans les supprimer', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo' });
  const trace = insertStage(db, { gearId: g.id });
  assert.strictEqual((await call('DELETE', `/api/gear/${g.id}`)).status, 200);
  const st = db.prepare('SELECT id, gear_id FROM stages WHERE id = ?').get(trace);
  assert.ok(st, 'la sortie existe toujours');
  assert.strictEqual(st.gear_id, null);
  assert.strictEqual((await call('DELETE', `/api/gear/${g.id}`)).status, 404);
});

test('GET /api/traces/summary : chaque sortie récente porte son gearId', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo' });
  const a = insertStage(db, { gearId: g.id });
  const b = insertStage(db);
  const { recent } = (await call('GET', '/api/traces/summary')).body;
  assert.strictEqual(recent.find((r) => r.id === a).gearId, g.id);
  assert.strictEqual(recent.find((r) => r.id === b).gearId, null);
});

test('sauvegarde portable : gear exportée et restaurée avec le lien des sorties ; ancienne sauvegarde sans gear acceptée', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo <b>route</b>' });
  const trace = insertStage(db, { distanceKm: 12, gearId: g.id });
  const dump = await (await fetch(`${base}/api/backup/export`)).json();
  assert.strictEqual(dump.tables.gear.length, 1);

  let r = await call('POST', '/api/backup/import', { confirm: true, tables: dump.tables });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.counts.gear, 1);
  assert.strictEqual(db.prepare('SELECT gear_id FROM stages WHERE id = ?').get(trace).gear_id, g.id);
  assert.strictEqual(db.prepare('SELECT name FROM gear').get().name, 'Vélo <b>route</b>');

  // Sauvegarde antérieure à la migration 7 : ni table gear, ni colonne gear_id.
  const old = JSON.parse(JSON.stringify(dump.tables));
  delete old.gear;
  for (const s of old.stages) delete s.gear_id;
  r = await call('POST', '/api/backup/import', { confirm: true, tables: old });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM gear').get().n, 0);

  // Sauvegarde forgée : gear_id vers un matériel absent → refus, base inchangée.
  const forged = JSON.parse(JSON.stringify(dump.tables));
  forged.gear = [];
  r = await call('POST', '/api/backup/import', { confirm: true, tables: forged });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM stages').get().n, 1, 'transaction annulée');
});

test('GET /api/gear/traces : toutes les traces terminées (au-delà des 20 récentes), date normalisée, compte des non associées', async () => {
  const db = getDb();
  const { body: g } = await call('POST', '/api/gear', { name: 'Vélo' });
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push(insertStage(db, { distanceKm: i, gearId: i === 0 ? g.id : null }));
  insertStage(db, { router: 'osrm' });
  insertStage(db, { state: 'error' });
  db.prepare("UPDATE stages SET date = '02/06/2026' WHERE id = ?").run(ids[1]);
  db.prepare("UPDATE stages SET date = '2026-06-09' WHERE id = ?").run(ids[2]);
  const { body } = await call('GET', '/api/gear/traces');
  assert.strictEqual(body.traces.length, 25);
  assert.strictEqual(body.unassignedCount, 24);
  assert.strictEqual(body.traces[0].id, ids[2], 'datée d\'abord');
  assert.strictEqual(body.traces.find((t) => t.id === ids[1]).date, null);
  // La plus ancienne (hors des 20 récentes du bilan) est bien associable.
  assert.strictEqual((await call('PUT', `/api/traces/${ids[0]}/gear`, { gearId: null })).status, 200);
  const { recent } = (await call('GET', '/api/traces/summary')).body;
  assert.strictEqual(recent.length, 20);
  assert.ok(!recent.some((r) => r.id === ids[3]), 'hors du bilan récent, mais présente dans /api/gear/traces');
});
