'use strict';
// pipeline/diagnostic.js : sondes de connectivité extraites de
// GET /api/diagnostic (backend/server.js) pour être réutilisables hors d'une
// requête HTTP — notamment par scripts/demo.js --online (Chantier L, "CI de
// vérification croisée périodique"). test/diagnosticParallel.test.js couvre
// déjà le comportement via la route HTTP (parallélisme, ordre des résultats)
// ; ce fichier teste le module directement, pour que ce contrat survive même
// si la route est un jour refactorée ou retirée.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-diagnostic-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');

const { runDiagnostic } = require('../pipeline/diagnostic');

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

// Trouvaille en écrivant ce fichier : le timer d'abandon (8 s) n'était
// annulé qu'après un fetch() réussi, jamais dans un `finally` — un fetch qui
// rejette (hôte injoignable, DNS) sautait droit au `catch` sans jamais
// atteindre `clearTimeout`, laissant le timer armé (observé : ~8 s de trop
// par sonde en échec immédiat, ce fichier de test entier passait de <1 s à
// ~8 s). Vérifié en comptant les appels réels à clearTimeout, pas seulement
// le temps d'exécution (fragile, dépend de la charge machine).
test('runDiagnostic() : le timer d\'abandon est bien annulé même quand fetch() rejette immédiatement (pas de fuite)', async () => {
  const realFetch = global.fetch;
  const realClearTimeout = global.clearTimeout;
  const realSetTimeout = global.setTimeout;
  let armed = 0;
  let cleared = 0;
  global.setTimeout = (...args) => { armed++; return realSetTimeout(...args); };
  global.clearTimeout = (...args) => { cleared++; return realClearTimeout(...args); };
  global.fetch = async () => { throw new Error('rejet immédiat (simulation de test)'); };
  try {
    await runDiagnostic();
    assert.strictEqual(armed, 7, 'un timer d\'abandon par sonde');
    assert.strictEqual(cleared, armed, 'chaque timer armé doit être annulé, même sur un fetch() qui rejette');
  } finally {
    global.fetch = realFetch;
    global.clearTimeout = realClearTimeout;
    global.setTimeout = realSetTimeout;
  }
});

test('runDiagnostic() : 7 hôtes, tous en échec → allOk false, chaque résultat garde name/ok/detail/ms', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('réseau coupé (simulation de test)'); };
  try {
    const { allOk, results } = await runDiagnostic();
    assert.strictEqual(allOk, false);
    assert.strictEqual(results.length, 7);
    for (const r of results) {
      assert.strictEqual(r.ok, false);
      assert.match(r.detail, /réseau coupé/);
      assert.strictEqual(typeof r.ms, 'number');
    }
  } finally {
    global.fetch = realFetch;
  }
});

test('runDiagnostic() : tous les hôtes répondent correctement → allOk true', async () => {
  const realFetch = global.fetch;
  const BODIES = {
    'data.geopf.fr/geocodage': { features: [{}] },
    'data.geopf.fr/altimetrie': { elevations: [{ z: 100 }] },
    'brouter.de': { type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [[0, 0, 0], [1, 1, 1]] }, properties: { 'track-length': '1000' } }] }, // chaîne, pas un nombre (vérifié en direct, issue #169)
    'router.project-osrm.org': { code: 'Ok' },
    'nominatim.openstreetmap.org': [{}],
    'api.opentopodata.org': { status: 'OK' },
    'en.wikipedia.org': { title: 'Tour de France' },
  };
  global.fetch = async (url) => {
    const key = Object.keys(BODIES).find((h) => String(url).includes(h));
    assert.ok(key, `URL non simulée par ce test : ${url}`);
    return { ok: true, status: 200, text: async () => JSON.stringify(BODIES[key]) };
  };
  try {
    const { allOk, results } = await runDiagnostic();
    assert.strictEqual(allOk, true);
    assert.ok(results.every((r) => r.ok));
  } finally {
    global.fetch = realFetch;
  }
});

test('runDiagnostic() : une réponse HTTP 200 mais au contenu inattendu (check() échoue) compte comme un échec', async () => {
  const realFetch = global.fetch;
  // Wikipédia répond 200 mais sans le champ `title` attendu — simule une
  // page d'erreur ou une évolution de l'API qui casserait le check() sans
  // que le statut HTTP seul ne le révèle.
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ pas_de_titre: true }) });
  try {
    const { allOk, results } = await runDiagnostic();
    assert.strictEqual(allOk, false);
    assert.ok(results.every((r) => r.ok === false));
    assert.match(results.find((r) => r.name.includes('Wikipédia')).detail, /réponse inattendue/);
  } finally {
    global.fetch = realFetch;
  }
});
