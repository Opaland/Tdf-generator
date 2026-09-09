'use strict';
// Tests unitaires de pipeline/checks.js (runChecks) — fonction pure/synchrone,
// porte de qualité utilisée par scripts/demo.js et par la fiche étape, mais
// jusqu'ici jamais testée directement (item de backlog issue #10, section F).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks, DIST_TOLERANCE_PCT } = require('../pipeline/checks');

// Les cas de distance se déduisent de DIST_TOLERANCE_PCT au lieu de réécrire
// le nombre : le 04/09/2026, le passage de ±25 % à ±10 % a demandé de
// retoucher quatre littéraux dans ce fichier, dont deux dans des libellés de
// test qui auraient continué d'annoncer « ±25 % » en vert. Un test qui décrit
// un seuil autrement que le code ne le lit finit par mentir sur ce qu'il
// mesure.
const CIBLE_KM = 100;
// Une étape juste sous la tolérance, et une juste au-dessus : c'est la
// frontière qui discrimine, pas un écart confortable de part et d'autre.
// Écrit `(cible + cible * pct / 100)` et non `cible * (1 + pct / 100)` : la
// seconde forme ne tombe pas sur la borne. Mesuré en écrivant ce test —
// 100 * (1 + 10 / 100) rend 110.00000000000001, soit un écart de
// 10.000000000000012 % que le `<=` rejette. La borne exacte n'est donc
// atteignable qu'en gardant le produit avant la somme.
const ecartKm = (pct) => CIBLE_KM + (CIBLE_KM * pct) / 100;
const SOUS_LE_SEUIL_M = ecartKm(DIST_TOLERANCE_PCT - 1) * 1000;
const AU_SEUIL_M = ecartKm(DIST_TOLERANCE_PCT) * 1000;
const AU_DESSUS_M = ecartKm(DIST_TOLERANCE_PCT + 1) * 1000;
const MOTIF_TOLERANCE = new RegExp(`tolérance ±${DIST_TOLERANCE_PCT} %`);

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

// Aller-retour du tracé (04/09/2026, suite signalement utilisateur Tour
// 1992 étape 10 : « Côte de Buckwald » force un aller-retour réel de ~5 km,
// qui fait apparaître une côte fantôme sur le trajet de retour — voir
// pipeline/climbs.js detectBacktrackZones()). runChecks() ne calcule pas les
// zones lui-même (coûteux, déjà fait une fois par generate.js) : il reçoit
// backtrackZones tel quel et se contente de les rapporter, éventuellement
// recoupées avec les côtes détectées à proximité.
test('aller-retour du tracé : une zone détectée → warn, ok global reste true', () => {
  const { items, ok } = runChecks({
    stage: {}, distanceM: 50000, waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
    backtrackZones: [{ startM: 87000, endM: 90000 }],
  });
  const item = find(items, 'backtrack-87000-90000');
  assert.ok(item, 'un item est créé pour la zone');
  assert.strictEqual(item.status, 'warn');
  assert.strictEqual(ok, true, 'un warn ne fait pas échouer le bloc global');
  assert.match(item.detail, /Tour 1992 étape 10/);
});

test('aller-retour du tracé : cite la côte détectée à proximité de la zone, quand il y en a une', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 50000, waypointsOnTrack: [], approxSegments: [], samples: [], legs: [],
    climbs: [{ startM: 94240, endM: 97240, name: 'Côte de Ferme Saint-Henri, Denting' }],
    // Écart de 1750 m entre la fin de la zone et le début de la côte : dans
    // la fenêtre de 2 km — même ordre de grandeur que le cas réel Tour
    // 1992 étape 10 (zone de retour finissant à 94 240 m, côte fantôme
    // débutant exactement là).
    backtrackZones: [{ startM: 91990, endM: 92490 }],
  });
  const item = find(items, 'backtrack-91990-92490');
  assert.match(item.detail, /Côte de Ferme Saint-Henri, Denting/, 'la côte proche (dans les 2 km) est citée par son nom');
});

test('aller-retour du tracé : aucune zone → aucun item, pas de bruit sur une étape normale', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 50000, waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
    backtrackZones: [],
  });
  assert.strictEqual(items.some((i) => i.id.startsWith('backtrack-')), false);
});

