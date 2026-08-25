'use strict';
// pipeline/simulator.js n'avait aucun test dédié malgré 346 lignes de
// logique non triviale (trouvaille de sprint dédié) — seuls simGeocode() et
// simElevations() étaient effleurés incidemment par test/geocode.test.js et
// test/elevationGaps.test.js, jamais avec des assertions sur le contrat du
// module lui-même. En particulier, la calibration en IIFE au chargement du
// module (calibrate(), point fixe sur p.amp) n'avait aucune assertion sur
// son résultat : rien ne garantissait que simElevation() au sommet de
// chaque col du gazetier retombe bien sur son altitude réelle — pourtant
// c'est tout l'objet de cette calibration.

const { test } = require('node:test');
const assert = require('node:assert');

const { GAZETTEER, simGeocode, simReverseGeocode, simRouteLeg, simElevation } = require('../pipeline/simulator');
const { haversine } = require('../pipeline/geo');

// --- calibration : simElevation(sommet) ≈ altitude réelle ------------------

test('simElevation() : chaque sommet du gazetier retombe sur son altitude réelle (calibrate(), écart < 1,5 %)', () => {
  const peaks = GAZETTEER.filter((g) => g.kind === 'peak');
  assert.ok(peaks.length >= 10, 'hypothèse du test : le gazetier contient bien plusieurs sommets');
  for (const p of peaks) {
    const sim = simElevation(p.lat, p.lon);
    const relErr = Math.abs(sim - p.ele) / p.ele;
    assert.ok(relErr < 0.015, `${p.name} : altitude simulée ${sim.toFixed(1)} m trop loin de la réelle ${p.ele} m (écart ${(relErr * 100).toFixed(2)} %)`);
  }
});

test('simElevation() : jamais négative, même loin de tout pic connu (socle borné à 2 m minimum)', () => {
  // Océan Atlantique au large de la Bretagne — aucun pic proche.
  assert.ok(simElevation(47.5, -6.0) >= 2);
});

test('simElevation() : déterministe (même point → même altitude)', () => {
  const a = simElevation(45.5, 6.2);
  const b = simElevation(45.5, 6.2);
  assert.strictEqual(a, b);
});

// --- simRouteLeg() -----------------------------------------------------------

test('simRouteLeg() : le tracé commence exactement en a et termine exactement en b', () => {
  const a = { lat: 45.0, lon: 6.0 };
  const b = { lat: 45.05, lon: 6.03 };
  const leg = simRouteLeg(a, b);
  assert.deepStrictEqual(leg.points[0], a);
  assert.deepStrictEqual(leg.points[leg.points.length - 1], b);
});

test('simRouteLeg() : distance routée cohérente avec les points générés, toujours ≥ la ligne droite (sinuosité)', () => {
  const a = { lat: 45.0, lon: 6.0 };
  const b = { lat: 45.05, lon: 6.03 };
  const leg = simRouteLeg(a, b);
  let recomputed = 0;
  for (let i = 1; i < leg.points.length; i++) recomputed += haversine(leg.points[i - 1], leg.points[i]);
  assert.ok(Math.abs(recomputed - leg.distanceM) < 1, 'distanceM doit correspondre à la somme des segments réellement générés');
  assert.ok(leg.distanceM >= haversine(a, b), 'un tracé sinueux ne peut pas être plus court que la ligne droite');
});

test('simRouteLeg() : déterministe (même a/b → même tracé, pas Math.random())', () => {
  const a = { lat: 45.0, lon: 6.0 };
  const b = { lat: 45.05, lon: 6.03 };
  const leg1 = simRouteLeg(a, b);
  const leg2 = simRouteLeg(a, b);
  assert.deepStrictEqual(leg1, leg2);
});

test('simRouteLeg() : plus sinueux en montagne qu\'en plaine, à distance à vol d\'oiseau comparable', () => {
  // Plaine (Beauce, ~140 m) vs col du Tourmalet (2115 m, GAZETTEER) : deux legs
  // de longueur à vol d'oiseau proche, mais un relief moyen très différent.
  const plaineA = { lat: 48.4, lon: 1.4 };
  const plaineB = { lat: 48.44, lon: 1.44 };
  const montagneA = { lat: 42.90, lon: 0.14 }; // ~col du Tourmalet
  const montagneB = { lat: 42.94, lon: 0.18 };
  const plaine = simRouteLeg(plaineA, plaineB);
  const montagne = simRouteLeg(montagneA, montagneB);
  const sinuositePlaine = plaine.distanceM / haversine(plaineA, plaineB);
  const sinuositeMontagne = montagne.distanceM / haversine(montagneA, montagneB);
  assert.ok(sinuositeMontagne > sinuositePlaine, `sinuosité montagne (${sinuositeMontagne.toFixed(3)}) doit dépasser celle en plaine (${sinuositePlaine.toFixed(3)})`);
});

// --- simReverseGeocode() ------------------------------------------------------

test('simReverseGeocode() : un point du gazetier renvoie son propre nom, distance ~0', () => {
  const lyon = GAZETTEER.find((g) => g.name === 'Lyon');
  const r = simReverseGeocode(lyon.lat, lyon.lon);
  assert.strictEqual(r.label, 'Lyon');
  assert.ok(r.distanceM < 100);
});

test('simReverseGeocode() : point isolé à plus de 25 km de tout lieu connu → label générique, distanceM null', () => {
  const r = simReverseGeocode(47.5, -6.0); // large Atlantique
  assert.match(r.label, /^Lieu \(/);
  assert.strictEqual(r.distanceM, null);
});

// --- simGeocode() --------------------------------------------------------------

test('simGeocode() : correspondance exacte du gazetier', () => {
  const r = simGeocode('Lyon');
  assert.strictEqual(r.label, 'Lyon');
  assert.strictEqual(r.kind, 'city');
  assert.strictEqual(r.provider, 'simulateur');
});

test('simGeocode() : correspondance partielle (sous-chaîne) du gazetier', () => {
  const r = simGeocode('Col du Tourmalet (Hautes-Pyrénées)');
  assert.strictEqual(r.label, 'Col du Tourmalet');
  assert.strictEqual(r.kind, 'peak');
});

test('simGeocode() : lieu inconnu → position dérivée du hash du texte, déterministe, en France métropolitaine', () => {
  const r1 = simGeocode('Un lieu totalement inventé xyz123');
  const r2 = simGeocode('Un lieu totalement inventé xyz123');
  assert.deepStrictEqual(r1, r2, 'même texte inconnu → même position simulée à chaque appel');
  assert.strictEqual(r1.kind, 'unknown');
  assert.ok(r1.lat >= 43.5 && r1.lat <= 49.0, 'latitude simulée doit rester dans la plage France métropolitaine du générateur');
  assert.ok(r1.lon >= -1.5 && r1.lon <= 5.5, 'longitude simulée doit rester dans la plage France métropolitaine du générateur');
});
