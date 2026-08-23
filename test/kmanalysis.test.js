'use strict';
// Test de pipeline/kmanalysis.js — détection des faux-plats (backlog issue
// #10, section C) : portions longues et régulières à 1-3 %, sous le seuil de
// détection des côtes (MIN_AVG_GRADIENT, importé de climbs.js) mais au-dessus
// du plat, aujourd'hui ni signalées comme côte ni distinguées du plat.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectFauxPlats, FAUXPLAT_MIN_GRADIENT, FAUXPLAT_MIN_LENGTH_KM,
  bearingDeg, compassLabel, segmentBearing,
} = require('../pipeline/kmanalysis');
const { MIN_AVG_GRADIENT } = require('../pipeline/climbs');

/** Construit des lignes km_analysis synthétiques à partir d'une liste de pentes moyennes. */
function kmRows(gradients) {
  return gradients.map((avgGradient, i) => ({ km: i + 1, avgGradient }));
}

test('une portion longue et régulière à 2 % est détectée comme faux-plat', () => {
  const rows = kmRows([0, 0, 2, 2, 2, 2, 2, 0, 0]);
  const fp = detectFauxPlats(rows);
  assert.strictEqual(fp.length, 1);
  assert.strictEqual(fp[0].fromKm, 2);
  assert.strictEqual(fp[0].toKm, 7);
  assert.strictEqual(fp[0].lengthKm, 5);
  assert.strictEqual(fp[0].avgGradient, 2);
});

test('une portion trop courte (< FAUXPLAT_MIN_LENGTH_KM) n\'est pas retenue', () => {
  const rows = kmRows([0, 2, 2, 0]);
  assert.strictEqual(FAUXPLAT_MIN_LENGTH_KM, 3, 'ce test suppose le seuil par défaut');
  assert.deepStrictEqual(detectFauxPlats(rows), []);
});

test('une portion trop plate (< FAUXPLAT_MIN_GRADIENT) n\'est pas un faux-plat', () => {
  const rows = kmRows([0.3, 0.4, 0.2, 0.5, 0.3]);
  assert.strictEqual(FAUXPLAT_MIN_GRADIENT, 1, 'ce test suppose le seuil par défaut');
  assert.deepStrictEqual(detectFauxPlats(rows), []);
});

test('une portion assez raide pour être une côte (>= MIN_AVG_GRADIENT) n\'est pas un faux-plat', () => {
  const rows = kmRows([2, 2, MIN_AVG_GRADIENT, MIN_AVG_GRADIENT, MIN_AVG_GRADIENT]);
  const fp = detectFauxPlats(rows);
  // seuls les 2 premiers km (< MIN_AVG_GRADIENT) sont éligibles, trop courts pour être retenus seuls
  assert.deepStrictEqual(fp, []);
});

test('deux faux-plats séparés par un vrai replat restent deux segments distincts', () => {
  const rows = kmRows([2, 2, 2, 2, 0, 0, 0, 1.5, 1.5, 1.5, 1.5]);
  const fp = detectFauxPlats(rows);
  assert.strictEqual(fp.length, 2);
  assert.strictEqual(fp[0].fromKm, 0);
  assert.strictEqual(fp[0].toKm, 4);
  assert.strictEqual(fp[1].fromKm, 7);
  assert.strictEqual(fp[1].toKm, 11);
});

test('accepte aussi bien avgGradient (camelCase) que avg_gradient (lignes rechargées depuis la base)', () => {
  const rows = [1, 2, 3].map((km) => ({ km, avg_gradient: 2 }));
  const fp = detectFauxPlats(rows);
  assert.strictEqual(fp.length, 1);
  assert.strictEqual(fp[0].lengthKm, 3);
});

test('aucun kilomètre : aucun faux-plat, pas d\'exception', () => {
  assert.deepStrictEqual(detectFauxPlats([]), []);
});

// Orientation des tronçons (backlog issue #10, section C, "exposition au
// vent") : cap grand-cercle en degrés + rose des vents à 8 directions. Tests
// sur l'équateur/le méridien, où le cap exact des 4 points cardinaux ne
// dépend pas de la magnitude du déplacement (seulement de son signe).

test('bearingDeg : les 4 points cardinaux exacts sur l\'équateur/le méridien', () => {
  assert.strictEqual(bearingDeg(0, 0, 0, 1), 90, 'plein est');
  assert.strictEqual(bearingDeg(0, 0, 1, 0), 0, 'plein nord');
  assert.strictEqual(bearingDeg(0, 0, 0, -1), 270, 'plein ouest');
  assert.strictEqual(bearingDeg(0, 0, -1, 0), 180, 'plein sud');
});

test('compassLabel : arrondit au point cardinal/intercardinal le plus proche', () => {
  assert.strictEqual(compassLabel(0), 'N');
  assert.strictEqual(compassLabel(44), 'NE');
  assert.strictEqual(compassLabel(90), 'E');
  assert.strictEqual(compassLabel(180), 'S');
  assert.strictEqual(compassLabel(225), 'SO');
  assert.strictEqual(compassLabel(270), 'O');
  assert.strictEqual(compassLabel(359), 'N');
});

test('segmentBearing : interpole lat/lon aux bornes du tronçon puis calcule le cap', () => {
  const samples = [
    { dist_m: 0, lat: 0, lon: 0 },
    { dist_m: 5000, lat: 0, lon: 0.5 },
    { dist_m: 10000, lat: 0, lon: 1 },
  ];
  assert.strictEqual(segmentBearing(samples, 0, 10), 90, 'déplacement plein est le long de l\'équateur');
  assert.strictEqual(segmentBearing([], 0, 1), null, 'pas assez de points → null, pas d\'exception');
  assert.strictEqual(segmentBearing(null, 0, 1), null);
});

test('detectFauxPlats(kmRows, samples) : porte bearingDeg/compass quand samples est fourni, rien sinon', () => {
  const rows = kmRows([0, 0, 2, 2, 2, 2, 2, 0, 0]); // faux-plat km 2→7 (voir premier test du fichier)
  const withoutSamples = detectFauxPlats(rows);
  assert.strictEqual(withoutSamples[0].bearingDeg, undefined);
  assert.strictEqual(withoutSamples[0].compass, undefined);

  // Tracé synthétique plein est le long de l'équateur sur toute la longueur.
  const samples = Array.from({ length: 10 }, (_, i) => ({ dist_m: i * 1000, lat: 0, lon: i * 0.1 }));
  const withSamples = detectFauxPlats(rows, samples);
  assert.strictEqual(withSamples[0].bearingDeg, 90);
  assert.strictEqual(withSamples[0].compass, 'E');
});
