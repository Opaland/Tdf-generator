'use strict';
// Comparateur d'étapes — option "aligner les altitudes de départ" (backlog
// issue #14, inspirée de la fonction "Align start" de VeloViewer).
// frontend/compare.js est require()-able côté test (overlaySVG est une
// fonction pure) grâce à la garde `typeof document` qui saute l'attache
// DOMContentLoaded en environnement Node.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? '') };
global.EFProfile = require('../frontend/profile.js');

const { overlaySVG, hasComparableProfile } = require('../frontend/compare.js');

function fullOf(samples) {
  return {
    stage: { name: 'Étape test' },
    climbs: [],
    samples: samples.map((s, i) => ({ dist_m: i * 1000, ele_smooth_m: s, lat: 45, lon: 1 })),
  };
}

// Étape à distance dégénérée : plusieurs échantillons, mais tous au même
// dist_m (points GPS confondus) — arrive réellement sur une trace importée
// dont resamplePolyline() (pipeline/geo.js) produit une distance cumulée
// nulle sur des coordonnées dupliquées, pas seulement un cas synthétique.
function degenerateOf(eles) {
  return {
    stage: { name: 'Étape dégénérée' },
    climbs: [],
    samples: eles.map((s) => ({ dist_m: 0, ele_smooth_m: s, lat: 45, lon: 1 })),
  };
}

// Trouvaille de revue-personas (27/08/2026, personas développeur/
// développeur accessibilité) : l'unique <svg> de overlaySVG() n'avait ni
// role="img" ni aria-label, contrairement aux 3 fonctions génératrices SVG
// de frontend/profile.js qui posent systématiquement les deux — un lecteur
// d'écran n'avait aucune description du graphique de comparaison.
test('overlaySVG() : role="img" et aria-label décrivant les deux étapes comparées', () => {
  const fa = fullOf([200, 400, 300]);
  fa.stage.name = 'Étape A';
  const fb = fullOf([800, 900, 850]);
  fb.stage.name = 'Étape B';
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.match(svg, /<svg[^>]*\brole="img"/);
  assert.match(svg, /<svg[^>]*\baria-label="[^"]*Étape A[^"]*Étape B[^"]*"/, 'aria-label doit mentionner les deux étapes comparées');
});

test('overlaySVG sans align-start : grille en altitude brute (eMin = plancher du minimum réel, ici 200 m)', () => {
  const fa = fullOf([200, 400, 300]);
  const fb = fullOf([800, 900, 850]);
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.match(svg, />200</, 'eMin attendu = floor(200/100)*100 = 200 (altitude brute, B ne descend jamais sous 800)');
  assert.doesNotMatch(svg, /dénivelé depuis le départ/, 'pas de mention d\'alignement quand la case n\'est pas cochée');
});

test('overlaySVG avec align-start : les deux courbes démarrent à la même altitude relative (0), et le libellé prévient que l\'axe n\'est plus l\'altitude réelle', () => {
  const fa = fullOf([200, 400, 300]); // +200 m relatif au départ
  const fb = fullOf([800, 1000, 900]); // +200 m relatif aussi, mais parti de 800 m plus haut en absolu
  const svg = overlaySVG(fa, fb, 'km', true);
  assert.match(svg, /dénivelé depuis le départ/, 'le libellé d\'avertissement doit apparaître en mode aligné');
  // Une fois alignées, les deux étapes ont le même dénivelé max (+200 m) —
  // la grille doit l'afficher, pas un mélange d'échelles à 200 et 900.
  assert.match(svg, />\+200</);
  assert.doesNotMatch(svg, />800</, 'l\'altitude brute de B (800 m) ne doit plus apparaître, seul le relatif compte');
});

