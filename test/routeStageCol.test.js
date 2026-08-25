'use strict';
// pipeline/routing.js, routeStage() : logique de col contourné jamais
// exercée par la suite (trouvaille de sprint dédié). En mode hors-ligne,
// simRouteLeg() (pipeline/simulator.js) route TOUJOURS exactement entre a et
// b (t=0 → a, t=1 → b, le sinus d'amplitude s'annule aux deux bornes) —
// startGap/endGap valent donc toujours 0, et les branches isColA/isColB
// (interpolation pied↔sommet, construction d'approxSegments) ne s'exécutent
// jamais dans test/generate.test.js (seul test qui exerce le pipeline
// complet hors-ligne, avec des waypoints `via` uniquement). Les
// consommateurs d'approxSegments (checks/profile/elevationGaps) fabriquent
// ce tableau à la main plutôt que de le recevoir du vrai producteur.
//
// Pour exercer réellement ces branches il faut simuler un routeur (OSRM) qui
// s'arrête avant le sommet — mode EN LIGNE avec global.fetch mocké, comme
// test/diagnosticParallel.test.js et test/geocode.test.js.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-routestagecol-test-${process.pid}`);

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { setOffline } = require('../pipeline/http');
const { routeStage, COL_TOLERANCE_M } = require('../pipeline/routing');
const { haversine } = require('../pipeline/geo');

let realFetch;

// Une seule base pour tout le fichier (CLAUDE.md règle 4 : ETAPEFORGE_DATA_DIR
// n'est lu qu'au premier require de backend/db.js, le réassigner en cours de
// process ne changerait rien) — chaque test utilise donc une paire de
// coordonnées distincte plutôt qu'un cache remis à zéro, pour que le cache
// api_cache (keyé sur a/b arrondis) ne fasse jamais fuiter la réponse mockée
// d'un test vers un autre.
before(() => {
  setOffline(false); // simRouteLeg() ne déclenche jamais isColA/isColB (voir en-tête) — il faut le vrai chemin OSRM
  realFetch = global.fetch;
});

after(() => {
  global.fetch = realFetch;
  setOffline(true);
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function mockOsrmRoute(points) {
  global.fetch = async (url) => {
    if (!String(url).includes('router.project-osrm.org')) return realFetch(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [{ geometry: { coordinates: points.map((p) => [p.lon, p.lat]) }, distance: 1000 }],
        waypoints: [{ distance: 0 }, { distance: 0 }],
      }),
    };
  };
}

test('routeStage() : col contourné par la route (arrivée) → interpolation vers le sommet, approxSegments et approximated:true', async () => {
  const pied = { lat: 45.0, lon: 6.0, kind: 'via', label: 'Pied du col' };
  const sommet = { lat: 45.045, lon: 6.0, kind: 'col', label: 'Sommet' }; // ~5 km au nord
  // La route OSRM simulée s'arrête à 45.040 (~560 m avant le sommet, > COL_TOLERANCE_M).
  const routeEnd = { lat: 45.040, lon: 6.0 };
  const gapFromSommet = haversine(routeEnd, sommet);
  assert.ok(gapFromSommet > COL_TOLERANCE_M, `hypothèse du test : l'écart simulé (${gapFromSommet} m) doit dépasser la tolérance (${COL_TOLERANCE_M} m)`);
  mockOsrmRoute([{ lat: pied.lat, lon: pied.lon }, routeEnd]);

  const result = await routeStage([pied, sommet]);

  assert.strictEqual(result.approxSegments.length, 1);
  assert.match(result.approxSegments[0].reason, /montée interpolée vers Sommet/);
  assert.ok(result.approxSegments[0].toM > result.approxSegments[0].fromM);
  assert.strictEqual(result.waypointsOnTrack[1].approximated, true);
  assert.strictEqual(result.waypointsOnTrack[1].offTrackM, 0, 'un waypoint approximé est toujours "recollé" pile sur son point : offTrackM=0, pas la distance réelle à la route');
  // Le tracé final doit vraiment atteindre le sommet (dernier point ≈ sommet),
  // pas s'arrêter là où OSRM s'est arrêté.
  const lastPoint = result.points[result.points.length - 1];
  assert.ok(haversine(lastPoint, sommet) < 1, 'le tracé final doit se terminer exactement au sommet après interpolation');
});

test('routeStage() : col contourné par la route (départ) → interpolation depuis le sommet, deuxième leg', async () => {
  const sommet = { lat: 45.045, lon: 6.0, kind: 'col', label: 'Sommet' };
  const vallee = { lat: 45.09, lon: 6.0, kind: 'via', label: 'Vallée' }; // ~5 km plus au nord
  // La route OSRM simulée commence à 45.050 (~560 m après le sommet, > COL_TOLERANCE_M).
  const routeStart = { lat: 45.050, lon: 6.0 };
  const gapFromSommet = haversine(routeStart, sommet);
  assert.ok(gapFromSommet > COL_TOLERANCE_M, `hypothèse du test : l'écart simulé (${gapFromSommet} m) doit dépasser la tolérance (${COL_TOLERANCE_M} m)`);
  mockOsrmRoute([routeStart, { lat: vallee.lat, lon: vallee.lon }]);

  const result = await routeStage([sommet, vallee]);

  assert.strictEqual(result.approxSegments.length, 1);
  assert.match(result.approxSegments[0].reason, /descente interpolée depuis Sommet/);
  // Le tracé doit bien partir du sommet, pas de là où OSRM a commencé à router.
  const firstPoint = result.points[0];
  assert.ok(haversine(firstPoint, sommet) < 1, 'le tracé doit démarrer exactement au sommet, pas au point de reprise OSRM');
});

test('routeStage() : route qui atteint le sommet directement (pas de contournement) → aucune approximation', async () => {
  // Coordonnées décalées de +0.02° en longitude par rapport au 1er test :
  // le cache api_cache est keyé sur (a, b), une paire déjà utilisée
  // renverrait la réponse mockée du 1er test plutôt que celle-ci.
  const pied = { lat: 45.0, lon: 6.02, kind: 'via', label: 'Pied' };
  const sommet = { lat: 45.045, lon: 6.02, kind: 'col', label: 'Sommet' };
  mockOsrmRoute([{ lat: pied.lat, lon: pied.lon }, { lat: sommet.lat, lon: sommet.lon }]);

  const result = await routeStage([pied, sommet]);

  assert.strictEqual(result.approxSegments.length, 0);
  assert.strictEqual(result.waypointsOnTrack[1].approximated, false);
});

test('routeStage() : écart sous la tolérance sur un waypoint "via" (pas un col) → jamais interpolé, même écart significatif', async () => {
  const a = { lat: 45.0, lon: 6.0, kind: 'via', label: 'A' };
  const b = { lat: 45.02, lon: 6.0, kind: 'via', label: 'B' }; // ~2.2 km — pas un col
  const routeEnd = { lat: 45.015, lon: 6.0 }; // ~560 m avant B, mais B n'est pas un col
  mockOsrmRoute([{ lat: a.lat, lon: a.lon }, routeEnd]);

  const result = await routeStage([a, b]);

  assert.strictEqual(result.approxSegments.length, 0, 'un waypoint "via" contourné ne doit jamais déclencher d\'interpolation, seul un col/peak le fait');
  assert.strictEqual(result.waypointsOnTrack[1].approximated, false);
  assert.ok(result.waypointsOnTrack[1].offTrackM > COL_TOLERANCE_M * 0.9, 'l\'écart réel doit rester visible dans offTrackM plutôt que masqué par une interpolation');
});
