'use strict';
// Garde-fou de contraste WCAG pour frontend/profile.js (CAT_COLORS/CAT_TEXT,
// GRAD_COLORS) — même esprit que test/contrast.test.js (:root de style.css),
// séparé parce que ces couleurs vivent dans un fichier différent, pas dans
// des variables CSS. Trouvaille de revue-personas sur PR #87 (Sprint 4) :
// CAT_TEXT['2'] (texte blanc sur #f08c00, catégorie 2) échouait nettement
// WCAG AA (2.48:1 < 4.5:1) — jamais mesuré à l'époque, laissé en suivi de
// session (backlog #63). En vérifiant systématiquement toute la table plutôt
// que la seule paire signalée, CAT_COLORS['4'] (texte blanc sur #3a9d4f,
// vert cat.4) échouait aussi (3.43:1) sans avoir été repéré — les deux
// assombris pour passer ce test, jamais l'inverse. Les couleurs sont lues
// depuis le vrai frontend/profile.js (require() direct, le fichier supporte
// déjà module.exports), jamais recopiées à la main ici.

const { test } = require('node:test');
const assert = require('node:assert');
const EFProfile = require('../frontend/profile.js');

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

const MIN_RATIO = 4.5; // texte normal — les pastilles/labels sont trop petits pour compter comme "grand texte" (seuil 3:1)

test('CAT_COLORS/CAT_TEXT existent et couvrent HC/1/2/3/4', () => {
  for (const cat of ['HC', '1', '2', '3', '4']) {
    assert.ok(EFProfile.CAT_COLORS[cat], `CAT_COLORS['${cat}'] absent`);
    assert.ok(EFProfile.CAT_TEXT[cat], `CAT_TEXT['${cat}'] absent`);
  }
});

for (const cat of ['HC', '1', '2', '3', '4']) {
  test(`contraste WCAG : CAT_TEXT['${cat}'] sur CAT_COLORS['${cat}'] >= ${MIN_RATIO}:1`, () => {
    const bg = EFProfile.CAT_COLORS[cat];
    const fg = EFProfile.CAT_TEXT[cat];
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= MIN_RATIO, `cat.${cat} : ${fg} sur ${bg} = ${ratio.toFixed(2)}:1, seuil ${MIN_RATIO}:1`);
  });
}

// GRAD_COLORS n'est pas exposé directement — gradStyle(g) renvoie {color,
// text} pour un gradient donné ; une valeur représentative par bande
// (d'après les seuils du fichier source : <5, 5-8, 8-10, >10 %).
const GRAD_SAMPLES = [
  { label: '< 5 %', gradient: 3 },
  { label: '5–8 %', gradient: 6 },
  { label: '8–10 %', gradient: 9 },
  { label: '> 10 %', gradient: 15 },
];

for (const { label, gradient } of GRAD_SAMPLES) {
  test(`contraste WCAG : bande de pente "${label}" >= ${MIN_RATIO}:1`, () => {
    const gs = EFProfile.gradStyle(gradient);
    const ratio = contrastRatio(gs.text, gs.color);
    assert.ok(ratio >= MIN_RATIO, `"${label}" (gradient ${gradient}%) : ${gs.text} sur ${gs.color} = ${ratio.toFixed(2)}:1, seuil ${MIN_RATIO}:1`);
  });
}

