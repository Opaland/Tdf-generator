'use strict';
// Story 42.1 (issue #568) : Dependabot suit les trois écosystèmes du dépôt.
// Lecture textuelle du YAML (pas de dépendance d'analyse) : chaque bloc
// « - package-ecosystem: » est découpé et contrôlé séparément.
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const FILE = path.join(__dirname, '..', '.github', 'dependabot.yml');

function blocks() {
  const text = fs.readFileSync(FILE, 'utf8');
  assert.match(text, /^version:\s*2\s*$/m, 'version: 2 attendue');
  return text.split(/^\s*-\s+package-ecosystem:\s*/m).slice(1).map((b) => {
    const eco = b.split(/\s/)[0].replace(/["']/g, '');
    return { eco, body: b };
  });
}

test('dependabot.yml existe et suit npm, les actions GitHub et Docker', () => {
  assert.ok(fs.existsSync(FILE), '.github/dependabot.yml manquant');
  const ecos = blocks().map((b) => b.eco).sort();
  assert.deepStrictEqual(ecos, ['docker', 'github-actions', 'npm']);
});

test('chaque écosystème : racine du dépôt, rythme mensuel, une PR groupée', () => {
  for (const { eco, body } of blocks()) {
    assert.match(body, /directory:\s*["']?\/["']?\s*$/m, `${eco} : directory "/" attendu`);
    assert.match(body, /interval:\s*["']?monthly["']?\s*$/m, `${eco} : rythme mensuel attendu`);
    assert.match(body, /^\s*groups:\s*$/m, `${eco} : mises à jour groupées attendues`);
  }
});

test('npm : les versions majeures restent à la main', () => {
  const npm = blocks().find((b) => b.eco === 'npm');
  assert.match(npm.body, /update-types:\s*\[\s*["']version-update:semver-major["']\s*\]/);
});
