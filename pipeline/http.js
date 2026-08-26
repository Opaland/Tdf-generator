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

// Plafond du délai imposé par un en-tête Retry-After sur un 429 — sans lui,
// un service qui répond "Retry-After: 3600" ferait attendre une tentative
// pendant une heure au lieu d'échouer proprement.
const RETRY_AFTER_CAP_MS = 65000;

/**
 * Délai avant la prochaine tentative. Si la réponse est un 429 et porte un
 * en-tête Retry-After exploitable, on l'utilise (borné à RETRY_AFTER_CAP_MS)
 * plutôt que le backoff expo — trouvaille en testant l'import en masse avec
 * un vrai accès réseau (25/08/2026) : l'API REST Wikipédia répond
 * `429` + `Retry-After: 30` sous charge, mais le backoff expo précédent
 * (1 s, 2 s, 4 s sur 3 tentatives) réessayait bien avant l'expiration
 * annoncée par le serveur — chaque retry retombait sur le même 429.
 */
function retryDelayMs(res, attempt) {
  if (res && res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter != null) {
      const asSeconds = Number(retryAfter);
      if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.min(asSeconds * 1000, RETRY_AFTER_CAP_MS);
      const asDate = Date.parse(retryAfter);
      if (!Number.isNaN(asDate)) return Math.min(Math.max(asDate - Date.now(), 0), RETRY_AFTER_CAP_MS);
    }
  }
  return 1000 * 2 ** attempt;
}

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
 * GET JSON avec rate-limit par hôte et retries (3 tentatives, backoff expo —
 * sauf sur un 429 avec Retry-After, voir retryDelayMs()).
 * `minDelayMs` = délai minimal entre deux requêtes vers cet hôte.
 * `timeoutMs` = délai avant abandon d'une tentative (retryable, comme un 5xx).
 */
async function httpJson(url, { minDelayMs = 0, headers = {}, retries = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const host = new URL(url).host;
  return rateLimited(host, minDelayMs, async () => {
    let lastErr;
    let lastRes;
    for (let attempt = 0; attempt <= retries; attempt++) {
      lastRes = undefined;
      try {
        recordRequest(host);
        const res = await fetchWithTimeout(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        }, timeoutMs);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
          lastRes = res;
        } else if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status} sur ${url}`), { nonRetryable: true });
        } else {
          return await res.json();
        }
      } catch (err) {
        if (err.nonRetryable) throw err;
        lastErr = err.name === 'AbortError' ? new Error(`Délai dépassé (${timeoutMs} ms) sur ${host}`) : err;
      }
      if (attempt < retries) await sleep(retryDelayMs(lastRes, attempt));
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
    let lastRes;
    for (let attempt = 0; attempt <= retries; attempt++) {
      lastRes = undefined;
      try {
        recordRequest(host);
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, ...headers } }, timeoutMs);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
          lastRes = res;
        } else if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status} sur ${url}`), { nonRetryable: true });
        } else {
          return await res.text();
        }
      } catch (err) {
        if (err.nonRetryable) throw err;
        lastErr = err.name === 'AbortError' ? new Error(`Délai dépassé (${timeoutMs} ms) sur ${host}`) : err;
      }
      if (attempt < retries) await sleep(retryDelayMs(lastRes, attempt));
    }
    throw lastErr;
  });
}

// Exportée à part de httpJson/httpText (qui ajoutent rate-limit par hôte,
// retries et bascule hors-ligne — hors sujet pour un webhook ou un flux
// OAuth) : réutilisée telle quelle par backend/notify.js et backend/suunto.js,
// mêmes appelants qui n'avaient elles non plus aucun timeout sur leur fetch().
module.exports = { httpJson, httpText, isOffline, setOffline, fetchWithTimeout, USER_AGENT, retryDelayMs };
