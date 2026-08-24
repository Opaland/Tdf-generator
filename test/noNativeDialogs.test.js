'use strict';
// Garde-fou anti-régression (issue #19) : les dialogues navigateur natifs
// (alert/confirm/prompt) ont été remplacés par des patterns inline
// (EF.confirmClick, formulaires/messages en ligne) — non stylables,
// bloquants, incohérents d'un navigateur à l'autre. La vérification
// proposée par l'issue elle-même : `grep -rn "alert(\|confirm(\|prompt("
// frontend/*.js` doit rester à zéro. Intégré ici en test plutôt que
// vérifié à la main une fois, pour qu'un retour en arrière soit détecté
// immédiatement plutôt que découvert au prochain audit UI/UX.
//
// Contrainte découverte au Sprint 2 de cette session : la CI n'installe
// aucun navigateur Playwright (.github/workflows/ci.yml) — mais ce
// garde-fou n'en a pas besoin, c'est un grep statique sur les fichiers
// sources, exécutable par un test Node classique (même motif que
// test/contrast.test.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// Retire les commentaires de bloc et de ligne — naïf mais suffisant pour ce
// dépôt : pas de chaîne contenant un motif de commentaire dans le code JS
// du projet (vérifié par les tests ci-dessous, qui échoueraient sinon sur
// du code légitime).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function jsFiles() {
  return fs.readdirSync(FRONTEND_DIR).filter((f) => f.endsWith('.js'));
}

test('aucun appel réel à alert()/confirm()/prompt() dans frontend/*.js (hors commentaires)', () => {
  const offenders = [];
  for (const file of jsFiles()) {
    const src = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
    const code = stripComments(src);
    const m = code.match(/\b(alert|confirm|prompt)\s*\(/g);
    if (m) offenders.push(`${file} : ${m.join(', ')}`);
  }
  assert.deepStrictEqual(offenders, [], `dialogue(s) natif(s) trouvé(s) — ${offenders.join(' ; ')}`);
});

test('stripComments retire bien un commentaire de bloc et de ligne sans toucher au code réel', () => {
  const src = "const a = 1; // alert('commentaire, pas un appel')\n/* confirm('bloc') */\nconst b = alert;\n";
  const code = stripComments(src);
  assert.ok(!code.includes("alert('commentaire"));
  assert.ok(!code.includes("confirm('bloc')"));
  assert.ok(code.includes('const b = alert;'), 'le code réel hors commentaire doit rester');
});

test('détecte bien un vrai appel s\'il est réintroduit (le test est discriminant)', () => {
  const code = stripComments("function f() { alert('coucou'); }");
  assert.match(code, /\balert\s*\(/);
});
