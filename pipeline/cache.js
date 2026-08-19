'use strict';
// Cache SQLite des appels externes. Clé = sha256 de la requête normalisée :
// on ne géocode et n'échantillonne jamais deux fois la même chose.
//
// Expiration : longue par défaut (les géocodages/altimétries changent
// rarement, et le but premier du cache est d'épargner les quotas des APIs
// gratuites) mais non infinie, pour qu'une correction en amont (Wikipédia mis
// à jour, algorithme de sélection de résultat amélioré) finisse par se
// propager sans purge manuelle. Réglable via ETAPEFORGE_CACHE_TTL_DAYS.

const crypto = require('crypto');
const { getDb } = require('../backend/db');

const TABLES = {
  geocode: 'geocode_cache',
  elevation: 'elevation_cache',
  api: 'api_cache',
};

const CACHE_TTL_MS = parseInt(process.env.ETAPEFORGE_CACHE_TTL_DAYS || '180', 10) * 24 * 60 * 60 * 1000;

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
  const row = db.prepare(`SELECT response, created_at FROM ${tableFor(kind)} WHERE key = ?`).get(key);
  if (!row) return undefined;
  if (CACHE_TTL_MS > 0 && Date.now() - Date.parse(`${row.created_at}Z`) > CACHE_TTL_MS) {
    db.prepare(`DELETE FROM ${tableFor(kind)} WHERE key = ?`).run(key);
    return undefined;
  }
  return JSON.parse(row.response);
}

/** Purge manuelle des entrées expirées (les trois caches) — pour un cron/CLI de maintenance. */
function purgeExpiredCache() {
  if (CACHE_TTL_MS <= 0) return { geocode: 0, elevation: 0, api: 0 };
  const db = getDb();
  // Même format que datetime('now') de SQLite ("YYYY-MM-DD HH:MM:SS") pour
  // que la comparaison lexicographique WHERE created_at < ? soit correcte.
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  const out = {};
  for (const [kind, table] of Object.entries(TABLES)) {
    out[kind] = db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(cutoff).changes;
  }
  return out;
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

module.exports = { cacheKey, cacheGet, cachePut, cached, purgeExpiredCache, CACHE_TTL_MS };
