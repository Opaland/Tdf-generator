'use strict';
// Sprint 4 (performance, issue #343) : `stages.edition_id` n'avait aucun index
// malgré un filtre `WHERE edition_id = ?` sur le chemin le plus chaud de l'app
// (GET /api/editions/:id, export de tour, generate.js — lookup des étapes
// sœurs pour occurrenceIndex/occurrenceCount à CHAQUE loadStageFull()).
// Mesuré avant correctif (EXPLAIN QUERY PLAN) : `SCAN stages` + tri sur
// B-tree temporaire — un coût qui grossit avec le nombre total d'étapes de
// TOUTES les éditions, pas seulement celle demandée. Process séparé : premier
// (et seul) require() de backend/db.js dans ce fichier, voir CLAUDE.md règle 4.

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { removeSync } = require('../pipeline/fsPortable');

// Bases créées par les processus enfants, terminés avant le nettoyage.
const dataDirs = [];
after(() => dataDirs.forEach(removeSync));

function runInChildProcess(dataDir) {
  const out = execFileSync(
    process.execPath,
    ['-e', `
      process.env.ETAPEFORGE_DATA_DIR = ${JSON.stringify(dataDir)};
      const { getDb } = require('./backend/db');
      const db = getDb();
      const indexes = db.prepare("PRAGMA index_list(stages)").all().map((i) => i.name);
      const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(1);
      console.log(JSON.stringify({ indexes, plan }));
    `],
    { cwd: path.join(__dirname, '..') }
  ).toString().trim();
  return JSON.parse(out);
}

test('getDb() : stages porte un index sur edition_id (base fraîche)', () => {
  const dataDir = path.join(os.tmpdir(), `etapeforge-db-index-test-${process.pid}-${Date.now()}`);
  dataDirs.push(dataDir);
  const { indexes } = runInChildProcess(dataDir);
  assert.ok(indexes.includes('idx_stages_edition'), `index attendus sur stages : ${indexes.join(', ')}`);
});

test('EXPLAIN QUERY PLAN : WHERE edition_id = ? ORDER BY stage_order, id utilise l\'index, pas un SCAN complet', () => {
  const dataDir = path.join(os.tmpdir(), `etapeforge-db-index-test2-${process.pid}-${Date.now()}`);
  dataDirs.push(dataDir);
  const { plan } = runInChildProcess(dataDir);
  const details = plan.map((p) => p.detail).join(' | ');
  assert.ok(/SEARCH stages USING.*INDEX idx_stages_edition/.test(details), `plan obtenu : ${details}`);
  assert.ok(!/SCAN stages/.test(details), `ne doit plus scanner toute la table : ${details}`);
  assert.ok(!/TEMP B-TREE/.test(details), `l'ordre de l'index doit couvrir le tri, pas de tri temporaire : ${details}`);
});
