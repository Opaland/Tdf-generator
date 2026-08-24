'use strict';
// Régression (revue globale de fin de cycle) : un audit de sécurité dédié a
// trouvé 4 appels L.marker/L.polyline.bindPopup()/bindTooltip() qui
// interpolaient un champ texte libre attaquable (waypoint.label,
// segment.reason, stage.date/stage_type) SANS EF.esc(), alors que le même
// champ était correctement échappé quelques lignes plus loin dans le même
// fichier (frontend/tourmap.js:21 échappait s.name mais pas s.date/
// s.stage_type juste en dessous ; frontend/stage.js échappait seg.reason
// dans un attribut title= mais pas dans le bindTooltip() du même segment).
// Exactement le pattern que CLAUDE.md règle 1 met en garde : corriger le
// vecteur trouvé (l'ancienne XSS de backend/exports.js) n'a jamais couvert
// ce vecteur-ci (Leaflet écrit aussi via innerHTML en interne :
// node_modules/leaflet/dist/leaflet-src.js, `_contentNode.innerHTML =
// content`), parce que personne n'avait jamais vérifié cette couche.
//
// Verrouille la classe entière plutôt que les 4 lignes trouvées : parseur
// JS réel (espree, même approche que test/noNativeDialogs.test.js — un
// regex confondrait trivialement une chaîne contenant "label" avec un accès
// de propriété) qui repère tout bindPopup()/bindTooltip() de frontend/*.js
// interpolant un champ texte libre connu sans passer par EF.esc().

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// Champs texte libre réellement écrivables via l'API (waypoint.label,
// stage.date/stage_type/status/note, climb/descent.name — qui vient
// directement de waypoint.label, pipeline/climbs.js `c.name = summitWp.label`)
// — pas stage.id/edition.year (entiers imposés côté serveur) ni
// climb.category/stage.state (petits ensembles littéraux écrits par du code
// serveur, jamais par une requête).
const RISKY_PROPS = new Set(['label', 'reason', 'name', 'date', 'stage_type', 'status', 'note']);

function isEscCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'EF' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'esc'
  );
}

/** Repère chaque accès `x.label`/`x.reason`/... (non échappé) atteignable dans le sous-arbre. */
function findUnescapedRiskyAccess(node, found) {
  if (!node || typeof node.type !== 'string') return;
  if (isEscCall(node)) return; // déjà échappé — ne pas descendre dans ses arguments
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    RISKY_PROPS.has(node.property.name)
  ) {
    found.push({ prop: node.property.name, line: node.loc.start.line });
  }
  for (const key in node) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const val = node[key];
    if (Array.isArray(val)) val.forEach((v) => findUnescapedRiskyAccess(v, found));
    else if (val && typeof val.type === 'string') findUnescapedRiskyAccess(val, found);
  }
}

// name -> corps de la fonction, pour résoudre bindPopup(stagePopupHtml(st))
// vers la fonction locale plutôt que de traiter l'appel comme opaque. Les
// deux formes de déclaration au niveau fichier sont indexées : la classique
// (`function f(x) {...}`) ET la fonction fléchée assignée à une const
// (`const f = (x) => ...`), tout aussi courante dans ce code — un test qui
// n'en résolvait qu'une seule aurait un angle mort dormant à la prochaine
// refactorisation de style (trouvaille de relecture adverse, reproduite en
// transformant stagePopupHtml() en arrow function tout en réintroduisant la
// régression : le test passait à tort avant ce correctif).
function collectTopLevelFns(ast) {
  const fns = new Map();
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      fns.set(stmt.id.name, stmt.body);
    } else if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (
          decl.id.type === 'Identifier' &&
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')
        ) {
          fns.set(decl.id.name, decl.init.body);
        }
      }
    }
  }
  return fns;
}

