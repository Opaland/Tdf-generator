'use strict';
// Test du détecteur de descentes sur des profils synthétiques connus —
// symétrique de test/climbs.test.js. detectDescents réutilise detectClimbs
// sur un profil d'altitude inversé (voir pipeline/descents.js) : ces tests
// vérifient surtout que l'adaptateur (signes, haut/bas d'altitude) est
// correct, pas la géométrie de fusion/rognage elle-même (déjà couverte par
// test/climbs.test.js, puisque c'est littéralement le même code).

const { test } = require('node:test');
const assert = require('node:assert');
const { detectDescents, nameDescents, reconcileDescentSummits, MIN_LENGTH_M, MIN_AVG_GRADIENT } = require('../pipeline/descents');
const { MIN_LENGTH_M: CLIMB_MIN_LENGTH_M, MIN_AVG_GRADIENT: CLIMB_MIN_GRADIENT } = require('../pipeline/climbs');

/** Construit un profil échantillonné tous les 100 m depuis des segments [lengthM, gradientPct]. */
function buildProfile(segments, startEle = 1000) {
  const samples = [{ dist: 0, eleRaw: startEle, eleSmooth: startEle, lat: 45, lon: 1 }];
  let dist = 0;
  let ele = startEle;
  for (const [lengthM, gradient] of segments) {
    const n = Math.round(lengthM / 100);
    for (let i = 0; i < n; i++) {
      dist += 100;
      ele += (gradient / 100) * 100;
      samples.push({ dist, eleRaw: ele, eleSmooth: ele, lat: 45, lon: 1 });
    }
  }
  return samples;
}

test('les seuils de descente sont dérivés de ceux des côtes, jamais divergents', () => {
  assert.strictEqual(MIN_LENGTH_M, CLIMB_MIN_LENGTH_M);
  assert.strictEqual(MIN_AVG_GRADIENT, -CLIMB_MIN_GRADIENT);
});

test('détecte une descente simple de 8 km à -6 % avec les bons signes et altitudes', () => {
  const profile = buildProfile([
    [10000, 0],   // 10 km de plat
    [8000, -6],   // descente : 8 km à -6 %
    [6000, 4],    // remontée
  ]);
  const descents = detectDescents(profile);
  assert.strictEqual(descents.length, 1);
  const d = descents[0];
  assert.ok(Math.abs(d.lengthKm - 8) < 0.3, `longueur ${d.lengthKm} ≈ 8 km`);
  assert.ok(d.avgGradient < 0, 'la pente moyenne d\'une descente doit être négative');
  assert.ok(Math.abs(d.avgGradient - -6) < 0.4, `pente ${d.avgGradient} ≈ -6 %`);
  assert.ok(d.maxGradient < 0, 'la pente max (la plus raide) doit aussi être négative');
  assert.ok(Math.abs(d.startM - 10000) < 600, `départ ${d.startM} ≈ km 10`);
  // Départ à 1000 m, descend de 8 km à 6 % ≈ 480 m de dénivelé perdu → bas ≈ 520 m.
  assert.ok(d.topEle > d.bottomEle, 'le sommet de la descente doit être plus haut que le bas');
  assert.ok(Math.abs(d.topEle - 1000) < 15, `sommet ${d.topEle} ≈ 1000 m`);
  assert.ok(Math.abs(d.bottomEle - 520) < 15, `bas ${d.bottomEle} ≈ 520 m`);
  assert.strictEqual(d.kmBlocks.length, 8);
  for (const b of d.kmBlocks) {
    assert.ok(b.gradient < 0, 'chaque bloc km doit reporter un gradient négatif');
    assert.ok(b.ele0 > b.ele1, 'l\'altitude doit décroître dans le sens du parcours pour chaque bloc');
  }
});

