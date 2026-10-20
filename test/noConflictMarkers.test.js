'use strict';
// Garde-fou (20/10/2026) : un `git commit -a` pendant une fusion inachevée a
// poussé un SPRINT-STATUS.md plein de marqueurs de conflit, sans qu'aucun
// test ne le voie. Aucun fichier suivi ne doit en contenir.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

test('aucun marqueur de conflit git dans les fichiers suivis', () => {
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => /\.(js|json|md|html|css|yml|yaml|sh)$/.test(f));
  const bad = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (/^(<{7}|>{7}) /m.test(text) || /^<{7}$|^>{7}$/m.test(text)) bad.push(f);
  }
  assert.deepStrictEqual(bad, []);
});
