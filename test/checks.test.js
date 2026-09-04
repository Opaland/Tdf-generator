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

// Points de passage espacés (03/09/2026, suite signalement utilisateur
// Nidervisse/Porcelette, Tour 1992 étape 10) : un trou > 12 km entre deux
// points curés consécutifs risque de laisser le routeur halluciner un chemin
// plausible mais faux — voir VIA_GAP_WARN_M dans pipeline/checks.js.
test('points de passage espacés : leg > 12 km à vol d\'oiseau sur une étape partiellement curée → warn', () => {
  const { items, ok } = runChecks({
    stage: {}, distanceM: 30000,
    waypointsOnTrack: [{ label: 'Départ' }, { label: 'Via' }, { label: 'Arrivée' }],
    approxSegments: [], climbs: [], samples: [],
    legs: [
      { from: 'Départ', to: 'Via', roadM: 5000, straightM: 4500 },
      { from: 'Via', to: 'Arrivée', roadM: 18000, straightM: 15000 },
    ],
  });
  const gap = find(items, 'via-gap-Via-Arrivée');
  assert.ok(gap, 'le leg de 15 km à vol d\'oiseau doit être signalé');
  assert.strictEqual(gap.status, 'warn');
  assert.strictEqual(ok, true, 'un warn ne fait pas échouer le bloc global');
  assert.strictEqual(find(items, 'via-gap-Départ-Via'), undefined, 'le leg de 4,5 km ne doit pas être signalé');
});

test('points de passage espacés : n\'est jamais signalé sur une étape entièrement non curée (départ+arrivée seuls)', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 200000,
    waypointsOnTrack: [{ label: 'Départ' }, { label: 'Arrivée' }],
    approxSegments: [], climbs: [], samples: [],
    legs: [{ from: 'Départ', to: 'Arrivée', roadM: 200000, straightM: 180000 }],
  });
  assert.strictEqual(items.some((i) => i.id.startsWith('via-gap-')), false);
});

test('points de passage espacés : jamais signalé si déjà couvert par le check leg suspect (fail)', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 130000,
    waypointsOnTrack: [{ label: 'Départ' }, { label: 'Via' }, { label: 'Arrivée' }],
    approxSegments: [], climbs: [], samples: [],
    legs: [
      { from: 'Départ', to: 'Via', roadM: 5000, straightM: 4500 },
      { from: 'Via', to: 'Arrivée', roadM: 120000, straightM: 20000 },
    ],
  });
  assert.strictEqual(find(items, 'leg-Via-Arrivée').status, 'fail');
  assert.strictEqual(find(items, 'via-gap-Via-Arrivée'), undefined, 'pas de doublon avec le leg déjà signalé en fail');
});

// Tolérance à deux paliers (03/09/2026, suite signalement utilisateur
// Nidervisse/Porcelette, Tour 1992 étape 10) : ±5 % pour une étape reconstruite
// à partir d'un tracé GPX officiel (waypoints labellisés « Tracé GPX km X »,
// voir isGpxSourced()), ±15 % sinon — une étape sans aucun waypoint
// labellisé (comme ici, waypointsOnTrack: []) n'est jamais GPX-sourcée.
test('distance : dans la tolérance ±15 % (non GPX) → ok', () => {
  const { items } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 110000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'ok');
  assert.match(find(items, 'distance').detail, /tolérance ±15 %/);
});

test('distance : hors tolérance ±15 % (non GPX) → fail', () => {
  const { items, ok } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 120000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'fail');
  assert.strictEqual(ok, false);
});

test('distance : tracé GPX officiel (waypoints labellisés) → tolérance resserrée à ±5 %', () => {
  const gpxWaypoints = [
    { label: 'Tracé GPX km 0' }, { label: 'Tracé GPX km 8.0' }, { label: 'Tracé GPX km 16.0' },
  ];
  const withinTight = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 104000,
    waypointsOnTrack: gpxWaypoints, approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(withinTight.items, 'distance').status, 'ok');
  assert.match(find(withinTight.items, 'distance').detail, /tolérance ±5 %/);
  assert.match(find(withinTight.items, 'distance').detail, /tracé GPX officiel/);

  // Un écart qui passerait la tolérance non-GPX (±15 %) échoue désormais à ±5 %.
  const outsideTight = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 110000,
    waypointsOnTrack: gpxWaypoints, approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(outsideTight.items, 'distance').status, 'fail');
});

