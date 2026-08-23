'use strict';
// Tests unitaires de pipeline/pain.js — backlog issue #10, section C,
// "indice de pénibilité cumulée façon VeloViewer".

const { test } = require('node:test');
const assert = require('node:assert');
const { climbScore, isMountainDay, painIndex } = require('../pipeline/pain');

test('climbScore : somme les points par catégorie, ignore une catégorie inconnue', () => {
  assert.strictEqual(climbScore([{ category: 'HC' }, { category: '1' }]), 9);
  assert.strictEqual(climbScore([{ category: '4' }]), 1);
  assert.strictEqual(climbScore([]), 0);
  assert.strictEqual(climbScore(null), 0);
  assert.strictEqual(climbScore([{ category: 'inconnue' }]), 0);
});

test('isMountainDay : côte HC/1/2 suffit, cat.3/4 seule ne suffit pas sauf stage_type montagne', () => {
  assert.strictEqual(isMountainDay('plaine', [{ category: 'HC' }]), true);
  assert.strictEqual(isMountainDay('plaine', [{ category: '2' }]), true);
  assert.strictEqual(isMountainDay('plaine', [{ category: '3' }]), false);
  assert.strictEqual(isMountainDay('plaine', []), false);
  assert.strictEqual(isMountainDay('montagne', [{ category: '4' }]), true);
  assert.strictEqual(isMountainDay('montagne', []), true);
});

test('painIndex : combine score des côtes, contribution du D+, et facteur de fatigue', () => {
  const flat = painIndex({ totalAscentM: 0, climbs: [], mountainStreak: 0 });
  assert.strictEqual(flat.score, 0);
  assert.strictEqual(flat.fatigueFactor, 1);

  const oneClimb = painIndex({ totalAscentM: 500, climbs: [{ category: 'HC' }], mountainStreak: 1 });
  // climbScore 5 + D+ 500/500=1 → base 6, mountainStreak=1 → pas de bonus (facteur 1)
  assert.strictEqual(oneClimb.climbScore, 5);
  assert.strictEqual(oneClimb.ascentContribution, 1);
  assert.strictEqual(oneClimb.fatigueFactor, 1);
  assert.strictEqual(oneClimb.score, 6);

  const thirdMountainDay = painIndex({ totalAscentM: 500, climbs: [{ category: 'HC' }], mountainStreak: 3 });
  // +15 % par jour au-delà du premier → 2 jours de plus → +30 % → facteur 1.3
  assert.strictEqual(thirdMountainDay.fatigueFactor, 1.3);
  assert.strictEqual(thirdMountainDay.score, Math.round(6 * 1.3 * 10) / 10);
});

test('painIndex : le facteur de fatigue est plafonné à +60 % (5 jours consécutifs ou plus)', () => {
  const longStreak = painIndex({ totalAscentM: 0, climbs: [], mountainStreak: 10 });
  assert.strictEqual(longStreak.fatigueFactor, 1.6);
});
