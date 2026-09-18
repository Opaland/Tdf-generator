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
function insertStage(db, { name, stageType = 'trace', router = 'trace', state = 'done', distanceKm = 0, ascentM = 0, date = null, elapsedTimeS = null, climbs = [] }) {
  const r = db.prepare(
    `INSERT INTO stages (name, stage_type, state, generated_distance_km, total_ascent_m, date, elapsed_time_s) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name, stageType, state, distanceKm, ascentM, date, elapsedTimeS);
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
  assert.deepStrictEqual(s, {
    traceCount: 0, totalDistanceKm: 0, totalAscentM: 0, totalElapsedTimeS: null, tracesWithTimeCount: 0,
    highestSummit: null, climbs: [], daily: [], recent: [],
  });
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

test('plus haut sommet : un col avec summit_ele_m null traité en premier ne masque pas un col réel derrière lui (relecture adverse)', async () => {
  const db = getDb();
  // c.summit_ele_m > highestSummit.summit_ele_m coercerait `null` en 0 des
  // deux côtés de la comparaison — sans garde, un col sans altitude connue,
  // traité en premier, empêcherait un vrai col négatif suivant de devenir
  // "le plus haut" (-30 > 0 est faux). Domaine négatif nécessaire pour le
  // même motif que le test ci-dessus.
  insertStage(db, {
    name: 'Sortie',
    climbs: [
      { name: 'Col Sans Altitude', category: '2', summitEleM: null },
      { name: 'Col Réel', category: '2', summitEleM: -30 },
    ],
  });
  const s = await summary();
  assert.strictEqual(s.highestSummit.name, 'Col Réel');
  assert.strictEqual(s.highestSummit.summit_ele_m, -30);
});

test('une trace sans aucune côte détectée ne casse rien (climbs vide reste valide)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie plate', distanceKm: 30, ascentM: 100 });
  const s = await summary();
  assert.strictEqual(s.traceCount, 1);
  assert.strictEqual(s.highestSummit, null);
  assert.deepStrictEqual(s.climbs, []);
});

// PR #227 (capture date/durée à l'import) : ces trois champs restent absents
// pour toute trace important antérieure, ou dont le GPX/FIT source ne
// portait aucun horodatage — jamais coercés en 0/liste vide trompeuse.
test('totalElapsedTimeS reste null si AUCUNE trace n\'a de durée connue (pas 0)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sortie sans horodatage', distanceKm: 40, ascentM: 500 });
  const s = await summary();
  assert.strictEqual(s.totalElapsedTimeS, null);
  assert.strictEqual(s.tracesWithTimeCount, 0);
});

test('totalElapsedTimeS additionne uniquement les traces qui ont une durée connue, tracesWithTimeCount les compte', async () => {
  const db = getDb();
  insertStage(db, { name: 'Avec durée 1', distanceKm: 40, ascentM: 500, date: '2026-09-01', elapsedTimeS: 3600 });
  insertStage(db, { name: 'Avec durée 2', distanceKm: 20, ascentM: 200, date: '2026-09-02', elapsedTimeS: 1800 });
  insertStage(db, { name: 'Sans durée', distanceKm: 10, ascentM: 100 });
  const s = await summary();
  assert.strictEqual(s.totalElapsedTimeS, 5400);
  assert.strictEqual(s.tracesWithTimeCount, 2, 'sur 3 traces au total (traceCount)');
  assert.strictEqual(s.traceCount, 3);
});

test('daily agrège plusieurs traces du même jour, ignore les traces sans date, trie par date croissante', async () => {
  const db = getDb();
  insertStage(db, { name: 'Matin', distanceKm: 20, ascentM: 300, date: '2026-09-02', elapsedTimeS: 1800 });
  insertStage(db, { name: 'Après-midi (même jour)', distanceKm: 15, ascentM: 200, date: '2026-09-02', elapsedTimeS: 1200 });
  insertStage(db, { name: 'Veille', distanceKm: 50, ascentM: 800, date: '2026-09-01', elapsedTimeS: 5400 });
  insertStage(db, { name: 'Sans date', distanceKm: 5, ascentM: 50 });
  const s = await summary();
  assert.strictEqual(s.daily.length, 2, 'une seule entrée par jour calendaire, la trace sans date exclue');
  assert.strictEqual(s.daily[0].date, '2026-09-01');
  assert.strictEqual(s.daily[1].date, '2026-09-02');
  assert.strictEqual(s.daily[1].distanceKm, 35, '20 + 15, les deux sorties du même jour additionnées');
  assert.strictEqual(s.daily[1].ascentM, 500);
  assert.strictEqual(s.daily[1].elapsedTimeS, 3000, '1800 + 1200');
});

test('daily : un jour dont AUCUNE trace n\'a de durée connue garde elapsedTimeS à null (pas 0)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Sans durée', distanceKm: 20, ascentM: 300, date: '2026-09-02' });
  const s = await summary();
  assert.strictEqual(s.daily.length, 1);
  assert.strictEqual(s.daily[0].elapsedTimeS, null);
});

test('recent : trie par date décroissante, tronque à 20, place les traces sans date en dernier (par id décroissant)', async () => {
  const db = getDb();
  insertStage(db, { name: 'Plus ancienne', distanceKm: 10, ascentM: 100, date: '2026-01-01' });
  insertStage(db, { name: 'Plus récente', distanceKm: 20, ascentM: 200, date: '2026-09-01' });
  insertStage(db, { name: 'Sans date', distanceKm: 5, ascentM: 50 });
  const s = await summary();
  assert.strictEqual(s.recent.length, 3);
  assert.strictEqual(s.recent[0].name, 'Plus récente');
  assert.strictEqual(s.recent[1].name, 'Plus ancienne');
  assert.strictEqual(s.recent[2].name, 'Sans date', 'une trace sans date connue va en dernier, jamais mélangée arbitrairement');
});

// Trouvaille de relecture adverse (18/09/2026, CLAUDE.md règle 3) : PUT
// /api/stages/:id (route générique, non scopée aux traces) ne valide que le
// TYPE de `date` (optionalString), jamais son format — une date au format
// JJ/MM/AAAA écrite par cette voie se triait lexicographiquement au mauvais
// endroit dans daily/recent (« 01/01/2026 » < « 2025-12-31 » car '0' < '2'),
// silencieusement, sans qu'aucune exception ne le signale.
test('date au format inattendu (écrite via PUT générique, pas l\'import) : traitée comme absente, pas de tri faussé', async () => {
  const db = getDb();
  insertStage(db, { name: 'Réveillon', distanceKm: 10, ascentM: 100, date: '2025-12-31' });
  insertStage(db, { name: 'MalFormee', distanceKm: 20, ascentM: 200, date: '01/01/2026' });
  const s = await summary();
  assert.strictEqual(s.daily.length, 1, 'seule la date bien formée alimente daily, la mal formée est traitée comme absente');
  assert.strictEqual(s.daily[0].date, '2025-12-31');
  assert.strictEqual(s.recent.find((r) => r.name === 'MalFormee').date, null, 'jamais affichée telle quelle, même logique qu\'une date absente');
  assert.strictEqual(s.recent[0].name, 'Réveillon', 'la trace mal formée retombe en fin de liste comme une trace sans date, ne casse pas le tri des dates valides');
});