test('formule de contraste : cas de référence noir/blanc = 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

// Trouvaille de relecture adverse : CAT_COLORS[cat]/CAT_TEXT[cat] ont un
// repli (`|| '#999'`/`|| '#fff'`) pour une catégorie inconnue, mort en
// pratique aujourd'hui (categorize() ne renvoie jamais que HC/1/2/3/4) mais
// échouant lui aussi WCAG AA (2.85:1) — assombri à #707070 (4.95:1),
// verrouillé ici pour que ce repli ne redevienne pas un vrai piège le jour
// où une nouvelle catégorie serait introduite.
test('contraste WCAG : repli catégorie inconnue (#fff sur #707070) >= 4.5:1', () => {
  const ratio = contrastRatio('#ffffff', '#707070');
  assert.ok(ratio >= MIN_RATIO, `repli : #ffffff sur #707070 = ${ratio.toFixed(2)}:1, seuil ${MIN_RATIO}:1`);
});

// Trouvaille de relecture adverse : frontend/stage.js construisait son propre
// marqueur de sommet de côte sur la carte avec un texte blanc figé au lieu de
// lire CAT_TEXT — le contraste corrigé ci-dessus ne s'y appliquait donc
// jamais (jusqu'à 1.48:1 sur cat.3, jaune). Corrigé en passant par
// EFProfile.catStyle() (helper partagé, voir plus bas) plutôt qu'en relisant
// CAT_COLORS/CAT_TEXT localement — c'est ce passage par le helper commun,
// pas une simple absence de couleur fixe, qui est verrouillé ici. Statique
// plutôt qu'un vrai rendu DOM (pas de navigateur en CI).
test('frontend/stage.js utilise EFProfile.catStyle() pour le marqueur de sommet de côte', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'stage.js'), 'utf8');
  assert.match(src, /EFProfile\.catStyle\(c\.category\)/, 'le marqueur de sommet doit passer par EFProfile.catStyle(), pas relire CAT_COLORS/CAT_TEXT localement');
  assert.doesNotMatch(src, /color:\s*#fff\b/, 'aucune couleur de texte ne doit être codée en dur pour ce marqueur');
});

// EFProfile.catStyle() est le seul point qui doit connaître CAT_COLORS/
// CAT_TEXT et leur repli (frontend/profile.js en a 3 usages internes en plus
// de frontend/stage.js) — vérifie que le helper renvoie bien la même paire
// que la table directe, pour toutes les catégories et pour le repli.
for (const cat of ['HC', '1', '2', '3', '4', 'inconnue']) {
  test(`catStyle('${cat}') renvoie la même paire que CAT_COLORS/CAT_TEXT (ou le repli)`, () => {
    const style = EFProfile.catStyle(cat);
    assert.strictEqual(style.color, EFProfile.CAT_COLORS[cat] || '#707070');
    assert.strictEqual(style.text, EFProfile.CAT_TEXT[cat] || '#fff');
  });
}

// Trouvaille de relecture adverse, 2e ronde : corriger l'écart de luminance
// entre une seule paire de catégories (ex. cat.4 vs cat.1) peut en fermer un
// autre sans qu'aucun test ne le détecte — l'éclaircie de CAT_COLORS['4'] à
// #5cb85c (pour corriger sa quasi-collision avec le rouge cat.1) l'a
// justement fait retomber quasi exactement sur la luminance de l'orange
// cat.2 (écart 0.0005), jamais mesuré parce que seul le contraste
// texte/fond par catégorie était verrouillé. Ce test mesure l'écart de
// luminance de CHAQUE paire de catégories, pas seulement celle qu'on vient
// de corriger — pour qu'un futur changement de teinte (harmonisation de
// palette, par ex.) ne puisse pas refaire chuter silencieusement deux
// catégories l'une sur l'autre.
test('contraste WCAG : écart de luminance entre chaque paire de catégories >= 0.10', () => {
  const MIN_GAP = 0.10;
  const cats = ['HC', '1', '2', '3', '4'];
  const lums = Object.fromEntries(cats.map((c) => [c, relativeLuminance(EFProfile.CAT_COLORS[c])]));
  const failures = [];
  for (let i = 0; i < cats.length; i++) {
    for (let j = i + 1; j < cats.length; j++) {
      const gap = Math.abs(lums[cats[i]] - lums[cats[j]]);
      if (gap < MIN_GAP) failures.push(`${cats[i]}/${cats[j]} : écart ${gap.toFixed(4)} < ${MIN_GAP}`);
    }
  }
  assert.deepStrictEqual(failures, [], `paires de catégories trop proches en luminance (confusion possible sous daltonisme rouge-vert) : ${failures.join(', ')}`);
});
