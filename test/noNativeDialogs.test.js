'use strict';
// Garde-fou anti-régression (issue #19) : les dialogues navigateur natifs
// (alert/confirm/prompt) ont été remplacés par des patterns inline
// (EF.confirmClick, formulaires/messages en ligne) — non stylables,
// bloquants, incohérents d'un navigateur à l'autre. La vérification
// proposée par l'issue elle-même : « grep -rn "alert(\|confirm(\|prompt("
// frontend/*.js doit retourner zéro résultat une fois traité » — mais un
// grep texte (même en retirant les commentaires à la main par regex) se
// fait piéger par les littéraux regex à slash échappé (`/^\//`) et les
// chaînes contenant une URL (`https://...`) : deux tours de relecture
// adverse/multi-personas sur cette même PR ont chacun trouvé un vrai
// alert()/confirm()/prompt() qu'un strip par regex laissait passer
// silencieusement, dont un cas (littéral regex après un mot-clé comme
// `return`) que le correctif du premier tour ne fermait toujours pas —
// exactement l'avertissement du CLAUDE.md règle 1 (« corriger le vecteur
// qu'on a trouvé ne ferme pas la classe de bug »).
//
// Solution retenue : un vrai parseur JS (espree, déjà une dépendance du
// dépôt via eslint — eslint.config.js l'utilise déjà avec les mêmes
// options ecmaVersion/sourceType pour frontend/*.js) plutôt qu'un
// tokenizer maison. Un AST distingue structurellement code/chaîne/regex/
// commentaire — la classe entière de bug (confondre un `//`/`/*` de
// contenu avec un vrai commentaire) ne peut pas se reproduire, par
// construction, plutôt que par une liste de cas particuliers couverts un
// par un.
//
// Contrainte découverte au Sprint 2 de cette session : la CI n'installe
// aucun navigateur Playwright (.github/workflows/ci.yml) — mais ce
// garde-fou n'en a pas besoin, c'est une analyse statique des fichiers
// source, exécutable par un test Node classique.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const DIALOG_NAMES = new Set(['alert', 'confirm', 'prompt']);

// Nom appelé par un CallExpression, qu'il soit direct (`alert(...)`) ou
// qualifié (`window.alert(...)`, `globalThis["alert"](...)`, y compris via
// `?.`) — trouvaille de relecture adverse (3ᵉ tour sur cette PR) : ne
// vérifier que `callee.type === 'Identifier'` ratait `window.alert(...)`,
// une forme réaliste (code de debug copié depuis la console navigateur),
// alors que même le grep texte d'origine l'aurait attrapée par frontière
// de mot. Élargi plutôt que juste ajouté `window`/`globalThis`/`self` en
// dur : n'importe quel `.alert(`/`.confirm(`/`.prompt(` qualifié, même
// motif que le grep original.
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    if (!callee.computed && callee.property.type === 'Identifier') return callee.property.name;
    if (callee.computed && callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value;
    }
  }
  return null;
}

/** [{name, line}] pour chaque appel réel à alert()/confirm()/prompt() dans le source. */
function findDialogCalls(src) {
  const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', loc: true });
  const found = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee);
      if (name && DIALOG_NAMES.has(name)) found.push({ name, line: node.loc.start.line });
    }
    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val.type === 'string') walk(val);
    }
  })(ast);
  return found;
}

function jsFiles() {
  return fs.readdirSync(FRONTEND_DIR).filter((f) => f.endsWith('.js'));
}

test('aucun appel réel à alert()/confirm()/prompt() dans frontend/*.js (hors commentaires)', () => {
  const offenders = [];
  for (const file of jsFiles()) {
    const src = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
    const calls = findDialogCalls(src);
    if (calls.length) offenders.push(`${file} : ${calls.map((c) => `${c.name}() ligne ${c.line}`).join(', ')}`);
  }
  assert.deepStrictEqual(offenders, [], `dialogue(s) natif(s) trouvé(s) — ${offenders.join(' ; ')}`);
});

test('un appel en commentaire (ligne ou bloc) n\'est pas détecté', () => {
  const src = "const a = 1; // alert('commentaire, pas un appel')\n/* confirm('bloc') */\nconst b = alert;\n";
  assert.deepStrictEqual(findDialogCalls(src), []);
});

test('détecte un vrai appel simple (le test est discriminant)', () => {
  const calls = findDialogCalls("function f() { alert('coucou'); }");
  assert.deepStrictEqual(calls, [{ name: 'alert', line: 1 }]);
});

// Cas qui ont fait échouer les deux versions précédentes de ce garde-fou
// (strip par regex, puis tokenizer maison) — verrouillés explicitement
// pour ne pas les perdre si l'implémentation change encore.
test('un vrai appel après un littéral regex à slash échappé (/^\\//) reste détecté', () => {
  const calls = findDialogCalls("const p = String(path).replace(/^\\//, '').split('?')[0]; alert('debug ' + p);");
  assert.deepStrictEqual(calls, [{ name: 'alert', line: 1 }]);
});

test('un vrai appel après un littéral regex précédé d\'un mot-clé (return/case) reste détecté', () => {
  const calls = findDialogCalls('function f(x){ return /^\\//.test(x); } alert("y");');
  assert.deepStrictEqual(calls, [{ name: 'alert', line: 1 }]);
});

test('un vrai appel après une chaîne contenant une URL (//) sur la même ligne reste détecté', () => {
  const calls = findDialogCalls("const url = 'https://exemple.com'; if (bug) alert('faux négatif');");
  assert.deepStrictEqual(calls, [{ name: 'alert', line: 1 }]);
});

test('un vrai appel dans ${...} d\'un template literal reste détecté', () => {
  const calls = findDialogCalls("const msg = `Erreur : ${alert('x')}`;");
  assert.deepStrictEqual(calls, [{ name: 'alert', line: 1 }]);
});

test('une division n\'est pas confondue avec un appel ou un commentaire', () => {
  const calls = findDialogCalls('const ratio = a / b / c; // pas un commentaire avant ce point-ci\nconst x = alert;');
  assert.deepStrictEqual(calls, []);
});

test('une simple référence à alert (sans appel) n\'est pas signalée', () => {
  assert.deepStrictEqual(findDialogCalls('const handler = window.alert;'), []);
  assert.deepStrictEqual(findDialogCalls('button.onclick = alert;'), []);
});

// Trouvaille de relecture adverse (3ᵉ tour) : ne vérifier que
// `callee.type === 'Identifier'` ratait tout appel qualifié — une forme
// réaliste (code de debug copié depuis la console navigateur, qui écrit
// spontanément `window.alert(...)`), alors que même le grep texte
// d'origine l'aurait attrapée par simple frontière de mot.
test('un appel qualifié (window.alert, globalThis.confirm, self.prompt) reste détecté', () => {
  assert.deepStrictEqual(findDialogCalls("window.alert('x')"), [{ name: 'alert', line: 1 }]);
  assert.deepStrictEqual(findDialogCalls("globalThis.confirm('x')"), [{ name: 'confirm', line: 1 }]);
  assert.deepStrictEqual(findDialogCalls("self.prompt('x')"), [{ name: 'prompt', line: 1 }]);
});

test('un appel qualifié par accès calculé (window["alert"](...)) reste détecté', () => {
  assert.deepStrictEqual(findDialogCalls('window["alert"]("x")'), [{ name: 'alert', line: 1 }]);
});

test('un appel qualifié avec chaînage optionnel (window?.alert(...)) reste détecté', () => {
  assert.deepStrictEqual(findDialogCalls('window?.alert("x")'), [{ name: 'alert', line: 1 }]);
});
