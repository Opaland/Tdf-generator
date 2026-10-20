'use strict';
// Backlog 34.4 : nombre d'Eddington (distance et D+) dans le bilan.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? ''), dec: (v) => (v == null ? v : String(v).replace('.', ',')) };
global.document = { addEventListener: () => {} };
const { eddington, eddingtonTiles } = require('../frontend/traces.js');

test('eddington : plus grand E tel que E jours atteignent E', () => {
  assert.deepStrictEqual(eddington([]), { e: 0, next: 1 });
  assert.deepStrictEqual(eddington([0.5]), { e: 0, next: 1 });
  assert.deepStrictEqual(eddington([1]), { e: 1, next: 2 });
  // 5 jours à ≥ 3 km mais seulement 3 jours à ≥ 4 : E = 3 ; 1 jour de plus à ≥ 4 km pour E = 4.
  assert.deepStrictEqual(eddington([3, 3, 4, 10, 50, 2]), { e: 3, next: 1 });
  assert.deepStrictEqual(eddington([100, 100, 100]), { e: 3, next: 1 });
  // Valeurs exactement au palier : 4 jours à 4 → E = 4.
  assert.strictEqual(eddington([4, 4, 4, 4]).e, 4);
  // null, NaN, négatifs ignorés (jamais comptés comme 0 ni comme un jour).
  assert.deepStrictEqual(eddington([null, NaN, -5, 2, 2]), { e: 2, next: 3 });
});

test('tuiles : D+ par tranches de 100 m, libellés explicites', () => {
  const daily = [
    { distanceKm: 40, ascentM: 850 }, { distanceKm: 60, ascentM: 1200 }, { distanceKm: 25, ascentM: 300 },
  ];
  const [dist, asc] = eddingtonTiles(daily);
  assert.strictEqual(dist.v, 3);
  assert.match(dist.l, /\(3 jours ≥ 3 km\) — prochain palier : 1 jour ≥ 4 km/);
  assert.strictEqual(asc.v, 3);
  assert.match(asc.l, /par 100 m \(3 jours ≥ 300 m\) — prochain palier : 2 jours ≥ 400 m/);
});

test('tuiles à E = 0 : seulement le premier palier, pas « 0 jour ≥ 0 km »', () => {
  const [dist, asc] = eddingtonTiles([{ distanceKm: 0.4, ascentM: 20 }]);
  assert.strictEqual(dist.l, 'Eddington distance — prochain palier : 1 jour ≥ 1 km');
  assert.strictEqual(asc.l, 'Eddington D+, par 100 m — prochain palier : 1 jour ≥ 100 m');
});
