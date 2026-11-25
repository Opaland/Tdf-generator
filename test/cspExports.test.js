'use strict';
// Story 42.2, relecture adverse du 25/11/2026 : les pages HTML générées par
// le serveur (roadbook, aperçus des mini-sites) ont leurs propres scripts en
// ligne et chargent Leaflet depuis unpkg. Sous la CSP de l'application, le
// bouton « Imprimer » du roadbook et la carte des mini-sites ne marchaient
// plus. Elles reçoivent une CSP dédiée : chaque script en ligne autorisé par
// son empreinte sha256, aucun gestionnaire d'événement en ligne.
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-csp-exports-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let stageId;
let editionId;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const post = async (url, body) => (await fetch(base + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  editionId = (await post('/api/editions', { name: 'Édition CSP', is_custom: 1 })).id;
  stageId = (await post('/api/stages', { name: 'Étape CSP', edition_id: editionId, waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] })).id;
});

after(() => {
  appServer?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function directives(header) {
  const out = {};
  for (const part of header.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    out[name] = values;
  }
  return out;
}

const routes = () => [
  `/api/stages/${stageId}/roadbook.html`,
  `/api/stages/${stageId}/site`,
  `/api/editions/${editionId}/site`,
  `/api/stages/${stageId}/export.html`,
  `/api/editions/${editionId}/export.html`,
];

test('pages générées : chaque script en ligne est autorisé par son empreinte, sans unsafe-inline', async () => {
  for (const route of routes()) {
    const res = await fetch(base + route);
    assert.strictEqual(res.status, 200, route);
    const html = await res.text();
    const d = directives(res.headers.get('content-security-policy') || '');
    assert.ok(d['script-src'], `${route} : script-src attendu`);
    assert.ok(!d['script-src'].includes("'unsafe-inline'"), `${route} : script-src sans unsafe-inline`);
    assert.deepStrictEqual(d['object-src'], ["'none'"], route);
    assert.deepStrictEqual(d['frame-ancestors'], ["'none'"], route);
    let inline = 0;
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc=/.test(m[1])) {
        const src = m[1].match(/src="([^"]+)"/)[1];
        assert.ok(d['script-src'].some((v) => src.startsWith(v)), `${route} : ${src} non autorisé`);
        continue;
      }
      inline++;
      const h = `'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`;
      assert.ok(d['script-src'].includes(h), `${route} : script en ligne n° ${inline} sans empreinte autorisée`);
    }
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i, `${route} : gestionnaire d'événement en ligne`);
  }
});

test('roadbook : le bouton Imprimer est branché par un script autorisé', async () => {
  const html = await (await fetch(`${base}/api/stages/${stageId}/roadbook.html`)).text();
  assert.match(html, /<button class="no-print"[^>]*>Imprimer/);
  assert.match(html, /addEventListener\('click', \(\) => window\.print\(\)\)/);
});

// Story 42.4 : téléchargée puis ouverte depuis le disque, une page n'a plus
// l'en-tête du serveur — elle embarque la même politique dans une balise.
test('pages générées : la même CSP est embarquée dans une balise <meta>, sans frame-ancestors', async () => {
  for (const route of routes()) {
    const res = await fetch(base + route);
    const html = await res.text();
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(m, `${route} : balise CSP absente`);
    assert.ok(html.indexOf(m[0]) < html.search(/<script|<link/), `${route} : CSP après un script ou une feuille`);
    const header = directives(res.headers.get('content-security-policy'));
    delete header['frame-ancestors'];
    assert.deepStrictEqual(directives(m[1]), header, route);
  }
});
