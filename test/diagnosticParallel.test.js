'use strict';
// Revue de code globale de fin de session : GET /api/diagnostic enchaînait
// ses 6 sondes de connectivité (Géoplateforme géocodage/altimétrie, OSRM,
// Nominatim, opentopodata, Wikipédia — 6 hôtes indépendants, chacun avec son
// propre timeout de 8 s) en série (`results.push(await probe(...))`) au lieu
// de les lancer en parallèle — un seul service lent ajoutait son délai
// complet au total plutôt que d'être masqué par les autres, jusqu'à ~48 s
// pour une page censée être un diagnostic rapide. Passé à `Promise.all`.
//
// Vérifie deux choses que seul un vrai timing peut prouver (une simple
// vérification du JSON retourné passerait aussi bien avec l'ancien code
// séquentiel) :
//  1. le temps total est borné par le plus lent des 6 délais simulés, pas
//     leur somme ;
//  2. l'ordre des résultats dans le tableau reste l'ordre fixe attendu
//     (Géoplateforme géocodage, Géoplateforme altimétrie, OSRM, Nominatim,
//     opentopodata, Wikipédia) même quand les délais simulés les font
//     résoudre dans l'ordre exactement inverse — `Promise.all` préserve
//     l'ordre du tableau d'entrée, pas l'ordre de résolution.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-diagnostic-parallel-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Délais volontairement décroissants dans l'ordre du tableau de probes côté
// serveur (le premier hôte sondé est le plus lent à répondre, le dernier le
// plus rapide) : si l'ordre des résultats suivait l'ordre de RÉSOLUTION
// plutôt que l'ordre du tableau d'entrée, ce test le détecterait (le premier
// résultat ne serait plus Géoplateforme géocodage).
const HOST_DELAYS = [
  { host: 'data.geopf.fr/geocodage', delayMs: 220, body: { features: [{}] } },
  { host: 'data.geopf.fr/altimetrie', delayMs: 180, body: { elevations: [{ z: 100 }] } },
  { host: 'router.project-osrm.org', delayMs: 140, body: { code: 'Ok' } },
  { host: 'nominatim.openstreetmap.org', delayMs: 100, body: [{}] },
  { host: 'api.opentopodata.org', delayMs: 60, body: { status: 'OK' } },
  { host: 'en.wikipedia.org', delayMs: 20, body: { title: 'Tour de France' } },
];
const EXPECTED_ORDER = [
  'Géoplateforme — géocodage',
  'Géoplateforme — altimétrie (RGE ALTI)',
  'OSRM — routage',
  'Nominatim — géocodage hors France',
  'opentopodata — altimétrie hors France',
  'Wikipédia — archives',
];

let appServer;
let base;
let realFetch;

before(async () => {
  realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const entry = HOST_DELAYS.find((h) => String(url).includes(h.host));
    // Ne simule que les 6 hôtes du diagnostic ; tout le reste (dont les
    // requêtes de test vers le serveur local 127.0.0.1) passe par le vrai fetch.
    if (!entry) return realFetch(url, opts);
    await new Promise((r) => setTimeout(r, entry.delayMs));
    if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: true, status: 200, text: async () => JSON.stringify(entry.body) };
  };

  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  global.fetch = realFetch;
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/diagnostic : les 6 sondes tournent en parallèle (temps borné par la plus lente, pas leur somme)', async () => {
  const sumOfDelays = HOST_DELAYS.reduce((a, h) => a + h.delayMs, 0); // 720 ms si séquentiel
  const maxDelay = Math.max(...HOST_DELAYS.map((h) => h.delayMs)); // 220 ms si parallèle

  const t0 = Date.now();
  const res = await fetch(`${base}/api/diagnostic`);
  const elapsedMs = Date.now() - t0;
  assert.strictEqual(res.status, 200);

  assert.ok(
    elapsedMs < sumOfDelays * 0.6,
    `temps total ${elapsedMs} ms trop proche de la somme séquentielle (${sumOfDelays} ms) — les sondes ne tournent probablement pas en parallèle`
  );
  assert.ok(
    elapsedMs >= maxDelay,
    `temps total ${elapsedMs} ms plus court que la sonde la plus lente (${maxDelay} ms) — résultat suspect`
  );
});

test('GET /api/diagnostic : l\'ordre des résultats suit l\'ordre du tableau de probes, pas l\'ordre de résolution', async () => {
  const { results } = await (await fetch(`${base}/api/diagnostic`)).json();
  assert.deepStrictEqual(results.map((r) => r.name), EXPECTED_ORDER);
  // Les délais simulés sont décroissants dans cet ordre (220 ms → 20 ms) :
  // si l'ordre suivait la résolution, Wikipédia (20 ms) serait en tête.
  assert.ok(results.every((r) => r.ok), `toutes les sondes doivent réussir avec les réponses simulées : ${JSON.stringify(results)}`);
});
