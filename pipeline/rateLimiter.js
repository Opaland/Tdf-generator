'use strict';
// Files d'attente par hôte : chaque service externe a son délai minimal entre requêtes.

const queues = new Map(); // host -> { chain: Promise, minDelayMs, lastAt }

function getQueue(host, minDelayMs) {
  if (!queues.has(host)) {
    queues.set(host, { chain: Promise.resolve(), minDelayMs, lastAt: 0 });
  }
  const q = queues.get(host);
  q.minDelayMs = Math.max(q.minDelayMs, minDelayMs || 0);
  return q;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Exécute fn() en respectant le délai minimal entre deux appels vers `host`.
 * Les appels sont sérialisés (jamais deux requêtes simultanées vers le même hôte).
 */
function rateLimited(host, minDelayMs, fn) {
  const q = getQueue(host, minDelayMs);
  const run = q.chain.then(async () => {
    const wait = q.lastAt + q.minDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      q.lastAt = Date.now();
    }
  });
  // La chaîne ne doit pas se rompre si un appel échoue.
  q.chain = run.catch(() => {});
  return run;
}

module.exports = { rateLimited, sleep };
