'use strict';
// Défi du jour (backlog #10, section D) : suggestion d'une édition mythique
// stable pour la journée — frontend/editor.js est require()-able côté test
// (challengeIndexForDate est une fonction pure) grâce à la garde `typeof
// document` qui saute l'attache DOMContentLoaded en environnement Node.

const { test } = require('node:test');
const assert = require('node:assert');
const { challengeIndexForDate } = require('../frontend/editor.js');

test('challengeIndexForDate : même jour → même index (stable pour tout le monde ce jour-là)', () => {
  const a = challengeIndexForDate(new Date(2026, 7, 24, 8, 0, 0), 9);
  const b = challengeIndexForDate(new Date(2026, 7, 24, 22, 30, 0), 9);
  assert.strictEqual(a, b, 'deux horaires du même jour doivent donner le même index');
});

test('challengeIndexForDate : jours différents donnent généralement des index différents (pas de constante figée)', () => {
  const idxs = new Set();
  for (let d = 1; d <= 9; d++) idxs.add(challengeIndexForDate(new Date(2026, 7, d), 9));
  assert.ok(idxs.size > 1, 'au moins deux jours différents doivent produire des index différents sur 9 jours consécutifs');
});

test('challengeIndexForDate : toujours dans les bornes [0, length)', () => {
  for (let d = 1; d <= 31; d++) {
    const idx = challengeIndexForDate(new Date(2026, 0, d), 5);
    assert.ok(idx >= 0 && idx < 5, `index ${idx} hors bornes pour le jour ${d}`);
  }
});

test('challengeIndexForDate : length=1 renvoie toujours 0', () => {
  assert.strictEqual(challengeIndexForDate(new Date(2026, 5, 15), 1), 0);
});