test(`distance : dans la tolérance ±${DIST_TOLERANCE_PCT} % → ok`, () => {
  const { items } = runChecks({
    stage: { official_distance_km: CIBLE_KM }, distanceM: SOUS_LE_SEUIL_M,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'ok');
  assert.match(find(items, 'distance').detail, MOTIF_TOLERANCE);
});

// La comparaison est un `<=` : l'écart exactement égal à la tolérance passe.
// Sans ce cas, remplacer `<=` par `<` laisserait toute la suite verte.
test(`distance : écart exactement égal à ±${DIST_TOLERANCE_PCT} % → ok (borne incluse)`, () => {
  const { items } = runChecks({
    stage: { official_distance_km: CIBLE_KM }, distanceM: AU_SEUIL_M,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'ok');
});

test(`distance : un point au-dessus de ±${DIST_TOLERANCE_PCT} % → fail`, () => {
  const { items, ok } = runChecks({
    stage: { official_distance_km: CIBLE_KM }, distanceM: AU_DESSUS_M,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'fail');
  assert.strictEqual(ok, false);
});

// Un écart négatif franchit la même frontière : la tolérance est symétrique
// (`Math.abs`), et le tracé trop court est le cas le plus fréquent sur les
// reconstitutions historiques (démo 1903, étape 6 à -21,8 %).
test(`distance : hors tolérance par défaut (-${DIST_TOLERANCE_PCT + 1} %) → fail`, () => {
  const { items, ok } = runChecks({
    stage: { official_distance_km: CIBLE_KM },
    distanceM: ecartKm(-(DIST_TOLERANCE_PCT + 1)) * 1000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  assert.strictEqual(find(items, 'distance').status, 'fail');
  assert.strictEqual(ok, false);
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
  assert.doesNotMatch(d.detail, MOTIF_TOLERANCE, 'ne doit pas afficher le message générique pour ce cas');
});

test('distance : reconstitution nettement insuffisante mais pas quasi nulle (>= 10 % de l\'officielle) → message générique', () => {
  const { items } = runChecks({
    stage: { official_distance_km: 100 }, distanceM: 30000,
    waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [],
  });
  const d = find(items, 'distance');
  assert.strictEqual(d.status, 'fail');
  assert.match(d.detail, MOTIF_TOLERANCE);
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

test('altitude de sommet : sans mesure autour du sommet → item "warn" explicite, non vérifiable (pas un continue silencieux)', () => {
  const { items } = runChecks({
    stage: {}, distanceM: 10000,
    waypointsOnTrack: [{ kind: 'col', label: 'Isolé', altitude_hint_m: 2000, alongM: 999999, offTrackM: 10 }],
    approxSegments: [], climbs: [], samples: [{ dist: 0, eleRaw: 400 }], legs: [],
  });
  const item = find(items, 'alt-Isolé');
  assert.ok(item, 'un col curé sans données autour du sommet doit quand même produire un item — pas de silence');
  assert.strictEqual(item.status, 'warn');
  assert.match(item.detail, /non vérifiable/);
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

test('échantillons altimétriques : plus de 50 % manquants → fail (D+/côtes non fiables, pas juste warn) — trouvaille 1992 étapes 0/7/8, 100 % manquants', () => {
  const majorityHoles = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], approxSegments: [], climbs: [], legs: [],
    samples: [{ eleRaw: null }, { eleRaw: null }, { eleRaw: 120 }],
  });
  const item = find(majorityHoles.items, 'profil');
  assert.strictEqual(item.status, 'fail');
  assert.match(item.detail, /67 %/);
  assert.strictEqual(majorityHoles.ok, false, 'un profil majoritairement troué doit faire échouer le bloc global');

  // Exactement à la limite (50 %) : reste warn, pas fail — le seuil est un
  // strict > pour ne pas basculer un profil moitié-moitié en échec dur.
  const halfHoles = runChecks({
    stage: {}, distanceM: 1000, waypointsOnTrack: [], approxSegments: [], climbs: [], legs: [],
    samples: [{ eleRaw: null }, { eleRaw: 120 }],
  });
  assert.strictEqual(find(halfHoles.items, 'profil').status, 'warn');
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

// Le README annonce la tolérance dans sa section « Garde-fous et qualité ».
// C'est la même règle écrite à deux endroits qui ne changent jamais ensemble :
// le 04/09/2026, passer de ±25 % à ±10 % dans le code laissait le README
// annoncer l'ancien chiffre à quiconque arrive sur le dépôt, et aucun diff du
// code ne pouvait l'attraper. Ce test relie les deux ; il échoue en nommant
// les deux valeurs plutôt qu'en disant seulement « non trouvé ».
test('README : la tolérance annoncée est celle que le code applique', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const ligne = readme.split('\n').find((l) => l.includes('distance reconstituée vs cible'));
  assert.ok(ligne, 'la puce « distance reconstituée vs cible » a disparu du README : ce test ne garde plus rien, le remettre ou le réécrire');
  const m = /±\s*(\d+(?:[.,]\d+)?)\s*%/.exec(ligne);
  assert.ok(m, `la puce du README n'annonce plus de tolérance chiffrée : « ${ligne.trim()} »`);
  assert.strictEqual(
    Number(m[1].replace(',', '.')),
    DIST_TOLERANCE_PCT,
    `le README annonce ±${m[1]} % là où pipeline/checks.js applique ±${DIST_TOLERANCE_PCT} %`,
  );
});
