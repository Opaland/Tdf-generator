'use strict';
// Chemins d'erreur de pipeline/generate.js et pipeline/importTrack.js — item de
// backlog issue #10, section F (étape à un seul waypoint, trace vide/illisible).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-generate-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { getDb } = require('../backend/db');
const { generateStage } = require('../pipeline/generate');
const { importTrackAsStage, parseGpx } = require('../pipeline/importTrack');

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('generateStage : étape introuvable → erreur explicite', async () => {
  await assert.rejects(() => generateStage(999999), /introuvable/);
});

test('generateStage : un seul waypoint → refusé sans toucher l\'état de l\'étape', async () => {
  const db = getDb();
  const r = db.prepare(`INSERT INTO stages (name, state) VALUES ('Étape incomplète', 'draft')`).run();
  const stageId = r.lastInsertRowid;
  db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind) VALUES (?, 0, ?, ?)').run(stageId, 'Pau', 'start');

  await assert.rejects(() => generateStage(stageId), /au moins deux waypoints/);

  const stage = db.prepare('SELECT state FROM stages WHERE id = ?').get(stageId);
  assert.strictEqual(stage.state, 'draft', 'le rejet précoce ne doit pas faire passer l\'étape en generating/error');
});

test('parseGpx : XML vide ou illisible → aucun point, pas d\'exception', () => {
  assert.deepStrictEqual(parseGpx(''), { points: [], name: null });
  assert.deepStrictEqual(parseGpx('<ceci>n\'est pas</du gpx>'), { points: [], name: null });
});

test('importTrackAsStage : trace vide → rejet explicite', async () => {
  await assert.rejects(() => importTrackAsStage([]), /vide ou illisible/);
});

test('importTrackAsStage : un seul point → rejet explicite', async () => {
  await assert.rejects(() => importTrackAsStage([{ lat: 43, lon: 1, ele: 200 }]), /vide ou illisible/);
});
