'use strict';
// Import en masse de toutes les éditions du Tour (pipeline/importer.js,
// importAllEditions() ; POST /api/editions/import-all, backend/server.js) —
// demande explicite « ajoute toutes les TDF » : le mécanisme d'import d'une
// édition (Wikipédia générique, sans curation requise) existait déjà pour
// une année à la fois ; ceci l'exécute pour 1903 → 2026 (hors guerres
// mondiales) sans jamais fabriquer de donnée historique manquante — une
// année sans fixture locale hors-ligne échoue proprement, elle n'est pas
// comblée par une valeur inventée.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-importall-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { allTdfYears, importAllEditions } = require('../pipeline/importer');

test('allTdfYears() : 1903 → 2026, hors 1915-1918 et 1940-1946 (guerres mondiales)', () => {
  const years = allTdfYears();
  assert.strictEqual(years[0], 1903);
  assert.strictEqual(years[years.length - 1], 2026);
  assert.strictEqual(years.length, 113, '124 années civiles 1903-2026 moins 11 années de guerre');
  for (const gap of [1915, 1916, 1917, 1918, 1940, 1941, 1942, 1943, 1944, 1945, 1946]) {
    assert.ok(!years.includes(gap), `${gap} ne doit pas être une année de Tour`);
  }
  assert.strictEqual(new Set(years).size, years.length, 'aucun doublon');
});

test('importAllEditions() hors-ligne : parcourt toutes les années, échoue proprement sans fixture (pas de donnée inventée)', async () => {
  const progressCalls = [];
  const { total, imported, failed } = await importAllEditions({
    onProgress: (p) => progressCalls.push(p),
  });

  assert.strictEqual(total, 113);
  assert.strictEqual(imported.length + failed.length, total, 'chaque année est soit importée soit en échec, jamais les deux ni ni l\'une ni l\'autre');
  assert.strictEqual(progressCalls.length, total, 'onProgress appelé une fois par année tentée');
  assert.strictEqual(progressCalls[0].index, 1);
  assert.strictEqual(progressCalls[total - 1].index, total);

  // Seules les années avec une fixture locale (pipeline/fixtures/wikipedia_*_en.html)
  // peuvent réussir hors-ligne — vérifié directement plutôt que supposé.
  const fixturesDir = path.join(__dirname, '..', 'pipeline', 'fixtures');
  const fixtureYears = fs.readdirSync(fixturesDir)
    .map((f) => f.match(/^wikipedia_(\d+)_en\.html$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  assert.ok(fixtureYears.length >= 3, 'hypothèse du test : au moins 3 fixtures locales existent');
  assert.deepStrictEqual(
    imported.map((i) => i.year).sort((a, b) => a - b),
    fixtureYears.slice().sort((a, b) => a - b),
    'les années importées avec succès sont exactement celles qui ont une fixture locale'
  );

  for (const f of failed) {
    assert.match(f.error, /fixture/i, `${f.year} doit échouer pour absence de fixture, pas une autre raison : ${f.error}`);
  }
});

test('importAllEditions() : chaque édition importée a bien des étapes en base', async () => {
  const { imported } = await importAllEditions();
  const { getDb } = require('../backend/db');
  const db = getDb();
  for (const i of imported) {
    const count = db.prepare('SELECT COUNT(*) n FROM stages WHERE edition_id = ?').get(i.editionId).n;
    assert.strictEqual(count, i.stagesCount, `édition ${i.year} : stagesCount annoncé doit correspondre aux lignes réellement insérées`);
    assert.ok(count > 0);
  }
});

let appServer;
let base;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/editions/import-all/status avant tout démarrage : running false, listes vides', async () => {
  // Doit s'exécuter avant le test suivant, qui démarre un vrai job — node:test
  // exécute les tests d'un même fichier dans l'ordre de définition par défaut,
  // donc cet ordre dans le fichier fait foi (pas un détail cosmétique).
  const res = await fetch(`${base}/api/editions/import-all/status`);
  const body = await res.json();
  assert.strictEqual(body.running, false);
  assert.deepStrictEqual(body.imported, []);
  assert.deepStrictEqual(body.failed, []);
});

test('POST /api/editions/import-all + GET .../status : démarre en tâche de fond puis rapporte le résultat final', async () => {
  const start = await fetch(`${base}/api/editions/import-all`, { method: 'POST' });
  assert.strictEqual(start.status, 202);
  assert.deepStrictEqual(await start.json(), { started: true });

  let status = { running: true };
  const deadline = Date.now() + 20000;
  while (status.running && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    status = await (await fetch(`${base}/api/editions/import-all/status`)).json();
  }
  assert.strictEqual(status.running, false, 'le job doit se terminer dans le délai du test');
  assert.strictEqual(status.total, 113);
  assert.strictEqual(status.done, status.total);
  assert.ok(status.imported.length >= 3);
  assert.strictEqual(status.imported.length + status.failed.length, status.total);
});
