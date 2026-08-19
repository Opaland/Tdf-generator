'use strict';
// Tests du TTL/purge du cache SQLite (pipeline/cache.js) — item de backlog
// issue #10, section F : le cache mémorisait indéfiniment sans expiration.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-cache-test-${process.pid}`);
process.env.ETAPEFORGE_CACHE_TTL_DAYS = '1'; // TTL court pour tester sans attendre 180 jours

const { test, after } = require('node:test');
const assert = require('node:assert');
const { getDb } = require('../backend/db');
const { cacheGet, cachePut, purgeExpiredCache, cacheKey } = require('../pipeline/cache');

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function backdate(table, key, daysAgo) {
  const db = getDb();
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`UPDATE ${table} SET created_at = ? WHERE key = ?`).run(ts, key);
}

test('une entrée fraîche est bien servie par le cache', () => {
  cachePut('geocode', 'test', { q: 'Paris' }, { lat: 48.85, lon: 2.35 });
  const hit = cacheGet('geocode', 'test', { q: 'Paris' });
  assert.deepStrictEqual(hit, { lat: 48.85, lon: 2.35 });
});

test('une entrée plus vieille que le TTL est traitée comme absente et supprimée', () => {
  cachePut('geocode', 'test', { q: 'Lyon' }, { lat: 45.76, lon: 4.83 });
  const key = cacheKey('test', { q: 'Lyon' });
  backdate('geocode_cache', key, 2); // TTL = 1 jour ici -> périmé

  assert.strictEqual(cacheGet('geocode', 'test', { q: 'Lyon' }), undefined);
  const row = getDb().prepare('SELECT * FROM geocode_cache WHERE key = ?').get(key);
  assert.strictEqual(row, undefined, 'la ligne expirée est supprimée au passage');
});

test('purgeExpiredCache supprime les entrées périmées des trois caches et compte les suppressions', () => {
  cachePut('elevation', 'test', { lat: 1, lon: 1 }, 100);
  cachePut('api', 'test', { url: '/x' }, { ok: true });
  const ek = cacheKey('test', { lat: 1, lon: 1 });
  const ak = cacheKey('test', { url: '/x' });
  backdate('elevation_cache', ek, 5);
  backdate('api_cache', ak, 5);

  cachePut('geocode', 'test', { q: 'frais' }, { lat: 0, lon: 0 }); // reste dans le TTL

  const result = purgeExpiredCache();
  assert.strictEqual(result.elevation, 1);
  assert.strictEqual(result.api, 1);
  assert.strictEqual(result.geocode, 0, 'entrée fraîche non purgée');
});
