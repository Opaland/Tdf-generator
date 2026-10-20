'use strict';
// Epic 35.20 (revue globale du 19/10/2026) : le rang des catégories de côte
// existait en quatre copies et esc() en trois côté Node — dont une (site
// statique, scripts/build-site.js) qui n'échappait pas « " ». Une seule
// source par couche, et les deux couches gardées identiques.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));

test('rang des catégories : une table côté Node, une côté navigateur, identiques', () => {
  const { CATEGORY_RANK } = require('../pipeline/climbs');
  assert.strictEqual(require('../backend/apiHelpers').CLIMB_CATEGORY_RANK, CATEGORY_RANK);
  const EFProfile = require('../frontend/profile.js');
  assert.deepStrictEqual({ ...EFProfile.CAT_RANK }, { ...CATEGORY_RANK });
  // Clés avec ou sans guillemets (relecture adverse : `'1': 4` échappait à
  // la première version de ce motif).
  const k = (n) => `['"]?${n}['"]?`;
  const literal = new RegExp(`\\{\\s*${k('HC')}:\\s*5,\\s*${k(1)}:\\s*4,\\s*${k(2)}:\\s*3,\\s*${k(3)}:\\s*2,\\s*${k(4)}:\\s*1\\s*\\}`);
  const copies = ['frontend', 'backend', 'backend/routes', 'pipeline', 'scripts']
    .flatMap(files)
    .filter((f) => literal.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  // pipeline/pain.js : barème de points de l'indice de douleur, mêmes valeurs
  // aujourd'hui mais pondération propre (documentée là-bas), pas un rang.
  assert.deepStrictEqual(copies.sort(), ['frontend/profile.js', 'pipeline/climbs.js', 'pipeline/pain.js']);
});

test('esc() côté Node : une seule définition, qui échappe aussi « " »', () => {
  const { esc } = require('../backend/exports');
  assert.strictEqual(esc('a"<b>&'), 'a&quot;&lt;b&gt;&amp;');
  const defs = ['backend', 'backend/routes', 'pipeline', 'scripts']
    .flatMap(files)
    .filter((f) => /^function esc\(/m.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepStrictEqual(defs, ['backend/exports.js']);
});
