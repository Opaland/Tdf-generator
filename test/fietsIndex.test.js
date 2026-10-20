'use strict';
// Backlog 34.5 : indice FIETS à côté de la catégorie approchée.
// Formule : H² / (D × 10) + bonus d'altitude ; le bonus varie selon les
// sources, celui retenu ici est (T − 1000) / 1000 au-dessus de 1000 m.

const { test } = require('node:test');
const assert = require('node:assert');
const { fietsIndex } = require('../frontend/profile.js');

test('fietsIndex : terme de pente seul sous 1000 m de sommet', () => {
  // H = 500 m sur 5 km, sommet 800 m : 500² / 50 000 = 5, pas de bonus.
  assert.strictEqual(fietsIndex({ start_ele_m: 300, summit_ele_m: 800, length_km: 5 }), 5);
});

test('fietsIndex : bonus d\'altitude au-dessus de 1000 m', () => {
  // H = 1000 m sur 10 km : 10 ; sommet 2000 m : + (2000 − 1000) / 1000 = 1.
  assert.strictEqual(fietsIndex({ start_ele_m: 1000, summit_ele_m: 2000, length_km: 10 }), 11);
  // Sommet à 1000 m pile : bonus nul, pas négatif.
  assert.strictEqual(fietsIndex({ start_ele_m: 500, summit_ele_m: 1000, length_km: 5 }), 5);
});

test('fietsIndex : donnée manquante ou côte qui ne monte pas → null, jamais un 0 supposé', () => {
  assert.strictEqual(fietsIndex({ start_ele_m: null, summit_ele_m: 800, length_km: 5 }), null);
  assert.strictEqual(fietsIndex({ start_ele_m: 300, summit_ele_m: 800, length_km: 0 }), null);
  assert.strictEqual(fietsIndex({ start_ele_m: 800, summit_ele_m: 800, length_km: 3 }), null);
  assert.strictEqual(fietsIndex(null), null);
});
