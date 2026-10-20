'use strict';
// Epic 35.18 (revue globale du 19/10/2026) : profil et comparateur
// illisibles en mobile (viewBox fixe de 1080 réduit à ~330 px : texte de
// ~3 px), légende du comparateur hors cadre, CSV mal lu par Excel FR.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? '') };
global.EFProfile = require('../frontend/profile.js');

test('largeur du viewBox : suit l\'écran en mobile, plafonnée en bureau', () => {
  const { responsiveWidth } = global.EFProfile;
  assert.strictEqual(responsiveWidth(330, 1080), 420, 'téléphone : plancher 420 → texte à ~80 %');
  assert.strictEqual(responsiveWidth(600, 1080), 720);
  assert.strictEqual(responsiveWidth(1400, 1080), 1080);
  assert.strictEqual(responsiveWidth(0, 1080), 1080, 'conteneur invisible : largeur nominale');
  assert.strictEqual(responsiveWidth(undefined, 1080), 1080);
});

test('comparateur étroit : légendes l\'une sous l\'autre, dans le cadre', () => {
  const { overlaySVG } = require('../frontend/compare.js');
  const full = (name) => ({ stage: { name }, climbs: [], samples: [0, 1, 2, 3, 4].map((i) => ({ dist_m: i * 1000, ele_smooth_m: 300 + i * 50, lat: 45, lon: 1 })) });
  const narrow = overlaySVG(full('Étape A'), full('Étape B'), 'km', true, 420);
  assert.match(narrow, /viewBox="0 0 420 320"/);
  const rects = [...narrow.matchAll(/<rect x="([\d.]+)" y="(\d+)" width="12"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepStrictEqual(rects, [[48, 8], [48, 26]]);
  assert.match(narrow, /altitudes de départ alignées \(dénivelé depuis le départ\)/);
  const wide = overlaySVG(full('Étape A'), full('Étape B'), 'km', false);
  assert.match(wide, /viewBox="0 0 1080 320"/);
  assert.match(wide, /<rect x="378" y="8" width="12"/);
});

test('CSV km par km : « ; » et virgule décimale, cellule vide pour une valeur absente', () => {
  global.EF.qs = () => null;
  const { csvRow } = require('../frontend/stage.js');
  assert.strictEqual(csvRow([3, 512.4, 6.25, null, 41, 1203]), '3;512,4;6,25;;41;1203');
});

test('profil étroit : une étiquette horizontale qui recouvrirait une voisine repasse en oblique raccourcie', () => {
  const { fitLabel, renderProfileSVG } = global.EFProfile;
  assert.strictEqual(fitLabel('Col du Galibier (2641 m)', 330, 51, 420, { noFlat: true }).align, 'tilt');
  // Coin haut droit réservé à l'encart distance / D+ : l'oblique y est plus courte.
  const nf = { noFlat: true };
  assert.ok(Array.from(fitLabel('Col du Télégraphe (1566 m)', 300, 51, 1000, nf).text).length
    > Array.from(fitLabel('Col du Télégraphe (1566 m)', 900, 51, 1000, nf).text).length);
  // Deux sommets voisins en haut du cadre étroit : pas d'étiquette horizontale
  // qui passe au-dessus de l'ancre de l'autre.
  const profile = [];
  for (let k = 0; k <= 120; k++) {
    const e = 900 + 1100 * Math.exp(-(((k - 50) / 6) ** 2)) + 1700 * Math.exp(-(((k - 90) / 6) ** 2));
    profile.push({ d: k * 1000, e, r: e, lat: 45, lon: 6 + k * 0.01 });
  }
  const climbs = [
    { name: 'Col de la Croix de Fer', category: 'HC', end_km: 50, summit_ele_m: 2000 },
    { name: 'Col du Galibier', category: 'HC', end_km: 90, summit_ele_m: 2600 },
  ];
  const svg = renderProfileSVG({ stage: {}, climbs, waypoints: [], profile }, { width: 420, height: 300 });
  const flat = [...svg.matchAll(/<text x="[\d.]+" y="[\d.]+"( text-anchor="end")? font-size="10.5"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)<\/text>/g)].map((m) => m[2]);
  assert.ok(!flat.some((t) => t.startsWith('Col du Galibier')), `Galibier posé à l'horizontale : ${flat}`);
});
