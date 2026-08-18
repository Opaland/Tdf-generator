'use strict';
// Cache SQLite des appels externes. Clé = sha256 de la requête normalisée :
// on ne géocode et n'échantillonne jamais deux fois la même chose.

const crypto = require('crypto');
const { getDb } = require('../backend/db');

const TABLES = {
  geocode: 'geocode_cache',
  elevation: 'elevation_cache',
  api: 'api_cache',
};

function cacheKey(provider, request) {
  const normalized = JSON.stringify({ provider, request });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function tableFor(kind) {
  const t = TABLES[kind];
  if (!t) throw new Error(`Cache inconnu : ${kind}`);
  return t;
}

function cacheGet(kind, provider, request) {
  const db = getDb();
  const key = cacheKey(provider, request);
  const row = db.prepare(`SELECT response FROM ${tableFor(kind)} WHERE key = ?`).get(key);
  return row ? JSON.parse(row.response) : undefined;
}

function cachePut(kind, provider, request, response) {
  const db = getDb();
  const key = cacheKey(provider, request);
  db.prepare(
    `INSERT OR REPLACE INTO ${tableFor(kind)} (key, provider, request, response) VALUES (?, ?, ?, ?)`
  ).run(key, provider, JSON.stringify(request), JSON.stringify(response));
  return response;
}

/** Passe-par-cache : retourne la valeur en cache ou exécute fn() et mémorise. */
async function cached(kind, provider, request, fn) {
  const hit = cacheGet(kind, provider, request);
  if (hit !== undefined) return { value: hit, cached: true };
  const value = await fn();
  cachePut(kind, provider, request, value);
  return { value, cached: false };
}

module.exports = { cacheKey, cacheGet, cachePut, cached };
