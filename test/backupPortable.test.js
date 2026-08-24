'use strict';
// Sauvegarde portable (export/import JSON) — backlog #10, "réfléchisses à
// mettre en place des backend pour la gestion des datas". Complète (ne
// remplace pas) backend/backup.js (sauvegarde fichier .sqlite planifiée,
// testée dans test/backup.test.js) : voir backend/server.js pour la
// distinction reprise-après-sinistre vs portabilité.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backupportable-test-${process.pid}`);
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
  for (const t of ['km_analysis', 'climbs', 'elevation_samples', 'tracks', 'waypoints', 'stages', 'editions']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

async function createEdition(name, year) {
  const res = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, year }),
  });
  return (await res.json()).id;
}

async function createStage(name, edition_id) {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, edition_id,
      waypoints: [{ label: 'Départ', kind: 'start' }, { label: 'Arrivée', kind: 'finish' }],
    }),
  });
  return (await res.json()).id;
}

async function exportBackup() {
  const res = await fetch(`${base}/api/backup/export`);
  assert.strictEqual(res.status, 200);
  return res.json();
}

async function importBackup(payload) {
  return fetch(`${base}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('GET /api/backup/export : base vide → toutes les tables présentes, vides', async () => {
  const dump = await exportBackup();
  assert.strictEqual(dump.version, 1);
  assert.ok(dump.exported_at);
  for (const t of ['editions', 'stages', 'waypoints', 'tracks', 'elevation_samples', 'climbs', 'km_analysis']) {
    assert.deepStrictEqual(dump.tables[t], [], `${t} doit être un tableau vide`);
  }
});

test('GET /api/backup/export : n\'inclut jamais users/sessions/caches (même vides, la clé ne doit pas exister)', async () => {
  const dump = await exportBackup();
  for (const t of ['users', 'sessions', 'geocode_cache', 'elevation_cache', 'api_cache']) {
    assert.strictEqual(dump.tables[t], undefined, `${t} ne doit jamais apparaître dans l'export`);
  }
});

test('GET /api/backup/export : reflète fidèlement les données créées', async () => {
  const editionId = await createEdition('Tour de test', 2024);
  await createStage('Étape 1', editionId);
  const dump = await exportBackup();
  assert.strictEqual(dump.tables.editions.length, 1);
  assert.strictEqual(dump.tables.editions[0].name, 'Tour de test');
  assert.strictEqual(dump.tables.stages.length, 1);
  assert.strictEqual(dump.tables.waypoints.length, 2);
});

test('POST /api/backup/import : sans confirm:true → 400, base inchangée', async () => {
  const editionId = await createEdition('Ne pas toucher', 2020);
  const res = await importBackup({ tables: { editions: [] } });
  assert.strictEqual(res.status, 400);
  const stillThere = getDb().prepare('SELECT id FROM editions WHERE id = ?').get(editionId);
  assert.ok(stillThere, 'la base ne doit pas être modifiée sans confirm:true');
});

test('POST /api/backup/import : tables absent ou mal typé → 400', async () => {
  let res = await importBackup({ confirm: true });
  assert.strictEqual(res.status, 400);
  res = await importBackup({ confirm: true, tables: [] });
  assert.strictEqual(res.status, 400);
  res = await importBackup({ confirm: true, tables: 'x' });
  assert.strictEqual(res.status, 400);
});

test('round-trip : export → modification de la base → réimport restaure exactement l\'état exporté (remplacement, pas fusion)', async () => {
  const editionId = await createEdition('Édition d\'origine', 2022);
  await createStage('Étape à conserver', editionId);
  const dump = await exportBackup();

  // Modification après l'export : une nouvelle édition qui ne doit PAS
  // survivre au réimport (preuve que c'est un remplacement, pas un ajout).
  await createEdition('Édition ajoutée après l\'export', 2099);
  assert.strictEqual(getDb().prepare('SELECT COUNT(*) n FROM editions').get().n, 2);

  const res = await importBackup({ confirm: true, tables: dump.tables });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.counts.editions, 1);
  assert.strictEqual(body.counts.stages, 1);

  const editions = getDb().prepare('SELECT * FROM editions').all();
  assert.strictEqual(editions.length, 1, 'l\'édition ajoutée après l\'export ne doit pas survivre au réimport');
  assert.strictEqual(editions[0].id, editionId, 'l\'id d\'origine doit être préservé (les FK stage.edition_id en dépendent)');
  assert.strictEqual(editions[0].name, 'Édition d\'origine');
});

test('POST /api/backup/import : colonne inconnue → 400, base inchangée (rien n\'est écrit)', async () => {
  const editionId = await createEdition('Protégée', 2021);
  const res = await importBackup({
    confirm: true,
    tables: { editions: [{ id: 1, name: 'x', colonne_qui_nexiste_pas: 'y' }] },
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /colonne inconnue/);
  const stillThere = getDb().prepare('SELECT id FROM editions WHERE id = ?').get(editionId);
  assert.ok(stillThere, 'un fichier invalide ne doit rien écrire, même partiellement');
});

test('POST /api/backup/import : valeur non liable (objet imbriqué) → 400 propre, pas un crash 500 avec stack trace', async () => {
  const res = await importBackup({
    confirm: true,
    tables: { editions: [{ id: 1, year: null, name: 'x', is_custom: 0, source: { nested: true }, created_at: 'x' }] },
  });
  assert.strictEqual(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /type non pris en charge/);
});

test('POST /api/backup/import : accepte un payload de plus de 2 Mo avec le Content-Type JSON standard', async () => {
  // ~55 Ko/étape mesuré en pratique (surtout elevation_samples) : quelques
  // dizaines d'étapes suffisent à dépasser l'ancienne limite de 2 Mo — voir
  // backend/server.js pour pourquoi la limite globale est passée à 20mb
  // plutôt qu'un second body-parser scopé à cette route (qui ne fonctionne
  // pas : le premier parseur qui matche le Content-Type rejette la requête
  // avant qu'un second, plus loin dans la chaîne, ne puisse la voir).
  const bigSource = 'x'.repeat(3 * 1024 * 1024); // 3 Mo, dépasse l'ancienne limite de 2 Mo
  const res = await importBackup({
    confirm: true,
    tables: { editions: [{ id: 1, year: 2024, name: 'Grosse édition', is_custom: 0, source: bigSource, created_at: '2024-01-01 00:00:00' }] },
  });
  const json = await res.json();
  assert.strictEqual(res.status, 200, `réponse inattendue : ${res.status} ${JSON.stringify(json)}`);
  assert.strictEqual(json.counts.editions, 1);
  assert.strictEqual(getDb().prepare('SELECT length(source) n FROM editions WHERE id = 1').get().n, bigSource.length);
});

test('POST /api/backup/import : lignes aux colonnes incohérentes entre elles dans une même table → 400', async () => {
  const res = await importBackup({
    confirm: true,
    tables: {
      editions: [
        { id: 1, year: 2020, name: 'A', is_custom: 0, source: null, created_at: 'x' },
        { id: 2, name: 'B' }, // colonnes manquantes par rapport à la 1re ligne
      ],
    },
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /colonnes incohérentes/);
});
