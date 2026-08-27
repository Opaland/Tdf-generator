'use strict';
// Chantier L, Tour de France Femmes (backlog #10) : `year` seul comme clé
// d'édition faisait écraser silencieusement l'une des deux éditions dès que
// Hommes et Femmes partagent une année — importEdition() faisait
// `DELETE FROM editions WHERE year = ?` avant d'insérer, sans distinguer la
// catégorie. Documenté comme bloquant dans docs/PRESENTATION.md avant
// d'être corrigé ici (pipeline/importer.js, backend/db.js, pipeline/wikipedia.js).
//
// Aucune fixture Wikipédia ni parcours curé Femmes n'existe dans ce dépôt
// (accès réseau nécessaire pour la scraper, indisponible dans ce sandbox —
// CLAUDE.md règle 9 : ne jamais fabriquer une donnée historique non
// vérifiée). Ces tests prouvent donc la non-collision au niveau base et le
// comportement d'échec propre sans fixture, pas un import Femmes réel
// bout-en-bout — mêmes garanties que importAllEditions() pour les années
// Hommes sans fixture (test/importAll.test.js).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-editioncategory-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { importEdition, CATEGORIES } = require('../pipeline/importer');
const { reconstructionWaypoints } = require('../pipeline/wikipedia');
const { getDb } = require('../backend/db');

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('CATEGORIES : hommes et femmes, rien d\'autre', () => {
  assert.deepStrictEqual(CATEGORIES, ['hommes', 'femmes']);
});

test('importEdition() : catégorie invalide rejetée avant tout accès réseau/DB (status 400)', async () => {
  await assert.rejects(
    () => importEdition(2025, { category: 'autre' }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /Catégorie invalide/);
      return true;
    }
  );
});

test('importEdition(year, {category: "hommes"}) : édition nommée et catégorisée correctement (fixture réelle 2025)', async () => {
  const { edition } = await importEdition(2025, { category: 'hommes' });
  assert.strictEqual(edition.category, 'hommes');
  assert.strictEqual(edition.name, 'Tour de France 2025');
});

test('importEdition() : category omise équivaut à "hommes" (rétrocompatibilité)', async () => {
  const { edition } = await importEdition(2025);
  assert.strictEqual(edition.category, 'hommes');
});

test('collision année/catégorie : ré-importer Hommes 2025 ne touche pas une édition Femmes 2025 existante', async () => {
  const db = getDb();
  // Édition Femmes insérée directement (pas via importEdition : aucune
  // fixture Femmes n'existe dans ce dépôt) pour isoler ce qu'on vérifie —
  // le comportement de collision de importEdition(), pas sa capacité à
  // importer réellement des données Femmes.
  const femmes = db
    .prepare(`INSERT INTO editions (year, name, is_custom, category, source) VALUES (2025, 'Tour de France Femmes 2025', 0, 'femmes', NULL)`)
    .run();
  const femmesStage = db
    .prepare(`INSERT INTO stages (edition_id, stage_order, name, state) VALUES (?, 1, 'Étape témoin Femmes', 'draft')`)
    .run(femmes.lastInsertRowid);

  // Avant le correctif, importEdition(2025) (sans catégorie -> hommes)
  // cherchait `WHERE year = ?` sans filtrer par catégorie : elle aurait
  // trouvé et supprimé cette édition Femmes avant d'insérer la sienne.
  await importEdition(2025, { category: 'hommes' });

  const stillThere = db.prepare('SELECT * FROM editions WHERE id = ?').get(femmes.lastInsertRowid);
  assert.ok(stillThere, 'l\'édition Femmes 2025 doit survivre à un ré-import Hommes 2025');
  assert.strictEqual(stillThere.name, 'Tour de France Femmes 2025');
  const stageStillThere = db.prepare('SELECT * FROM stages WHERE id = ?').get(femmesStage.lastInsertRowid);
  assert.ok(stageStillThere, 'les étapes de l\'édition Femmes ne doivent pas être supprimées non plus');

  const hommes = db.prepare(`SELECT * FROM editions WHERE year = 2025 AND category = 'hommes'`).all();
  assert.strictEqual(hommes.length, 1, 'une seule édition Hommes 2025 après ré-import (l\'ancienne a bien été remplacée, elle)');
});

