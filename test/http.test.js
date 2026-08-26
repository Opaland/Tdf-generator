'use strict';
// Tests de pipeline/http.js : chemins d'erreur jusqu'ici non couverts (item de
// backlog issue #10, section F) — en particulier régression sur le bug déjà
// corrigé où une erreur 4xx non-retryable (ex. 404) était capturée par le même
// catch que les 429/5xx et retentait inutilement au lieu d'échouer tout de
// suite (voir historique git, correctif "revue croisée multi-perspective").

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { httpJson, retryDelayMs } = require('../pipeline/http');

let server;
let base;
let calls;

before(async () => {
  calls = { count400: 0, count500then200: 0, count429RetryAfter: 0 };
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/toujours-400') {
      calls.count400++;
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }
    if (req.url === '/500-puis-200') {
      calls.count500then200++;
      if (calls.count500then200 === 1) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'temporaire' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      }
      return;
    }
    if (req.url === '/429-retry-after-puis-200') {
      calls.count429RetryAfter++;
      if (calls.count429RetryAfter === 1) {
        res.statusCode = 429;
        // 3 s, volontairement bien au-dessus du 1er délai du backoff expo
        // (1 s) : si le correctif ne lisait pas Retry-After, ce test
        // passerait quand même (1 s < 3 s, faux négatif) — voir le test
        // suivant, qui isole retryDelayMs() en direct pour ce cas précis.
        res.setHeader('Retry-After', '3');
        res.end(JSON.stringify({ error: 'rate limited' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      }
      return;
    }
    if (req.url === '/lent') {
      calls.countLent = (calls.countLent || 0) + 1;
      // Volontairement bien plus long que le timeoutMs testé ci-dessous —
      // le serveur finit par répondre 200, mais trop tard : httpJson() doit
      // avoir déjà abandonné cette tentative.
      setTimeout(() => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      }, 2000);
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('erreur 4xx non-retryable : échoue immédiatement, une seule tentative', async () => {
  await assert.rejects(
    () => httpJson(`${base}/toujours-400`, { retries: 3 }),
    /HTTP 400/
  );
  assert.strictEqual(calls.count400, 1, 'pas de retry sur une erreur 4xx (régression du bug corrigé)');
});

test('erreur 5xx retryable : réessaie et réussit au 2e essai', async () => {
  const json = await httpJson(`${base}/500-puis-200`, { retries: 1 });
  assert.deepStrictEqual(json, { ok: true });
  assert.strictEqual(calls.count500then200, 2);
});

// rateLimiter.js sérialise les appels par hôte (jamais deux requêtes
// simultanées) — sans timeout, une seule requête qui pend gèlerait
// indéfiniment la file entière vers cet hôte, pas seulement cet appel.
test('timeout : une requête trop lente est abandonnée (retryable), pas bloquée indéfiniment', async () => {
  const start = Date.now();
  await assert.rejects(
    () => httpJson(`${base}/lent`, { retries: 0, timeoutMs: 150 }),
    /Délai dépassé \(150 ms\)/
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500, `doit échouer bien avant les 2000 ms de réponse réelle du serveur (mesuré ${elapsed} ms)`);
});

test('timeout : une requête qui répond avant le délai n\'est jamais abandonnée (pas de faux positif)', async () => {
  const json = await httpJson(`${base}/500-puis-200`, { retries: 1, timeoutMs: 5000 });
  assert.deepStrictEqual(json, { ok: true });
});

// Trouvaille en testant l'import en masse avec un vrai accès réseau
// (25/08/2026) : l'API REST Wikipédia répond 429 + Retry-After sous charge,
// mais le backoff expo (1 s, 2 s, 4 s) retentait bien avant l'expiration
// annoncée par le serveur — chaque retry retombait sur le même 429.
test('429 avec Retry-After : attend au moins le délai annoncé par le serveur avant de réessayer', async () => {
  const start = Date.now();
  const json = await httpJson(`${base}/429-retry-after-puis-200`, { retries: 1 });
  const elapsed = Date.now() - start;
  assert.deepStrictEqual(json, { ok: true });
  assert.strictEqual(calls.count429RetryAfter, 2);
  assert.ok(elapsed >= 2900, `doit attendre ~3000 ms (Retry-After: 3), pas le premier délai du backoff expo (1000 ms) (mesuré ${elapsed} ms)`);
});

test('retryDelayMs() : lit Retry-After (secondes) sur un 429, borné par le plafond', () => {
  const fakeRes = (status, retryAfter) => ({
    status,
    headers: { get: (h) => (h === 'retry-after' ? retryAfter : null) },
  });
  assert.strictEqual(retryDelayMs(fakeRes(429, '3'), 0), 3000);
  assert.strictEqual(retryDelayMs(fakeRes(429, '99999'), 0), 65000, 'un Retry-After absurde ne doit jamais dépasser le plafond');
});

test('retryDelayMs() : sans Retry-After exploitable, retombe sur le backoff expo', () => {
  const fakeRes = (status, retryAfter) => ({
    status,
    headers: { get: (h) => (h === 'retry-after' ? retryAfter : null) },
  });
  assert.strictEqual(retryDelayMs(fakeRes(429, null), 2), 1000 * 2 ** 2, 'pas de Retry-After → backoff expo');
  assert.strictEqual(retryDelayMs(fakeRes(429, 'pas-une-date'), 1), 1000 * 2 ** 1, 'Retry-After illisible → backoff expo');
  assert.strictEqual(retryDelayMs(fakeRes(500, '3'), 0), 1000, 'Retry-After ignoré sur un 5xx (seul le 429 le porte en pratique)');
  assert.strictEqual(retryDelayMs(undefined, 3), 1000 * 2 ** 3, 'pas de réponse (ex. timeout) → backoff expo');
});
