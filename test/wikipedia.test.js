'use strict';
// Test du parseur Wikipédia sur les fixtures locales (1903 exigé, + 2025/2026).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  parseStagesFromHtml,
  parseCourse,
  parseDistanceKm,
  parseDate,
  reconstructionWaypoints,
  extractTables,
} = require('../pipeline/wikipedia');

const FIXTURES = path.join(__dirname, '..', 'pipeline', 'fixtures');
const load = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

test('parse le tableau des étapes du Tour 1903', () => {
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  assert.strictEqual(stages.length, 6, '6 étapes en 1903 (la ligne Total est ignorée)');

  const s1 = stages[0];
  assert.strictEqual(s1.number, 1);
  assert.strictEqual(s1.start, 'Paris');
  assert.strictEqual(s1.finish, 'Lyon');
  assert.strictEqual(s1.distanceKm, 467);
  assert.strictEqual(s1.dateIso, '1903-07-01');
  assert.match(s1.winner, /Garin/);

  const s6 = stages[5];
  assert.strictEqual(s6.number, 6);
  assert.strictEqual(s6.start, 'Nantes');
  assert.strictEqual(s6.distanceKm, 471);

  const total = stages.reduce((a, s) => a + s.distanceKm, 0);
  assert.strictEqual(total, 2428, 'distance totale officielle 1903');
});

test('waypoints de reconstruction 1903 étape 1 : Montgeron au départ, col du Pin-Bouchain', () => {
  // Le col du Pin-Bouchain (759 m, entre Tarare et Roanne) est le tout premier
  // col franchi dans l'histoire du Tour — sur l'étape 1 Paris→Lyon, pas le col
  // de la République (qui est franchi à l'étape 2, premier col > 1000 m).
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  const wps = reconstructionWaypoints(1903, stages[0]);
  assert.strictEqual(wps[0].label, 'Montgeron', 'départ réel au Réveil-Matin de Montgeron');
  assert.strictEqual(wps[wps.length - 1].label, 'Lyon');
  const col = wps.find((w) => w.kind === 'col');
  assert.ok(col, 'le col du Pin-Bouchain figure dans le parcours curé de l\'étape 1');
  assert.strictEqual(col.label, 'Col du Pin-Bouchain');
  assert.strictEqual(col.altitude_hint_m, 759);
});

test('waypoints de reconstruction 1903 étape 2 : col de la République (premier col > 1000 m)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  const wps = reconstructionWaypoints(1903, stages[1]);
  const col = wps.find((w) => w.kind === 'col');
  assert.ok(col, 'le col de la République figure dans le parcours curé de l\'étape 2');
  assert.strictEqual(col.label, 'Col de la République');
  assert.strictEqual(col.altitude_hint_m, 1161);
});

test('parse le tableau des étapes du Tour 2025 (format moderne)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_2025_en.html'), 2025);
  assert.strictEqual(stages.length, 21, '21 étapes en 2025 (repos et Total ignorés)');

  const clm = stages.find((s) => s.number === 5);
  assert.strictEqual(clm.start, 'Caen');
  assert.strictEqual(clm.type, 'clm');
  assert.strictEqual(clm.distanceKm, 33);

  const hautacam = stages.find((s) => s.number === 12);
  assert.strictEqual(hautacam.finish, 'Hautacam');
  assert.strictEqual(hautacam.type, 'montagne');

  const bretagne = stages.find((s) => s.number === 7);
  assert.strictEqual(bretagne.finish, 'Mûr-de-Bretagne', 'entités HTML accentuées décodées');
});

test('parse la fixture 2026 (parcours annoncé, partielle)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_2026_en.html'), 2026);
  assert.ok(stages.length >= 10);
  assert.strictEqual(stages[0].type, 'clm par équipes', 'étape 1 : CLM par équipes à Barcelone');
  assert.strictEqual(stages[0].start, 'Barcelona');
  const alpe = stages.filter((s) => s.finish === "Alpe d'Huez");
  assert.strictEqual(alpe.length, 2, "doublé de l'Alpe d'Huez");
});

test('fonctions unitaires du parseur', () => {
  assert.deepStrictEqual(parseCourse('Paris to Lyon'), { start: 'Paris', finish: 'Lyon' });
  assert.deepStrictEqual(parseCourse('Pau – Hautacam'), { start: 'Pau', finish: 'Hautacam' });
  assert.deepStrictEqual(parseCourse('Paris (Montgeron) to Lyon'), { start: 'Paris', finish: 'Lyon' });
  assert.strictEqual(parseDistanceKm('467 km (290 mi)'), 467);
  assert.strictEqual(parseDistanceKm('2,428 km'), 2428, 'séparateur de milliers anglo-saxon');
  assert.strictEqual(parseDistanceKm('467,5 km'), 467.5, 'décimale française');
  assert.strictEqual(parseDate('1–2 July', 1903), '1903-07-01');
  assert.strictEqual(parseDate('5 juillet 1903', 1903), '1903-07-05');
});

// extractTables (backlog #10, section F) : remplacement du mini-parseur
// regex par node-html-parser (un vrai DOM) — vérifié bit-à-bit identique à
// l'ancien parseur sur les 3 fixtures réelles du dépôt avant remplacement
// (pas dans ce fichier, en amont, avant l'écriture du diff). Ces tests
// couvrent des cas que le mini-parseur regex maison gérait déjà pour
// partie, ou pas du tout — à ne pas régresser avec un futur changement.
test('extractTables : ignore les tables sans classe wikitable', () => {
  const html = '<table class="infobox"><tr><td>x</td></tr></table><table class="wikitable"><tr><td>y</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['y']]]);
});

test('extractTables : retire les appels de référence <sup> du texte de cellule', () => {
  const html = '<table class="wikitable"><tr><td>Paris<sup>[1]</sup> to Lyon</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Paris to Lyon']]]);
});

test('extractTables : <br> devient un espace, pas une concaténation collée', () => {
  const html = '<table class="wikitable"><tr><td>Ligne1<br>Ligne2</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Ligne1 Ligne2']]]);
});

test('extractTables : décode les entités HTML au-delà du tableau fixe de l\'ancien parseur (ex. &hellip;, &#39;, entité numérique)', () => {
  const html = '<table class="wikitable"><tr><td>L&#39;étape&hellip; &#233;tape</td></tr></table>';
  const cell = extractTables(html)[0][0][0];
  assert.strictEqual(cell, "L'étape… étape");
});

test('extractTables : balisage légèrement malformé (attribut non fermé) ne casse pas le parseur', () => {
  const html = '<table class="wikitable"><tr><td class=unquoted>Étape 1</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Étape 1']]]);
});

test('extractTables : HTML vide ou sans aucune table → tableau vide, pas d\'exception', () => {
  assert.deepStrictEqual(extractTables(''), []);
  assert.deepStrictEqual(extractTables('<p>rien ici</p>'), []);
});
