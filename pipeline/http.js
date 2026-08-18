'use strict';
// Enveloppe fetch : rate-limit par hôte + retries avec backoff + bascule hors-ligne.

const { rateLimited, sleep } = require('./rateLimiter');

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

/**
 * GET JSON avec rate-limit par hôte et retries (3 tentatives, backoff expo).
 * `minDelayMs` = délai minimal entre deux requêtes vers cet hôte.
 */
async function httpJson(url, { minDelayMs = 0, headers = {}, retries = 3 } = {}) {
  const host = new URL(url).host;
  return rateLimited(host, minDelayMs, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status} sur ${url}`);
        } else {
          return await res.json();
        }
      } catch (err) {
        lastErr = err;
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
async function httpText(url, { minDelayMs = 0, headers = {}, retries = 3 } = {}) {
  const host = new URL(url).host;
  return rateLimited(host, minDelayMs, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} sur ${host}`);
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status} sur ${url}`);
        } else {
          return await res.text();
        }
      } catch (err) {
        lastErr = err;
      }
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
  });
}

module.exports = { httpJson, httpText, isOffline, setOffline, USER_AGENT };
