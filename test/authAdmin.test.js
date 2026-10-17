'use strict';
// Rôle admin en mode public (recommandation R1, Epic 27.4) : les routes
// destructrices ou de configuration partagée sont réservées aux emails de
// ETAPEFORGE_ADMIN_EMAILS. Le mode local (sans ETAPEFORGE_PUBLIC) reste sans
// compte : couvert par les autres suites, qui appellent ces routes sans cookie.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-auth-admin-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
process.env.ETAPEFORGE_PUBLIC = '1';
process.env.ETAPEFORGE_ADMIN_EMAILS = ' Admin@Example.org , autre@example.org';
process.env.ETAPEFORGE_ADMIN_TOKEN = 'jeton-amorcage-test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let adminCookie;
let memberCookie;

function sessionCookie(res) {
  const m = (res.headers.get('set-cookie') || '').match(/ef_session=[^;]+/);
  return m ? m[0] : null;
}

function registerRaw(email, extra = {}) {
  // Plusieurs inscriptions par test : le limiteur (10 tentatives / 15 min
  // par IP, backend/auth.js) n'est pas l'objet de ces tests.
  require('../backend/auth').attempts.clear();
  return fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-solide', ...extra }),
  });
}

async function register(email, extra) {
  const res = await registerRaw(email, extra);
  assert.strictEqual(res.status, 200);
  return sessionCookie(res);
}

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  adminCookie = await register('admin@example.org', { admin_token: 'jeton-amorcage-test' }); // casse et espaces normalisés
  memberCookie = await register('membre@example.org');
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const call = (method, route, cookie, body) => fetch(`${base}${route}`, {
  method,
  redirect: 'manual', // /connect redirige vers le fournisseur OAuth : ne pas suivre
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const ADMIN_ONLY = [
  ['POST', '/api/offline', { offline: true }],
  ['POST', '/api/backup/import', {}],
  ['POST', '/api/editions/import', { year: 1903 }],
  ['POST', '/api/editions/import-all', {}],
  ['DELETE', '/api/stages/999999', undefined],
  ['DELETE', '/api/gear/999999', undefined],
  ['POST', '/api/suunto/config', { client_id: 'x' }],
  ['POST', '/api/suunto/disconnect', {}],
  ['GET', '/api/suunto/connect', undefined],
  ['GET', '/api/suunto/callback', undefined],
  ['GET', '/api/suunto/workouts', undefined],
  ['POST', '/api/suunto/import', {}],
  ['POST', '/api/strava/config', { client_id: 'x' }],
  ['POST', '/api/strava/disconnect', {}],
  ['GET', '/api/strava/connect', undefined],
  ['GET', '/api/strava/callback', undefined],
  ['GET', '/api/strava/activities', undefined],
  ['POST', '/api/strava/import', {}],
  ['GET', '/api/secrets/status', undefined],
];

test('membre connecté non admin → 403 sur chaque route réservée, sans effet', async () => {
  for (const [method, route, body] of ADMIN_ONLY) {
    const res = await call(method, route, memberCookie, body);
    assert.strictEqual(res.status, 403, `${method} ${route}`);
    assert.match((await res.json()).error, /administrateurs/);
  }
  // Le mode hors-ligne n'a pas été touché par la tentative refusée.
  const st = await (await fetch(`${base}/api/status`)).json();
  assert.strictEqual(st.offline, true);
});

test('sans session → 401 (le mur d\'accès passe avant le rôle)', async () => {
  for (const [method, route, body] of ADMIN_ONLY) {
    assert.strictEqual((await call(method, route, null, body)).status, 401, `${method} ${route}`);
  }
});

test('admin → la route s\'exécute (plus de 401/403)', async () => {
  for (const [method, route, body] of ADMIN_ONLY) {
    if (route === '/api/editions/import-all') continue; // import réel de toutes les éditions : trop long ici
    const res = await call(method, route, adminCookie, body);
    assert.ok(![401, 403].includes(res.status), `${method} ${route} : ${res.status}`);
  }
});

test('routes ordinaires toujours ouvertes à un membre (création d\'étape, lecture)', async () => {
  const res = await call('POST', '/api/stages', memberCookie, { name: 'Étape membre', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await call('GET', '/api/stages', memberCookie)).status, 200);
});

test('GET /api/auth/me signale le rôle', async () => {
  assert.strictEqual((await (await call('GET', '/api/auth/me', adminCookie)).json()).admin, true);
  assert.strictEqual((await (await call('GET', '/api/auth/me', memberCookie)).json()).admin, false);
});

test('inscription d\'un email administrateur : refusée sans le jeton d\'amorçage (ou avec un mauvais), acceptée avec', async () => {
  // Sans ce garde, le premier venu s'inscrivant avec un email de la liste devenait admin.
  let res = await registerRaw('autre@example.org');
  assert.strictEqual(res.status, 403);
  assert.match((await res.json()).error, /ETAPEFORGE_ADMIN_TOKEN/);
  res = await registerRaw('AUTRE@example.org ', { admin_token: 'mauvais' });
  assert.strictEqual(res.status, 403);
  res = await registerRaw('autre@example.org', { admin_token: ['jeton-amorcage-test'] });
  assert.strictEqual(res.status, 403, 'un jeton non chaîne est refusé, jamais une exception');
  const cookie = await register('autre@example.org', { admin_token: 'jeton-amorcage-test' });
  assert.strictEqual((await (await call('GET', '/api/auth/me', cookie)).json()).admin, true);
  // Un email hors liste s'inscrit sans jeton, comme avant.
  assert.strictEqual((await registerRaw('simple@example.org')).status, 200);
});

test('jeton d\'amorçage absent, trop court ou fait d\'espaces → inscription admin fermée (jamais un jeton devinable)', async () => {
  const savedToken = process.env.ETAPEFORGE_ADMIN_TOKEN;
  const savedEmails = process.env.ETAPEFORGE_ADMIN_EMAILS;
  process.env.ETAPEFORGE_ADMIN_EMAILS = `${savedEmails},troisieme@example.org`; // email admin pas encore inscrit
  try {
    for (const bad of ['', '                    ', 'court']) {
      process.env.ETAPEFORGE_ADMIN_TOKEN = bad;
      const res = await registerRaw('troisieme@example.org', { admin_token: bad });
      assert.strictEqual(res.status, 403, `jeton ${JSON.stringify(bad)}`);
    }
    delete process.env.ETAPEFORGE_ADMIN_TOKEN;
    assert.strictEqual((await registerRaw('troisieme@example.org', { admin_token: 'x' })).status, 403);
  } finally {
    process.env.ETAPEFORGE_ADMIN_TOKEN = savedToken;
    process.env.ETAPEFORGE_ADMIN_EMAILS = savedEmails;
  }
});
