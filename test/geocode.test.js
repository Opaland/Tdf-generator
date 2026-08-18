'use strict';
// Sélection du bon résultat de géocodage (bugs vus lors de la première
// génération en ligne : « Vienne » résolu sur le département de la Vienne,
// adresses préférées aux communes).

const { test } = require('node:test');
const assert = require('node:assert');
const { pickFeature, isColQuery } = require('../pipeline/geocode');

test('une commune bat un homonyme mieux classé (département, rue…)', () => {
  const feats = [
    { label: 'Vienne (département)', type: 'department', score: 0.95 },
    { label: 'Rue de Vienne 75008 Paris', type: 'street', score: 0.93 },
    { label: 'Vienne (38200)', type: 'municipality', score: 0.9 },
  ];
  assert.strictEqual(pickFeature(feats, 'Vienne').type, 'municipality');
});

test('pour un col, on garde le classement du géocodeur (index POI)', () => {
  const feats = [
    { label: 'Col du Soulor', type: undefined, score: 0.9 },
    { label: 'Arbéost (65560)', type: 'municipality', score: 0.7 },
  ];
  assert.strictEqual(pickFeature(feats, 'Col du Soulor').label, 'Col du Soulor');
});

test('sans commune candidate, le premier résultat est conservé', () => {
  const feats = [{ label: 'Lieu-dit X', type: 'locality', score: 0.5 }];
  assert.strictEqual(pickFeature(feats, 'X').label, 'Lieu-dit X');
  assert.strictEqual(pickFeature([], 'X'), null);
});

test('isColQuery reconnaît les libellés de sommets', () => {
  assert.ok(isColQuery('Col du Tourmalet'));
  assert.ok(isColQuery('Mont Ventoux'));
  assert.ok(!isColQuery('Pau'));
});
