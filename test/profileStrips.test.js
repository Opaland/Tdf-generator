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

test('hrSegments : zone dominante par tranche, rien sans FC max, sans temps, ni à travers un trou', () => {
  const s = (d, t, hr) => ({ dist_m: d, elapsed_s: t, hr_bpm: hr });
  // FC max 200 : Z2 = 120–139, Z4 = 160–179. 3 km, tranches de 100 m.
  const samples = [];
  for (let k = 0; k <= 30; k++) samples.push(s(k * 100, k * 20, k < 10 ? 125 : 165));
  assert.deepStrictEqual(hrSegments(samples, null), []);
  const segs = hrSegments(samples, 200);
  assert.deepStrictEqual(segs.map((g) => [g.fromM, g.toM]), [[0, 1000], [1000, 3000]]);
  assert.match(segs[0].title, /surtout Z2 endurance/);
  assert.match(segs[1].title, /surtout Z4 seuil/);
  // Sans temps écoulé : aucune zone attribuée (même règle que hrZoneTimes).
  assert.deepStrictEqual(hrSegments(samples.map((x) => ({ ...x, elapsed_s: null })), 200), []);
  // Un arrêt de plus de 10 min entre deux échantillons ne colore pas la portion.
  const gap = samples.map((x) => ({ ...x, elapsed_s: x.dist_m >= 1500 ? x.elapsed_s + 3600 : x.elapsed_s }));
  const g2 = hrSegments(gap, 200);
  assert.deepStrictEqual(g2.map((g) => [g.fromM, g.toM]), [[0, 1000], [1000, 1400], [1500, 3000]]);
});

test('hrSegments : une FC qui oscille autour d\'une borne reste bornée à 300 portions', () => {
  const samples = [];
  for (let k = 0; k <= 100000; k++) samples.push({ dist_m: k * 2, elapsed_s: k, hr_bpm: k % 2 ? 139 : 141 });
  const segs = hrSegments(samples, 200);
  assert.ok(segs.length <= 300, `${segs.length} portions`);
  assert.ok(segs.length >= 1);
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

test('renderProfileSVG : les bandes agrandissent la marge basse, la courbe garde sa hauteur', () => {
  const profile = [];
  for (let k = 0; k <= 10; k++) profile.push({ d: k * 1000, e: 400 + k * 10, r: 400 + k * 10, lat: 45, lon: 6 });
  const data = { stage: {}, climbs: [], waypoints: [], profile };
  const strips = [{ label: 'Rev.', segments: [{ fromM: 1000, toM: 2500, color: '#8c510a' }] }];
  const step = global.EFProfile.STRIP_STEP;
  const lowest = (svg) => Math.max(...[...svg.matchAll(/<path d="M ([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2])));
  const without = global.EFProfile.renderProfileSVG(data, { width: 1000, height: 300 });
  const withStrip = global.EFProfile.renderProfileSVG(data, { width: 1000, height: 300 + step, strips });
  assert.strictEqual(lowest(withStrip).toFixed(1), lowest(without).toFixed(1), 'courbe au même endroit');
  const y = Number(/<rect x="[\d.]+" y="([\d.]+)"[^>]*fill="#8c510a"/.exec(withStrip)[1]);
  assert.ok(y > lowest(without), `bande (y=${y}) sous le départ de la courbe`);
  assert.ok(y + 7 <= 300 + step, 'bande dans le cadre');
  // Survol : même projection avec et sans bandes, à hauteur agrandie.
  const a = global.EFProfile.profileHoverAt(data, { width: 1000, height: 300 }, 500);
  const b = global.EFProfile.profileHoverAt(data, { width: 1000, height: 300 + step, strips }, 500);
  assert.strictEqual(a.yCurve.toFixed(1), b.yCurve.toFixed(1));
  assert.strictEqual(a.yBottom.toFixed(1), b.yBottom.toFixed(1));
});