test('importEdition(year, {category: "femmes"}) hors-ligne sans fixture : échec propre, base inchangée', async () => {
  const db = getDb();
  const before2026 = db.prepare(`SELECT COUNT(*) n FROM editions WHERE year = 2026`).get().n;
  await assert.rejects(
    () => importEdition(2026, { category: 'femmes' }),
    (err) => {
      assert.match(err.message, /fixture locale/);
      assert.match(err.message, /Tour de France Femmes/);
      return true;
    }
  );
  const after2026 = db.prepare(`SELECT COUNT(*) n FROM editions WHERE year = 2026`).get().n;
  assert.strictEqual(after2026, before2026, 'un import Femmes échoué ne doit rien écrire, pas même supprimer l\'édition Hommes 2026 existante');
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
});

test('POST /api/editions/import : category omise → hommes par défaut, category invalide → 400', async () => {
  const okRes = await fetch(`${base}/api/editions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: 2025 }),
  });
  assert.strictEqual(okRes.status, 200);
  assert.strictEqual((await okRes.json()).edition.category, 'hommes');

  const badRes = await fetch(`${base}/api/editions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: 2025, category: 'peloton-mixte' }),
  });
  assert.strictEqual(badRes.status, 400);
  assert.match((await badRes.json()).error, /Catégorie invalide/);
});

// Trouvaille de revue-personas/monkey testing (27/08/2026) : le test direct
// sur importEdition() ci-dessus (ligne 89) vérifiait déjà le rejet, mais
// aucun test n'appelait la route HTTP pour ce même cas — elle renvoyait
// 500 générique (avec console.error côté serveur, comme une vraie panne)
// alors qu'une année/catégorie valide sans fixture locale en mode
// hors-ligne est un cas attendu, pas un bug serveur.
test('POST /api/editions/import : hors-ligne sans fixture locale -> 503 (pas 500)', async () => {
  const res = await fetch(`${base}/api/editions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: 2026, category: 'femmes' }),
  });
  assert.strictEqual(res.status, 503);
  assert.match((await res.json()).error, /fixture locale/);
});

test('POST /api/editions (édition personnalisée) : category invalide → 400, category valide acceptée', async () => {
  const badRes = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mon tour perso', category: 'peloton-mixte' }),
  });
  assert.strictEqual(badRes.status, 400);

  const okRes = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mon tour perso Femmes', category: 'femmes', is_custom: true }),
  });
  assert.strictEqual(okRes.status, 200);
  const { id } = await okRes.json();
  const getRes = await fetch(`${base}/api/editions/${id}`);
  assert.strictEqual((await getRes.json()).category, 'femmes');
});

test('reconstructionWaypoints() : la curation Hommes d\'une année ne s\'applique pas à Femmes (pas de fuite entre catégories)', () => {
  // 1903 étape 2 a un point de passage curé réel (col de la République) côté
  // Hommes — vérifié par test/historicRoutes.test.js. Sans entrée
  // "1903-femmes" dans historic_routes.json, l'appel côté Femmes doit
  // retomber sur les libellés Wikipédia bruts, jamais hériter de cette
  // curation Hommes.
  const stage = { number: 2, start: 'Lyon', finish: 'Marseille' };
  const hommes = reconstructionWaypoints(1903, stage, 'hommes');
  const femmes = reconstructionWaypoints(1903, stage, 'femmes');
  assert.ok(
    hommes.some((wp) => wp.source === 'parcours curé'),
    'hypothèse du test : 1903 étape 2 est bien curée côté Hommes'
  );
  assert.ok(
    femmes.every((wp) => wp.source === 'wikipedia'),
    'aucune donnée curée Hommes ne doit fuiter vers un import Femmes de la même année'
  );
});
