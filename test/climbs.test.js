'use strict';
// Test du détecteur de côtes sur des profils synthétiques connus.

const { test } = require('node:test');
const assert = require('node:assert');
const { detectClimbs, categorize, irregularityIndex, nameClimbs, detectBacktrackZones } = require('../pipeline/climbs');

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
  assert.ok(c.irregularityIndex < 0.5, `montée régulière : indice d'irrégularité ${c.irregularityIndex} ≈ 0`);
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

test('mur irrégulier : même catégorie ASO qu\'une montée régulière, mais indice d\'irrégularité nettement plus haut', () => {
  // Deux montées à la même longueur, l'une régulière (8 km à 6 %), l'autre
  // avec un mur à 13 % noyé dans un faux-plat à ~3 % (8 km à 5 % en
  // moyenne) — la catégorisation ASO approchée (longueur × pente moyenne)
  // les range dans la même catégorie 1, l'indice d'irrégularité les distingue.
  const regular = detectClimbs(buildProfile([[10000, 0], [8000, 6], [6000, -4]]))[0];
  const wall = detectClimbs(buildProfile([
    [10000, 0],
    [3000, 3],    // faux-plat
    [1500, 13],   // mur
    [3500, 3.2],  // faux-plat
    [6000, -4],
  ]))[0];
  assert.strictEqual(regular.category, '1');
  assert.strictEqual(wall.category, '1', 'même catégorie malgré le mur — c\'est justement ce que l\'indice complète');
  assert.ok(
    wall.irregularityIndex > regular.irregularityIndex + 1,
    `mur détecté par l'indice d'irrégularité (régulier ${regular.irregularityIndex} vs mur ${wall.irregularityIndex})`
  );
});