// Trouvaille de revue-personas (27/08/2026, développeur/QA) : overlaySVG()
// est exportée et testée comme fonction pure, mais accédait à rawA[0]/rawB[0]
// sans garde — une étape sans aucun échantillon (génération en échec, ou pas
// encore lancée) fait planter decimate([], 700)[0] en TypeError. Le seul
// appelant DOM (update(), frontend/compare.js) garde déjà ce cas avant
// d'appeler overlaySVG(), mais la fonction elle-même ne le faisait pas.
test('overlaySVG() : samples vides sur une des deux étapes ne plante pas (TypeError), rend un <svg> vide', () => {
  const fa = fullOf([200, 400, 300]);
  const fb = { stage: { name: 'Étape sans données' }, climbs: [], samples: [] };
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.match(svg, /<svg[^>]*>/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

// Trouvaille de relecture adverse sur le test précédent : la garde à 0
// échantillon ne couvre pas le cas à exactement 1 échantillon — dist_m du
// seul point vaut 0, donc maxLen = Math.max(lenA, lenB) peut valoir 0 et
// x() divise silencieusement par ce 0 (NaN dans les coordonnées du SVG,
// sans aucune exception, donc invisible pour npm test s'il ne le vérifie
// pas explicitement). Il faut les DEUX étapes à 1 échantillon pour que
// maxLen tombe à 0 — une seule suffit à fournir un maxLen non nul via
// l'autre étape, donc à masquer le bug (repro exacte de la relecture
// adverse, pas juste « un seul échantillon quelque part »).
test('overlaySVG() : un seul échantillon sur CHAQUE étape (maxLen = 0) ne produit pas de NaN/Infinity dans le SVG', () => {
  const fa = fullOf([500]);
  const fb = fullOf([500]);
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

// Deuxième ronde de relecture adverse : un seuil sur samples.length (essayé
// dans un premier temps) ne couvre pas ce cas — plusieurs échantillons, tous
// au même dist_m (points GPS confondus, reproductible via resamplePolyline()
// sur des coordonnées dupliquées, pipeline/geo.js). La garde doit vérifier
// la portée de distance elle-même, pas juste un compte d'échantillons.
test('overlaySVG() : échantillons multiples mais tous au même dist_m (points confondus) ne produit pas de NaN/Infinity', () => {
  const fa = degenerateOf([500, 520, 480]);
  const fb = degenerateOf([500, 480, 520]);
  const svg = overlaySVG(fa, fb, 'km', false);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

// Trouvaille de relecture adverse : en axe 'pct', x(d, len) divise par `len`
// (la portée de CHAQUE étape individuellement), pas seulement par maxLen —
// une seule étape dégénérée suffit donc à casser l'axe pct même quand
// l'autre étape est parfaitement normale (contrairement à l'axe km, où
// maxLen reste non nul grâce à l'étape saine).
test('overlaySVG() axe pct : une étape dégénérée (points confondus) et une étape normale ne produit pas de NaN/Infinity', () => {
  const fa = degenerateOf([500, 520, 480]);
  const fb = fullOf([500, 600, 550]);
  assert.doesNotMatch(overlaySVG(fa, fb, 'pct', false), /NaN|Infinity/);
  assert.doesNotMatch(overlaySVG(fa, fb, 'km', false), /NaN|Infinity/);
});

test('hasComparableProfile() : vrai pour un profil avec une portée de distance non nulle, faux sinon (vide, 1 point, points confondus)', () => {
  assert.strictEqual(hasComparableProfile(fullOf([200, 400, 300]).samples), true);
  assert.strictEqual(hasComparableProfile([]), false);
  assert.strictEqual(hasComparableProfile(fullOf([500]).samples), false);
  assert.strictEqual(hasComparableProfile(degenerateOf([500, 520]).samples), false);
});

test('overlaySVG avec align-start : une étape qui redescend sous son altitude de départ produit un dénivelé négatif, sans NaN/Infinity', () => {
  const fa = fullOf([500, 300, 400]); // descend à -200 m relatif
  const fb = fullOf([500, 600, 550]);
  const svg = overlaySVG(fa, fb, 'km', true);
  assert.match(svg, />-200</, 'le dénivelé négatif doit être visible sur la grille (eMin = floor(-200/100)*100)');
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