// Trouvaille de relecture adverse (revue de code globale) : detectClimbs()
// (pipeline/climbs.js, réutilisée telle quelle ici sur le profil inversé)
// calculait summitEle via `Math.max(summitEle, samples[i].eleRaw)` sans
// vérifier `eleRaw` par échantillon — un `null` (trou de couverture
// altimétrique, pipeline/elevation.js) s'y coerce arithmétiquement en 0
// (`Math.max(x, null)` ⇒ `Math.max(x, 0)`). Sans danger sur une vraie côte
// (altitudes positives, 0 ne gagne jamais un Math.max face à ~500-2000 m),
// mais dévastateur ici : sur le profil NÉGATÉ que réutilise detectDescents,
// toutes les altitudes sont négatives (ex. -1000 à -520 m) — un candidat 0
// injecté par un trou y devient le MAXIMUM, donnant bottomEle = 0 (un faux
// point bas au niveau de la mer) au lieu de l'altitude réelle. bottom_ele_m
// est affiché tel quel côté utilisateur (frontend/stage.js).
test('un trou d\'altimétrie au point le plus bas de la descente ne donne pas bottomEle = 0', () => {
  const profile = buildProfile([
    [10000, 0],
    [8000, -6], // descend de 1000 m à ~520 m — voir le test ci-dessus pour la valeur attendue sans trou
    [6000, 4],
  ]);
  const idx = profile.findIndex((s) => s.dist === 18000); // dernier échantillon de la descente, le point le plus bas
  profile[idx].eleRaw = null;
  const descents = detectDescents(profile);
  assert.strictEqual(descents.length, 1);
  const d = descents[0];
  assert.notStrictEqual(d.bottomEle, 0, 'un trou d\'altimétrie ne doit jamais produire un faux "bas de descente" à 0 m');
  assert.ok(Math.abs(d.bottomEle - 520) < 20, `bas ${d.bottomEle} doit rester proche de ~520 m malgré le trou`);
});

test('ignore les descentes trop courtes ou trop douces (mêmes seuils que les côtes)', () => {
  const profile = buildProfile([
    [5000, 0],
    [1000, -8],  // 1 km à -8 % : trop court
    [5000, 0],
    [3000, -2],  // 3 km à -2 % : trop douce
    [5000, 0],
  ]);
  assert.strictEqual(detectDescents(profile).length, 0);
});

test('fusionne deux descentes séparées par un replat < 500 m (comportement hérité de detectClimbs)', () => {
  const profile = buildProfile([
    [5000, 0],
    [4000, -6],
    [300, 0],   // replat court → fusion
    [3000, -6],
    [5000, 4],
  ]);
  const descents = detectDescents(profile);
  assert.strictEqual(descents.length, 1, 'une seule descente après fusion');
  assert.ok(descents[0].lengthKm > 7, `longueur fusionnée ${descents[0].lengthKm} > 7 km`);
});

// Trouvaille de revue-personas (persona spécialiste TDF) : detectClimbs()
// tourne deux fois indépendamment (profil réel pour les côtes, profil
// inversé pour les descentes), avec ses propres bornes de rognage à chaque
// fois — rien ne garantit que le "sommet" détecté par la côte et le "haut"
// détecté par la descente correspondent au même échantillon pour un même
// col physique. Écart réel observé : Tourmalet 2115 m (côte) vs 2105 m
// (descente), sur la même fiche étape.
test('reconcileDescentSummits() : aligne topEle sur summitEle de la côte dont le sommet précède la descente', () => {
  const descents = [{ startM: 20500, endM: 28000, topEle: 2105 }];
  const climbs = [{ name: 'Col du Tourmalet', endM: 20000, summitEle: 2115 }];
  reconcileDescentSummits(descents, climbs);
  assert.strictEqual(descents[0].topEle, 2115, 'topEle doit reprendre exactement summitEle de la côte correspondante');
});

test('reconcileDescentSummits() : n\'affecte pas les descentes sans côte proche (départ isolé)', () => {
  const descents = [{ startM: 50000, endM: 58000, topEle: 900 }];
  const climbs = [{ name: 'Col du Tourmalet', endM: 20000, summitEle: 2115 }];
  reconcileDescentSummits(descents, climbs);
  assert.strictEqual(descents[0].topEle, 900, 'aucune côte à proximité (< 800 m) : topEle reste la valeur détectée par la descente elle-même');
});

test('reconcileDescentSummits() : sans aucune côte connue, ne plante pas (liste vide ou absente)', () => {
  const descents = [{ startM: 20500, endM: 28000, topEle: 2105 }];
  assert.doesNotThrow(() => reconcileDescentSummits(descents, []));
  assert.strictEqual(descents[0].topEle, 2105);
  assert.doesNotThrow(() => reconcileDescentSummits(descents, undefined));
});

test('aucune catégorie ASO n\'est inventée pour une descente (contrairement aux côtes)', () => {
  const profile = buildProfile([[10000, -6]]);
  const [d] = detectDescents(profile);
  assert.strictEqual(d.category, undefined, 'une descente ne doit jamais porter de champ category fabriqué');
  assert.strictEqual(d.score, undefined);
});

test('nameDescents : nomme d\'après la côte dont le sommet précède immédiatement la descente (côte nommée par waypoint)', async () => {
  const descents = [{ startM: 20500, endM: 28000 }];
  // rawLabel = ce que nameClimbs pose réellement pour une côte nommée par
  // waypoint (identique à name, sans préfixe) — voir test/climbs.test.js.
  const climbs = [{ name: 'Col du Tourmalet', rawLabel: 'Col du Tourmalet', endM: 20000 }];
  await nameDescents(descents, climbs, [], [], async () => ({ label: 'ignoré' }));
  assert.strictEqual(descents[0].name, 'Descente de Col du Tourmalet');
  assert.strictEqual(descents[0].nameSource, 'climb-summit');
});

