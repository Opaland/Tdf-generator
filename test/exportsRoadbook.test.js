'use strict';
// Tests HTTP ciblant les branches conditionnelles de stageToRoadbookHtml/
// tourToStandaloneHtml/stageToStandaloneHtml (backend/exports.js) qui ne
// sont pas testables sans DB (elles appellent loadStageFull()/getDb() en
// interne, contrairement aux fonctions couvertes directement dans
// test/exports.test.js) — même motif de score de mutation faible (backlog
// #64) que ce fichier, mais qui nécessite le serveur HTTP réel plutôt qu'un
// objet `full` synthétique. Complète test/serverFuzz.test.js (déjà centré
// sur les régressions XSS/500) sans le dupliquer.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-exports-roadbook-test-${process.pid}`);
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

test('roadbook.html : étape rattachée à une édition -> le nom de l\'édition préfixe la ligne meta', async () => {
  const ed = await (await fetch(`${base}/api/editions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Édition roadbook test', is_custom: 1 }),
  })).json();
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape avec édition', edition_id: ed.id, waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const html = await (await fetch(`${base}/api/stages/${create.id}/roadbook.html`)).text();
  assert.match(html, /Édition roadbook test —/);
});

test('roadbook.html : étape sans édition -> pas de préfixe (ni "undefined", ni "null", ni un tiret orphelin)', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape sans édition', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const html = await (await fetch(`${base}/api/stages/${create.id}/roadbook.html`)).text();
  const meta = html.match(/<p class="meta">([^<]*)<\/p>/)[1];
  assert.ok(!meta.includes('undefined') && !meta.includes('null'));
  assert.ok(!meta.trimStart().startsWith('—'), `pas de tiret orphelin en tête de la ligne meta : "${meta}"`);
});

test('roadbook.html : distance non générée -> "?", distance générée -> la valeur réelle (jamais les deux mélangés)', async () => {
  const notGenerated = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape distance non générée', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const metaNotGenerated = (await (await fetch(`${base}/api/stages/${notGenerated.id}/roadbook.html`)).text())
    .match(/<p class="meta">([\s\S]*?)<\/p>/)[1];
  assert.strictEqual(metaNotGenerated, '?', 'sans distance générée, la ligne meta doit afficher exactement "?" (pas "? km")');

  const { generateStage } = require('../pipeline/generate');
  const generated = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape distance générée', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  await generateStage(generated.id);
  const metaGenerated = (await (await fetch(`${base}/api/stages/${generated.id}/roadbook.html`)).text())
    .match(/<p class="meta">([\s\S]*?)<\/p>/)[1];
  assert.doesNotMatch(metaGenerated, /\?/, 'avec une distance générée, "?" ne doit plus apparaître à sa place');
  assert.match(metaGenerated, /^[0-9]+(\.[0-9]+)? km/);
});

test('roadbook.html : un waypoint d\'un kind non répertorié dans KIND_LABELS retombe sur "Passage", pas "undefined"', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape kind inconnu',
      waypoints: [{ label: 'Pau' }, { label: 'Point mystère', kind: 'kind_totalement_inconnu' }, { label: 'Tarbes' }],
    }),
  })).json();
  await generateStage(create.id);
  const html = await (await fetch(`${base}/api/stages/${create.id}/roadbook.html`)).text();
  assert.match(html, /<td>Passage<\/td>\s*<td>Point mystère<\/td>/);
  assert.doesNotMatch(html, /undefined/);
});

test('roadbook.html : aucune côte détectée -> message exact "Aucune côte détectée (seuil : ≥ 1,5 km à ≥ 3 %)."', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape sans côte (jamais générée)', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const html = await (await fetch(`${base}/api/stages/${create.id}/roadbook.html`)).text();
  assert.match(html, /<td colspan="7">Aucune côte détectée \(seuil : ≥ 1,5 km à ≥ 3 %\)\.<\/td>/);
});

test('roadbook.html : temps écoulé au départ toujours "0 min" (distance nulle), pas "0 h 00"', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape temps écoulé départ', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  await generateStage(create.id);
  const html = await (await fetch(`${base}/api/stages/${create.id}/roadbook.html`)).text();
  // Première ligne du tableau villes/points de passage = le départ (km 0.0).
  const firstRow = html.match(/<tbody>\s*<tr>([\s\S]*?)<\/tr>/)[1];
  assert.match(firstRow, /<td>0\.0<\/td><td>0 min<\/td>/);
});

test('site (tour) : édition sans source.notes -> aucun encart <p class="note"> (le cas "présent" n\'est pas déclenchable via l\'API publique, seulement par import historique)', async () => {
  const ed = await (await fetch(`${base}/api/editions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Édition sans notes', is_custom: 1 }),
  })).json();
  await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape 1', edition_id: ed.id, stage_order: 1, waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  });
  const html = await (await fetch(`${base}/api/editions/${ed.id}/site`)).text();
  // Le seul <p class="note"> légitime ici est celui, conditionnel, juste
  // après <main> (sourceInfo.notes) — le catch d'échec de chargement
  // Leaflet en écrit un autre, inconditionnel, mais dans une chaîne de JS
  // client (jamais un vrai tag HTML côté serveur) : ne pas le confondre.
  const mainBlock = html.match(/<main>([\s\S]*?)<div id="map">/)[1];
  assert.doesNotMatch(mainBlock, /<p class="note">/, 'une édition sans source.notes ne doit produire aucun encart <p class="note">');
});
