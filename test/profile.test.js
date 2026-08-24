'use strict';
// Rendu SVG des marqueurs sprint/bonification sur le profil — backlog issue
// #14, "marqueurs sprint / bonification". frontend/profile.js est aussi
// require()-able côté Node (module.exports = EFProfile), donc testable
// directement sans navigateur/jsdom.

const { test } = require('node:test');
const assert = require('node:assert');
const { renderProfileSVG, gradStyle, climbApproxOverlap, profileHoverAt } = require('../frontend/profile.js');

function samplePayload(waypoints, climbs = [], kmAnalysis) {
  return {
    stage: { generated_distance_km: 50, total_ascent_m: 400 },
    climbs,
    waypoints,
    kmAnalysis,
    profile: [
      { d: 0, e: 200, lat: 45.0, lon: 1.0 },
      { d: 15000, e: 350, lat: 45.1, lon: 1.2 },
      { d: 50000, e: 450, lat: 45.3, lon: 1.5 },
    ],
  };
}

test('renderProfileSVG : un waypoint kind=sprint avec bonus_sec affiche la pastille SPR et le texte de bonification', () => {
  const svg = renderProfileSVG(samplePayload([
    { label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 },
    { label: 'Lac de Vassivière', kind: 'sprint', bonus_sec: [3, 2, 1], lat: 45.1, lon: 1.2 },
    { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 },
  ]));
  assert.match(svg, />SPR</, 'la pastille "SPR" doit apparaître pour un waypoint sprint');
  assert.match(svg, /bonif\. 3\/2\/1″/, 'le texte de bonification doit apparaître dans le libellé du sprint');
});

test('renderProfileSVG : un waypoint sans bonus_sec ne porte ni pastille ni texte de bonification', () => {
  const svg = renderProfileSVG(samplePayload([
    { label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 },
    { label: 'Un village', kind: 'via', lat: 45.1, lon: 1.2 },
    { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 },
  ]));
  assert.doesNotMatch(svg, />SPR</);
  assert.doesNotMatch(svg, /bonif\./);
});

test('renderProfileSVG : bonification d\'arrivée en sommet (kind=col absorbé par la côte) reste visible sur le libellé de la côte', () => {
  // Reproduit le cas réel du Puy de Dôme 2023 étape 9 : le waypoint d'arrivée
  // prend kind='col' (isColQuery) et se fait absorber par le libellé de la
  // côte détectée (nearClimb) — sans le raccord bonusPoints/climbs, le texte
  // "bonif. 10/6/4″" curé sur ce waypoint disparaîtrait silencieusement.
  const svg = renderProfileSVG(samplePayload(
    [
      { label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 },
      { label: 'Puy de Dôme', kind: 'col', bonus_sec: [10, 6, 4], lat: 45.3, lon: 1.5 },
    ],
    [{ name: 'Puy de Dôme', category: '1', end_km: 50, summit_ele_m: 450 }]
  ));
  assert.match(svg, /bonif\. 10\/6\/4″/, 'la bonification doit rester visible, portée par le libellé de la côte');
});

test('renderProfileSVG : surligne (bande translucide) un km dont la pente moyenne dépasse 10 % (backlog issue #14, inspiré Komoot)', () => {
  const steepColor = gradStyle(12).color; // couleur du dernier palier de GRAD_COLORS (> 10 %)
  const svg = renderProfileSVG(samplePayload(
    [
      { label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 },
      { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 },
    ],
    [],
    [
      { km: 1, avg_gradient: 3 },
      { km: 2, avg_gradient: 12 }, // > 10 % : doit être surligné
      { km: 3, avg_gradient: 6 },
    ]
  ));
  assert.match(svg, new RegExp(`fill="${steepColor}" fill-opacity="0.16"`), 'un rect translucide à la couleur du palier >10% doit apparaître');
});

