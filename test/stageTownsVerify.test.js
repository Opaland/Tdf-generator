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
