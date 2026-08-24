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
const { generateStage, loadStageFull } = require('../pipeline/generate');
const { importTrackAsStage, parseGpx } = require('../pipeline/importTrack');
const { stageConfidence } = require('../pipeline/wikipedia');

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('generateStage : étape introuvable → erreur explicite', async () => {
  await assert.rejects(() => generateStage(999999), /introuvable/);
});

test('loadStageFull : expose les réserves de confiance de l\'édition/étape (backlog #10, section D)', () => {
  // Rattachées à un couple (année, numéro d'étape) dans historic_routes.json,
  // pas à une colonne dédiée sur `stages` — vérifie le chemin de résolution
  // via l'édition (edition.year + stage.stage_order), pas juste la fonction
  // stageConfidence() elle-même (déjà couverte par test/historicRoutes.test.js).
  const db = getDb();
  const ed = db.prepare("INSERT INTO editions (year, name) VALUES (2023, 'Tour de France 2023')").run();
  const st = db.prepare(
    `INSERT INTO stages (edition_id, stage_order, name, state) VALUES (?, 9, 'Étape 9', 'draft')`
  ).run(ed.lastInsertRowid);
  const full = loadStageFull(st.lastInsertRowid);
  const expected = stageConfidence(2023, 9);
  assert.ok(expected.length > 0, 'hypothèse du test : 2023 étape 9 (Puy de Dôme) porte une réserve connue');
  assert.deepStrictEqual(full.confidence, expected);
});

test('loadStageFull : confidence vide pour une étape sans édition (créée dans l\'éditeur)', () => {
  const db = getDb();
  const st = db.prepare(`INSERT INTO stages (name, state) VALUES ('Étape libre', 'draft')`).run();
  const full = loadStageFull(st.lastInsertRowid);
  assert.deepStrictEqual(full.confidence, []);
});

function insertDoneStage(db, editionId, stageOrder, { stageType = 'montagne', ascentM = 1000, climbCategories = ['HC'] } = {}) {
  const r = db.prepare(
    `INSERT INTO stages (edition_id, stage_order, name, stage_type, state, total_ascent_m)
     VALUES (?, ?, ?, ?, 'done', ?)`
  ).run(editionId, stageOrder, `Étape ${stageOrder}`, stageType, ascentM);
  const stageId = r.lastInsertRowid;
  const insClimb = db.prepare(
    `INSERT INTO climbs (stage_id, name, category, start_km, end_km) VALUES (?, ?, ?, 0, 10)`
  );
  climbCategories.forEach((cat, i) => insClimb.run(stageId, `Côte ${i}`, cat));
  return stageId;
}

test('loadStageFull : pain.mountainStreak compte les jours de montagne consécutifs de l\'édition (backlog #10, section C)', () => {
  const db = getDb();
  const ed = db.prepare("INSERT INTO editions (year, name) VALUES (2030, 'Édition test pénibilité')").run();
  const editionId = ed.lastInsertRowid;
  insertDoneStage(db, editionId, 1); // jour de montagne 1
  insertDoneStage(db, editionId, 2); // jour de montagne 2
  const stage3Id = insertDoneStage(db, editionId, 3); // jour de montagne 3

  const full = loadStageFull(stage3Id);
  assert.strictEqual(full.pain.mountainStreak, 3);
  assert.strictEqual(full.pain.climbScore, 5); // une côte HC
  assert.ok(full.pain.fatigueFactor > 1, 'la fatigue doit augmenter après plusieurs jours de montagne consécutifs');
  assert.strictEqual(full.pain.fatigueFactor, 1.3); // +15 % × 2 jours au-delà du premier
});

test('loadStageFull : pain.mountainStreak s\'arrête à un jour de plaine ou un trou dans la numérotation', () => {
  const db = getDb();
  const ed = db.prepare("INSERT INTO editions (year, name) VALUES (2031, 'Édition test pénibilité 2')").run();
  const editionId = ed.lastInsertRowid;
  insertDoneStage(db, editionId, 1);
  insertDoneStage(db, editionId, 2, { stageType: 'plaine', climbCategories: [] }); // rompt la série
  const stage3Id = insertDoneStage(db, editionId, 3);

  const full = loadStageFull(stage3Id);
  assert.strictEqual(full.pain.mountainStreak, 1, 'la série ne doit pas remonter au-delà du jour de plaine');
});

test('loadStageFull : pain reste défini (mais sans fatigue) pour une étape hors édition', () => {
  const db = getDb();
  const st = db.prepare(
    `INSERT INTO stages (name, stage_type, state, total_ascent_m) VALUES ('Étape libre', 'montagne', 'done', 800)`
  ).run();
  const insClimb = db.prepare(`INSERT INTO climbs (stage_id, name, category, start_km, end_km) VALUES (?, ?, ?, 0, 5)`);
  insClimb.run(st.lastInsertRowid, 'Côte', '2');
  const full = loadStageFull(st.lastInsertRowid);
  assert.strictEqual(full.pain.mountainStreak, 0);
  assert.strictEqual(full.pain.fatigueFactor, 1);
  assert.ok(full.pain.score > 0);
});

test('loadStageFull : expose les descentes persistées, blocs km décodés (backlog #10)', () => {
  const db = getDb();
  const st = db.prepare(`INSERT INTO stages (name, state) VALUES ('Étape avec descente', 'done')`).run();
  const stageId = st.lastInsertRowid;
  db.prepare(
    `INSERT INTO descents (stage_id, name, start_km, end_km, length_km, top_ele_m, bottom_ele_m,
       avg_gradient, max_gradient, irregularity_index, km_blocks, name_source)
     VALUES (?, 'Descente du Tourmalet', 10, 18, 8, 2000, 1520, -6, -9.5, 1.2, ?, 'climb-summit')`
  ).run(stageId, JSON.stringify([{ fromM: 10000, toM: 11000, ele0: 2000, ele1: 1940, gradient: -6 }]));
  const full = loadStageFull(stageId);
  assert.strictEqual(full.descents.length, 1);
  const d = full.descents[0];
  assert.strictEqual(d.name, 'Descente du Tourmalet');
  assert.strictEqual(d.avg_gradient, -6);
  assert.ok(Array.isArray(d.km_blocks), 'km_blocks doit être décodé du JSON stocké, pas laissé en chaîne');
  assert.strictEqual(d.km_blocks.length, 1);
});

test('loadStageFull : descents est un tableau vide (pas undefined) pour une étape sans descente détectée', () => {
  const db = getDb();
  const st = db.prepare(`INSERT INTO stages (name, state) VALUES ('Étape plate', 'done')`).run();
  const full = loadStageFull(st.lastInsertRowid);
  assert.deepStrictEqual(full.descents, []);
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