test('renderProfileSVG : aucun km >10% → aucune bande de surlignage', () => {
  const svg = renderProfileSVG(samplePayload(
    [{ label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 }, { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 }],
    [],
    [{ km: 1, avg_gradient: 3 }, { km: 2, avg_gradient: 8 }, { km: 3, avg_gradient: -6 }]
  ));
  assert.doesNotMatch(svg, /fill-opacity="0.16"/);
});

test('renderProfileSVG : une forte pente en descente (négative, < -10 %) est aussi surlignée', () => {
  const steepColor = gradStyle(-15).color;
  const svg = renderProfileSVG(samplePayload(
    [{ label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 }, { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 }],
    [],
    [{ km: 1, avg_gradient: -15 }]
  ));
  assert.match(svg, new RegExp(`fill="${steepColor}" fill-opacity="0.16"`));
});

test('renderProfileSVG : sans kmAnalysis (undefined), le rendu ne plante pas et ne surligne rien', () => {
  const svg = renderProfileSVG(samplePayload(
    [{ label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 }, { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 }]
  ));
  assert.doesNotMatch(svg, /fill-opacity="0.16"/);
  assert.match(svg, /<svg/);
});

// Backlog issue #10, section C, "flag surface non goudonnée" : une côte qui
// chevauche un segment interpolé (col contourné par la route, pente lissée
// artificiellement) doit être signalée — pas de garantie de fiabilité sur
// une pente max qu'on sait déjà approximée.
test('climbApproxOverlap : détecte le chevauchement (côte à cheval sur un segment approximé)', () => {
  const climb = { start_km: 10, end_km: 15 };
  const seg = climbApproxOverlap(climb, [{ fromM: 14000, toM: 16000, reason: 'montée interpolée vers Col X (col contourné par la route)' }]);
  assert.ok(seg, 'un segment chevauchant [10km,15km] doit être trouvé');
  assert.match(seg.reason, /interpolée/);
});

test('climbApproxOverlap : aucun chevauchement → undefined', () => {
  const climb = { start_km: 10, end_km: 15 };
  const seg = climbApproxOverlap(climb, [{ fromM: 20000, toM: 22000, reason: 'sans rapport' }]);
  assert.strictEqual(seg, undefined);
});

test('climbApproxOverlap : segment adjacent (ne se touchent qu\'aux bornes) compte comme chevauchement', () => {
  const climb = { start_km: 10, end_km: 15 };
  const seg = climbApproxOverlap(climb, [{ fromM: 15000, toM: 16000, reason: 'juste après le sommet' }]);
  assert.ok(seg);
});

test('climbApproxOverlap : pas de segments (undefined/vide) → undefined, pas de crash', () => {
  assert.strictEqual(climbApproxOverlap({ start_km: 0, end_km: 5 }, undefined), undefined);
  assert.strictEqual(climbApproxOverlap({ start_km: 0, end_km: 5 }, []), undefined);
});

// Profil ↔ carte synchronisés (backlog #10) : profileHoverAt convertit une
// abscisse en unités du viewBox (mêmes marges que renderProfileSVG, W=1000
// H=260 par défaut → M = {l:48, r:24}) en point du profil le plus proche.
const payload = samplePayload([
  { label: 'Départ', kind: 'start', lat: 45.0, lon: 1.0 },
  { label: 'Arrivée', kind: 'finish', lat: 45.3, lon: 1.5 },
]);

test('profileHoverAt : à l\'abscisse du bord gauche (M.l), renvoie le tout premier point du profil', () => {
  const pt = profileHoverAt(payload, {}, 48);
  assert.strictEqual(pt.distM, 0);
  assert.strictEqual(pt.lat, 45.0);
  assert.strictEqual(pt.lon, 1.0);
});

test('profileHoverAt : à l\'abscisse du bord droit (W - M.r), renvoie le tout dernier point du profil', () => {
  const pt = profileHoverAt(payload, {}, 1000 - 24);
  assert.strictEqual(pt.distM, 50000);
  assert.strictEqual(pt.lat, 45.3);
  assert.strictEqual(pt.lon, 1.5);
});

