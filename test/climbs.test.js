'use strict';
// Test du détecteur de côtes sur des profils synthétiques connus.

const { test } = require('node:test');
const assert = require('node:assert');
const { detectClimbs, categorize } = require('../pipeline/climbs');

/** Construit un profil échantillonné tous les 100 m depuis des segments [lengthM, gradientPct]. */
function buildProfile(segments, startEle = 200) {
  const samples = [{ dist: 0, eleRaw: startEle, eleSmooth: startEle }];
  let dist = 0;
  let ele = startEle;
  for (const [lengthM, gradient] of segments) {
    const n = Math.round(lengthM / 100);
    for (let i = 0; i < n; i++) {
      dist += 100;
      ele += (gradient / 100) * 100;
      samples.push({ dist, eleRaw: ele, eleSmooth: ele });
    }
  }
  return samples;
}

test('détecte une montée simple de 8 km à 6 % (cat. 1)', () => {
  const profile = buildProfile([
    [10000, 0],   // 10 km de plat
    [8000, 6],    // montée : 8 km à 6 % → score 48 → cat. 1
    [6000, -4],   // descente
  ]);
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1);
  const c = climbs[0];
  assert.ok(Math.abs(c.lengthKm - 8) < 0.3, `longueur ${c.lengthKm} ≈ 8 km`);
  assert.ok(Math.abs(c.avgGradient - 6) < 0.4, `pente ${c.avgGradient} ≈ 6 %`);
  assert.strictEqual(c.category, '1');
  assert.ok(Math.abs(c.startM - 10000) < 600, `départ ${c.startM} ≈ km 10`);
  assert.ok(Math.abs(c.summitEle - 680) < 15, `sommet ${c.summitEle} ≈ 680 m`);
  assert.strictEqual(c.kmBlocks.length, 8);
  for (const b of c.kmBlocks) assert.ok(Math.abs(b.gradient - 6) < 0.5);
});

test('fusionne deux montées séparées par un replat < 500 m', () => {
  const profile = buildProfile([
    [5000, 0],
    [4000, 6],   // 240 m de D+
    [300, 0],    // replat court → fusion
    [3000, 6],   // 180 m de D+
    [5000, -3],
  ]);
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1, 'une seule côte après fusion');
  assert.ok(climbs[0].lengthKm > 7, `longueur fusionnée ${climbs[0].lengthKm} > 7 km`);
});

test('ne fusionne pas au-delà de 500 m de replat', () => {
  const profile = buildProfile([
    [5000, 0],
    [3000, 6],
    [2000, 0],   // long replat → deux côtes distinctes
    [3000, 6],
    [5000, -3],
  ]);
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 2);
});

test('ignore les montées trop courtes ou trop douces', () => {
  const profile = buildProfile([
    [5000, 0],
    [1000, 8],   // 1 km à 8 % : trop court (< 1,5 km)
    [5000, 0],
    [3000, 2],   // 3 km à 2 % : trop doux (< 3 %)
    [5000, 0],
  ]);
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 0);
});

test('catégorisation ASO approchée (score = km × %)', () => {
  assert.strictEqual(categorize(85), 'HC');   // > 80
  assert.strictEqual(categorize(40), '1');    // > 32
  assert.strictEqual(categorize(20), '2');    // > 16
  assert.strictEqual(categorize(8), '3');     // > 6
  assert.strictEqual(categorize(5), '4');
});

test('profil type Hautacam : ~13 km à ~8 % → HC', () => {
  const profile = buildProfile([
    [8000, 0.5],
    [13000, 7.8],  // score ≈ 101 → HC
  ], 450);
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1);
  assert.strictEqual(climbs[0].category, 'HC');
  assert.ok(climbs[0].maxGradient >= climbs[0].avgGradient - 0.2);
});

test('profil vide ou à un/deux échantillons : aucune côte, pas d\'exception', () => {
  assert.deepStrictEqual(detectClimbs([]), []);
  assert.deepStrictEqual(detectClimbs([{ dist: 0, eleSmooth: 200 }]), []);
  assert.deepStrictEqual(
    detectClimbs([{ dist: 0, eleSmooth: 200 }, { dist: 100, eleSmooth: 210 }]),
    []
  );
});

test('altitude null au milieu d\'une montée : comblée par le voisin, pas de NaN dans la sortie', () => {
  const profile = buildProfile([[5000, 0], [8000, 6], [6000, -4]]);
  const idx = profile.findIndex((s) => s.dist === 9000);
  profile[idx].eleSmooth = null;
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1, 'toujours une seule côte détectée');
  const c = climbs[0];
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} doit rester un nombre fini, reçu ${v}`);
  }
  for (const b of c.kmBlocks) {
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `kmBlocks.${k} doit rester fini, reçu ${v}`);
    }
  }
});

test('altitude NaN au milieu d\'une montée : comblée par le voisin, pas de NaN dans la sortie', () => {
  const profile = buildProfile([[5000, 0], [8000, 6], [6000, -4]]);
  const idx = profile.findIndex((s) => s.dist === 9000);
  profile[idx].eleSmooth = NaN;
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1);
  assert.ok(Number.isFinite(climbs[0].maxGradient));
  assert.ok(Number.isFinite(climbs[0].avgGradient));
});

test('pic de bruit GPS isolé (+500 m sur un échantillon) : toujours détecté, pente max reflète le pic', () => {
  const profile = buildProfile([[5000, 0], [8000, 6], [6000, -4]]);
  const idx = profile.findIndex((s) => s.dist === 9000);
  profile[idx].eleSmooth += 500;
  profile[idx].eleRaw += 500;
  const climbs = detectClimbs(profile);
  assert.strictEqual(climbs.length, 1, 'le pic ne casse pas la détection');
  assert.ok(
    climbs[0].maxGradient > climbs[0].avgGradient * 5,
    'le pic non lissé se reflète dans maxGradient (pas de filtrage — ce n\'est pas le rôle de detectClimbs)'
  );
});
