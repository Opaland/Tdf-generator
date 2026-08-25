'use strict';
// pipeline/geo.js n'avait aucun test dédié — seulement une couverture
// incidente via les pipelines qui l'appellent (routing.js, simulator.js,
// elevation.js, importTrack.js), qui n'exercent chacun qu'une partie des
// fonctions et ne testent jamais geo.js pour ses propres garanties
// géométriques (trouvaille de sprint dédié).
//
// `distanceToPolyline` était exportée mais sans aucun appelant nulle part
// dans le dépôt (`grep -rn distanceToPolyline` ne trouve que sa propre
// définition), sans mention en doc, présente depuis le commit initial du
// projet — code mort depuis le premier jour, pas une fonctionnalité
// oubliée en cours d'usage. Retirée plutôt que testée : un test sur du
// code jamais appelé ne protège rien de réel, et la garder « au cas où »
// va à l'encontre de la discipline du dépôt contre le code spéculatif.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  haversine,
  lerpPoint,
  cumulativeDistances,
  resamplePolyline,
  movingAverageByDistance,
} = require('../pipeline/geo');

test('haversine : 1° de longitude à l\'équateur ≈ 111,2 km', () => {
  const d = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(d - 111195) < 100, `attendu ~111195 m, obtenu ${d}`);
});

test('haversine : 1° de latitude (méridien) ≈ 111,2 km, symétrique à la longitude', () => {
  const d = haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111195) < 100, `attendu ~111195 m, obtenu ${d}`);
});

test('haversine : distance nulle entre un point et lui-même', () => {
  assert.strictEqual(haversine({ lat: 45.5, lon: 6.1 }, { lat: 45.5, lon: 6.1 }), 0);
});

test('lerpPoint : t=0 renvoie a, t=1 renvoie b, t=0.5 le milieu', () => {
  const a = { lat: 0, lon: 0 };
  const b = { lat: 10, lon: 20 };
  assert.deepStrictEqual(lerpPoint(a, b, 0), a);
  assert.deepStrictEqual(lerpPoint(a, b, 1), b);
  assert.deepStrictEqual(lerpPoint(a, b, 0.5), { lat: 5, lon: 10 });
});

test('cumulativeDistances : cum[0]=0, cum[dernier]=total, croissant', () => {
  const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }];
  const { total, cum } = cumulativeDistances(points);
  assert.strictEqual(cum[0], 0);
  assert.strictEqual(cum[cum.length - 1], total);
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] > cum[i - 1]);
  assert.ok(Math.abs(total - haversine(points[0], points[1]) - haversine(points[1], points[2])) < 1e-6);
});

test('cumulativeDistances : polyligne à un seul point → total 0', () => {
  const { total, cum } = cumulativeDistances([{ lat: 1, lon: 1 }]);
  assert.strictEqual(total, 0);
  assert.deepStrictEqual(cum, [0]);
});

test('resamplePolyline : conserve le premier et le dernier point d\'origine', () => {
  const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.5 }, { lat: 0, lon: 1 }];
  const out = resamplePolyline(points, 20000);
  assert.ok(Math.abs(out[0].lat - points[0].lat) < 1e-9 && Math.abs(out[0].lon - points[0].lon) < 1e-9);
  const last = out[out.length - 1];
  assert.ok(Math.abs(last.lat - points[2].lat) < 1e-9 && Math.abs(last.lon - points[2].lon) < 1e-9);
});

test('resamplePolyline : distances cumulées croissantes et bornées par le total', () => {
  const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }];
  const { total } = cumulativeDistances(points);
  const out = resamplePolyline(points, 20000);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].dist >= out[i - 1].dist);
  assert.ok(Math.abs(out[out.length - 1].dist - total) < 1e-6);
});

test('resamplePolyline : moins de 2 points renvoie les points tels quels avec dist=0', () => {
  const out = resamplePolyline([{ lat: 1, lon: 1 }], 100);
  assert.deepStrictEqual(out, [{ lat: 1, lon: 1, dist: 0 }]);
});

test('movingAverageByDistance : profil d\'altitude constant reste constant', () => {
  const samples = [0, 100, 200, 300, 400].map((dist) => ({ dist, ele: 500 }));
  const smooth = movingAverageByDistance(samples, 200);
  for (const v of smooth) assert.strictEqual(v, 500);
});

test('movingAverageByDistance : un pic isolé est atténué (lissé en dessous de son sommet)', () => {
  const samples = [0, 100, 200, 300, 400].map((dist) => ({ dist, ele: dist === 200 ? 1000 : 100 }));
  const smooth = movingAverageByDistance(samples, 300);
  assert.ok(smooth[2] < 1000, `pic non lissé : ${smooth[2]}`);
  assert.ok(smooth[2] > 100, `pic totalement effacé : ${smooth[2]}`);
});
