'use strict';
// Hook de démarrage etat-deploiement.sh (issue #529) : un run en cours n'est
// pas un échec. `gh` est remplacé par un faux script en tête du PATH, dans un
// dépôt jetable — le hook ne sort jamais sur le réseau ici.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'etat-deploiement.sh').replace(/\\/g, '/');
// Sous Windows, `bash` peut être absent ou être celui de WSL, qui ne lit pas ces chemins.
const SANS_BASH = spawnSync('bash', ['-c', 'command -v jq && test -r "$0"', HOOK]).status !== 0
  && 'bash (Git Bash) ou jq absent';

let dir;

before(() => {
  if (SANS_BASH) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etat-deploiement-'));
  fs.writeFileSync(path.join(dir, 'gh'), '#!/usr/bin/env bash\nprintf \'%s\' "$FAUX_GH"\n', { mode: 0o755 });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/exemple/depot.git'], { cwd: dir });
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function contexte(runs) {
  const sortie = execFileSync('bash', [HOOK], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FAUX_GH: JSON.stringify(runs), PATH: dir + path.delimiter + process.env.PATH },
  });
  return JSON.parse(sortie).hookSpecificOutput.additionalContext;
}

test('un run en cours (conclusion vide) n\'annonce pas main en échec', { skip: SANS_BASH }, () => {
  const texte = contexte([{ name: 'Surveillance', conclusion: '' }, { name: 'CI', conclusion: 'success' }]);
  assert.strictEqual(texte, 'État de main : Surveillance: en cours · CI: success');
});

test('un vrai échec reste annoncé, même à côté d\'un run en cours', { skip: SANS_BASH }, () => {
  const texte = contexte([{ name: 'Surveillance', conclusion: '' }, { name: 'CI', conclusion: 'failure' }]);
  assert.match(texte, /^⚠ main EN ÉCHEC — Surveillance: en cours · CI: failure\./);
});
