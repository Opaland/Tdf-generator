'use strict';
// Test d'intégration du connecteur Suunto contre un serveur Suunto SIMULÉ local :
// flux OAuth complet (échange de code, Basic auth), en-têtes API
// (Bearer + Ocp-Apim-Subscription-Key), export FIT BINAIRE réel (encodé par le
// test : en-tête, message de définition, records en demi-cercles, CRC-16) puis
// import → étape avec côte détectée. Seul le comportement du vrai serveur
// Suunto n'est pas couvert (test manuel avec un compte : voir README).

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-suunto-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

// --- Encodeur FIT minimal (messages record : lat/lon/alt/timestamp) ------------
const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
function crc16(buf, crc = 0) {
  for (const b of buf) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

/** Encode un fichier FIT valide contenant des records GPS [{lat, lon, ele}]. */
function encodeFit(points) {
  const SEMI = 2 ** 31 / 180;
  // Définition (local 0, global 20 = record) : timestamp, lat, lon, altitude.
  const def = Buffer.from([
    0x40, 0x00, 0x00, 20, 0x00, 4,
    253, 4, 0x86, // timestamp uint32
    0, 4, 0x85,   // position_lat sint32 (demi-cercles)
    1, 4, 0x85,   // position_long sint32
    2, 2, 0x84,   // altitude uint16 (scale 5, offset 500)
  ]);
  const records = [def];
  let ts = 1000000000;
  for (const p of points) {
    const b = Buffer.alloc(15);
    b.writeUInt8(0x00, 0);
    b.writeUInt32LE(ts++, 1);
    b.writeInt32LE(Math.round(p.lat * SEMI), 5);
    b.writeInt32LE(Math.round(p.lon * SEMI), 9);
    b.writeUInt16LE(Math.round((p.ele + 500) * 5), 13);
    records.push(b);
  }
  const data = Buffer.concat(records);
  const header = Buffer.alloc(14);
  header.writeUInt8(14, 0);          // taille d'en-tête
  header.writeUInt8(0x20, 1);        // version de protocole
  header.writeUInt16LE(2132, 2);     // version de profil
  header.writeUInt32LE(data.length, 4);
  header.write('.FIT', 8, 'ascii');
  header.writeUInt16LE(crc16(header.subarray(0, 12)), 12);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(crc16(data, crc16(header)), 0);
  return Buffer.concat([header, data, crc]);
}

/** Trace synthétique : 10 km plat à 400 m puis 6 km à 7 % (comme le test GPX). */
function syntheticPoints() {
  const pts = [];
  for (let m = 0; m <= 16000; m += 100) {
    pts.push({ lat: 43.0 + m / 110540, lon: 0.5, ele: m <= 10000 ? 400 : 400 + (m - 10000) * 0.07 });
  }
  return pts;
}

// --- Serveur Suunto simulé ------------------------------------------------------
let mock;
let mockCalls;
let appServer;
let base;

before(async () => {
  mockCalls = [];
  mock = http.createServer((req, res) => {
    mockCalls.push({ url: req.url, auth: req.headers.authorization, sub: req.headers['ocp-apim-subscription-key'] });
    if (req.method === 'POST' && req.url === '/oauth/token') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const basicOk = req.headers.authorization === 'Basic ' + Buffer.from('cid-test:secret-test').toString('base64');
        const grantOk = params.get('grant_type') === 'authorization_code' && params.get('code') === 'code-test';
        res.setHeader('Content-Type', 'application/json');
        if (!basicOk || !grantOk) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.end(JSON.stringify({ access_token: 'jwt-test', refresh_token: 'refresh-test', expires_in: 86400, user: 'testeur' }));
      });
      return;
    }
    if (req.url.startsWith('/v2/workouts')) {
      if (req.headers.authorization !== 'Bearer jwt-test' || req.headers['ocp-apim-subscription-key'] !== 'sub-test') {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ payload: [{ workoutKey: 'wk1', workoutName: 'Sortie col test', activityId: 3, startTime: 1755500000000, totalDistance: 16000, totalAscent: 420 }] }));
      return;
    }
    if (req.url === '/v2/workout/exportFit/wk1') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(encodeFit(syntheticPoints()));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
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

test('statut : configuré mais pas connecté', async () => {
  const st = await (await fetch(`${base}/api/suunto/status`)).json();
  assert.strictEqual(st.configured, true);
  assert.strictEqual(st.connected, false);
});

test("callback OAuth : échange du code contre un jeton (Basic auth vérifiée par le simulateur)", async () => {
  const res = await fetch(`${base}/api/suunto/callback?code=code-test`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location'), /suunto=ok/);
  const st = await (await fetch(`${base}/api/suunto/status`)).json();
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.user, 'testeur');
});

test('liste des sorties avec les bons en-têtes (Bearer + Ocp-Apim-Subscription-Key)', async () => {
  const list = await (await fetch(`${base}/api/suunto/workouts`)).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].key, 'wk1');
  assert.strictEqual(list[0].name, 'Sortie col test');
  assert.strictEqual(list[0].distance_m, 16000);
});

test('import FIT binaire → étape complète avec côte détectée', async () => {
  const res = await fetch(`${base}/api/suunto/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'wk1', name: 'Sortie col test' }),
  });
  const json = await res.json();
  assert.ok(res.ok, JSON.stringify(json));
  const { loadStageFull } = require('../pipeline/generate');
  const full = loadStageFull(json.id);
  assert.strictEqual(full.stage.state, 'done');
  assert.ok(Math.abs(full.stage.generated_distance_km - 16) < 0.3, `distance ${full.stage.generated_distance_km} ≈ 16 km`);
  assert.strictEqual(full.climbs.length, 1, 'la montée de 6 km à 7 % est détectée');
  assert.strictEqual(full.climbs[0].category, '1');
  assert.ok(Math.abs(full.climbs[0].summit_ele_m - 820) < 15, `sommet ${full.climbs[0].summit_ele_m} ≈ 820 m`);
});
