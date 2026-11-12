'use strict';
// Revue de code globale de fin de session : GET /api/diagnostic enchaînait
// ses sondes de connectivité (Géoplateforme géocodage/altimétrie, OSRM,
// Nominatim, opentopodata, Wikipédia — hôtes indépendants, chacun avec son
// propre timeout de 8 s) en série (`results.push(await probe(...))`) au lieu
// de les lancer en parallèle — un seul service lent ajoutait son délai
// complet au total plutôt que d'être masqué par les autres, jusqu'à ~48 s
// pour une page censée être un diagnostic rapide. Passé à `Promise.all`.
// BRouter ajouté le 31/08/2026 (issue #169) comme 7ᵉ hôte, fournisseur de
// routage désormais primaire (OSRM en repli seulement).
//
// Vérifie deux choses qu'une simple vérification du JSON retourné ne
// prouverait pas (elle passerait aussi bien avec l'ancien code séquentiel) :
//  1. les 7 requêtes sont en cours en même temps : le faux fetch compte les
//     requêtes simultanées (7 en parallèle, 1 en série). Ce n'est plus un
//     seuil de temps : l'ancienne version (temps total < 0,6 × la somme des
//     délais) a échoué sur un runner de CI chargé alors que le code était
//     correct (840 ms mesurés, PR #579, 12/11/2026 ; story 25.4) ;
//  2. l'ordre des résultats dans le tableau reste l'ordre fixe attendu
//     (Géoplateforme géocodage, Géoplateforme altimétrie, BRouter, OSRM,
//     Nominatim, opentopodata, Wikipédia) même quand les délais simulés les
//     font résoudre dans l'ordre exactement inverse — `Promise.all` préserve
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
  { host: 'data.geopf.fr/geocodage', delayMs: 240, body: { features: [{}] } },
  { host: 'data.geopf.fr/altimetrie', delayMs: 200, body: { elevations: [{ z: 100 }] } },
  { host: 'brouter.de', delayMs: 160, body: { type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [[0, 0, 0], [1, 1, 1]] }, properties: { 'track-length': '1000' } }] } }, // chaîne, pas un nombre (vérifié en direct, issue #169)
  { host: 'router.project-osrm.org', delayMs: 120, body: { code: 'Ok' } },
  { host: 'nominatim.openstreetmap.org', delayMs: 90, body: [{}] },
  { host: 'api.opentopodata.org', delayMs: 50, body: { status: 'OK' } },
  { host: 'en.wikipedia.org', delayMs: 20, body: { title: 'Tour de France' } },
];
const EXPECTED_ORDER = [
  'Géoplateforme — géocodage',
  'Géoplateforme — altimétrie (RGE ALTI)',
  'BRouter — routage (profil vélo, primaire)',
  'OSRM — routage (profil voiture, repli seulement)',
  'Nominatim — géocodage hors France',
  'opentopodata — altimétrie hors France',
  'Wikipédia — archives',
];

let appServer;
let base;
let realFetch;
// Requêtes simulées en cours, et leur maximum simultané.
let inFlight = 0;
let maxInFlight = 0;

before(async () => {
  realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const entry = HOST_DELAYS.find((h) => String(url).includes(h.host));
    // Ne simule que les 7 hôtes du diagnostic ; tout le reste (dont les
    // requêtes de test vers le serveur local 127.0.0.1) passe par le vrai fetch.
    if (!entry) return realFetch(url, opts);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, entry.delayMs));
    } finally {
      inFlight--;
    }
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
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/diagnostic : les 7 sondes tournent en parallèle (toutes en cours en même temps, pas l\'une après l\'autre)', async () => {
  const maxDelay = Math.max(...HOST_DELAYS.map((h) => h.delayMs)); // 240 ms
  inFlight = 0;
  maxInFlight = 0;

  const t0 = Date.now();
  const res = await fetch(`${base}/api/diagnostic`);
  const elapsedMs = Date.now() - t0;
  assert.strictEqual(res.status, 200);

  // Toutes les sondes partent avant qu'aucune ne réponde : 7 requêtes en
  // cours en même temps. Un code séquentiel n'en aurait jamais plus d'une.
  // Indépendant de la charge de la machine, contrairement à un seuil de temps.
  assert.strictEqual(
    maxInFlight,
    HOST_DELAYS.length,
    `${maxInFlight} requête(s) simultanée(s) au plus pour ${HOST_DELAYS.length} sondes — les sondes ne tournent pas en parallèle`
  );
  assert.strictEqual(inFlight, 0, 'toutes les requêtes simulées doivent être terminées');
  // Borne basse seulement (une machine lente ne peut que l'allonger) : le
  // diagnostic attend bien la plus lente des sondes.
  assert.ok(
    elapsedMs >= maxDelay,
    `temps total ${elapsedMs} ms plus court que la sonde la plus lente (${maxDelay} ms) — résultat suspect`
  );
});

test('GET /api/diagnostic : l\'ordre des résultats suit l\'ordre du tableau de probes, pas l\'ordre de résolution', async () => {
  const { results } = await (await fetch(`${base}/api/diagnostic`)).json();
  assert.deepStrictEqual(results.map((r) => r.name), EXPECTED_ORDER);
  // Les délais simulés sont décroissants dans cet ordre (240 ms → 20 ms) :
  // si l'ordre suivait la résolution, Wikipédia (20 ms) serait en tête.
  assert.ok(results.every((r) => r.ok), `toutes les sondes doivent réussir avec les réponses simulées : ${JSON.stringify(results)}`);
});
