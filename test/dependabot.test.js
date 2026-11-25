'use strict';
// Story 42.1 (issue #568) : Dependabot suit les trois écosystèmes du dépôt.
// Lecture textuelle du YAML (pas de dépendance d'analyse), mais liée à
// l'indentation et sans les lignes commentées : une clé commentée, mal
// placée (interval hors de schedule) ou un groupe vide ne passent pas
// (relecture adverse du 25/11/2026).
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const FILE = path.join(__dirname, '..', '.github', 'dependabot.yml');

function blocks() {
  const text = fs.readFileSync(FILE, 'utf8')
    .split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');
  assert.match(text, /^version: 2$/m, 'version: 2 attendue');
  assert.match(text, /^updates:$/m, 'updates: attendu');
  return text.split(/^ {2}- package-ecosystem: /m).slice(1).map((b) => {
    const eco = b.split('\n')[0].replace(/["'\s]/g, '');
    return { eco, body: b };
  });
}

const STAR = String.raw`\[\s*"\*"\s*\]`;
const MAJOR = String.raw`\[\s*"version-update:semver-major"\s*\]`;

test('dependabot.yml existe et suit npm, les actions GitHub et Docker', () => {
  assert.ok(fs.existsSync(FILE), '.github/dependabot.yml manquant');
  const ecos = blocks().map((b) => b.eco).sort();
  assert.deepStrictEqual(ecos, ['docker', 'github-actions', 'npm']);
});

test('chaque écosystème : racine du dépôt, rythme mensuel, une PR groupée sur tout', () => {
  for (const { eco, body } of blocks()) {
    assert.match(body, /^ {4}directory: "\/"$/m, `${eco} : directory "/" attendu`);
    assert.match(body, /^ {4}schedule:\n {6}interval: "monthly"$/m, `${eco} : schedule.interval mensuel attendu`);
    assert.match(body, new RegExp(String.raw`^ {4}groups:\n {6}[\w-]+:\n {8}patterns: ${STAR}$`, 'm'),
      `${eco} : un groupe avec patterns ["*"] attendu`);
  }
});

test('npm et Docker : les versions majeures restent à la main', () => {
  for (const eco of ['npm', 'docker']) {
    const b = blocks().find((x) => x.eco === eco);
    assert.match(b.body, new RegExp(String.raw`^ {4}ignore:\n {6}- dependency-name: "\*"\n {8}update-types: ${MAJOR}$`, 'm'),
      `${eco} : ignore des majeures attendu`);
  }
});
