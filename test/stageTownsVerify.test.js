'use strict';
// Vérification du jeu de villes-étapes (Epic 32.4, scripts/build-stage-towns.js,
// verify) : une position qui contredit la longueur des étapes voisines est
// corrigée ou retirée — mais une grande ville cohérente avec la plupart de
// ses étapes n'est jamais retirée pour une seule étape contradictoire
// (premier jet : Lyon et Toulouse retirées à tort).

const os = require('os');
const path = require('path');
process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-towns-verify-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test } = require('node:test');
const assert = require('node:assert');
const { verify } = require('../scripts/build-stage-towns');

const LYON = { lat: 45.76, lon: 4.84 };
const near = (dLat, dLon) => ({ lat: LYON.lat + dLat, lon: LYON.lon + dLon });
const town = (label, p, confidence = 'ok') => ({ label, lat: p.lat, lon: p.lon, confidence });
const stage = (n, a, b, km) => ({ number: n, start: a, finish: b, distanceKm: km });

test('verify : ville incertaine corrigée par le seul candidat compatible, ville sans candidat retirée, grande ville cohérente conservée', async () => {
  const lyon = town('Lyon', LYON);
  const mons = town('Mons', { lat: 50.454, lon: 3.952 });
  const editions = {
    1950: { stages: [
      stage(1, lyon, town('A', near(0.5, 0)), 120),
      stage(2, lyon, town('B', near(-0.5, 0)), 120),
      stage(3, lyon, town('C', near(0, 0.6)), 120),
      stage(4, lyon, town('D', near(0, -0.6)), 120),
      // Distance Wikipédia mal lue : 10 km pour 220 km réels — ni Lyon ni E ne sont fautives.
      stage(5, lyon, town('E', near(2, 0)), 10),
      stage(6, town('E', near(2, 0)), town('F', near(2.5, 0)), 120),
      // Charleroi placée en Dordogne (homonyme), étape de 50 km depuis Mons.
      stage(7, town('Charleroi', { lat: 45.25, lon: 0.49 }, 'approx'), mons, 50),
      stage(8, town('Fantôme', { lat: 43.3, lon: 5.4 }, 'approx'), mons, 30),
    ] },
  };
  const failures = [];
  const candidates = {
    Charleroi: [{ lat: 45.25, lon: 0.49, how: 'commune-ign' }, { lat: 50.4108, lon: 4.4446, how: 'nominatim' }],
    Fantôme: [{ lat: 43.3, lon: 5.4, how: 'nominatim' }],
  };
  const left = await verify(editions, failures, async (label) => candidates[label] || [], () => {});
  const s = editions[1950].stages;
  assert.deepStrictEqual([s[6].start.lat, s[6].start.lon, s[6].start.confidence], [50.4108, 4.4446, 'verifie']);
  assert.strictEqual(s[7].start.lat, undefined, 'position retirée, jamais gardée fausse');
  assert.ok(failures.some((f) => f.label === 'Fantôme'));
  assert.strictEqual(s[0].start.lat, LYON.lat, 'Lyon conservée');
  assert.strictEqual(s[4].finish.lat, near(2, 0).lat, 'E conservée');
  assert.deepStrictEqual(left, ['Lyon → E'], 'étape contradictoire entre deux villes fiables signalée');
});

test('verify : un remplacement compatible mais implausible (route presque droite) est refusé — position retirée', async () => {
  const chambery = town('Chambéry', { lat: 45.566, lon: 5.92 });
  const editions = { 1996: { stages: [
    // Les Arcs (Savoie) à ~70 km de Chambéry pour 200 km d'étape. Candidat
    // proposé en Haute-Saône (~200 km à vol d'oiseau) : compatible avec la
    // borne maximale, mais une route de 200 km presque droite n'existe pas.
    stage(7, chambery, town('Les Arcs', { lat: 43.46, lon: 6.48 }, 'approx'), 200),
  ] } };
  const failures = [];
  await verify(editions, failures, async () => [{ lat: 47.4586, lon: 5.5827, how: 'commune-ign' }], () => {});
  assert.strictEqual(editions[1996].stages[0].finish.lat, undefined);
});

test('crossCheck : position du géocodeur général confirmée par Nominatim, remplacée si plausible, sinon douteuse', async () => {
  const { crossCheck } = require('../scripts/build-stage-towns');
  const chambery = { label: 'Chambéry', lat: 45.566, lon: 5.92, how: 'commune-ign', confidence: 'ok' };
  const editions = { 1979: { stages: [
    // Position actuelle dans l'Aude (≈ 450 km de Chambéry pour 160 km d'étape) : seule celle de Nominatim est plausible.
    { number: 16, distanceKm: 160, start: chambery, finish: { label: 'Les Menuires', lat: 43.0, lon: 2.0, how: 'geocode', confidence: 'approx' } },
    { number: 17, distanceKm: 150, start: chambery, finish: { label: 'Bon', lat: 45.7, lon: 6.0, how: 'geocode', confidence: 'approx' } },
    { number: 18, distanceKm: 150, start: chambery, finish: { label: 'Inconnu', lat: 45.0, lon: 6.0, how: 'geocode', confidence: 'approx' } },
  ] } };
  const nomi = { 'Les Menuires': [{ lat: 45.3236, lon: 6.5379 }], Bon: [{ lat: 45.701, lon: 6.001 }], Inconnu: [] };
  await crossCheck(editions, async (l) => nomi[l] || [], () => {});
  const [a, b, c] = editions[1979].stages.map((s) => s.finish);
  assert.deepStrictEqual([a.lat, a.confidence], [45.3236, 'verifie']);
  assert.deepStrictEqual([b.lat, b.confidence], [45.7, 'ok']);
  assert.strictEqual(c.confidence, 'douteux');
  assert.strictEqual(chambery.confidence, 'ok', 'commune IGN jamais contre-vérifiée');
});

test('crossCheck : désaccord sans contrainte (circuit) ou avec deux positions plausibles → douteux, jamais un remplacement au hasard', async () => {
  const { crossCheck } = require('../scripts/build-stage-towns');
  const geneve = { label: 'Genève-ville', lat: 46.2, lon: 6.14, how: 'commune-ign', confidence: 'ok' };
  const editions = { 1987: { stages: [
    // Circuit : aucune étape contraignante.
    { number: 0, distanceKm: 6, start: { label: 'West Berlin', lat: 52.52, lon: 13.4, how: 'geocode-pays', confidence: 'ok' }, finish: { label: 'West Berlin', lat: 52.52, lon: 13.4, how: 'geocode-pays', confidence: 'ok' } },
    // Évian juste, candidat Nominatim valdôtain lui aussi plausible depuis Genève (150 km d'étape).
    { number: 1, distanceKm: 150, start: geneve, finish: { label: 'Evian', lat: 46.395, lon: 6.59, how: 'geocode', confidence: 'approx' } },
  ] } };
  const nomi = { 'West Berlin': [{ lat: 39.81, lon: -74.94 }], Evian: [{ lat: 45.71, lon: 7.2 }] };
  await crossCheck(editions, async (l) => nomi[l] || [], () => {});
  const [s0, s1] = editions[1987].stages;
  assert.deepStrictEqual([s0.start.lat, s0.start.confidence], [52.52, 'douteux']);
  assert.deepStrictEqual([s1.finish.lat, s1.finish.confidence], [46.395, 'douteux']);
});
