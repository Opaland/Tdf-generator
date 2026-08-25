'use strict';
// Test de backend/notify.js — notification d'échec de génération (backlog
// issue #10, section E : « webhook simple (Telegram, notif DSM…) quand une
// génération d'étape échoue en tâche de fond en mode self-hosted »).
// Un vrai serveur HTTP local (pas de mock de global.fetch) reçoit les
// requêtes envoyées par le module — évite le piège d'un mock global qui
// intercepterait aussi d'autres appels (voir CLAUDE.md règle 6).

const http = require('http');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { notifyGenerationFailure, buildMessage } = require('../backend/notify');

let server;
let base;
let received = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body, path: req.url });
      if (req.url === '/lent') {
        // Ne répond jamais dans le délai testé — simule un webhook qui
        // accepte la connexion sans jamais répondre.
        setTimeout(() => { res.writeHead(200); res.end('ok'); }, 2000);
        return;
      }
      const status = req.url === '/fail' ? 503 : 200;
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { received = []; });

const INFO = { stageId: 42, stageName: 'Pau → Hautacam', error: 'OSRM sans itinéraire' };

test('buildMessage() : message lisible avec le nom, l\'id et l\'erreur', () => {
  const msg = buildMessage(INFO);
  assert.match(msg, /Pau → Hautacam/);
  assert.match(msg, /#42/);
  assert.match(msg, /OSRM sans itinéraire/);
});

test('sans webhook configuré : false, aucune requête envoyée', async () => {
  const ok = await notifyGenerationFailure(INFO, null);
  assert.strictEqual(ok, false);
  assert.strictEqual(received.length, 0);
});

test('format JSON (par défaut) : text ET content portent le même message, Content-Type JSON', async () => {
  const ok = await notifyGenerationFailure(INFO, `${base}/hook`, 'json');
  assert.strictEqual(ok, true);
  assert.strictEqual(received.length, 1);
  const [r] = received;
  assert.strictEqual(r.method, 'POST');
  assert.match(r.headers['content-type'], /application\/json/);
  const body = JSON.parse(r.body);
  assert.strictEqual(body.text, buildMessage(INFO));
  assert.strictEqual(body.content, buildMessage(INFO));
  assert.strictEqual(body.stage_id, 42);
  assert.strictEqual(body.stage_name, 'Pau → Hautacam');
  assert.strictEqual(body.error, 'OSRM sans itinéraire');
  assert.ok(body.timestamp, 'horodatage présent');
});

test('format texte (ETAPEFORGE_NOTIFY_FORMAT=text, ex. ntfy.sh) : corps brut, pas de JSON', async () => {
  const ok = await notifyGenerationFailure(INFO, `${base}/hook`, 'text');
  assert.strictEqual(ok, true);
  const [r] = received;
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.strictEqual(r.body, buildMessage(INFO));
});

test('le récepteur répond en erreur (503) : false, pas d\'exception', async () => {
  const ok = await notifyGenerationFailure(INFO, `${base}/fail`, 'json');
  assert.strictEqual(ok, false);
});

test('webhook injoignable : false, pas d\'exception (ne doit jamais faire planter la génération)', async () => {
  const ok = await notifyGenerationFailure(INFO, 'http://127.0.0.1:1/injoignable', 'json');
  assert.strictEqual(ok, false);
});

// pipeline/rateLimiter.js n'entre pas en jeu ici (pas d'appel via httpJson/
// httpText), mais un webhook qui pend sans timeout laissait quand même la
// requête ouverte indéfiniment — trouvaille de sprint dédié.
test('webhook qui ne répond jamais : false bien avant le délai réel du serveur, pas de blocage', async () => {
  const start = Date.now();
  const ok = await notifyGenerationFailure(INFO, `${base}/lent`, 'json', 150);
  const elapsed = Date.now() - start;
  assert.strictEqual(ok, false);
  assert.ok(elapsed < 1500, `doit échouer bien avant les 2000 ms de réponse réelle du serveur (mesuré ${elapsed} ms)`);
});
