'use strict';
// Garde-fou de contraste WCAG (backlog #10 / issue #18) : #18 avait mesuré au
// calculateur que --warn (#e67e22 sur blanc, 2.85:1) et le badge
// .badge.generating (#e67e22 sur #fdf0d8, 2.53:1) échouaient nettement le
// seuil AA — corrigé depuis (palette assombrie). En écrivant ce garde-fou
// pour verrouiller ce résultat contre une régression future, --fail
// (#d7263d) s'est révélé encore insuffisant sur .badge.error (#fbdcdc,
// 3.87:1 < 4.5:1) — jamais mesuré lors du correctif de #18, qui ne portait
// que sur --warn/--ok. Assombri à #b01c2f (voir frontend/style.css) pour
// passer ce test, pas l'inverse. Les couleurs sont lues depuis le vrai
// frontend/style.css, jamais recopiées à la main : un hex qui dérive dans le
// CSS fait échouer ce test plutôt que de laisser un doublon obsolète ici.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'style.css'), 'utf8');

function readRootVars(css) {
  const rootBlock = css.match(/:root\s*{([^}]*)}/)[1];
  const vars = {};
  for (const m of rootBlock.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) vars[m[1]] = m[2];
  return vars;
}

// WCAG 2.1 § 1.4.3 — luminance relative sRGB puis ratio de contraste.
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

const vars = readRootVars(css);

test('les variables de couleur attendues existent dans :root (fixture du test à jour)', () => {
  for (const name of ['jaune', 'noir', 'fond', 'carte', 'texte', 'texte2', 'ok', 'warn', 'fail']) {
    assert.ok(vars[name], `--${name} absent de :root — style.css a changé, mettre à jour ce test`);
  }
});

// Paires réellement utilisées dans style.css (texte sur fond), avec leur
// seuil WCAG AA : 4.5:1 pour du texte normal, 3:1 pour du grand texte/icône
// isolée (cf. .checks .st, taille d'icône généreuse).
const PAIRS = [
  { name: '--texte sur --fond (corps de texte)', fg: 'texte', bg: 'fond', min: 4.5 },
  { name: '--texte sur --carte (corps de texte, cartes)', fg: 'texte', bg: 'carte', min: 4.5 },
  { name: '--ok sur --carte (.checks .ok .st, icône de statut)', fg: 'ok', bg: 'carte', min: 3 },
  { name: '--warn sur --carte (.checks .warn .st, icône de statut)', fg: 'warn', bg: 'carte', min: 3 },
  { name: '--fail sur --carte (.checks .fail .st, icône de statut)', fg: 'fail', bg: 'carte', min: 3 },
  { name: '--texte sur --bord (.explorer-tile-unexplored)', fg: 'texte', bg: 'bord', min: 4.5 },
];

// button.danger : texte blanc sur fond --fail (pas une variable :root pour
// le texte, donc hors boucle PAIRS ci-dessus).
const DANGER_BUTTON = { fg: '#ffffff', bg: 'fail', min: 4.5 };

// Fonds de badge codés en dur dans style.css (.badge.done/.generating/.error,
// .sourced-badge/.partial-badge) — pas des variables :root, donc listés ici
// explicitement plutôt que lus dynamiquement (même esprit que les PAIRS
// ci-dessus : si ces hex bougent dans le CSS sans mise à jour ici, le test
// vérifie une valeur qui n'est plus la vraie — acceptable pour un badge
// fixe, documenté pour qu'un futur changement de ces couleurs pense à
// relire ce fichier).
const BADGE_PAIRS = [
  { name: '.badge.done (--ok sur #d9efe1)', fg: 'ok', bgHex: '#d9efe1', min: 4.5 },
  { name: '.badge.generating (--warn sur #fdf0d8)', fg: 'warn', bgHex: '#fdf0d8', min: 4.5 },
  { name: '.badge.error (--fail sur #fbdcdc)', fg: 'fail', bgHex: '#fbdcdc', min: 4.5 },
  { name: '.explorer-tile-partial (--texte sur #fdf0d8)', fg: 'texte', bgHex: '#fdf0d8', min: 4.5 },
  { name: '.explorer-tile-complete (--texte sur #d9efe1)', fg: 'texte', bgHex: '#d9efe1', min: 4.5 },
];

for (const p of PAIRS) {
  test(`contraste WCAG : ${p.name} >= ${p.min}:1`, () => {
    const ratio = contrastRatio(vars[p.fg], vars[p.bg]);
    assert.ok(
      ratio >= p.min,
      `${p.name} : ${vars[p.fg]} sur ${vars[p.bg]} = ${ratio.toFixed(2)}:1, seuil ${p.min}:1`
    );
  });
}

for (const p of BADGE_PAIRS) {
  test(`contraste WCAG : ${p.name} >= ${p.min}:1`, () => {
    const ratio = contrastRatio(vars[p.fg], p.bgHex);
    assert.ok(
      ratio >= p.min,
      `${p.name} : ${vars[p.fg]} sur ${p.bgHex} = ${ratio.toFixed(2)}:1, seuil ${p.min}:1`
    );
  });
}

test(`contraste WCAG : button.danger (texte blanc sur --fail) >= ${DANGER_BUTTON.min}:1`, () => {
  const ratio = contrastRatio(DANGER_BUTTON.fg, vars[DANGER_BUTTON.bg]);
  assert.ok(
    ratio >= DANGER_BUTTON.min,
    `texte blanc sur --fail (${vars[DANGER_BUTTON.bg]}) = ${ratio.toFixed(2)}:1, seuil ${DANGER_BUTTON.min}:1`
  );
});

test('formule de contraste : cas de référence noir/blanc = 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});
