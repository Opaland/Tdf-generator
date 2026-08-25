'use strict';
// Régression (relecture adverse du correctif backlog #66) : ajouter un
// timeout par défaut à EF.api() a cassé /api/diagnostic — 6 services
// externes sondés en séquence côté serveur (backend/server.js), 8 s chacun,
// pire cas ~48 s, largement au-delà du délai par défaut pensé pour un appel
// local. Reproduit empiriquement par la relecture adverse (serveur réel,
// hôtes externes simulés injoignables) : le client affichait « le serveur
// ne répond pas » après 20 s alors que le serveur travaillait encore à 25 s.
// /api/suunto/import (même famille : jeton OAuth + téléchargement FIT
// externe) manquait la même extension par analogie structurelle.
//
// Verrouille l'invariant plutôt que les 2 lignes trouvées : toute route
// connue pour faire un aller-retour réseau externe côté serveur doit être
// appelée avec un timeoutMs étendu — un vrai parseur JS (espree, même
// approche que test/noNativeDialogs.test.js) plutôt qu'un grep, pour ne pas
// se faire piéger par un `EF.api('/api/diagnostic')` en commentaire ou dans
// une chaîne non liée à un appel réel.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const MIN_EXTENDED_TIMEOUT_MS = 60000;

// Routes dont le handler serveur (backend/server.js, backend/suunto.js) fait
// lui-même un aller-retour réseau externe avant de répondre — le délai par
// défaut d'EF.api() (pensé pour un appel local) ne leur suffit pas.
const SLOW_ROUTES = new Set(['/api/diagnostic', '/api/editions/import', '/api/import/link', '/api/suunto/import']);

/** [{route, line, timeoutMs}] pour chaque appel EF.api(route, opts) du source, route ∈ SLOW_ROUTES. */
function findSlowRouteCalls(src) {
  const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', loc: true });
  const found = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === 'EF' &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'api' &&
      node.arguments.length &&
      node.arguments[0].type === 'Literal' &&
      SLOW_ROUTES.has(node.arguments[0].value)
    ) {
      const optsArg = node.arguments[1];
      let timeoutMs = null;
      if (optsArg && optsArg.type === 'ObjectExpression') {
        const prop = optsArg.properties.find(
          (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'timeoutMs'
        );
        if (prop && prop.value.type === 'Literal' && typeof prop.value.value === 'number') timeoutMs = prop.value.value;
      }
      found.push({ route: node.arguments[0].value, line: node.loc.start.line, timeoutMs });
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

/** Extrait le contenu du (des) <script> inline (sans src=) d'un fichier HTML. */
function inlineScriptsOf(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const scripts = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

function allSources() {
  const sources = [];
  for (const f of fs.readdirSync(FRONTEND_DIR)) {
    const full = path.join(FRONTEND_DIR, f);
    if (f.endsWith('.js')) sources.push({ file: f, src: fs.readFileSync(full, 'utf8') });
    else if (f.endsWith('.html')) inlineScriptsOf(full).forEach((src, i) => sources.push({ file: `${f} (script ${i + 1})`, src }));
  }
  return sources;
}

test('chaque appel EF.api() vers une route qui proxy un aller-retour réseau externe a un timeoutMs étendu', () => {
  const offenders = [];
  for (const { file, src } of allSources()) {
    for (const call of findSlowRouteCalls(src)) {
      if (call.timeoutMs == null || call.timeoutMs < MIN_EXTENDED_TIMEOUT_MS) {
        offenders.push(`${file}:${call.line} — EF.api('${call.route}') timeoutMs=${call.timeoutMs} (attendu ≥ ${MIN_EXTENDED_TIMEOUT_MS})`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join(' ; '));
});

test('le test est discriminant : une route lente sans timeoutMs étendu est bien détectée', () => {
  const found = findSlowRouteCalls("EF.api('/api/diagnostic');");
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].timeoutMs, null);
});

test('le test ne signale pas une route lente correctement étendue (pas de faux positif)', () => {
  const found = findSlowRouteCalls("EF.api('/api/suunto/import', { method: 'POST', timeoutMs: 60000 });");
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].timeoutMs, 60000);
});

test('le test ignore les routes non listées comme lentes (pas de faux positif sur les appels ordinaires)', () => {
  const found = findSlowRouteCalls("EF.api('/api/stages');");
  assert.deepStrictEqual(found, []);
});
