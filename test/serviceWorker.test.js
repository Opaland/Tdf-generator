'use strict';
// Story 42.2 : le service worker ne relaie que les requêtes de son origine.
// Relayées par fetch() dans le worker, les tuiles IGN et OSM tombaient sous
// la CSP du worker (connect-src 'self') : 0 tuile sur 15 avec le worker
// actif, 15 sur 15 sans (Playwright, 25/11/2026). Le test exécute sw.js dans
// un faux contexte de worker et compte les appels à respondWith.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');
const assert = require('node:assert');

function loadWorker() {
  const listeners = {};
  const ctx = {
    self: { location: { origin: 'https://app.example' }, skipWaiting() {}, clients: { claim: async () => {} } },
    fetch: async () => 'réponse',
    URL,
  };
  ctx.self.addEventListener = (type, fn) => { listeners[type] = fn; };
  ctx.addEventListener = ctx.self.addEventListener;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'sw.js'), 'utf8'), ctx);
  return listeners;
}

function fire(listeners, url) {
  let responded = false;
  listeners.fetch({ request: { url }, respondWith() { responded = true; } });
  return responded;
}

test('sw.js relaie les requêtes de son origine', () => {
  assert.strictEqual(fire(loadWorker(), 'https://app.example/api/status'), true);
});

test('sw.js laisse au navigateur les tuiles et toute requête d’une autre origine', () => {
  const l = loadWorker();
  for (const url of ['https://tile.openstreetmap.org/5/16/11.png', 'https://data.geopf.fr/wmts?SERVICE=WMTS']) {
    assert.strictEqual(fire(l, url), false, url);
  }
});
