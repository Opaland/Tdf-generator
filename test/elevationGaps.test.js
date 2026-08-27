'use strict';
// Trouvaille de revue de code globale de fin de session : un échantillon
// d'altimétrie sans couverture (Géoplateforme RGE ALTI ou opentopodata)
// était silencieusement coercé en 0 m (`Math.round(s.ele * 10) / 10` avec
// `s.ele` null/undefined) au lieu de rester `null` — un pic de niveau de la
// mer factice sur le profil, invisible pour l'audit
// "Échantillons altimétriques" de pipeline/checks.js (`eleRaw == null`),
// jamais déclenché en pratique puisque `eleRaw` n'était jamais réellement
// `null`. Corrigé dans pipeline/elevation.js : les trous restent `null`
// dans `eleRaw` (détectables), mais sont comblés par le voisin valide le
// plus proche AVANT le lissage (`eleSmooth`) — movingAverageByDistance
// additionne `.ele` directement, et `null` non comblé y serait coercé
// arithmétiquement en 0 (`sum += null` ⇒ `sum += 0`), biaisant toute la
// fenêtre de moyenne glissante qui le recouvre.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-elevation-gaps-test-${process.pid}`);
// Volontairement PAS ETAPEFORGE_OFFLINE=1 : le simulateur hors-ligne
// (pipeline/simulator.js, simElevations) ne produit jamais de trou — ce
// test vérifie le chemin réseau réel (geopfBatch), avec httpJson mocké.

const { test, after } = require('node:test');
const assert = require('node:assert');

const http = require('../pipeline/http');
const originalHttpJson = http.httpJson;
let mockElevations = null; // tableau d'altitudes (ou null/objets {z}) à renvoyer, dans l'ordre demandé

// Mock minimal : intercepte uniquement les requêtes vers data.geopf.fr
// (altimétrie RGE ALTI) — tout le reste (aucun autre appel attendu dans ce
// test) retomberait sur le vrai httpJson, mais échouerait faute de réseau
// dans ce bac à sable ; ce test ne construit que des points en France pour
// n'exercer que ce chemin.
http.httpJson = async (url) => {
  if (String(url).includes('data.geopf.fr/altimetrie')) {
    const lonsParam = String(url).match(/lon=([^&]*)/)[1];
    const count = lonsParam.split('|').length;
    if (!mockElevations || mockElevations.length !== count) {
      throw new Error(`mockElevations doit avoir exactement ${count} entrées (reçu ${mockElevations?.length})`);
    }
    return { elevations: mockElevations };
  }
  return originalHttpJson(url);
};

const { buildProfile, fillNearestValid } = require('../pipeline/elevation');
const { runChecks } = require('../pipeline/checks');

