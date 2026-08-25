'use strict';
// Test d'intégration du mur d'accès (ETAPEFORGE_PUBLIC=1) : inscription,
// connexion, cookie de session, routes protégées, déconnexion, limiteur de
// tentatives. Le mode local par défaut (sans ETAPEFORGE_PUBLIC) est déjà
// couvert implicitement par les autres suites (ex. suunto.test.js appelle des
// routes /api/* sans cookie et s'attend à un 200 — si le mur d'auth s'activait
// par erreur en mode local, ces suites échoueraient).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-auth-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
process.env.ETAPEFORGE_PUBLIC = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { purgeStaleAttempts, attempts, RATE_WINDOW_MS } = require('../backend/auth');

let appServer;
let base;

function sessionCookie(res) {
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/ef_session=[^;]+/);
  return m ? m[0] : null;
}

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/status reste accessible sans compte et signale authRequired', async () => {
  const st = await (await fetch(`${base}/api/status`)).json();
  assert.strictEqual(st.authRequired, true);
});

test('routes protégées : 401 sans session', async () => {
  const res = await fetch(`${base}/api/stages`);
  assert.strictEqual(res.status, 401);
});

// Test dédié plutôt que de se fier uniquement à la couverture générique
// ci-dessus : une route ajoutée par erreur avant `app.use('/api',
// requireAuth)` (backend/server.js) ne serait pas détectée par le seul test
// sur /api/stages — relecture adverse, backlog #10 "étapes similaires".
test('GET /api/stages/:id/similar : 401 sans session (nouvelle route, pas seulement /api/stages)', async () => {
  const res = await fetch(`${base}/api/stages/1/similar`);
  assert.strictEqual(res.status, 401);
});

test('inscription : email invalide et mot de passe trop court rejetés (400)', async () => {
  const badEmail = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pas-un-email', password: 'motdepasse123' }),
  });
  assert.strictEqual(badEmail.status, 400);

  const shortPw = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'court' }),
  });
  assert.strictEqual(shortPw.status, 400);
});

let cookie;

test('inscription valide : pose un cookie de session httpOnly', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'Test@Example.com', password: 'motdepasse123' }),
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.email, 'test@example.com', 'email normalisé en minuscules');
  const raw = res.headers.get('set-cookie') || '';
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);
  cookie = sessionCookie(res);
  assert.ok(cookie, 'cookie ef_session posé');
});

test('email déjà pris : 409', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'autremotdepasse' }),
  });
  assert.strictEqual(res.status, 409);
});

test('le cookie de session donne accès aux routes protégées', async () => {
  const res = await fetch(`${base}/api/stages`, { headers: { Cookie: cookie } });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('GET /api/auth/me avec cookie renvoie l\'email', async () => {
  const res = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).email, 'test@example.com');
});

test('mauvais mot de passe : 401 (email correct)', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'mauvais-mot-de-passe' }),
  });
  assert.strictEqual(res.status, 401);
});

test('login correct : nouveau cookie valide', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'motdepasse123' }),
  });
  assert.strictEqual(res.status, 200);
  const c2 = sessionCookie(res);
  assert.ok(c2 && c2 !== cookie, 'nouveau jeton de session distinct');
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: c2 } });
  assert.strictEqual(me.status, 200);
});

test('logout invalide la session', async () => {
  const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  assert.strictEqual(out.status, 200);
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(me.status, 401);
});

test('limiteur de tentatives : 429 après trop d\'essais', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inexistant@example.com', password: 'peu-importe' }),
    });
  }
  assert.strictEqual(last.status, 429);
});

// Trouvaille de sprint dédié : chaque IP distincte laissait une entrée dans
// `attempts` (Map de module) jamais retirée — croissance non bornée sur un
// déploiement public longue durée avec beaucoup d'IP différentes.
test('purgeStaleAttempts() : retire les IP sans tentative dans la fenêtre, garde les autres', () => {
  const map = new Map();
  const now = 1755000000000; // horodatage fixe, sans dépendre de Date.now()
  map.set('198.51.100.1', [now - RATE_WINDOW_MS - 1]); // juste hors fenêtre
  map.set('198.51.100.2', [now - RATE_WINDOW_MS + 1]); // juste dans la fenêtre
  map.set('198.51.100.3', [now - RATE_WINDOW_MS - 5000, now - 1000]); // un vieux + un récent
  purgeStaleAttempts(map, now);
  assert.deepStrictEqual([...map.keys()].sort(), ['198.51.100.2', '198.51.100.3']);
});

test('purgeStaleAttempts() : une Map vide reste vide, ne casse rien', () => {
  const map = new Map();
  purgeStaleAttempts(map, Date.now());
  assert.strictEqual(map.size, 0);
});

test('le limiteur purge réellement la Map de module lors d\'un vrai appel à /api/auth/login', async () => {
  attempts.clear();
  const now = Date.now();
  attempts.set('203.0.113.9', [now - RATE_WINDOW_MS - 1000]); // IP jamais revue, doit disparaître
  attempts.set('203.0.113.10', [now]); // IP encore dans la fenêtre, doit rester
  await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'purge-test@example.com', password: 'peu-importe' }),
  });
  assert.strictEqual(attempts.has('203.0.113.9'), false, 'IP hors fenêtre purgée par le vrai appel HTTP');
  assert.strictEqual(attempts.has('203.0.113.10'), true, 'IP encore active non purgée');
});
