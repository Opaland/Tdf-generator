'use strict';
// Tests unitaires purs de pointsFromStreams(), séparés de test/strava.test.js :
// voir le commentaire en tête de ce dernier fichier — un require() direct de
// backend/strava.js ici est sans risque, ce fichier tourne dans son propre
// processus Node et ne pose aucune variable d'environnement STRAVA_* dont
// l'ordre de chargement pourrait interférer.

const { test } = require('node:test');
const assert = require('node:assert');
const { pointsFromStreams } = require('../backend/strava');

test('pointsFromStreams : combine latlng + altitude + time avec la date de départ fournie', () => {
  const startDateIso = '2026-06-01T09:00:00Z';
  const streams = {
    latlng: { data: [[43.0, 0.5], [43.001, 0.5]] },
    altitude: { data: [400, 410] },
    time: { data: [0, 60] },
  };
  const points = pointsFromStreams(streams, startDateIso);
  assert.strictEqual(points.length, 2);
  assert.deepStrictEqual(points[0], { lat: 43.0, lon: 0.5, ele: 400, time: new Date(Date.parse(startDateIso)) });
  assert.deepStrictEqual(points[1], { lat: 43.001, lon: 0.5, ele: 410, time: new Date(Date.parse(startDateIso) + 60000) });
});

test('pointsFromStreams : sans flux altitude/time, ele/time restent null (pas un 0 deviné)', () => {
  const streams = { latlng: { data: [[43.0, 0.5], [43.001, 0.5]] } };
  const points = pointsFromStreams(streams, '2026-06-01T09:00:00Z');
  for (const p of points) {
    assert.strictEqual(p.ele, null);
    assert.strictEqual(p.time, null);
  }
});

test("pointsFromStreams : sans flux latlng, erreur explicite plutôt qu'un tracé vide silencieux", () => {
  assert.throws(() => pointsFromStreams({}, '2026-06-01T09:00:00Z'), /latlng/);
});
