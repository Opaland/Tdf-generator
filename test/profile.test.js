'use strict';
// Rendu SVG des marqueurs sprint/bonification sur le profil — backlog issue
// #14, "marqueurs sprint / bonification". frontend/profile.js est aussi
// require()-able côté Node (module.exports = EFProfile), donc testable
// directement sans navigateur/jsdom.

const { test } = require('node:test');
const assert = require('node:assert');
const { renderProfileSVG } = require('../frontend/profile.js');

function samplePayload(waypoints, climbs = []) {
  return {
    stage: { generated_distance_km: 50, total_ascent_m: 400 },
    climbs,
    waypoints,
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
