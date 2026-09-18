'use strict';
// Test d'intégration du connecteur Strava contre un serveur Strava SIMULÉ local :
// flux OAuth complet (échange de code, client_id/client_secret dans le corps —
// pas de Basic auth, contrairement à Suunto), liste des activités, reconstruction
// des points depuis /activities/{id}/streams (tableaux parallèles latlng/altitude/
// time + start_date de l'activité) puis import → étape avec côte détectée et
// statistiques de vitesse. Seul le comportement du vrai serveur Strava n'est pas
// couvert (test manuel avec un compte : voir docs/STRAVA.md).

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-strava-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
// pointsFromStreams() est testée à part, dans test/stravaPointsFromStreams.test.js :
// la require() directe de backend/strava.js ici, avant que before() ci-dessous ne
// pose STRAVA_OAUTH_BASE, figeait la constante de module OAUTH_BASE sur la vraie
// https://www.strava.com (lue une seule fois au chargement) — la suite continuait
// de tourner contre le simulateur pour tout le reste, mais le test OAuth de cette
// suite partait un vrai appel réseau vers Strava et échouait sur une réponse HTTP
// 400 authentique du serveur réel. Node isole chaque fichier de test dans son
// propre process : séparer le fichier règle l'ordre de chargement sans readresser
// la timing des deux require() dans celui-ci.

/** Trace synthétique : 10 km plat à 400 m puis 6 km à 7 %, à 20 km/h (comme le test GPX). */
function syntheticStreams() {
  const latlng = [];
  const altitude = [];
  const time = [];
  const speedMps = (20 * 1000) / 3600;
  for (let m = 0; m <= 16000; m += 100) {
    latlng.push([43.0 + m / 110540, 0.5]);
    altitude.push(m <= 10000 ? 400 : 400 + (m - 10000) * 0.07);
    time.push(Math.round(m / speedMps));
  }
  return { latlng: { data: latlng }, altitude: { data: altitude }, time: { data: time } };
}

// --- Serveur Strava simulé -------------------------------------------------------
let mock;
let mockCalls;
let appServer;
let base;
const START_DATE = '2026-06-01T09:00:00Z';

before(async () => {
  mockCalls = [];
  mock = http.createServer((req, res) => {
    mockCalls.push({ url: req.url, auth: req.headers.authorization });
    if (req.method === 'POST' && req.url === '/oauth/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const credsOk = params.get('client_id') === 'cid-test' && params.get('client_secret') === 'secret-test';
        const isAuthCode = params.get('grant_type') === 'authorization_code' && params.get('code') === 'code-test';
        const isRefresh = params.get('grant_type') === 'refresh_token' && params.get('refresh_token') === 'refresh-test';
        res.setHeader('Content-Type', 'application/json');
        if (!credsOk || (!isAuthCode && !isRefresh)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.end(JSON.stringify({
          access_token: 'access-test',
          refresh_token: 'refresh-test',
          expires_at: Math.floor(Date.now() / 1000) + 21600,
          athlete: { firstname: 'Théo', lastname: 'Test' },
        }));
      });
      return;
    }
    if (req.headers.authorization !== 'Bearer access-test') {
      res.statusCode = 401;
      res.end('{}');
      return;
    }
    if (req.url.startsWith('/athlete/activities')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([
        { id: 42, name: 'Sortie col test', sport_type: 'Ride', start_date: START_DATE, distance: 16000, total_elevation_gain: 420, moving_time: 2880 },
      ]));
      return;
    }
    if (req.url === '/activities/42') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 42, name: 'Sortie col test', start_date: START_DATE }));
      return;
    }
    if (req.url.startsWith('/activities/42/streams')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(syntheticStreams()));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  process.env.STRAVA_OAUTH_BASE = mockUrl;
  process.env.STRAVA_API_BASE = mockUrl;
  process.env.STRAVA_CLIENT_ID = 'cid-test';
  process.env.STRAVA_CLIENT_SECRET = 'secret-test';

  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  mock?.close();
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('statut : configuré mais pas connecté', async () => {
  const st = await (await fetch(`${base}/api/strava/status`)).json();
  assert.strictEqual(st.configured, true);
  assert.strictEqual(st.connected, false);
});

