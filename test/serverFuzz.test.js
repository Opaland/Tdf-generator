'use strict';
// Régression sur deux bugs trouvés par fuzzing (monkey test API, persona
// "Fatiha") et corrigés dans la foulée :
//  1. POST/PUT sur /api/stages et /api/editions plantait en 500 (avec fuite
//     de stack trace incluant les chemins de fichiers du serveur) dès qu'un
//     champ attendu en chaîne recevait un objet/tableau/booléen — SQLite
//     (better-sqlite3) n'accepte que number/string/bigint/buffer/null comme
//     paramètre lié.
//  2. Le mini-site HTML exporté (backend/exports.js) était vulnérable à une
//     évasion de balise <script> : un nom d'étape contenant le texte littéral
//     "</script>" fermait prématurément le <script> qui embarque les
//     données JSON, faisant passer le reste du payload comme du HTML brut
//     interprété par le navigateur — indépendamment de tout échappement côté
//     JS client (le DOM-sink escHtml() ajouté plus tôt ne protégeait pas
//     contre cette évasion au niveau du parseur HTML lui-même).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-serverfuzz-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

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

const NON_STRINGS = [{}, [], [1, 2, 3], true, false];

for (const bad of NON_STRINGS) {
  test(`POST /api/stages avec name=${JSON.stringify(bad)} : 400 propre, pas 500`, async () => {
    const res = await fetch(`${base}/api/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bad, waypoints: [{ label: 'A' }, { label: 'B' }] }),
    });
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.ok(json.error);
  });
}

test('POST /api/editions avec name non-chaîne : 400 propre, pas 500', async () => {
  const res = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: { toString: () => 'x' } }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST /api/editions avec year non-numérique : 400 propre, pas 500', async () => {
  const res = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Édition test', year: ['pas un an'] }),
  });
  assert.strictEqual(res.status, 400);
});

test('PUT /api/stages/:id avec des champs non-chaîne : 400 propre, pas 500', async () => {
  const create = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape valide', waypoints: [{ label: 'A' }, { label: 'B' }] }),
  });
  const { id } = await create.json();
  const res = await fetch(`${base}/api/stages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: [1, 2, 3] }),
  });
  assert.strictEqual(res.status, 400);
});

test('erreur non gérée : JSON propre, jamais la page HTML par défaut d\'Express (fuite de stack trace)', async () => {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: true, waypoints: [{ label: 'A' }, { label: 'B' }] }),
  });
  assert.strictEqual(res.headers.get('content-type')?.includes('application/json'), true);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
  assert.ok(!text.includes('<pre>'), 'pas la page d\'erreur HTML par défaut d\'Express');
});

test('export.html : une évasion de balise </script> dans le nom d\'étape est neutralisée', async () => {
  const ed = await (await fetch(`${base}/api/editions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Fuzz XSS regression', is_custom: 1 }),
  })).json();

  const payload = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
  await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: payload, edition_id: ed.id, stage_order: 1,
      waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }],
    }),
  });

  const html = await (await fetch(`${base}/api/editions/${ed.id}/site`)).text();
  assert.ok(!html.includes('<script>window.__xss=1</script>'), 'le payload ne doit jamais apparaître comme un vrai tag <script> non échappé');
  assert.ok(!html.includes('<img src=x onerror='), 'le payload ne doit jamais apparaître comme un vrai tag <img> non échappé');
  assert.match(html, /\\u003cscript>window\.__xss=1/, 'le JSON embarqué doit échapper les < en \\u003c (évite la fermeture prématurée du <script> englobant)');
});

test('étape/export.html (fiche individuelle, backlog #10 section D) : même évasion </script>, même neutralisation', async () => {
  // Régression identique à la précédente mais sur stageToStandaloneHtml
  // (nouvelle fonction sœur de tourToStandaloneHtml) — CLAUDE.md règle 1 :
  // corriger la faille sur un chemin ne ferme pas la classe de bug sur un
  // autre chemin qui la réintroduit indépendamment.
  const payload = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: payload, waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();

  const html = await (await fetch(`${base}/api/stages/${create.id}/site`)).text();
  assert.ok(!html.includes('<script>window.__xss=1</script>'), 'le payload ne doit jamais apparaître comme un vrai tag <script> non échappé');
  assert.ok(!html.includes('<img src=x onerror='), 'le payload ne doit jamais apparaître comme un vrai tag <img> non échappé');
  assert.match(html, /\\u003cscript>window\.__xss=1/, 'le JSON embarqué doit échapper les < en \\u003c (évite la fermeture prématurée du <script> englobant)');
});

test('GET /api/stages/:id/export.html : téléchargement (Content-Disposition attachment)', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape à exporter', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const res = await fetch(`${base}/api/stages/${create.id}/export.html`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-disposition')?.includes('attachment'));
  assert.ok(res.headers.get('content-type')?.includes('text/html'));
});

test('GET /api/stages/:id/export.html : étape introuvable → erreur JSON propre, pas 500 avec fuite de stack', async () => {
  const res = await fetch(`${base}/api/stages/999999/export.html`);
  assert.notStrictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
});
