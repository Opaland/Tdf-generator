'use strict';
// Bilan personnel « année en cols » (backlog #10, section D) : GET
// /api/traces/summary agrège les traces importées — cols gravis dédupliqués
// par nom, D+ total, distance totale, plus haut sommet. N'inclut jamais une
// étape officielle/historique ou un brouillon éditeur, même au même D+.
//
// Marqueur utilisé : `tracks.router = 'trace'`, PAS `stages.stage_type`.
// Trouvaille de la relecture adverse : stage_type est une chaîne libre
// acceptée telle quelle par POST/PUT /api/stages (optionalString, aucune
// liste blanche) — un brouillon créé à la main dans l'éditeur avec
// stage_type: 'trace' se route normalement (router='osrm'/'simulateur'),
// et se serait fait passer pour une sortie réellement parcourue si le
// filtre avait porté sur stage_type. router='trace' n'est posé que par une
// seule ligne de pipeline/importTrack.js, jamais atteignable autrement.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-tracessummary-test-${process.pid}`);
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
  for (const t of ['climbs', 'tracks', 'stages']) db.prepare(`DELETE FROM ${t}`).run();
});

// router: 'trace' (import réel), 'osrm'/'simulateur' (routage standard), ou
// null (aucune ligne tracks — ex. un brouillon jamais généré).
function insertStage(db, { name, stageType = 'trace', router = 'trace', state = 'done', distanceKm = 0, ascentM = 0, climbs = [] }) {
  const r = db.prepare(
    `INSERT INTO stages (name, stage_type, state, generated_distance_km, total_ascent_m) VALUES (?, ?, ?, ?, ?)`
  ).run(name, stageType, state, distanceKm, ascentM);
  const stageId = r.lastInsertRowid;
  if (router != null) {
    db.prepare(`INSERT INTO tracks (stage_id, geojson, distance_m, router) VALUES (?, '{}', 0, ?)`).run(stageId, router);
  }
  const ins = db.prepare(`INSERT INTO climbs (stage_id, name, category, summit_ele_m, start_km, end_km) VALUES (?, ?, ?, ?, 0, 10)`);
  climbs.forEach((c) => ins.run(stageId, c.name, c.category, c.summitEleM));
  return stageId;
}

async function summary() {
  const res = await fetch(`${base}/api/traces/summary`);
  assert.strictEqual(res.status, 200);
  return res.json();
}

test('aucune trace importée → bilan vide, pas d\'erreur', async () => {
  const s = await summary();
  assert.deepStrictEqual(s, { traceCount: 0, totalDistanceKm: 0, totalAscentM: 0, highestSummit: null, climbs: [] });
});

test('n\'inclut jamais une étape officielle/historique (routage OSRM/simulateur standard)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Étape officielle', router: 'osrm', distanceKm: 180, ascentM: 3000 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 0, 'une étape routée normalement ne doit jamais compter comme une sortie personnelle');
});

// La trouvaille elle-même, verrouillée : stage_type='trace' seul (posable
// par n'importe qui via POST/PUT /api/stages) ne doit JAMAIS suffire.
test('un brouillon éditeur avec stage_type=\'trace\' usurpé, mais routé normalement, n\'apparaît pas dans le bilan', async () => {
  const db = getDb();
  insertStage(db, { name: 'Brouillon éditeur maquillé', stageType: 'trace', router: 'osrm', distanceKm: 100, ascentM: 1500 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 0, 'stage_type seul ne doit jamais suffire à compter comme une trace personnelle — voir tracks.router');
});

test('un brouillon jamais généré (aucune ligne tracks) n\'apparaît jamais, même avec stage_type=\'trace\' et state forcé à \'done\'', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sans tracé', stageType: 'trace', router: null, distanceKm: 50, ascentM: 500 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 0);
});

test('n\'inclut jamais une trace non générée (draft/error)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Import en cours', state: 'generating', distanceKm: 50, ascentM: 500 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 0);
});

test('agrège distance et D+ sur plusieurs traces', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie 1', distanceKm: 60, ascentM: 800 });
  insertStage(db, { name: 'Sortie 2', distanceKm: 40, ascentM: 1200 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 2);
  assert.strictEqual(s.totalDistanceKm, 100);
  assert.strictEqual(s.totalAscentM, 2000);
});

test('déduplique les cols par nom, compte les ascensions, garde l\'altitude sommet la plus haute observée', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie 1', climbs: [{ name: 'Col du Tourmalet', category: '1', summitEleM: 2100 }] });
  insertStage(db, { name: 'Sortie 2', climbs: [{ name: 'Col du Tourmalet', category: 'HC', summitEleM: 2115 }] });
  const s = await summary();
  assert.strictEqual(s.climbs.length, 1, 'un seul col dans la liste malgré 2 ascensions');
  assert.strictEqual(s.climbs[0].count, 2);
  assert.strictEqual(s.climbs[0].maxSummitM, 2115, 'garde la plus haute des deux altitudes observées');
  assert.strictEqual(s.climbs[0].bestCategory, 'HC', 'garde la catégorie la plus dure observée (HC > 1)');
});

test('plus haut sommet toutes traces confondues, distinct de la déduplication par nom', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie 1', climbs: [{ name: 'Col A', category: '2', summitEleM: 1200 }] });
  insertStage(db, { name: 'Sortie 2', climbs: [{ name: 'Col B', category: '1', summitEleM: 2400 }] });
  const s = await summary();
  assert.strictEqual(s.highestSummit.name, 'Col B');
  assert.strictEqual(s.highestSummit.summit_ele_m, 2400);
});

test('une trace sans aucune côte détectée ne casse rien (climbs vide reste valide)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie plate', distanceKm: 30, ascentM: 100 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 1);
  assert.strictEqual(s.highestSummit, null);
  assert.deepStrictEqual(s.climbs, []);
});
