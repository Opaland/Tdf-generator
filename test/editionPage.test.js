'use strict';
// Page « Parcours par édition » (story 41.6, issue #631) : formatage sans
// navigateur — km non imprimé, altitude douteuse, écart toujours rendu,
// lignes coupées aux points non placés, profil échappé.
const { test } = require('node:test');
const assert = require('node:assert');
global.EF = require('../frontend/common.js');
const E = require('../frontend/edition.js');

test('km « ≈ » quand il n’est pas imprimé, altitude « ? » quand douteuse', () => {
  assert.strictEqual(E.kmText({ km: 41.5, km_printed: true }), '41,5');
  assert.strictEqual(E.kmText({ km: 41.5, km_printed: false }), '≈ 41,5');
  assert.strictEqual(E.altText({ altitude_m: 1449, altitude_doubtful: true }), '1449 m ?');
  assert.strictEqual(E.altText({ altitude_m: 220, altitude_doubtful: false }), '220 m');
  assert.strictEqual(E.altText({ altitude_m: null }), '—');
  assert.strictEqual(E.kindText({ kind: 'col', category: '1' }), 'col (1re cat.)');
  assert.strictEqual(E.kindText({ kind: 'côte', category: 'HC' }), 'côte (HC)');
  assert.strictEqual(E.placedText({ placed: false, at_village: true }), 'au village éponyme');
});

test('écart affiché dans et hors tolérance, « non contrôlée » sans contrôle', () => {
  const hors = { routed_km: 44.1, profile_km: 41.5, delta_pct: 6.3, tolerance_pct: 5, coverage_pct: 92, within: false };
  assert.strictEqual(E.checkText(hors), '44,1 km routés pour 41,5 km au profil sur 92 % de l\'étape : +6,3 % (hors la tolérance de ±5 %)');
  assert.strictEqual(E.deltaText(hors), '+6,3 % (hors tolérance)');
  assert.strictEqual(E.deltaText({ ...hors, delta_pct: -0.7, within: true }), '-0,7 %');
  assert.strictEqual(E.checkText(null), 'non contrôlée');
  assert.strictEqual(E.deltaText(null), 'non contrôlée');
});

test('lignes droites seulement entre voisins placés', () => {
  const P = (placed, lat) => (placed ? { placed, lat, lon: 0 } : { placed });
  assert.deepStrictEqual(E.runs([P(true, 1), P(true, 2), P(false), P(true, 3), P(true, 4), P(true, 5), P(false), P(true, 6)]),
    [[[1, 0], [2, 0]], [[3, 0], [4, 0], [5, 0]]]);
});

test('profil : noms échappés, moins de deux altitudes → message', () => {
  const svg = E.profileSvg([
    { label: '<b>A</b>', km: 0, km_printed: true, altitude_m: 100 },
    { label: 'B', km: 10, km_printed: false, altitude_m: 400, altitude_doubtful: true },
  ]);
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes('&lt;b&gt;A&lt;/b&gt;'));
  assert.ok(!svg.includes('<b>A'));
  assert.match(svg, /≈ 10, 400 m \?/);
  assert.match(E.profileSvg([{ label: 'A', km: 0, altitude_m: 100 }]), /pas de profil/);
});

