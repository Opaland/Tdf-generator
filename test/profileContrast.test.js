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
