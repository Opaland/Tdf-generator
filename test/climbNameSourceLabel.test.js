'use strict';
// climbNameSourceLabel() (frontend/stage.js) — trouvaille de revue-personas
// (27/08/2026, personas cycliste amateur / visiteur non-cycliste / non-
// francophone) : la fiche étape rendait « nom : waypoint » tel quel sur
// chaque côte dont le nom vient d'un point de passage marqué explicitement
// (c.name_source === 'waypoint') — se lisait comme si le col s'appelait
// littéralement « waypoint », un anglicisme technique interne jamais
// destiné à l'affichage. Extrait en fonction pure testable, même schéma que
// similarItemHtml (test/similarStages.test.js).

const { test } = require('node:test');
const assert = require('node:assert');

// global.EF.qs nécessaire : frontend/stage.js l'appelle au chargement du
// module (const stageId = EF.qs('id')) — même stub que test/similarStages
// .test.js/test/stagePoll.test.js, sa valeur n'a pas d'importance ici.
global.EF = { qs: () => null, esc: (s) => String(s ?? '') };
const { climbNameSourceLabel } = require('../frontend/stage.js');

test('climbNameSourceLabel("waypoint") : ne contient jamais le mot brut "waypoint"', () => {
  const label = climbNameSourceLabel('waypoint');
  assert.doesNotMatch(label, /\bwaypoint\b/i, 'le libellé technique interne ne doit jamais fuiter tel quel vers l\'utilisateur');
  assert.match(label, /point de passage/);
});

test('climbNameSourceLabel("reverse-geocode") : décrit un géocodage inverse, jamais "waypoint"', () => {
  const label = climbNameSourceLabel('reverse-geocode');
  assert.doesNotMatch(label, /\bwaypoint\b/i);
  assert.match(label, /géocodage inverse/);
});

test('climbNameSourceLabel("defaut") : aucun nom exploitable, jamais confondu avec un géocodage réussi', () => {
  // pipeline/climbs.js pose nameSource = 'defaut' dans deux cas : soit
  // reverseGeocodeFn() a rejeté (panne réseau/API), soit elle a résolu
  // sans label exploitable (ex. point sans toponyme connu) — dans les
  // deux cas, nom de repli générique "Côte du km N". Trouvaille de
  // relecture adverse : une première version de climbNameSourceLabel
  // traitait ce cas comme "déduit par géocodage inverse", l'exact
  // contraire de ce qui s'est passé (aucun nom réel n'a été trouvé).
  const label = climbNameSourceLabel('defaut');
  assert.doesNotMatch(label, /\bwaypoint\b/i);
  assert.doesNotMatch(label, /déduit par géocodage inverse/, 'un échec de géocodage ne doit jamais se lire comme un géocodage réussi');
  assert.match(label, /repli générique/);
});

test('climbNameSourceLabel(undefined) : ne plante pas, retombe sur le libellé de repli générique', () => {
  assert.doesNotThrow(() => climbNameSourceLabel(undefined));
  assert.match(climbNameSourceLabel(undefined), /repli générique/);
});
