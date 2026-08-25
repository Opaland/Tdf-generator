'use strict';
// Vérifie que backend/suunto.js abandonne un appel OAuth/API Suunto qui ne
// répond jamais, plutôt que de laisser la requête utilisateur (routes
// /api/suunto/*) pendre indéfiniment (trouvaille de sprint dédié, même
// classe que pipeline/http.js, PR précédente).
//
// Fichier séparé de test/suunto.test.js : SUUNTO_TIMEOUT_MS doit être réglé
// à une valeur courte AVANT le premier require de backend/server.js, qui lit
// cette variable au chargement du module backend/suunto.js (CLAUDE.md règle
// 4 — un état mis en cache au premier require() n'est fiable qu'une fois par
// process ; le test principal a déjà besoin du délai par défaut de 15 s pour
// ses propres assertions, donc pas question de le réduire globalement).

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-suunto-timeout-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
process.env.SUUNTO_TIMEOUT_MS = '150';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let mock;
let appServer;
let base;

before(async () => {
  mock = http.createServer((req, res) => {
    // Ne répond jamais dans le délai testé — simule un service Suunto qui
    // accepte la connexion sans jamais répondre.
    setTimeout(() => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'jwt-test', expires_in: 86400 }));
    }, 2000);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  process.env.SUUNTO_OAUTH_BASE = mockUrl;
  process.env.SUUNTO_API_BASE = mockUrl;
  process.env.SUUNTO_CLIENT_ID = 'cid-test';
  process.env.SUUNTO_CLIENT_SECRET = 'secret-test';
  process.env.SUUNTO_SUBSCRIPTION_KEY = 'sub-test';

  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  mock?.close();
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('callback OAuth : le service Suunto qui ne répond jamais est abandonné bien avant sa vraie réponse à 2 s', async () => {
  const start = Date.now();
  const res = await fetch(`${base}/api/suunto/callback?code=code-test`, { redirect: 'manual' });
  const elapsed = Date.now() - start;
  assert.strictEqual(res.status, 302);
  const location = res.headers.get('location');
  assert.match(location, /suunto=/);
  assert.match(decodeURIComponent(location), /délai de 150 ms dépassé/);
  assert.ok(elapsed < 1500, `doit échouer bien avant les 2000 ms de réponse réelle du service (mesuré ${elapsed} ms)`);
});
