'use strict';
// Intègre scripts/demo.js (démo de validation, mode hors-ligne) à `npm test` —
// item de backlog issue #10, section F : jusqu'ici seule la CI l'exécutait
// séparément (`npm run demo`), la rendant moins visible dans le harness de
// test standard. scripts/demo-2027.js n'est PAS inclus ici : il nécessite
// --online (aucune couverture Royaume-Uni/Italie dans le simulateur), donc
// reste hors de npm test par nature (voir son propre en-tête).

const os = require('os');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

test('scripts/demo.js (hors-ligne) : 10/10 vérifications OK', () => {
  const dataDir = path.join(os.tmpdir(), `etapeforge-demo-test-${process.pid}`);
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'demo.js')], {
    env: { ...process.env, ETAPEFORGE_DATA_DIR: dataDir, ETAPEFORGE_OFFLINE: '1' },
    encoding: 'utf8',
  });
  assert.match(out, /Bilan : 10\/10 vérifications OK/);
  require('fs').rmSync(dataDir, { recursive: true, force: true });
});
