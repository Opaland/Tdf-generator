'use strict';
// Test HTTP des routes d'import direct de trace (POST /api/import/gpx et
// POST /api/import/fit). Contrairement à test/importTrack.test.js (qui teste
// le pipeline en appelant directement importTrackAsStage()), ce fichier
// exerce les deux routes via de vraies requêtes HTTP — c'est la seule façon
// de vérifier ce que le front (frontend/traces.js) obtient réellement en
// retour, y compris le body-parser scopé à chaque route (express.text() pour
// le GPX, express.raw() pour le FIT).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-importhttp-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const SYNTHETIC_GPX =
  '<?xml version="1.0"?><gpx><trk><name>Sortie test</name><trkseg>' +
  Array.from({ length: 20 }, (_, i) => `<trkpt lat="${(43 + i * 0.001).toFixed(6)}" lon="0.5"><ele>${400 + i}</ele></trkpt>`).join('') +
  '</trkseg></trk></gpx>';

// --- Encodeur FIT minimal (même idiome que test/suunto.test.js : messages
// record lat/lon/alt/timestamp, CRC-16) — un fichier FIT syntaxiquement
// valide est nécessaire ici, contrairement au GPX (texte), donc pas de
// raccourci possible.
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
  header.writeUInt8(14, 0);
  header.writeUInt8(0x20, 1);
  header.writeUInt16LE(2132, 2);
  header.writeUInt32LE(data.length, 4);
  header.write('.FIT', 8, 'ascii');
  header.writeUInt16LE(crc16(header.subarray(0, 12)), 12);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(crc16(data, crc16(header)), 0);
  return Buffer.concat([header, data, crc]);
}

function syntheticFitPoints() {
  return Array.from({ length: 20 }, (_, i) => ({ lat: 43 + i * 0.001, lon: 0.5, ele: 400 + i }));
}

let appServer;
let base;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('POST /api/import/gpx : GPX réel importé comme étape', async () => {
  const res = await fetch(`${base}/api/import/gpx?name=test-gpx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gpx+xml' },
    body: SYNTHETIC_GPX,
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.ok(json.id);
  assert.strictEqual(json.points, 20);
});

test('POST /api/import/gpx : texte sans trkpt exploitable → 400, pas un crash', async () => {
  const res = await fetch(`${base}/api/import/gpx?name=test-gpx-vide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gpx+xml' },
    body: '<?xml version="1.0"?><gpx></gpx>',
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /GPX illisible/i);
});

test('POST /api/import/fit : FIT réel importé comme étape (même pipeline que GPX)', async () => {
  const res = await fetch(`${base}/api/import/fit?name=test-fit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encodeFit(syntheticFitPoints()),
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.ok(json.id);
  assert.strictEqual(json.points, 20);
});

test('POST /api/import/fit : corps vide → 400, pas un crash serveur', async () => {
  const res = await fetch(`${base}/api/import/fit?name=test-fit-vide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(0),
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /FIT illisible/i);
});

test('POST /api/import/fit : corps qui n\'est pas un FIT → 400, pas un crash serveur', async () => {
  const res = await fetch(`${base}/api/import/fit?name=test-fit-garbage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: 'ceci n\'est pas un fichier FIT',
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /FIT illisible/i);
});

// Trouvaille de relecture adverse (16/09/2026) : express.json(), monté sans
// restriction de chemin, doit rester sans effet sur ces deux routes même
// quand le Content-Type ne correspond pas à ce que le front envoie
// (application/gpx+xml / application/octet-stream) — sinon un FIT/GPX
// parfaitement valide se fait « avaler » par le mauvais parseur avant
// d'atteindre express.text()/express.raw(), avec un message d'erreur trompeur
// à la clé (body-parser brut, ou "corps de requête vide" alors qu'il ne
// l'est pas).
//
// Note : l'absence totale de Content-Type n'est PAS testée ici — type-is
// (utilisé par express.text()/express.raw()/express.json()) ne fait
// correspondre aucun parseur sans un Content-Type déclaré, sur aucune des
// deux routes, comportement de bibliothèque préexistant et jamais atteint
// en usage réel (frontend/traces.js pose toujours explicitement
// application/gpx+xml ou application/octet-stream). Vérifié manuellement
// (curl sans en-tête Content-Type → 400 identique sur les deux routes,
// avant comme après ce correctif) plutôt que supposé.
test('POST /api/import/gpx : Content-Type application/json (mismatch) → toujours importé, pas intercepté par express.json()', async () => {
  const res = await fetch(`${base}/api/import/gpx?name=test-gpx-json-ct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: SYNTHETIC_GPX,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).points, 20);
});

test('POST /api/import/fit : Content-Type application/json (mismatch) → toujours importé, pas intercepté par express.json()', async () => {
  const res = await fetch(`${base}/api/import/fit?name=test-fit-json-ct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: encodeFit(syntheticFitPoints()),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).points, 20);
});
