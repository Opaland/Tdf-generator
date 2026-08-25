'use strict';
// Tests de pipeline/http.js : chemins d'erreur jusqu'ici non couverts (item de
// backlog issue #10, section F) — en particulier régression sur le bug déjà
// corrigé où une erreur 4xx non-retryable (ex. 404) était capturée par le même
// catch que les 429/5xx et retentait inutilement au lieu d'échouer tout de
// suite (voir historique git, correctif "revue croisée multi-perspective").

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { httpJson } = require('../pipeline/http');

let server;
let base;
let calls;

before(async () => {
  calls = { count400: 0, count500then200: 0 };
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
