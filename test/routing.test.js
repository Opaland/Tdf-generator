'use strict';
// Test de pipeline/routing.js — backlog issue #10, section E, "plan de
// continuité pour la dépendance aux APIs publiques" : OSRM_BASE (repli sur
// le service public si ETAPEFORGE_OSRM absente) doit rester lisible depuis
// l'extérieur du module pour que GET /api/diagnostic sonde l'instance
// réellement configurée, pas systématiquement le service public.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

test('OSRM_BASE : repli sur le service public sans ETAPEFORGE_OSRM', () => {
  const { OSRM_BASE } = require('../pipeline/routing');
  assert.strictEqual(OSRM_BASE, 'https://router.project-osrm.org');
});

test('OSRM_BASE : respecte ETAPEFORGE_OSRM (processus séparé — état de module figé au premier require, voir CLAUDE.md règle 4)', () => {
  const out = execFileSync(
    process.execPath,
    ['-e', "console.log(require('./pipeline/routing').OSRM_BASE)"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, ETAPEFORGE_OSRM: 'http://osrm-local:5000' } }
  ).toString().trim();
  assert.strictEqual(out, 'http://osrm-local:5000');
});
