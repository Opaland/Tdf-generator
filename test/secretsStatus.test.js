'use strict';
// Provenance des secrets des connecteurs (Epic 13, issue #379, option A) :
// GET /api/secrets/status dit où vit chaque secret (env / base / absent),
// jamais sa valeur.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-secrets-status-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
for (const v of ['SUUNTO_CLIENT_SECRET', 'SUUNTO_SUBSCRIPTION_KEY', 'STRAVA_CLIENT_SECRET']) delete process.env[v];

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  delete process.env.STRAVA_CLIENT_SECRET;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const status = async () => (await fetch(`${base}/api/secrets/status`)).json();

test('rien de configuré → tout « absent », aucun jeton', async () => {
  const d = await status();
  assert.deepStrictEqual(d.suunto.secrets, { client_secret: 'absent', subscription_key: 'absent' });
  assert.deepStrictEqual(d.strava.secrets, { client_secret: 'absent' });
  assert.strictEqual(d.suunto.tokensInDb, false);
  assert.strictEqual(d.strava.tokensInDb, false);
});

test('secret saisi dans l\'interface → « db », et la valeur n\'apparaît jamais dans la réponse', async () => {
  const SECRET = 'valeur-tres-secrete-9f3a';
  await fetch(`${base}/api/suunto/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'id', client_secret: SECRET }),
  });
  const raw = await (await fetch(`${base}/api/secrets/status`)).text();
  assert.ok(!raw.includes(SECRET), 'la valeur du secret ne doit jamais sortir');
  assert.strictEqual(JSON.parse(raw).suunto.secrets.client_secret, 'db');
});

test('variable d\'environnement prioritaire → « env » même si une valeur reste en base', async () => {
  await fetch(`${base}/api/strava/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'id', client_secret: 'en-base' }),
  });
  assert.strictEqual((await status()).strava.secrets.client_secret, 'db');
  process.env.STRAVA_CLIENT_SECRET = 'depuis-env';
  assert.strictEqual((await status()).strava.secrets.client_secret, 'env');
});

test('jetons OAuth en base → tokensInDb', async () => {
  const { setSetting } = require('../backend/settings');
  setSetting('suunto_refresh_token', 'r');
  assert.strictEqual((await status()).suunto.tokensInDb, true);
  setSetting('suunto_refresh_token', null);
  assert.strictEqual((await status()).suunto.tokensInDb, false);
});
