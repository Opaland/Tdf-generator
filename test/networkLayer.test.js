'use strict';
// Epic 35.7 (revue globale du 19/10/2026) : couche réseau.

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-network-test-${process.pid}`);
delete process.env.ETAPEFORGE_OFFLINE;
delete process.env.ETAPEFORGE_PUBLIC;
// Identifiants fictifs : /connect doit pouvoir émettre un state (aucun appel
// réel au fournisseur n'est fait par ces tests).
process.env.STRAVA_CLIENT_ID = 'test-client';
process.env.SUUNTO_CLIENT_ID = 'test-client';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { httpText, httpJson } = require('../pipeline/http');

const servers = [];
after(() => {
  for (const s of servers) s.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`));
  });
}

test('un corps de réponse qui ne finit jamais est abandonné au délai (httpText, httpJson)', async () => {
  const base = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    res.write('{"a":'); // puis plus rien
  });
  for (const fn of [httpText, httpJson]) {
    const t0 = Date.now();
    // Garde-fou du test lui-même : sans le correctif, l'appel ne rend jamais.
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error('jamais abandonné')), 5000).unref());
    await assert.rejects(Promise.race([fn(`${base}/lent`, { timeoutMs: 300, retries: 0 }), guard]), /Délai dépassé/);
    assert.ok(Date.now() - t0 < 3000, `${fn.name} : ${Date.now() - t0} ms`);
  }
});

test('httpText avec allowRedirect : une redirection hors liste est refusée, une autorisée est suivie', async () => {
  const target = await listen((req, res) => { res.writeHead(200); res.end('<gpx/>'); });
  const base = await listen((req, res) => {
    if (req.url === '/vers-interne') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
    res.writeHead(302, { Location: `${target}/ok` });
    res.end();
  });
  const onlyLocal = (u) => u.hostname === '127.0.0.1';
  await assert.rejects(httpText(`${base}/vers-interne`, { retries: 0, allowRedirect: onlyLocal }), (e) => e.status === 400 && /Redirection refusée/.test(e.message));
  assert.strictEqual(await httpText(`${base}/suivie`, { retries: 0, allowRedirect: onlyLocal }), '<gpx/>');
});

test('OAuth : un callback sans state valide ne connecte aucun compte', async () => {
  const { app } = require('../backend/server');
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  for (const p of ['strava', 'suunto']) {
    const r = await fetch(`${base}/api/${p}/callback?code=code-attaquant&state=forge`, { redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    assert.match(decodeURIComponent(r.headers.get('location')), /invalide ou expiré/, p);
    // L'attaquant obtient lui-même un state valide en appelant /connect, puis
    // piège la victime : sans le cookie posé chez elle, le state est refusé.
    const c = await fetch(`${base}/api/${p}/connect`, { redirect: 'manual' });
    const stolen = new URL(c.headers.get('location')).searchParams.get('state');
    const victim = await fetch(`${base}/api/${p}/callback?code=code-attaquant&state=${stolen}`, { redirect: 'manual', headers: { Cookie: 'ef_oauth_' + p + '=autre' } });
    assert.match(decodeURIComponent(victim.headers.get('location')), /invalide ou expiré/, `${p} : state volé`);
  }
  const { getSetting } = require('../backend/settings');
  assert.ok(!getSetting('strava_access_token') && !getSetting('suunto_access_token'));
});
