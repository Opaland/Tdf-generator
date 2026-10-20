'use strict';
// Revue globale du 19/10/2026 (Epic 35.1) : trois façons de mettre le serveur
// en échec, chacune reproduite avant correctif.
// - deux inscriptions simultanées du même email : la seconde INSERT levait
//   « UNIQUE constraint failed » dans un handler async non rattrapé, et Node
//   arrêtait le process ;
// - un cookie voisin mal encodé (`other=50%`) faisait lever decodeURIComponent
//   dans requireAuth : 500 sur toute l'API ;
// - un waypoint hors bornes (lat 999) passait la validation et la génération
//   saturait la mémoire.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-authrob-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
process.env.ETAPEFORGE_PUBLIC = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let cookie;

const post = (p, body, extra = {}) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
    // Sans correctif, le process du serveur (le même que celui du test)
    // tombe : on borne l'attente plutôt que de laisser le test pendre.
    signal: AbortSignal.timeout(15000),
  });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('inscriptions simultanées du même email : une seule réussit, les autres 409, le serveur reste vivant', async () => {
  const body = { email: 'course@example.com', password: 'motdepasse123' };
  const res = await Promise.all([post('/api/auth/register', body), post('/api/auth/register', body), post('/api/auth/register', body)]);
  const codes = res.map((r) => r.status).sort();
  assert.deepStrictEqual(codes, [200, 409, 409]);
  for (const r of res.filter((x) => x.status === 409)) {
    const j = await r.json();
    assert.doesNotMatch(j.error, /UNIQUE|constraint/i, 'pas de message SQLite brut');
  }
  const ok = res.find((r) => r.status === 200);
  cookie = (ok.headers.get('set-cookie') || '').match(/ef_session=[^;]+/)[0];
  const st = await fetch(`${base}/api/status`);
  assert.strictEqual(st.status, 200);
});

test('un cookie voisin mal encodé ne casse pas la session', async () => {
  for (const bad of ['other=50%', 'x=%E0%A4%A']) {
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `${bad}; ${cookie}` } });
    assert.strictEqual(me.status, 200, bad);
    const stages = await fetch(`${base}/api/stages`, { headers: { Cookie: `${cookie}; ${bad}` } });
    assert.strictEqual(stages.status, 200, bad);
  }
});

test('waypoint hors bornes : 400 à la création comme à la modification', async () => {
  const wp = (lat, lon) => ({ name: 'Bornes', waypoints: [{ label: 'A', kind: 'start', lat, lon }, { label: 'B', kind: 'finish', lat: 43.3, lon: -0.37 }] });
  for (const [lat, lon] of [[999, -500], [43.3, 359.6], [-90.5, 0], [0, 180.01]]) {
    const r = await post('/api/stages', wp(lat, lon), { Cookie: cookie });
    assert.strictEqual(r.status, 400, `${lat},${lon}`);
    assert.match((await r.json()).error, /waypoints\[0\]/);
  }
  const ok = await post('/api/stages', wp(90, -180), { Cookie: cookie });
  assert.strictEqual(ok.status, 200, 'les bornes elles-mêmes restent valides');
  const { id } = await ok.json();
  const put = await fetch(`${base}/api/stages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(wp(43.3, 359.6)),
  });
  assert.strictEqual(put.status, 400);
});

test('trace importée : les points hors bornes sont écartés, une trace sans point valide est refusée', async () => {
  const gpx = (pts) => `<gpx><trk><trkseg>${pts.map(([la, lo]) => `<trkpt lat="${la}" lon="${lo}"><ele>100</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const send = (body) => fetch(`${base}/api/import/gpx?name=t`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml', Cookie: cookie }, body, signal: AbortSignal.timeout(15000) });
  const bad = await send(gpx([[999, -500], [999.1, -500.1]]));
  assert.strictEqual(bad.status, 400);
  const mixed = await send(gpx([[43, 0], [999, -500], [43, 0.01], [43, 0.02]]));
  assert.strictEqual(mixed.status, 200);
  const { id } = await mixed.json();
  const st = await (await fetch(`${base}/api/stages/${id}`, { headers: { Cookie: cookie } })).json();
  assert.ok(st.samples.every((s) => s.lat >= -90 && s.lat <= 90 && s.lon >= -180 && s.lon <= 180));
});

test("éditeur : la longitude d'un clic sur une copie du monde est ramenée dans [-180, 180)", () => {
  const { normalizeLon } = require('../frontend/editor.js');
  assert.ok(Math.abs(normalizeLon(359.6) - -0.4) < 1e-9);
  assert.ok(Math.abs(normalizeLon(-361) - -1) < 1e-9);
  assert.strictEqual(normalizeLon(2.35), 2.35);
  assert.strictEqual(normalizeLon(-180), -180);
});
