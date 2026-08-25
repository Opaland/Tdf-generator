'use strict';
// Enveloppe fetch : rate-limit par hôte + retries avec backoff + bascule hors-ligne.

const { rateLimited, sleep } = require('./rateLimiter');
const { recordRequest } = require('./apiUsage');

const USER_AGENT = 'EtapeForge/1.0 (application locale de cartographie cycliste; +https://github.com/opaland/tdf-generator)';

/**
 * Mode hors-ligne : aucun appel réseau, les fournisseurs basculent sur le
 * simulateur déterministe (données synthétiques, clairement étiquetées).
 * Activé par ETAPEFORGE_OFFLINE=1 ou automatiquement après un échec réseau
 * si ETAPEFORGE_AUTO_OFFLINE=1.
 */
let forcedOffline = process.env.ETAPEFORGE_OFFLINE === '1';
const autoOffline = process.env.ETAPEFORGE_AUTO_OFFLINE === '1';

function isOffline() {
  return forcedOffline;
}
function setOffline(v) {
  forcedOffline = !!v;
}

// Délai par défaut avant abandon d'UNE tentative (hors backoff entre
// tentatives, hors attente de la file de rate-limit par hôte) — sans lui,
// une requête qui pend indéfiniment (service externe qui accepte la
// connexion sans jamais répondre) bloquait tout, pas seulement l'appelant :
// rateLimiter.js sérialise les appels par hôte (jamais deux requêtes
// simultanées), donc un seul appel pendant gèle la file entière vers cet
// hôte. Même principe que EF.api() (frontend/common.js) et les sondes de
// GET /api/diagnostic (backend/server.js, 8 s), qui avaient déjà ce
// garde-fou côté client/diagnostic mais pas ici, côté pipeline — la couche
// réellement utilisée par géocodage/altimétrie/routage/Wikipédia.
const DEFAULT_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, opts, timeoutMs) {
  if (!timeoutMs) return fetch(url, opts);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET JSON avec rate-limit par hôte et retries (3 tentatives, backoff expo).
 * `minDelayMs` = délai minimal entre deux requêtes vers cet hôte.
 * `timeoutMs` = délai avant abandon d'une tentative (retryable, comme un 5xx).
 */
async function httpJson(url, { minDelayMs = 0, headers = {}, retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const host = new URL(url).host;
  return rateLimited(host, minDelayMs, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        recordRequest(host);
        const res = await fetchWithTimeout(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        }, timeoutMs);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
        } else if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status} sur ${url}`), { nonRetryable: true });
        } else {
          return await res.json();
        }
      } catch (err) {
        if (err.nonRetryable) throw err;
        lastErr = err.name === 'AbortError' ? new Error(`Délai dépassé (${timeoutMs} ms) sur ${host}`) : err;
      }
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    if (autoOffline) {
      forcedOffline = true;
      const e = new Error(`Réseau indisponible (${lastErr.message}) — bascule en mode hors-ligne`);
      e.becameOffline = true;
      throw e;
    }
    throw lastErr;
  });
}

/** GET texte (pages Wikipédia HTML). Mêmes garanties que httpJson. */
async function httpText(url, { minDelayMs = 0, headers = {}, retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const host = new URL(url).host;
  return rateLimited(host, minDelayMs, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        recordRequest(host);
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, ...headers } }, timeoutMs);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
        } else if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status} sur ${url}`), { nonRetryable: true });
        } else {
          return await res.text();
        }
      } catch (err) {
        if (err.nonRetryable) throw err;
        lastErr = err.name === 'AbortError' ? new Error(`Délai dépassé (${timeoutMs} ms) sur ${host}`) : err;
      }
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
  });
}

module.exports = { httpJson, httpText, isOffline, setOffline, USER_AGENT };
