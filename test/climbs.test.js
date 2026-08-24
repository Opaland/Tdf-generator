'use strict';
// Test du détecteur de côtes sur des profils synthétiques connus.

const { test } = require('node:test');
const assert = require('node:assert');
const { detectClimbs, categorize, irregularityIndex, nameClimbs } = require('../pipeline/climbs');

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

  const climbsEmpty = [{ endM: 10000 }];
  await nameClimbs(climbsEmpty, [], samples, async () => ({ label: null }));
  assert.strictEqual(climbsEmpty[0].name, 'Côte du km 10');
  assert.strictEqual(climbsEmpty[0].rawLabel, undefined);
});
