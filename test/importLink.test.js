'use strict';
// Import par lien d'export direct (POST /api/import/link) : cas d'usage Suunto
// app → export "GPX" qui ne donne pas de fichier local mais un lien signé
// api.sports-tracker.com (backend historique de l'appli Suunto). Le serveur
// va chercher le contenu à la place du navigateur (pas de CORS côté
// sports-tracker.com) — d'où une liste blanche d'hôtes stricte à vérifier
// (protection SSRF : un lien saisi par l'utilisateur ne doit jamais permettre
// au serveur d'aller sonder une adresse arbitraire, interne ou non).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-importlink-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const SYNTHETIC_GPX =
  '<?xml version="1.0"?><gpx><trk><name>Sortie Suunto</name><trkseg>' +
  Array.from({ length: 20 }, (_, i) => `<trkpt lat="${(43 + i * 0.001).toFixed(6)}" lon="0.5"><ele>${400 + i}</ele></trkpt>`).join('') +
  '</trkseg></trk></gpx>';

let appServer;
let base;
let realFetch;
let fetchCalls;

before(async () => {
  realFetch = global.fetch;
  fetchCalls = [];
  global.fetch = async (url, opts) => {
    // Ne simule que les appels sortants vers l'hôte d'export (sports-tracker.com) ;
    // les requêtes de test vers le serveur local (127.0.0.1) passent par le vrai fetch.
    if (!String(url).includes('sports-tracker.com')) return realFetch(url, opts);
    fetchCalls.push(String(url));
    if (String(url).includes('/broken-export/')) {
      return { ok: true, status: 200, text: async () => '{"not":"gpx"}' };
    }
    return { ok: true, status: 200, text: async () => SYNTHETIC_GPX };
  };

  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  global.fetch = realFetch;
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

async function post(body) {
  return fetch(`${base}/api/import/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('url manquante : 400', async () => {
  const res = await post({});
  assert.strictEqual(res.status, 400);
});

test('url http:// (non https) refusée : 400, aucun appel réseau', async () => {
  const before = fetchCalls.length;
  const res = await post({ url: 'http://api.sports-tracker.com/apiserver/v1/workouts/export/x' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(fetchCalls.length, before, 'ne doit jamais tenter la requête si le protocole est refusé');
});

test('hôte hors liste blanche refusé : 400, aucun appel réseau (protection SSRF)', async () => {
  const before = fetchCalls.length;
  const res = await post({ url: 'https://evil.example.com/apiserver/v1/workouts/export/x' });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /domaine|hôte/i);
  assert.strictEqual(fetchCalls.length, before, 'ne doit jamais tenter la requête vers un hôte non autorisé');
});

test('lien api.sports-tracker.com valide : GPX récupéré et importé comme étape', async () => {
  const res = await post({ url: 'https://api.sports-tracker.com/apiserver/v1/workouts/export/AF7Bp5ZCb1WMQfZ2AfkD4bOQO5t?brand=SUUNTOAPP' });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.ok(json.id);
  assert.strictEqual(json.points, 20);
});

test('lien valide mais réponse non-GPX : 400 (pas un crash serveur)', async () => {
  const res = await post({ url: 'https://api.sports-tracker.com/broken-export/x' });
  assert.strictEqual(res.status, 400);
});