test('isGpxSourced() : majorité de labels « Tracé GPX km » → true ; sinon → false', () => {
  const { isGpxSourced } = require('../pipeline/checks');
  assert.strictEqual(isGpxSourced([{ label: 'Tracé GPX km 0' }, { label: 'Tracé GPX km 8.0' }]), true);
  assert.strictEqual(isGpxSourced([{ label: 'Bouzonville' }, { label: 'Boulay-Moselle' }, { label: 'Tracé GPX km 8.0' }]), false, 'minorité de labels GPX');
  assert.strictEqual(isGpxSourced([{ label: 'Bouzonville' }, { label: 'Boulay-Moselle' }]), false);
  assert.strictEqual(isGpxSourced([]), false);
  assert.strictEqual(isGpxSourced([{ kind: 'start' }]), false, 'waypoint sans label');
  assert.strictEqual(
    isGpxSourced([{ label: 'Tracé GPX km 0' }, { label: 'Boulay-Moselle' }]),
    true,
    'égalité stricte 50/50 → true (seuil >= 0.5)',
  );
});

// Trouvaille en vérifiant le Tour 1992 (issue #108 suite, 01/09/2026) : une
// étape en circuit (départ = arrivée) sans aucun via curé géocode aux deux
// mêmes coordonnées, donc routeStage() route entre deux points identiques —
// distance ~0, pas juste « hors tolérance » comme un tracé mal deviné. Le
// message générique noyait ce cas qualitativement différent (fiche
// pratiquement vide, aucun profil réel) dans le même libellé qu'un simple
// écart de tracé.
test('distance : reconstitution quasi nulle (< 10 % de l\'officielle) → message dédié, pas le message générique', () => {
  const { items, ok } = runChecks({
    stage: { official_distance_km: 194.5 }, distanceM: 100,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  const d = find(items, 'distance');
  assert.strictEqual(d.status, 'fail');
  assert.strictEqual(ok, false);
  assert.match(d.detail, /quasi nulle/);
  assert.match(d.detail, /circuit/);
  assert.doesNotMatch(d.detail, /tolérance ±25/, 'ne doit pas afficher le message générique pour ce cas');
});

test('distance : reconstitution nettement insuffisante mais pas quasi nulle (>= 10 % de l\'officielle) → message générique', () => {
  const { items } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 30000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  const d = find(items, 'distance');
  assert.strictEqual(d.status, 'fail');
  assert.match(d.detail, /tolérance ±15 %/);
  assert.doesNotMatch(d.detail, /quasi nulle/);
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

test('altitude de sommet : un trou d\'altimétrie (eleRaw null) dans la fenêtre ne fait pas remonter la mesure vers 0 m (relecture adverse)', () => {
  // Sur le domaine réel des cols du Tour (toujours positif), Math.max(mesuré,
  // null) -> Math.max(mesuré, 0) ne change jamais le résultat : 0 n'est
  // jamais le maximum face à une vraie altitude positive. Ce test ne serait
  // donc pas discriminant avec un col à ~2000 m (essayé d'abord, voir
  // l'historique) — comme pour descents.test.js sur un profil négaté, il
  // faut sortir du domaine réaliste pour forcer le cas où 0 devient le
  // maximum : un `eleRaw` négatif suivi d'un trou de couverture.
  const samples = [
    { dist: 5000, eleRaw: -50 },
    { dist: 5200, eleRaw: null }, // trou de couverture : sans le filtre sur
    // eleRaw != null, Math.max(-50, null) coercerait ce trou en
    // Math.max(-50, 0) = 0, remontant faussement la mesure de -50 à 0 m.
  ];
  const { items } = runChecks({
    stage: {}, distanceM: 10000,
    waypointsOnTrack: [
      { kind: 'col', label: 'Proche', altitude_hint_m: -50, alongM: 5000, offTrackM: 10 },
    ],
    approxSegments: [], climbs: [], samples, legs: [],
  });
  assert.strictEqual(find(items, 'alt-Proche').status, 'ok');
  assert.match(find(items, 'alt-Proche').detail, /mesurée -50 m/);
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
