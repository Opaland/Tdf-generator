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

test('fietsIndex : H pris sur le profil lissé, pas sur le maximum brut du sommet', () => {
  // Sommet brut 732 m (pointe de bruit), profil lissé de 500 à 710 m sur 3 km.
  const c = { start_ele_m: 500, summit_ele_m: 732, length_km: 3, km_blocks: [
    { fromKm: 0, toKm: 1, ele0: 500, ele1: 570 }, { fromKm: 1, toKm: 2, ele0: 570, ele1: 640 }, { fromKm: 2, toKm: 3, ele0: 640, ele1: 710 },
  ] };
  // 210² / 30 000 = 1,47 → 1,5 ; avec le sommet brut ce serait 232² / 30 000 = 1,8.
  assert.strictEqual(fietsIndex(c), 1.5);
  // Sans blocs : repli sur sommet − pied.
  assert.strictEqual(fietsIndex({ ...c, km_blocks: undefined }), 1.8);
});