test('profileHoverAt : au milieu de la zone de tracé, retrouve le point intermédiaire exact', () => {
  // frac = 0.3 → distM = 15000, qui correspond pile au 2e point du profil de test.
  const pt = profileHoverAt(payload, {}, 48 + 0.3 * (1000 - 48 - 24));
  assert.strictEqual(pt.distM, 15000);
  assert.strictEqual(pt.lat, 45.1);
  assert.strictEqual(pt.lon, 1.2);
});

test('profileHoverAt : une abscisse avant le bord gauche est bornée à distM=0 (pas de valeur négative)', () => {
  const pt = profileHoverAt(payload, {}, 0);
  assert.strictEqual(pt.distM, 0);
});

test('profileHoverAt : une abscisse après le bord droit est bornée à la distance totale', () => {
  const pt = profileHoverAt(payload, {}, 5000);
  assert.strictEqual(pt.distM, 50000);
});

test('profileHoverAt : profil vide → null, pas de crash', () => {
  assert.strictEqual(profileHoverAt({ profile: [] }, {}, 100), null);
  assert.strictEqual(profileHoverAt({}, {}, 100), null);
});

test('profileHoverAt : renvoie des coordonnées SVG finies exploitables pour dessiner un curseur', () => {
  const pt = profileHoverAt(payload, {}, 300);
  for (const k of ['x', 'yTop', 'yBottom', 'yCurve']) {
    assert.ok(Number.isFinite(pt[k]), `${k} doit être un nombre fini`);
  }
});

// Le payload à 3 points ci-dessus est trop grossier pour discriminer une
// marge gauche/droite inversée dans le calcul frac→distM (l'écran de
// tolérance de "point le plus proche" absorbe l'erreur sans changer de
// point retenu) — repéré par relecture adverse. Payload dense (1 point par
// km) + valeurs attendues calculées à la main sur M={l:48,r:24,t:64,b:40}
// (W=1000, H=260 par défaut) pour verrouiller la formule exacte.
const densePayload = {
  stage: {},
  climbs: [],
  waypoints: [],
  profile: Array.from({ length: 51 }, (_, i) => ({ d: i * 1000, e: 200 + i * 2, lat: 45 + i * 0.001, lon: 1 })),
};

test('profileHoverAt (payload dense) : à mi-parcours, distM et yCurve tombent exactement sur les valeurs calculées à la main', () => {
  // x(25000) = 48 + (25000/50000)*(1000-48-24) = 48 + 0.5*928 = 512
  const pt = profileHoverAt(densePayload, {}, 512);
  assert.strictEqual(pt.distM, 25000, 'une marge l/r inversée dans frac déplacerait distM d\'environ 1300 m sur ce payload dense');
  assert.strictEqual(pt.x, 512);
  // eMin = floor(200/100)*100 = 200 ; eMax = max(300*1.05, 200+300) = 500
  // e(25000) = 250 → y = 64 + (1 - (250-200)/300) * (260-64-40) = 64 + (5/6)*156 = 194
  assert.strictEqual(pt.yCurve, 194);
  assert.strictEqual(pt.yTop, 64);
  assert.strictEqual(pt.yBottom, 220); // y(eMin=200) = 64 + 1*156
});

test('profileHoverAt (payload dense) : une marge gauche/droite inversée changerait le point retenu (verrouille scaleFor contre ce mutant précis)', () => {
  // Avec la vraie formule, frac=(512-48)/928=0.5 → distM=25000 → point d=25000 (e=250).
  // Avec M.l/M.r échangés dans le calcul de frac, frac=(512-24)/928≈0.526 →
  // distM≈26293 → point le plus proche devient d=26000 (e=252), pas 25000.
  const pt = profileHoverAt(densePayload, {}, 512);
  assert.strictEqual(pt.ele, 250, 'le point retenu doit être celui à 25000 m (e=250), pas un voisin décalé par une marge inversée');
});
