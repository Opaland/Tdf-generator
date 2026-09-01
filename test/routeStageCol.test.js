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
// Pour exercer réellement ces branches il faut simuler un routeur qui
// s'arrête avant le sommet — mode EN LIGNE avec global.fetch mocké, comme
// test/diagnosticParallel.test.js et test/geocode.test.js.
//
// Migration OSRM → BRouter (31/08/2026, issue #169) : routeLeg() interroge
// BRouter en premier, jamais OSRM directement (OSRM reste un repli si
// BRouter échoue) — le mock cible donc brouter.de par défaut
// (mockBrouterRoute()), au format GeoJSON réel de BRouter (LineString 3D
// [lon,lat,ele], `properties['track-length']` en mètres), pas le format
// OSRM. Un test dédié plus bas (mockOsrmOnly + BRouter en échec) vérifie
// spécifiquement le repli.

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

/** Mock BRouter (chemin primaire de routeLeg()) — jamais OSRM (repli seulement, voir plus bas). */
function mockOsrmRoute(points) {
  global.fetch = async (url) => {
    if (!String(url).includes('brouter.de')) return realFetch(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat, 0]) },
          properties: { 'track-length': '1000' }, // BRouter renvoie une CHAÎNE, pas un nombre (vérifié en direct, issue #169)
        }],
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

// Migration OSRM → BRouter (issue #169) : BRouter reste un service public
// tiers qui peut échouer (pas de tracé trouvé, indisponibilité...) — OSRM
// doit alors prendre le relais de façon transparente pour l'appelant,
// jamais faire échouer routeStage() entier tant qu'OSRM répond.
test('routeLeg()/routeStage() : repli sur OSRM quand BRouter échoue, jamais un échec total', async () => {
  const a = { lat: 45.1, lon: 6.1, kind: 'via', label: 'A' };
  const b = { lat: 45.12, lon: 6.1, kind: 'via', label: 'B' };
  global.fetch = async (url) => {
    if (String(url).includes('brouter.de')) {
      return { ok: false, status: 400, json: async () => { throw new Error('pas de JSON sur un 400 BRouter'); } };
    }
    if (String(url).includes('router.project-osrm.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{ geometry: { coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }, distance: 2200 }],
          waypoints: [{ distance: 0 }, { distance: 0 }],
        }),
      };
    }
    return realFetch(url);
  };

  const result = await routeStage([a, b]);

  assert.strictEqual(result.router, 'osrm', 'le repli doit être visible dans le champ router, pas masqué en "brouter"');
  assert.strictEqual(result.legs[0].roadM, 2200, 'la distance du leg vient bien de la réponse OSRM de repli, pas d\'un échec silencieux à 0');
});

// Trouvaille de relecture adverse avant tout commit : BRouter renvoie
// track-length sous forme de CHAÎNE (vérifié en direct sur brouter.de,
// ex. "2477"), pas de nombre. Number.isFinite() (contrairement à
// isFinite() global) ne coerce pas les chaînes — sans coercion explicite,
// routeLegBrouter() rejetterait CHAQUE réponse réelle de BRouter et
// retomberait silencieusement sur OSRM à chaque appel, rendant la
// migration inopérante en production malgré des tests tous verts.
test('routeLeg() : track-length de BRouter en chaîne (format réel de l\'API) est bien accepté, pas rejeté comme invalide', async () => {
  const a = { lat: 45.2, lon: 6.2, kind: 'via', label: 'A' };
  const b = { lat: 45.22, lon: 6.2, kind: 'via', label: 'B' };
  global.fetch = async (url) => {
    if (String(url).includes('brouter.de')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[a.lon, a.lat, 0], [b.lon, b.lat, 0]] },
            properties: { 'track-length': '2477' }, // chaîne, comme la vraie API
          }],
        }),
      };
    }
    return realFetch(url);
  };

  const result = await routeStage([a, b]);

  assert.strictEqual(result.router, 'brouter', 'une réponse BRouter valide (même avec track-length en chaîne) ne doit jamais déclencher le repli OSRM');
  assert.strictEqual(result.legs[0].roadM, 2477);
});
