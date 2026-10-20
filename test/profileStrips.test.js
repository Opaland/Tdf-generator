'use strict';
// Backlog 34.6 : profil coloré par revêtement et par zone de FC (bandes au
// pied du profil).

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { qs: () => null, esc: (s) => String(s ?? '').replace(/</g, '&lt;'), dec: (v) => (v == null ? v : String(v).replace('.', ',')) };
global.EFProfile = require('../frontend/profile.js');
const { surfaceSegments, hrSegments } = require('../frontend/stage.js');

test('surfaceSegments : seulement les tronçons non revêtus et pavés, avec infobulle', () => {
  const segs = surfaceSegments({ stretches: [
    { fromM: 0, toM: 1000, cls: 'revetu', surfaces: [] },
    { fromM: 1000, toM: 2500, cls: 'non_revetu', surfaces: ['gravel'] },
    { fromM: 4000, toM: 4300, cls: 'paves', surfaces: ['sett'] },
  ] });
  assert.deepStrictEqual(segs.map((s) => [s.fromM, s.toM]), [[1000, 2500], [4000, 4300]]);
  assert.strictEqual(segs[0].title, 'km 1,0 → 2,5 : non revêtu (gravel)');
  assert.deepStrictEqual(surfaceSegments(null), []);
});

test('hrSegments : suites d\'échantillons dans la même zone, rien sans FC max ni sous Z1', () => {
  const s = (d, hr) => ({ dist_m: d, hr_bpm: hr });
  // FC max 200 : Z2 = 120–139, Z4 = 160–179.
  const samples = [s(0, 125), s(100, 130), s(200, 165), s(300, null), s(400, 80), s(500, 170), s(600, 171)];
  assert.deepStrictEqual(hrSegments(samples, null), []);
  const segs = hrSegments(samples, 200);
  assert.deepStrictEqual(segs.map((g) => [g.fromM, g.toM]), [[0, 200], [200, 300], [500, 600]]);
  assert.match(segs[0].title, /Z2 endurance/);
  assert.match(segs[1].title, /Z4 seuil/);
});

test('renderProfileSVG : une bande par option, libellé échappé, segment hors tracé ignoré', () => {
  const profile = [];
  for (let k = 0; k <= 10; k++) profile.push({ d: k * 1000, e: 400 + k * 10, r: 400 + k * 10, lat: 45, lon: 6 });
  const svg = global.EFProfile.renderProfileSVG({ stage: {}, climbs: [], waypoints: [], profile }, {
    width: 1000, height: 300,
    strips: [
      { label: 'Rev.', segments: [{ fromM: 1000, toM: 2500, color: '#8c510a', title: 'non revêtu <b>' }, { fromM: 50000, toM: 60000, color: '#000' }] },
      { label: 'FC', segments: [] },
    ],
  });
  assert.strictEqual((svg.match(/fill="#8c510a"/g) || []).length, 1);
  assert.doesNotMatch(svg, /fill="#000"/);
  assert.match(svg, /<title>non revêtu &lt;b&gt;<\/title>/);
  assert.match(svg, />Rev\.<\/text>/);
  assert.doesNotMatch(svg, />FC<\/text>/, 'bande vide non dessinée');
});
