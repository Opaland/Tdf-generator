'use strict';
// Courbe de FC de la fiche étape (frontend/stage.js, Epic 30).

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { qs: () => null, esc: (s) => String(s ?? '') };
const { buildHrChart } = require('../frontend/stage.js');

const s = (dist_m, hr_bpm) => ({ dist_m, hr_bpm });

test('buildHrChart : moins de deux valeurs → aucune courbe', () => {
  assert.strictEqual(buildHrChart([], 600, 140), '');
  assert.strictEqual(buildHrChart([s(0, null), s(100, 140), s(200, null)], 600, 140), '');
});

test('buildHrChart : un trou coupe la ligne (nouveau M), jamais relié', () => {
  const svg = buildHrChart([s(0, 120), s(100, 130), s(200, null), s(300, 150), s(400, 155)], 600, 140);
  const d = /<path d="([^"]+)"/.exec(svg)[1];
  assert.strictEqual((d.match(/M/g) || []).length, 2);
  assert.strictEqual((d.match(/L/g) || []).length, 2);
  assert.ok(!/NaN/.test(svg));
});

test('buildHrChart : axe arrondi à la dizaine autour des valeurs, distance en km', () => {
  const svg = buildHrChart([s(0, 121), s(5000, 168)], 600, 140);
  assert.match(svg, />110</);
  assert.match(svg, />180</);
  assert.match(svg, />5 km</);
});
