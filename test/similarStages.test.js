'use strict';
// Étapes similaires (backlog #10, section D) : GET /api/stages/:id/similar
// rapproche des étapes au profil proche (D+, catégorie de côte max, pente
// max) — heuristique de distance documentée dans backend/server.js,
// jamais présentée comme une recommandation éditoriale.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-similar-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// Stub fidèle à EF.esc() (frontend/common.js) — pas la version simplifiée
// `(s) => String(s ?? '')` utilisée ailleurs (test/compare.test.js), qui ne
// vérifierait rien sur l'échappement. global.EF.qs est nécessaire car
// frontend/stage.js l'appelle au chargement du module (const stageId =
// EF.qs('id')) — sa valeur n'a pas d'importance pour similarItemHtml.
global.EF = {
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  qs: () => null,
};
const { similarItemHtml } = require('../frontend/stage.js');

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
  for (const t of ['climbs', 'stages', 'editions']) db.prepare(`DELETE FROM ${t}`).run();
});

function insertStage(db, { name, state = 'done', totalAscentM = 0, climbs = [] }) {
  const r = db.prepare(
    `INSERT INTO stages (name, state, total_ascent_m) VALUES (?, ?, ?)`
  ).run(name, state, totalAscentM);
  const stageId = r.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO climbs (stage_id, name, category, max_gradient, start_km, end_km) VALUES (?, ?, ?, ?, 0, 10)`);
  climbs.forEach((c, i) => ins.run(stageId, `Côte ${i}`, c.category, c.maxGradient));
  return stageId;
}

test('GET /api/stages/:id/similar : étape introuvable → 404', async () => {
  const res = await fetch(`${base}/api/stages/999999/similar`);
  assert.strictEqual(res.status, 404);
});

test('GET /api/stages/:id/similar : étape non générée (draft) → liste vide, pas d\'erreur', async () => {
  const db = getDb();
  const id = insertStage(db, { name: 'Brouillon', state: 'draft' });
  const res = await fetch(`${base}/api/stages/${id}/similar`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual((await res.json()).similar, []);
});

test('GET /api/stages/:id/similar : aucune autre étape générée → liste vide', async () => {
  const db = getDb();
  const id = insertStage(db, { name: 'Seule étape', totalAscentM: 2000 });
  const res = await fetch(`${base}/api/stages/${id}/similar`);
  assert.deepStrictEqual((await res.json()).similar, []);
});

test('GET /api/stages/:id/similar : classe la plus proche par D+ en premier', async () => {
  const db = getDb();
  const target = insertStage(db, { name: 'Cible', totalAscentM: 3000 });
  const close = insertStage(db, { name: 'Proche', totalAscentM: 3200 });
  const far = insertStage(db, { name: 'Loin', totalAscentM: 500 });
  const res = await fetch(`${base}/api/stages/${target}/similar`);
  const { similar } = await res.json();
  assert.strictEqual(similar.length, 2);
  assert.strictEqual(similar[0].id, close, 'l\'étape la plus proche en D+ doit arriver en premier');
  assert.strictEqual(similar[1].id, far);
});

test('GET /api/stages/:id/similar : la propre étape cible n\'apparaît jamais dans ses propres suggestions', async () => {
  const db = getDb();
  const target = insertStage(db, { name: 'Cible', totalAscentM: 1000 });
  insertStage(db, { name: 'Autre', totalAscentM: 1000 });
  const res = await fetch(`${base}/api/stages/${target}/similar`);
  const { similar } = await res.json();
  assert.ok(!similar.some((s) => s.id === target));
});

test('GET /api/stages/:id/similar : ne retient jamais les étapes non générées (draft/generating/error) comme candidates', async () => {
  const db = getDb();
  const target = insertStage(db, { name: 'Cible', totalAscentM: 1000 });
  insertStage(db, { name: 'Brouillon', state: 'draft', totalAscentM: 1000 });
  insertStage(db, { name: 'En erreur', state: 'error', totalAscentM: 1000 });
  const res = await fetch(`${base}/api/stages/${target}/similar`);
  assert.deepStrictEqual((await res.json()).similar, []);
});

test('GET /api/stages/:id/similar : rapproche aussi par catégorie de côte et pente max, pas seulement le D+', async () => {
  const db = getDb();
  // Deux étapes au même D+ que la cible : l'une avec une côte de catégorie et
  // pente proches, l'autre sans aucune côte (plate) — la première doit gagner.
  const target = insertStage(db, { name: 'Cible', totalAscentM: 2000, climbs: [{ category: '1', maxGradient: 9 }] });
  const withClimb = insertStage(db, { name: 'Avec côte proche', totalAscentM: 2000, climbs: [{ category: '1', maxGradient: 8 }] });
  const flat = insertStage(db, { name: 'Plate', totalAscentM: 2000 });
  const res = await fetch(`${base}/api/stages/${target}/similar`);
  const { similar } = await res.json();
  assert.strictEqual(similar[0].id, withClimb, 'même D+, mais la côte de catégorie/pente proche doit primer sur une étape plate');
  assert.strictEqual(similar[0].max_category, '1');
  assert.strictEqual(similar[1].id, flat);
});

test('GET /api/stages/:id/similar : limite à 5 suggestions au maximum', async () => {
  const db = getDb();
  const target = insertStage(db, { name: 'Cible', totalAscentM: 1000 });
  for (let i = 0; i < 8; i++) insertStage(db, { name: `Étape ${i}`, totalAscentM: 1000 + i * 10 });
  const res = await fetch(`${base}/api/stages/${target}/similar`);
  const { similar } = await res.json();
  assert.strictEqual(similar.length, 5);
});

// similarItemHtml (frontend/stage.js) : fonction pure, testée directement
// sans DOM (voir la garde `typeof document`/`typeof module` en fin de
// fichier). Verrouille l'échappement HTML trouvé correct par la relecture
// adverse (testé alors avec un vrai navigateur Playwright) sur les deux
// vecteurs : s.name (nom d'étape) et s.edition_name (nom de tour
// personnalisé — champ libre saisi par l'utilisateur).
test('similarItemHtml : échappe s.name (nom d\'étape) contre une charge XSS', () => {
  const html = similarItemHtml({ id: 1, name: '<img src=x onerror="alert(1)">', edition_name: null, total_ascent_m: null });
  assert.doesNotMatch(html, /<img/, 'un nom d\'étape hostile ne doit jamais produire une balise <img> exécutable');
  assert.match(html, /&lt;img/);
});

test('similarItemHtml : échappe s.edition_name (nom de tour personnalisé, champ libre) contre une charge XSS', () => {
  const html = similarItemHtml({ id: 1, name: 'Étape propre', edition_name: '</script><img src=x onerror="alert(1)">', total_ascent_m: null });
  assert.doesNotMatch(html, /<img|<\/script>/, 'un nom de tour hostile (concaténé dans meta) ne doit jamais produire du HTML exécutable');
  assert.match(html, /&lt;img/);
});

test('similarItemHtml : rendu normal — lien vers la fiche, métadonnées jointes par « · »', () => {
  const html = similarItemHtml({
    id: 42, name: 'Pau → Hautacam', edition_name: 'Tour de France', edition_year: 2024,
    total_ascent_m: 2200, max_category: '1', max_gradient: 12.4,
  });
  assert.match(html, /href="\/stage\.html\?id=42"/);
  assert.match(html, /Pau → Hautacam/);
  assert.match(html, /Tour de France \(2024\)/);
  assert.match(html, /D\+ 2200 m/);
  assert.match(html, /côte cat\. 1/);
  assert.match(html, /12\.4 % max/);
});

test('similarItemHtml : sans édition ni côte, pas de tiret orphelin ni de "null" affiché', () => {
  const html = similarItemHtml({ id: 1, name: 'Étape libre', edition_name: null, total_ascent_m: null, max_category: null, max_gradient: 0 });
  assert.doesNotMatch(html, /null|undefined/);
  assert.doesNotMatch(html, / — <\/li>/, 'sans aucune métadonnée, pas de tiret " — " suivi de rien');
});