test('le statut ne renvoie jamais client_secret en clair', async () => {
  const raw = await (await fetch(`${base}/api/strava/status`)).text();
  assert.ok(!raw.includes(process.env.STRAVA_CLIENT_SECRET), 'client_secret absent de la réponse brute');
  const st = JSON.parse(raw);
  assert.deepStrictEqual(
    Object.keys(st).sort(),
    ['configured', 'connected', 'redirect_uri', 'user'].sort(),
    'aucun champ additionnel (secret) ne doit apparaître dans la réponse'
  );
});

for (const [field, bad] of [['client_id', {}], ['client_secret', []]]) {
  test(`POST /api/strava/config avec ${field}=${JSON.stringify(bad)} : 400 propre, pas stocké dépareillé`, async () => {
    const res = await fetch(`${base}/api/strava/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: bad }),
    });
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /doit être une chaîne/);
  });
}

test("callback OAuth : échange du code contre un jeton (client_id/client_secret dans le corps, pas Basic)", async () => {
  const res = await fetch(`${base}/api/strava/callback?code=code-test`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location'), /strava=ok/);
  const st = await (await fetch(`${base}/api/strava/status`)).json();
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.user, 'Théo Test');
});

test('liste des activités avec le bon en-tête Bearer', async () => {
  const list = await (await fetch(`${base}/api/strava/activities`)).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 42);
  assert.strictEqual(list[0].name, 'Sortie col test');
  assert.strictEqual(list[0].distance_m, 16000);
});

test('import par flux (streams) → étape complète, côte détectée, statistiques de vitesse', async () => {
  const res = await fetch(`${base}/api/strava/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 42, name: 'Sortie col test' }),
  });
  const json = await res.json();
  assert.ok(res.ok, JSON.stringify(json));
  const { loadStageFull } = require('../pipeline/generate');
  const full = loadStageFull(json.id);
  assert.strictEqual(full.stage.state, 'done');
  assert.ok(Math.abs(full.stage.generated_distance_km - 16) < 0.3, `distance ${full.stage.generated_distance_km} ≈ 16 km`);
  assert.strictEqual(full.climbs.length, 1, 'la montée de 6 km à 7 % est détectée');
  assert.strictEqual(full.climbs[0].category, '1');
  // Le flux `time` de la simulation ci-dessus correspond à 20 km/h constant :
  // vérifie que rideStats.js reçoit bien des `time` (Date) exploitables de
  // bout en bout à travers la route (le choix précis de la date de départ,
  // lui, est vérifié séparément sur pointsFromStreams(), dans
  // test/stravaPointsFromStreams.test.js — une vitesse moyenne ne dépend que
  // des écarts entre points, pas de leur origine, donc ce test-ci ne peut
  // pas discriminer une mauvaise date, seulement une absence totale
  // d'horodatage).
  assert.ok(Math.abs(full.stage.avg_speed_kmh - 20) < 1, `vitesse moyenne ${full.stage.avg_speed_kmh} ≈ 20 km/h`);
});

test("POST /api/strava/import avec name={} : 400 propre, pas d'appel réseau vers Strava", async () => {
  const callsBefore = mockCalls.length;
  const res = await fetch(`${base}/api/strava/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 42, name: {} }),
  });
  assert.strictEqual(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /doit être une chaîne/);
  assert.strictEqual(mockCalls.length, callsBefore, 'la validation doit échouer avant tout aller-retour vers le serveur Strava simulé');
});

test('POST /api/strava/import sans id : 400 propre', async () => {
  const res = await fetch(`${base}/api/strava/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.strictEqual(res.status, 400);
});
