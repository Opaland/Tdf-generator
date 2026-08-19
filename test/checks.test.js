'use strict';
// Tests unitaires de pipeline/checks.js (runChecks) — fonction pure/synchrone,
// porte de qualité utilisée par scripts/demo.js et par la fiche étape, mais
// jusqu'ici jamais testée directement (item de backlog issue #10, section F).

const { test } = require('node:test');
const assert = require('node:assert');
const { runChecks } = require('../pipeline/checks');

function find(items, id) {
  return items.find((i) => i.id === id);
}

test('leg suspect (route >> vol d\'oiseau) : fail et ok global à false', () => {
  const { ok, items } = runChecks({
    stage: {},
    distanceM: 10000,
    waypointsOnTrack: [],
    approxSegments: [],
    climbs: [],
    samples: [],
    legs: [{ from: 'Lyon', to: 'Vienne', roadM: 120000, straightM: 20000 }],
  });
  const leg = find(items, 'leg-Lyon-Vienne');
  assert.strictEqual(leg.status, 'fail');
  assert.strictEqual(ok, false);
});

test('leg normal (route proche du vol d\'oiseau) : aucun item leg-suspect', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 10000, waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [],
    legs: [{ from: 'A', to: 'B', roadM: 12000, straightM: 10000 }],
  });
  assert.strictEqual(items.some((i) => i.id.startsWith('leg-')), false);
});

test('distance : dans la tolérance ±25 % → ok', () => {
  const { items } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 110000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'ok');
});

test('distance : hors tolérance ±25 % → fail', () => {
  const { items, ok } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 160000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'fail');
  assert.strictEqual(ok, false);
});

test('distance : pas de distance officielle (étape créée) → ok, pas de comparaison', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 42000, waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  const d = find(items, 'distance');
  assert.strictEqual(d.status, 'ok');
  assert.match(d.detail, /étape créée/);
});

test('cols : aucun col déclaré → item informatif ok', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [{ kind: 'start' }, { kind: 'finish' }],
    approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'cols').status, 'ok');
});

test('cols : sommet atteint sous le seuil → ok ; au-delà → fail ; approximé → warn', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 1000,
    waypointsOnTrack: [
      { kind: 'col', label: 'Bon', offTrackM: 50 },
      { kind: 'col', label: 'Loin', offTrackM: 900 },
      { kind: 'col', label: 'Approx', approximated: true },
    ],
    approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'col-Bon').status, 'ok');
  assert.strictEqual(find(items, 'col-Loin').status, 'fail');
  assert.strictEqual(find(items, 'col-Approx').status, 'warn');
});

test('altitude de sommet : proche de la valeur connue → ok ; écart important → warn', () => {
  const samples = [{ dist: 5000, eleRaw: 1990 }, { dist: 5000, eleRaw: 2600 }];
  const { items } = runChecks({
    stage: {}, distanceM: 10000,
    waypointsOnTrack: [
      { kind: 'col', label: 'Proche', altitude_hint_m: 2000, alongM: 5000, offTrackM: 10 },
    ],
    approxSegments: [], climbs: [], samples, legs: [],
  });
  // eleRaw max autour de 5000 m = 2600 (loin de 2000) -> écart 600 m > tolérance 120 m -> warn
  assert.strictEqual(find(items, 'alt-Proche').status, 'warn');
});

test('altitude de sommet : sans mesure autour du sommet → pas d\'item', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 10000,
    waypointsOnTrack: [{ kind: 'col', label: 'Isolé', altitude_hint_m: 2000, alongM: 999999, offTrackM: 10 }],
    approxSegments: [], climbs: [], samples: [{ dist: 0, eleRaw: 400 }], legs: [],
  });
  assert.strictEqual(find(items, 'alt-Isolé'), undefined);
});

test('segments approximés : présents → warn (global ok reste true, warn n\'échoue pas) ; absents → ok', () => {
  const withApprox = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], climbs: [], samples: [], legs: [],
    approxSegments: [{ fromM: 1000, toM: 2000, reason: 'col contourné' }],
  });
  assert.strictEqual(find(withApprox.items, 'approx').status, 'warn');
  assert.strictEqual(withApprox.ok, true, 'un warn ne fait pas échouer le bloc global');

  const noApprox = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], climbs: [], samples: [], legs: [], approxSegments: [],
  });
  assert.strictEqual(find(noApprox.items, 'approx').status, 'ok');
});

test('échantillons altimétriques : trous détectés → warn ; profil complet → ok', () => {
  const holes = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], approxSegments: [], climbs: [], legs: [],
    samples: [{ eleRaw: 100 }, { eleRaw: null }, { eleRaw: 120 }],
  });
  assert.strictEqual(find(holes.items, 'profil').status, 'warn');
  assert.match(find(holes.items, 'profil').detail, /1 manquants/);

  const clean = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], approxSegments: [], climbs: [], legs: [],
    samples: [{ eleRaw: 100 }, { eleRaw: 110 }],
  });
  assert.strictEqual(find(clean.items, 'profil').status, 'ok');
});

test('ok global : true seulement si aucun item en fail (warn accepté)', () => {
  const allGood = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 100000,
    waypointsOnTrack: [{ kind: 'col', label: 'X', approximated: true }],
    approxSegments: [{ fromM: 0, toM: 1, reason: 'x' }], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(allGood.ok, true);

  const oneFail = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 100000,
    waypointsOnTrack: [{ kind: 'col', label: 'X', offTrackM: 99999 }],
    approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(oneFail.ok, false);
});
