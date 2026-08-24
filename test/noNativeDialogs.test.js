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

// Retire les commentaires de bloc et de ligne, en laissant intact tout le
// reste du code — y compris le contenu des chaînes, template literals
// (${...} traité comme du code, récursivement, pas comme du texte figé) et
// littéraux regex, qui peuvent tous contenir un `//` ou un `/*` sans être
// des commentaires. Une première version naïve (un simple
// `line.replace(/\/\/.*$/, '')`) coupait tout ce qui suit un littéral
// regex terminé par un slash échappé (ex. `/^\//` dans
// frontend/common.js:29) — trouvé par relecture adverse sur cette même PR,
// vérifié avec un `alert()` réintroduit juste après ce motif : le test
// passait à tort. Un vrai scanner caractère par caractère, pas un grep,
// est nécessaire pour ne pas se faire piéger de la même façon deux fois.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastSignificant = '';
  const isRegexContext = (ch) => ch === '' || !/[\w$)\]]/.test(ch);

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        i++;
      }
      out += src[i] || '';
      i++;
      lastSignificant = quote;
      continue;
    }
    if (c === '`') {
      // Template literal : ${...} est du vrai code (peut contenir un appel
      // réel), pas du texte à préserver tel quel — profondeur de {} suivie
      // pour savoir où il se termine, y compris s'il contient lui-même des
      // accolades (objet littéral dans l'expression).
      out += c;
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (depth === 0 && src[i] === '`') { out += '`'; i++; break; }
        if (depth === 0 && src[i] === '$' && src[i + 1] === '{') { out += '${'; i += 2; depth = 1; continue; }
        if (depth > 0 && src[i] === '{') depth++;
        else if (depth > 0 && src[i] === '}') depth--;
        out += src[i];
        i++;
      }
      lastSignificant = '`';
      continue;
    }
    if (c === '/' && isRegexContext(lastSignificant)) {
      const start = i;
      out += c;
      i++;
      let inClass = false;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === '\n') break; // pas un littéral regex valide : abandonner l'hypothèse
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { out += '/'; i++; closed = true; break; }
        out += src[i];
        i++;
      }
      if (!closed) {
        // Faux positif (ex. division) : revenir en arrière, traiter comme code normal.
        out = out.slice(0, out.length - (i - start));
        i = start;
        out += c;
        i++;
        lastSignificant = c;
        continue;
      }
      while (i < n && /[a-z]/i.test(src[i])) { out += src[i]; i++; }
      lastSignificant = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out;
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

// Régression trouvée par relecture adverse (PR #89) : un littéral regex
// terminé par un slash échappé (ex. `/^\//`) ne doit pas être confondu avec
// l'ouverture d'un commentaire de ligne — sinon tout ce qui suit sur la
// même ligne, y compris un vrai alert(), disparaît silencieusement.
test('un vrai appel après un littéral regex terminé par /\\// reste détecté', () => {
  const src = "const p = String(path).replace(/^\\//, '').split('?')[0]; alert('debug ' + p);";
  const code = stripComments(src);
  assert.match(code, /\balert\s*\(/, 'le alert() après le littéral regex doit survivre au strip');
});

test('une division n\'est pas confondue avec un littéral regex ou un commentaire', () => {
  const src = 'const ratio = a / b / c; // pas un commentaire avant ce point-ci\nconst x = alert;';
  const code = stripComments(src);
  assert.ok(code.includes('const ratio = a / b / c;'), 'la division doit rester intacte');
  assert.ok(!code.includes('pas un commentaire'), 'le vrai commentaire de fin de ligne doit disparaître');
});

test('${...} dans un template literal est traité comme du code réel, pas du texte figé', () => {
  const src = 'const msg = `Erreur : ${alert(\'x\')}`;';
  const code = stripComments(src);
  assert.match(code, /\balert\s*\(/, 'un appel réel dans ${...} doit être détecté, pas caché par le template');
});

// Régression trouvée indépendamment par la revue-personas (persona
// développeur/testeur QA, PR #89) : plusieurs fichiers de frontend/
// contiennent des URL en dur (https://...) — un `//` à l'intérieur d'une
// chaîne ne doit jamais être confondu avec un commentaire de ligne.
test('un vrai appel après une chaîne contenant une URL (//) sur la même ligne reste détecté', () => {
  const src = "const url = 'https://exemple.com'; if (bug) alert('faux négatif');";
  const code = stripComments(src);
  assert.match(code, /\balert\s*\(/, 'le alert() après l\'URL en chaîne doit survivre au strip');
});

test('un vrai commentaire contenant un slash de regex ne casse pas le strip qui suit', () => {
  const src = "// voir /^\\d+$/ pour le motif\nconst x = alert;";
  const code = stripComments(src);
  assert.ok(!code.includes('voir'), 'le commentaire doit disparaître entièrement');
  assert.ok(code.includes('const x = alert;'), 'le code après doit rester');
});