// Relecture adverse : nommer d'après `fromClimb.name` plutôt que
// `fromClimb.rawLabel` produisait "Descente de Côte de Pin-Bouchain" pour
// une côte nommée par géocodage inverse (name porte déjà le préfixe "Côte
// de", posé par pipeline/climbs.js) — reproduit avec `npm run demo` avant
// d'être corrigé. Verrouillé ici pour ne pas régresser.
test('nameDescents : côte source nommée par géocodage inverse → pas de double préfixe "Côte de"', async () => {
  const descents = [{ startM: 20500, endM: 28000 }];
  const climbs = [{ name: 'Côte de Pin-Bouchain', rawLabel: 'Pin-Bouchain', nameSource: 'reverse-geocode', endM: 20000 }];
  await nameDescents(descents, climbs, [], [], async () => ({ label: 'ignoré' }));
  assert.strictEqual(descents[0].name, 'Descente de Pin-Bouchain');
  assert.doesNotMatch(descents[0].name, /Côte de/, 'ne doit jamais concaténer le préfixe "Côte de" déjà présent dans le nom de la côte source');
});

test('nameDescents : côte source au nom générique de repli (sans rawLabel) → ignorée, la descente retombe sur sa propre chaîne de repli', async () => {
  const descents = [{ startM: 20500, endM: 28000 }];
  // Une côte "Côte du km 20" (repli générique de nameClimbs, aucun
  // rawLabel) ne doit pas produire "Descente de Côte du km 20" — la
  // descente doit chercher sa propre source (ici : géocodage inverse).
  const climbs = [{ name: 'Côte du km 20', nameSource: 'defaut', endM: 20000 }];
  const samples = [{ dist: 20500, lat: 45, lon: 1 }];
  await nameDescents(descents, climbs, [], samples, async () => ({ label: 'Gavarnie' }));
  assert.strictEqual(descents[0].name, 'Descente de Gavarnie');
  assert.strictEqual(descents[0].nameSource, 'reverse-geocode');
});

test('nameDescents : sans côte proche, se rabat sur un waypoint de type col proche du départ', async () => {
  const descents = [{ startM: 10000, endM: 18000 }];
  const waypointsOnTrack = [{ label: 'Col de Peyresourde', kind: 'col', alongM: 10200 }];
  await nameDescents(descents, [], waypointsOnTrack, [], async () => ({ label: 'ignoré' }));
  assert.strictEqual(descents[0].name, 'Descente de Col de Peyresourde');
  assert.strictEqual(descents[0].nameSource, 'waypoint');
});

test('nameDescents : sans côte ni waypoint, géocodage inverse du point de départ', async () => {
  const descents = [{ startM: 10000, endM: 18000 }];
  const samples = [{ dist: 10000, lat: 45, lon: 1 }];
  await nameDescents(descents, [], [], samples, async () => ({ label: 'Gavarnie' }));
  assert.strictEqual(descents[0].name, 'Descente de Gavarnie');
  assert.strictEqual(descents[0].nameSource, 'reverse-geocode');
});

test('nameDescents : géocodage inverse en échec → repli sur un libellé par défaut, pas de crash', async () => {
  const descents = [{ startM: 10000, endM: 18000 }];
  const samples = [{ dist: 10000, lat: 45, lon: 1 }];
  await nameDescents(descents, [], [], samples, async () => { throw new Error('réseau indisponible'); });
  assert.strictEqual(descents[0].name, 'Descente du km 10');
  assert.strictEqual(descents[0].nameSource, 'defaut');
});

// Même motif que pipeline/climbs.js (relecture adverse, 27/08/2026) : une
// requête résolue SANS exception mais sans label exploitable n'est pas un
// géocodage réussi — avant ce correctif, nameSource restait 'reverse-geocode'
// pour ce cas, comme si un vrai toponyme avait été trouvé.
test('nameDescents : géocodage résolu sans label exploitable → repli générique, nameSource "defaut" (pas "reverse-geocode")', async () => {
  const descents = [{ startM: 10000, endM: 18000 }];
  const samples = [{ dist: 10000, lat: 45, lon: 1 }];
  await nameDescents(descents, [], [], samples, async () => ({ label: null }));
  assert.strictEqual(descents[0].name, 'Descente du km 10');
  assert.strictEqual(descents[0].nameSource, 'defaut');
});
