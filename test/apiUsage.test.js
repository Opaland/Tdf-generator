'use strict';
// Test de pipeline/apiUsage.js — compteur de requêtes par hôte externe
// (backlog issue #10, section E : « dashboard de consommation des quotas
// API — nombre de requêtes Géoplateforme/OSRM/Nominatim consommées, pour
// rester sous les rate-limits en usage prolongé »).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { recordRequest, getUsageStats, resetUsageStats } = require('../pipeline/apiUsage');

beforeEach(() => resetUsageStats());

test('httpJson() enregistre bien chaque tentative réelle sur pipeline/apiUsage (câblage de pipeline/http.js)', async () => {
  // Mock de global.fetch scopé à un hôte de test fictif, avec repli explicite
  // en erreur pour tout autre appel — pas un mock qui intercepterait
  // silencieusement d'autres requêtes (CLAUDE.md règle 6).
  const realFetch = global.fetch;
  const HOST = 'test-quota-host.invalid';
  let calls = 0;
  global.fetch = async (url) => {
    if (new URL(String(url)).host !== HOST) throw new Error(`appel réseau non simulé par ce test : ${url}`);
    calls++;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const { httpJson } = require('../pipeline/http');
    await httpJson(`https://${HOST}/probe`, { minDelayMs: 0 });
    assert.strictEqual(calls, 1, 'le mock a bien été appelé une fois');
    const stats = getUsageStats();
    const entry = stats.find((s) => s.host === HOST);
    assert.ok(entry, 'l\'hôte apparaît dans les statistiques après un httpJson() réussi');
    assert.strictEqual(entry.count, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test('getUsageStats() : vide tant qu\'aucune requête n\'a été enregistrée', () => {
  assert.deepStrictEqual(getUsageStats(), []);
});

test('recordRequest() : incrémente le compteur du bon hôte', () => {
  recordRequest('data.geopf.fr');
  recordRequest('data.geopf.fr');
  recordRequest('router.project-osrm.org');
  const stats = getUsageStats();
  const geopf = stats.find((s) => s.host === 'data.geopf.fr');
  const osrm = stats.find((s) => s.host === 'router.project-osrm.org');
  assert.strictEqual(geopf.count, 2);
  assert.strictEqual(osrm.count, 1);
  assert.ok(geopf.firstAt && geopf.lastAt, 'horodatages présents');
});

test('getUsageStats() : trié par nombre de requêtes décroissant', () => {
  recordRequest('nominatim.openstreetmap.org');
  recordRequest('data.geopf.fr');
  recordRequest('data.geopf.fr');
  recordRequest('data.geopf.fr');
  const hosts = getUsageStats().map((s) => s.host);
  assert.deepStrictEqual(hosts, ['data.geopf.fr', 'nominatim.openstreetmap.org']);
});

test('resetUsageStats() : remet tous les compteurs à zéro', () => {
  recordRequest('data.geopf.fr');
  resetUsageStats();
  assert.deepStrictEqual(getUsageStats(), []);
});
