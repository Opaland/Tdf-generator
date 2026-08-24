'use strict';
// Comparateur d'étapes — option "aligner les altitudes de départ" (backlog
// issue #14, inspirée de la fonction "Align start" de VeloViewer).
// frontend/compare.js est require()-able côté test (overlaySVG est une
// fonction pure) grâce à la garde `typeof document` qui saute l'attache
// DOMContentLoaded en environnement Node.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? '') };
global.EFProfile = require('../frontend/profile.js');

const { overlaySVG } = require('../frontend/compare.js');

function fullOf(samples) {
  return {
    stage: { name: 'Étape test' },
    climbs: [],
    samples: samples.map((s, i) => ({ dist_m: i * 1000, ele_smooth_m: s, lat: 45, lon: 1 })),
  };
}

test('overlaySVG sans align-start : grille en altitude brute (eMin = plancher du minimum réel, ici 200 m)', () => {
  const fa = fullOf([200, 400, 300]);
  const fb = fullOf([800, 900, 850]);
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.match(svg, />200</, 'eMin attendu = floor(200/100)*100 = 200 (altitude brute, B ne descend jamais sous 800)');
  assert.doesNotMatch(svg, /dénivelé depuis le départ/, 'pas de mention d\'alignement quand la case n\'est pas cochée');
});

test('overlaySVG avec align-start : les deux courbes démarrent à la même altitude relative (0), et le libellé prévient que l\'axe n\'est plus l\'altitude réelle', () => {
  const fa = fullOf([200, 400, 300]); // +200 m relatif au départ
  const fb = fullOf([800, 1000, 900]); // +200 m relatif aussi, mais parti de 800 m plus haut en absolu
  const svg = overlaySVG(fa, fb, 'km', true);
  assert.match(svg, /dénivelé depuis le départ/, 'le libellé d\'avertissement doit apparaître en mode aligné');
  // Une fois alignées, les deux étapes ont le même dénivelé max (+200 m) —
  // la grille doit l'afficher, pas un mélange d'échelles à 200 et 900.
  assert.match(svg, />\+200</);
  assert.doesNotMatch(svg, />800</, 'l\'altitude brute de B (800 m) ne doit plus apparaître, seul le relatif compte');
});

test('overlaySVG avec align-start : une étape qui redescend sous son altitude de départ produit un dénivelé négatif, sans NaN/Infinity', () => {
  const fa = fullOf([500, 300, 400]); // descend à -200 m relatif
  const fb = fullOf([500, 600, 550]);
  const svg = overlaySVG(fa, fb, 'km', true);
  assert.match(svg, />-200</, 'le dénivelé négatif doit être visible sur la grille (eMin = floor(-200/100)*100)');
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