after(() => {
  http.httpJson = originalHttpJson;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

// --- fillNearestValid (fonction pure) -----------------------------------

test('fillNearestValid : comble un trou intérieur par le voisin le plus proche', () => {
  assert.deepStrictEqual(fillNearestValid([100, 200, null, 400, 500]), [100, 200, 200, 400, 500]);
});

test('fillNearestValid : trou en tête -> voisin de droite', () => {
  assert.deepStrictEqual(fillNearestValid([null, 200, 300]), [200, 200, 300]);
});

test('fillNearestValid : trou en queue -> voisin de gauche', () => {
  assert.deepStrictEqual(fillNearestValid([100, 200, null]), [100, 200, 200]);
});

test('fillNearestValid : plusieurs trous consécutifs comblés de proche en proche (même idiome que fillInvalidElevations, pipeline/climbs.js)', () => {
  // Un seul passage gauche->droite, en place : une fois filled[1] rempli
  // avec la valeur de gauche (100), filled[2] la trouve déjà comblée en
  // remontant vers la gauche et la reprend — la valeur de gauche "gagne"
  // en cascade sur tout le bloc de trous, ce n'est pas symétrique par
  // rapport au trou le plus proche de chaque côté individuellement.
  assert.deepStrictEqual(fillNearestValid([100, null, null, null, 500]), [100, 100, 100, 100, 500]);
});

test('fillNearestValid : NaN et undefined traités comme null', () => {
  assert.deepStrictEqual(fillNearestValid([100, NaN, undefined, 400]), [100, 100, 100, 400]);
});

test('fillNearestValid : aucun trou -> tableau inchangé (no-op, chemin hors-ligne jamais concerné)', () => {
  assert.deepStrictEqual(fillNearestValid([100, 200, 300]), [100, 200, 300]);
});

test('fillNearestValid : entièrement invalide -> 0 en dernier recours', () => {
  assert.deepStrictEqual(fillNearestValid([null, null]), [0, 0]);
});

// --- buildProfile (intégration, httpJson mocké) -------------------------

// Pau (43.30, -0.37) -> plein est, dans la bbox France : looksLikeFrance()
// route tous les points vers geopfBatch. resamplePolyline(_, 100) sur cette
// distance produit N_POINTS points (vérifié empiriquement) — la valeur
// exacte n'a pas d'importance pour ce test, seul compte l'index 10 comme
// point du milieu où placer le trou.
const N_POINTS = 25;

// Chaque appel à buildProfile() passe par pipeline/cache.js (cached()), qui
// clé sur les coordonnées demandées — pas sur la réponse mockée. Deux appels
// sur EXACTEMENT le même tracé retomberaient donc sur le premier résultat en
// cache au lieu de ré-invoquer httpJson. Un décalage minuscule de longitude
// (~11 m, négligeable sur un tracé de ~2-3 km, ne change pas N_POINTS) donne
// à chaque appel de test sa propre clé de cache.
let trackOffset = 0;
function makeTrack() {
  trackOffset += 0.0001;
  return [{ lat: 43.30, lon: -0.37 + trackOffset }, { lat: 43.30, lon: -0.34 + trackOffset }];
}

test('buildProfile : un trou d\'altimétrie reste null dans eleRaw (pas coercé en 0 m)', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = null; // trou au milieu du profil
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, null, 'eleRaw doit rester null, pas 0');
  assert.strictEqual(profile.samples[9].eleRaw, 245, 'les voisins ne doivent pas être affectés');
  assert.strictEqual(profile.samples[11].eleRaw, 255);
});

test('buildProfile : la même donnée mais avec {z: null} (forme objet Géoplateforme) donne le même résultat', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = { z: null };
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, null);
});

// Trouvaille en générant en masse des étapes réelles avec un vrai accès
// réseau (26/08/2026) : le Géoplateforme ne renvoie pas toujours `null`
// pour un point hors couverture RGE ALTI. Deux formes observées en direct :
//   1. Franchement hors couverture (mer ouverte) : nombre littéral -99999
//      pile (vérifié sur un point en Manche, 49.5°N, -2.0°E).
//   2. À la LIMITE de la couverture (littoral, ex. Le Havre → Cherbourg le
//      long de la Manche) : une valeur INTERPOLÉE entre une case valide et
//      une case -99999 voisine — des fractions comme -74017.5 ou -56315.9,
//      jamais -99999 pile. Un premier correctif qui ne testait que
//      l'égalité stricte à -99999 manquait cette zone de transition.
// Un garde-fou sur une plage plausible (plausibleEle(), -500 m à 6000 m)
// couvre les deux cas sans dépendre de la valeur exacte du sentinel.
// Impact observé sur des étapes réelles : jusqu'à +100 000 m, voire
// +304 000 m de D+ fantôme sur une seule étape (285 km).
test('buildProfile : -99999 (sentinel numérique Géoplateforme hors couverture) traité comme un trou, pas une vraie altitude', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = -99999;
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, null, 'le sentinel -99999 ne doit jamais devenir une eleRaw valide');
  assert.strictEqual(profile.samples[9].eleRaw, 245, 'les voisins ne doivent pas être affectés');
});

test('buildProfile : -99999 sous la forme objet {z: -99999} traité de la même façon', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = { z: -99999 };
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, null);
});

test('buildProfile : valeur interpolée fractionnaire hors plage plausible (frontière de couverture, pas -99999 pile) traitée comme un trou', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = -74017.5; // observé en direct, Le Havre → Cherbourg, 26/08/2026
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, null, 'une valeur hors plage plausible ne doit jamais passer, même sans égaler -99999 pile');
});

