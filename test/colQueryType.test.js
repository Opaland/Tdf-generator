'use strict';
// Epic 35.10 (revue globale du 19/10/2026) : classement des libellés en
// col/sommet et des types d'étape Wikipédia.

const { test } = require('node:test');
const assert = require('node:assert');
const { isColQuery } = require('../pipeline/geocode');
const { normalizeType } = require('../pipeline/wikipedia');

test('isColQuery : les communes au nom de relief ne sont plus des cols', () => {
  for (const commune of ['Mont-de-Marsan', 'Le Mont-Dore', 'Mont-Dore', 'Mont-Saint-Père', 'Le Puy-en-Velay', 'Puy-Saint-Martin',
    'Mont-Saint-Michel', 'Pagny-la-Blanche-Côte', 'Saint-Gervais Mont-Blanc', 'Le Bouchet-Mont-Charvin', 'Montélimar',
    'Chemin du Plateau de la Côte des Bar (secteur km 131.9, entrée)']) {
    assert.strictEqual(isColQuery(commune), false, commune);
  }
});

test('isColQuery : les cols, côtes et sommets restent reconnus, y compris en second segment', () => {
  for (const col of ['Col du Tourmalet', "Alpe d'Huez", 'Puy de Dôme', 'Mont Ventoux', 'Côte de la Croix Neuve', 'Montée de Laffrey',
    'Plateau de Beille', 'Station de Superbagnères', "Le Col de la Croix de Fer", "L'Alpe d'Huez", 'col de la Schlucht',
    'Mont-Ventoux', 'Plateau-de-Beille', 'Puy-de-Dôme', "Gourette–Col d'Aubisque", "Belfort/Col du Ballon d'Alsace",
    'Serre Chevalier (col du Granon)', 'Villard-de-Lans (Côte 2000)', 'Tulle (Puy Pinçon)', 'Pic du Midi']) {
    assert.strictEqual(isColQuery(col), true, col);
  }
  assert.strictEqual(isColQuery(''), false);
  assert.strictEqual(isColQuery(null), false);
});

test('normalizeType : moyenne montagne, CLM de montagne, libellés anciens', () => {
  assert.strictEqual(normalizeType('Medium mountain stage'), 'accidentée');
  assert.strictEqual(normalizeType('Mountain time trial'), 'clm');
  assert.strictEqual(normalizeType('Team time trial'), 'clm par équipes');
  assert.strictEqual(normalizeType('High mountain stage'), 'montagne');
  assert.strictEqual(normalizeType('Mountain stage'), 'montagne');
  assert.strictEqual(normalizeType('Intermediate stage'), 'accidentée');
  assert.strictEqual(normalizeType('Hilly stage'), 'accidentée');
  assert.strictEqual(normalizeType('Flat stage'), 'plaine');
  assert.strictEqual(normalizeType('Individual time trial'), 'clm');
});