test('irregularityIndex() : écart-type des pentes par bloc de 1 km', () => {
  assert.strictEqual(irregularityIndex([]), 0, 'aucun bloc : 0, pas une exception');
  assert.strictEqual(
    irregularityIndex([{ gradient: 6 }, { gradient: 6 }, { gradient: 6 }]),
    0,
    'blocs identiques : aucune irrégularité'
  );
  // écart-type de [4, 8] (moyenne 6) = 2
  assert.strictEqual(irregularityIndex([{ gradient: 4 }, { gradient: 8 }]), 2);
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

// nameClimbs : c.rawLabel (backlog #10, "détection des descentes") — un
// toponyme nu, sans le préfixe "Côte de", consommé par
// pipeline/descents.js pour nommer la descente qui suit sans doubler un
// préfixe ("Descente de Côte de X" serait grammaticalement faux).
test('nameClimbs : côte nommée par un waypoint → rawLabel = label du waypoint (identique à name, pas de préfixe)', async () => {
  const climbs = [{ endM: 10000 }];
  await nameClimbs(climbs, [{ label: 'Col du Tourmalet', kind: 'col', alongM: 10100 }], [], async () => { throw new Error('ne doit pas être appelé'); });
  assert.strictEqual(climbs[0].name, 'Col du Tourmalet');
  assert.strictEqual(climbs[0].rawLabel, 'Col du Tourmalet');
});

// Trouvaille en générant en ligne (30/08/2026, Tour 1903 étape 1, Col du
// Pin-Bouchain) : reproduit avec les vraies données mesurées (OSRM + RGE
// ALTI réels, Tarare → Col du Pin-Bouchain). La côte catégorisée (pente
// moyenne ≥ 3 %) s'arrête à 12 602 m ; le point du col est à 14 602,56 m
// (2000,56 m plus loin, hors de la fenêtre de 1500 m) — un faux-plat final
// (<3 % mais toujours en montée) sépare les deux. Sans repli, `check('Col du
// Pin-Bouchain détecté', …)` échouait dans scripts/demo.js (nom retombé sur
// le géocodage inverse, jamais "Col du Pin-Bouchain").
test('nameClimbs : repli altitude quand le col est plus loin sur le tracé qu\'un faux-plat final (Col du Pin-Bouchain, données réelles)', async () => {
  const climbs = [{ endM: 12602, summitEle: 761 }];
  const waypointsOnTrack = [{ label: 'Col du Pin Bouchain', kind: 'col', alongM: 14602.56, altitude_hint_m: 759 }];
  await nameClimbs(climbs, waypointsOnTrack, [], async () => { throw new Error('ne doit pas être appelé : le repli altitude doit suffire'); });
  assert.strictEqual(climbs[0].name, 'Col du Pin Bouchain');
  assert.strictEqual(climbs[0].nameSource, 'waypoint');
});

// Non-régression : le repli altitude ne doit JAMAIS rattacher un col déjà
// dépassé (en arrière sur le tracé) — seul un col PLUS LOIN que la fin de la
// côte est un candidat légitime pour un faux-plat final.
test('nameClimbs : repli altitude n\'attrape jamais un col en arrière sur le tracé', async () => {
  const climbs = [{ endM: 12602, summitEle: 761 }];
  const waypointsOnTrack = [{ label: 'Col déjà passé', kind: 'col', alongM: 10000, altitude_hint_m: 761 }];
  await nameClimbs(climbs, waypointsOnTrack, [{ dist: 12602, lat: 45, lon: 1 }], async () => ({ label: null }));
  assert.notStrictEqual(climbs[0].name, 'Col déjà passé');
});

// Non-régression : le repli altitude reste borné à 5 km — un col bien plus
// loin sur le tracé (une étape entière, pas un simple faux-plat final) ne
// doit pas être rattaché même à altitude identique.
test('nameClimbs : repli altitude n\'attrape jamais un col à plus de 5 km de la fin de côte', async () => {
  const climbs = [{ endM: 12602, summitEle: 761 }];
  const waypointsOnTrack = [{ label: 'Col bien plus loin', kind: 'col', alongM: 20000, altitude_hint_m: 761 }];
  await nameClimbs(climbs, waypointsOnTrack, [{ dist: 12602, lat: 45, lon: 1 }], async () => ({ label: null }));
  assert.notStrictEqual(climbs[0].name, 'Col bien plus loin');
});

// Non-régression : le repli altitude exige une correspondance resserrée
// (< 40 m) — un col plus loin sur le tracé mais d'altitude nettement
// différente (un sommet sans rapport) ne doit pas être rattaché.
test('nameClimbs : repli altitude n\'attrape jamais un col d\'altitude trop différente', async () => {
  const climbs = [{ endM: 12602, summitEle: 761 }];
  const waypointsOnTrack = [{ label: 'Col sans rapport', kind: 'col', alongM: 14602, altitude_hint_m: 1200 }];
  await nameClimbs(climbs, waypointsOnTrack, [{ dist: 12602, lat: 45, lon: 1 }], async () => ({ label: null }));
  assert.notStrictEqual(climbs[0].name, 'Col sans rapport');
});

test('nameClimbs : côte nommée par géocodage inverse → rawLabel = toponyme nu, name porte le préfixe "Côte de"', async () => {
  const climbs = [{ endM: 10000 }];
  const samples = [{ dist: 10000, lat: 45, lon: 1 }];
  await nameClimbs(climbs, [], samples, async () => ({ label: 'Pin-Bouchain' }));
  assert.strictEqual(climbs[0].name, 'Côte de Pin-Bouchain');
  assert.strictEqual(climbs[0].rawLabel, 'Pin-Bouchain');
});

test('nameClimbs : géocodage inverse en échec ou sans résultat → repli générique, aucun rawLabel', async () => {
  const climbsFail = [{ endM: 10000 }];
  const samples = [{ dist: 10000, lat: 45, lon: 1 }];
  await nameClimbs(climbsFail, [], samples, async () => { throw new Error('réseau indisponible'); });
  assert.strictEqual(climbsFail[0].name, 'Côte du km 10');
  assert.strictEqual(climbsFail[0].rawLabel, undefined, 'un nom de repli générique ne doit pas fournir de rawLabel exploitable en aval');
  assert.strictEqual(climbsFail[0].nameSource, 'defaut');

  // Trouvaille de relecture adverse (27/08/2026) sur un correctif frontend
  // qui distingue nameSource === 'reverse-geocode' (un vrai toponyme
  // trouvé) de 'defaut' (repli générique, aucun nom disponible) : ce
  // deuxième cas — la requête résout SANS exception mais sans label
  // exploitable — posait encore 'reverse-geocode' avant ce correctif,
  // comme si un vrai toponyme avait été trouvé alors que le nom produit
  // est le même repli générique que l'échec réseau ci-dessus.
  const climbsEmpty = [{ endM: 10000 }];
  await nameClimbs(climbsEmpty, [], samples, async () => ({ label: null }));
  assert.strictEqual(climbsEmpty[0].name, 'Côte du km 10');
  assert.strictEqual(climbsEmpty[0].rawLabel, undefined);
  assert.strictEqual(climbsEmpty[0].nameSource, 'defaut', 'un géocodage résolu sans label exploitable doit être traité comme le repli générique, pas comme un géocodage réussi');
});

// detectBacktrackZones (04/09/2026, suite signalement utilisateur Tour 1992
// étape 10) : le point de passage curé « Côte de Buckwald » force un
// aller-retour réel de ~5 km sur la même route (vérifié en traçant les
// coordonnées échantillon par échantillon sur les données réelles), qui
// fait apparaître une côte fantôme sur le trajet de retour. Calibré et
// vérifié sur trois jeux de données réels avant d'écrire ces tests
// synthétiques : Tour 1992 étape 10 (2 zones trouvées, 2,25-3 km chacune,
// confirmées manuellement) ; Tour 2021 étape 11 — double ascension
// INTENTIONNELLE du Ventoux, seul cas réel de repassage légitime déjà
// présent dans le corpus — les deux passages au sommet (même point
// géographique, sens de progression opposé après chacun) ne déclenchent
// qu'une correspondance isolée sur un seul échantillon (zone ~0 m,
// éliminée par BACKTRACK_MIN_ZONE_LENGTH_M), tandis que deux aller-retours
// RÉELS et jusqu'ici inconnus sur la même étape (~km 61-70 et ~km 116-120,
// sans rapport avec le Ventoux) sont eux bien détectés (zones 3-3,75 km).
function eastPoint(lon0, i, step = 0.0013) {
  return { lat: 45, lon: lon0 + i * step };
}

test('detectBacktrackZones : aller-retour réel (même route en sens inverse, altitude en miroir) → zone détectée', () => {
  const samples = [];
  let dist = 0;
  // aller : 3 km vers l'est en montant
  for (let i = 0; i <= 30; i++) {
    samples.push({ dist, ...eastPoint(6, i), eleRaw: 200 + i * 2, eleSmooth: 200 + i * 2 });
    dist += 100;
  }
  // retour : mêmes coordonnées en sens inverse, même altitude à chaque point miroir
  for (let i = 29; i >= 0; i--) {
    samples.push({ dist, ...eastPoint(6, i), eleRaw: 200 + i * 2, eleSmooth: 200 + i * 2 });
    dist += 100;
  }
  // repart ensuite dans une direction jamais reparcourue
  for (let i = 1; i <= 15; i++) {
    samples.push({ dist, lat: 45 + i * 0.0009, lon: 6, eleRaw: 200, eleSmooth: 200 });
    dist += 100;
  }
  const zones = detectBacktrackZones(samples);
  // Le point de rebroussement lui-même (au sommet du aller) n'est jamais
  // flaggé (aucun point plus loin n'est à la fois assez proche ET assez
  // espacé en distance parcourue pour lui correspondre) — un aller-retour
  // symétrique produit donc typiquement 2 zones (le bras aller, le bras
  // retour), pas une seule continue. Vérifié à l'identique sur les
  // données réelles du Tour 1992 étape 10 (2 zones pour l'aller-retour de
  // Buckwald).
  assert.ok(zones.length >= 1, 'au moins une zone de rebroussement détectée');
  const totalLength = zones.reduce((a, z) => a + (z.endM - z.startM), 0);
  assert.ok(totalLength >= 2000, `longueur totale des zones assez importante (${totalLength} m)`);
});

test('detectBacktrackZones : même endroit repassé dans le MÊME sens (boucle légitime, ex. plusieurs tours) → aucune zone', () => {
  const samples = [];
  let dist = 0;
  // premier passage : 3 km vers l'est
  for (let i = 0; i <= 30; i++) { samples.push({ dist, ...eastPoint(6, i), eleRaw: 200, eleSmooth: 200 }); dist += 100; }
  // grande boucle ailleurs, jamais proche géographiquement de l'aller
  for (let i = 1; i <= 150; i++) { samples.push({ dist, lat: 46 + i * 0.001, lon: 7, eleRaw: 200, eleSmooth: 200 }); dist += 100; }
  // second passage au même endroit, MÊME direction (est, pas un retour)
  for (let i = 0; i <= 30; i++) { samples.push({ dist, ...eastPoint(6, i), eleRaw: 200, eleSmooth: 200 }); dist += 100; }
  const zones = detectBacktrackZones(samples);
  assert.strictEqual(zones.length, 0, 'même sens de progression : ce n\'est pas un rebroussement');
});

test('detectBacktrackZones : points géographiquement proches mais altitude nettement différente (ex. lacet de montagne en montée continue) → aucune zone', () => {
  const samples = [];
  let dist = 0;
  for (let i = 0; i <= 30; i++) { samples.push({ dist, ...eastPoint(6, i), eleRaw: 200 + i * 2, eleSmooth: 200 + i * 2 }); dist += 100; }
  // « retour » géographique aux mêmes coordonnées, mais l'altitude continue à
  // monter au lieu de redescendre en miroir — signe d'une route différente
  // (ex. deux niveaux d'un lacet), pas d'un aller-retour sur la même route.
  for (let i = 29; i >= 0; i--) { samples.push({ dist, ...eastPoint(6, i), eleRaw: 400 + (30 - i) * 2, eleSmooth: 400 + (30 - i) * 2 }); dist += 100; }
  const zones = detectBacktrackZones(samples);
  assert.strictEqual(zones.length, 0, 'écart d\'altitude > tolérance : pas retenu comme rebroussement');
});

test('detectBacktrackZones : coïncidence géographique isolée sur un seul point (ex. même sommet visité deux fois, Tour 2021 étape 11 Ventoux) → filtrée, zone trop courte', () => {
  const samples = [];
  let dist = 0;
  // approche du « sommet » par l'est
  for (let i = 0; i <= 20; i++) { samples.push({ dist, ...eastPoint(6, i), eleRaw: 200 + i * 10, eleSmooth: 200 + i * 10 }); dist += 100; }
  // s'éloigne longuement ailleurs
  for (let i = 1; i <= 100; i++) { samples.push({ dist, lat: 45 + i * 0.001, lon: 6.026, eleRaw: 400, eleSmooth: 400 }); dist += 100; }
  // repasse exactement par le même point sommet (venant du nord cette fois), une seule fois
  samples.push({ dist, lat: 45, lon: 6.026, eleRaw: 400, eleSmooth: 400 });
  dist += 100;
  // puis repart dans une direction encore différente (jamais reparcourue)
  for (let i = 1; i <= 20; i++) { samples.push({ dist, lat: 45 - i * 0.0009, lon: 6.026, eleRaw: 400 - i * 5, eleSmooth: 400 - i * 5 }); dist += 100; }
  const zones = detectBacktrackZones(samples);
  assert.strictEqual(zones.length, 0, 'une coïncidence ponctuelle (< 300 m) est filtrée, pas un vrai aller-retour');
});

test('detectBacktrackZones : profil vide, trop court ou sans lat/lon → aucune zone, pas d\'exception', () => {
  assert.deepStrictEqual(detectBacktrackZones([]), []);
  assert.deepStrictEqual(detectBacktrackZones([{ dist: 0 }, { dist: 100 }]), []);
  assert.deepStrictEqual(detectBacktrackZones([{ dist: 0, eleRaw: 200 }, { dist: 100, eleRaw: 210 }]), []);
});