test('buildProfile : une vraie altitude basse mais plausible (ex. -10 m, Camargue) n\'est jamais traitée comme un trou', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 200 + i * 5);
  mockElevations[10] = -10;
  const profile = await buildProfile(makeTrack());
  assert.strictEqual(profile.samples[10].eleRaw, -10, 'une vraie altitude sous le niveau de la mer reste valide, la plage plausible ne doit pas la rejeter à tort');
});

test('buildProfile : totalAscentM avec un sentinel -99999 reste proche de la montée réelle (pas des dizaines de milliers de mètres en trop)', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 800 + i * 5); // 800 -> 900 m, montée réelle ~100 m
  mockElevations[10] = -99999;
  const withSentinel = await buildProfile(makeTrack());
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 800 + i * 5); // même profil, sans sentinel
  const withoutSentinel = await buildProfile(makeTrack());
  assert.ok(
    Math.abs(withSentinel.totalAscentM - withoutSentinel.totalAscentM) <= 5,
    `D+ avec sentinel (${withSentinel.totalAscentM} m) doit rester proche du D+ sans sentinel (${withoutSentinel.totalAscentM} m), pas +100 000 m`
  );
});

test('buildProfile : eleSmooth reste fini et cohérent au niveau du trou (pas de creux artificiel vers 0 m)', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 800 + i * 5); // montée régulière ~800-900 m
  mockElevations[10] = null;
  const profile = await buildProfile(makeTrack());
  const eleSmoothAtHole = profile.samples[10].eleSmooth;
  assert.ok(Number.isFinite(eleSmoothAtHole), 'eleSmooth ne doit jamais être NaN/Infinity');
  // Sans le comblement par le voisin avant lissage, un trou coercé en 0 dans
  // la somme de la fenêtre glissante ferait chuter eleSmooth largement sous
  // les valeurs voisines (~845 m) — vérifie qu'il reste dans la plage
  // plausible de la montée, pas un creux vers 0.
  assert.ok(eleSmoothAtHole > 700, `eleSmooth au trou (${eleSmoothAtHole}) ne doit pas s'effondrer vers 0 m`);
});

test('buildProfile : totalAscentM proche de la montée réelle malgré le trou (pas faussé par un faux creux à 0 m)', async () => {
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 800 + i * 5); // 800 -> 900 m, montée réelle ~100 m
  mockElevations[10] = null;
  const withHole = await buildProfile(makeTrack());
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 800 + i * 5); // même profil, sans trou
  const withoutHole = await buildProfile(makeTrack());
  assert.ok(
    Math.abs(withHole.totalAscentM - withoutHole.totalAscentM) <= 5,
    `D+ avec trou (${withHole.totalAscentM} m) doit rester proche du D+ sans trou (${withoutHole.totalAscentM} m)`
  );
});

// --- pipeline/checks.js : l'audit se déclenche enfin sur un vrai trou ----

test('runChecks : "Échantillons altimétriques" passe en warn quand eleRaw contient un vrai null (audit auparavant mort — eleRaw n\'était jamais null)', () => {
  const samples = [
    { dist: 0, eleRaw: 100, eleSmooth: 100 },
    { dist: 100, eleRaw: null, eleSmooth: 105 },
    { dist: 200, eleRaw: 110, eleSmooth: 110 },
  ];
  const { items } = runChecks({
    stage: {}, distanceM: 200, waypointsOnTrack: [], approxSegments: [], climbs: [], samples, legs: [],
  });
  const profilCheck = items.find((i) => i.id === 'profil');
  assert.strictEqual(profilCheck.status, 'warn');
  assert.match(profilCheck.detail, /1 manquants/);
});

test('runChecks : aucun trou -> "Échantillons altimétriques" reste ok', () => {
  const samples = [
    { dist: 0, eleRaw: 100, eleSmooth: 100 },
    { dist: 100, eleRaw: 105, eleSmooth: 105 },
  ];
  const { items } = runChecks({
    stage: {}, distanceM: 100, waypointsOnTrack: [], approxSegments: [], climbs: [], samples, legs: [],
  });
  const profilCheck = items.find((i) => i.id === 'profil');
  assert.strictEqual(profilCheck.status, 'ok');
});