/** [{prop, line}] pour chaque bindPopup()/bindTooltip() du source qui interpole un champ risqué sans EF.esc(). */
function findUnsafeBindCalls(src, topLevelFns) {
  const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', loc: true });
  const fns = topLevelFns || collectTopLevelFns(ast);
  const offenders = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property.type === 'Identifier' &&
      (node.callee.property.name === 'bindPopup' || node.callee.property.name === 'bindTooltip') &&
      node.arguments.length
    ) {
      let target = node.arguments[0];
      if (target.type === 'CallExpression' && target.callee.type === 'Identifier' && fns.has(target.callee.name)) {
        target = fns.get(target.callee.name);
      }
      const found = [];
      findUnescapedRiskyAccess(target, found);
      for (const f of found) offenders.push({ method: node.callee.property.name, prop: f.prop, line: f.line });
    }
    for (const key in node) {
      if (key === 'loc' || key === 'range' || key === 'parent') continue;
      const val = node[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val.type === 'string') walk(val);
    }
  })(ast);
  return offenders;
}

function analyzeFile(file) {
  const src = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
  const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'script', loc: true });
  return findUnsafeBindCalls(src, collectTopLevelFns(ast)).map(
    (o) => `${file}:${o.line} — .${o.method}() interpole .${o.prop} sans EF.esc()`
  );
}

function jsFiles() {
  return fs.readdirSync(FRONTEND_DIR).filter((f) => f.endsWith('.js'));
}

test('aucun bindPopup()/bindTooltip() de frontend/*.js n\'interpole un champ texte libre sans EF.esc()', () => {
  const offenders = jsFiles().flatMap(analyzeFile);
  assert.deepStrictEqual(offenders, [], `bindPopup()/bindTooltip() non échappé(s) — ${offenders.join(' ; ')}`);
});

test('le test est discriminant : un bindTooltip non échappé sur un champ risqué est bien détecté', () => {
  const offenders = findUnsafeBindCalls('L.marker([0,0]).bindTooltip(`${w.label}`).addTo(map);');
  assert.strictEqual(offenders.length, 1);
  assert.strictEqual(offenders[0].prop, 'label');
});

test('le test ne signale pas un bindTooltip déjà échappé (pas de faux positif)', () => {
  const offenders = findUnsafeBindCalls('L.marker([0,0]).bindTooltip(`${EF.esc(w.label)}`).addTo(map);');
  assert.deepStrictEqual(offenders, []);
});

test('le test résout un bindPopup(fn(x)) vers une function déclarée classique (function f(x){...})', () => {
  const offenders = findUnsafeBindCalls(
    "function popupHtml(s) { return `<b>${s.name}</b>`; } line.bindPopup(popupHtml(st));"
  );
  assert.strictEqual(offenders.length, 1);
  assert.strictEqual(offenders[0].prop, 'name');
});

// Angle mort trouvé par relecture adverse : la première version ne résolvait
// que les FunctionDeclaration, jamais une fonction fléchée assignée à une
// const — reproduit concrètement en transformant tourmap.js:stagePopupHtml()
// en `const stagePopupHtml = (st) => {...}` tout en réintroduisant la
// régression exacte (s.date/s.stage_type non échappés) : le test passait à
// tort (0 trouvaille). Verrouillé ici pour ne pas le perdre si le fichier
// réel passe un jour à ce style, courant dans le reste du dépôt.
test('le test résout un bindPopup(fn(x)) vers une fonction fléchée assignée (const f = (x) => {...})', () => {
  const offenders = findUnsafeBindCalls(
    "const popupHtml = (s) => { return `<b>${s.name}</b>`; }; line.bindPopup(popupHtml(st));"
  );
  assert.strictEqual(offenders.length, 1);
  assert.strictEqual(offenders[0].prop, 'name');
});

test('le test résout un bindPopup(fn(x)) vers une fonction fléchée à corps expression (const f = (x) => `...`)', () => {
  const offenders = findUnsafeBindCalls('const popupHtml = (s) => `<b>${s.name}</b>`; line.bindPopup(popupHtml(st));');
  assert.strictEqual(offenders.length, 1);
  assert.strictEqual(offenders[0].prop, 'name');
});
