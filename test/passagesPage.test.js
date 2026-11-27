'use strict';
// « Passé chez moi » sur le site statique (story 41.7, issue #633) :
// recherche par nom et par position faite dans le navigateur.
const { test } = require('node:test');
const assert = require('node:assert');
global.EF = require('../frontend/common.js');
const P = require('../frontend/passages.js');

const PLACES = [
  ['Saint-Gervais-les-Bains', 45.8921, 6.7121, 'ville', [[1966, '19', 0, 1]]],
  ['Gervais', 46.0, 6.0, 'ville', [[1980, '3', 12.5, 0]]],
  ['Col du Galibier', 45.064, 6.4078, 'col', [[1970, '10', 120, 1], [1965, '17', 98, 1]]],
  ['Saint-Étienne', 45.4397, 4.3872, 'ville', [[1975, '8', 0, 1]]],
];

test('fold : accents, casse et ponctuation ignorés', () => {
  assert.strictEqual(P.fold('Saint-Étienne  '), 'saint etienne');
  assert.strictEqual(P.fold('Col de l’Iseran'), 'col de l iseran');
});

test('par nom : mot entier en tête, nom exact puis début de nom puis le reste', () => {
  assert.deepStrictEqual(P.byName(PLACES, 'gervais').map((m) => m.place[0]), ['Gervais', 'Saint-Gervais-les-Bains']);
  assert.deepStrictEqual(P.byName(PLACES, 'saint etienne').map((m) => m.place[0]), ['Saint-Étienne']);
  assert.deepStrictEqual(P.byName(PLACES, 'galib').map((m) => m.place[0]), ['Col du Galibier']);
  // pas au milieu d'un mot
  assert.deepStrictEqual(P.byName(PLACES, 'ervais'), []);
  assert.deepStrictEqual(P.byName(PLACES, 'a'), []);
});

test('autour d’un point : rayon respecté, plus proche d’abord', () => {
  const m = P.near(PLACES, 45.9, 6.7, 30);
  assert.deepStrictEqual(m.map((x) => x.place[0]), ['Saint-Gervais-les-Bains']);
  assert.ok(m[0].distance < 2);
  assert.deepStrictEqual(P.near(PLACES, 45.9, 6.7, 100).map((x) => x.place[0]), ['Saint-Gervais-les-Bains', 'Gervais', 'Col du Galibier']);
  assert.ok(Math.abs(P.km(45, 6, 46, 6) - 111.2) < 0.2);
});

test('lignes : un passage par ligne, années croissantes, km non imprimé « ≈ », lien vers l’étape', () => {
  const rows = P.rows(P.byName(PLACES, 'galibier'));
  assert.deepStrictEqual(rows.map((r) => r.year), [1965, 1970]);
  const html = P.rowHtml(rows[0]);
  assert.ok(html.includes('href="/edition.html?annee=1965&amp;etape=17"'));
  assert.ok(html.includes('(col)'));
  assert.ok(P.rowHtml(P.rows(P.byName(PLACES, 'gervais'))[0]).includes('≈ 12,5'));
  const evil = P.rowHtml({ label: '<img src=x onerror=1>', kind: 'ville', distance: 1.26, year: 1965, stage: '"><b>', km: 3, printed: true });
  assert.ok(!evil.includes('<img') && !evil.includes('"><b>'));
  assert.ok(evil.includes('1,3 km'));
});

// Relecture adverse : rang « début de nom », bord du rayon, « St », homonymes.
test('rangs : identique, puis début de nom, puis mot plus loin', () => {
  const pl = [['Bains', 0, 0, 'ville', []], ['Saint-Gervais-les-Bains', 0, 0, 'ville', []], ['Bains-les-Bains', 0, 0, 'ville', []]];
  assert.deepStrictEqual(P.byName(pl, 'bains').map((m) => m.place[0]), ['Bains', 'Bains-les-Bains', 'Saint-Gervais-les-Bains']);
});

test('« St » et « Ste » trouvent « Saint » et « Sainte »', () => {
  assert.deepStrictEqual(P.byName(PLACES, 'St Gervais').map((m) => m.place[0]), ['Saint-Gervais-les-Bains']);
  assert.strictEqual(P.fold('Ste-Marie'), 'sainte marie');
  assert.strictEqual(P.fold('Stade'), 'stade');
  assert.strictEqual(P.fold('Saint-Étienne'), 'saint etienne');
});

test('rayon : un lieu juste au bord est compté, juste au-delà non', () => {
  const pl = [['A', 46, 6, 'ville', []]];
  const d = P.km(45.9, 6, 46, 6);
  assert.strictEqual(P.near(pl, 45.9, 6, d + 0.01).length, 1);
  assert.strictEqual(P.near(pl, 45.9, 6, d - 0.01).length, 0);
});

test('homonymes distingués par « départ → arrivée » de l’étape', () => {
  const pl = [['Saint-Gervais', 45.89, 6.71, 'ville', [[1966, '19', 0, 1]]], ['Saint-Gervais', 45.2, 5.48, 'ville', [[1970, '4', 80, 1]]]];
  const rows = P.rows(P.byName(pl, 'saint gervais'), { '1966/19': 'Saint-Gervais → Montreux', '1970/4': 'Grenoble → Valence' });
  assert.deepStrictEqual(rows.map((r) => r.route), ['Saint-Gervais → Montreux', 'Grenoble → Valence']);
  assert.ok(P.rowHtml(rows[1]).includes('Grenoble → Valence'));
});
