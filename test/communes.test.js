'use strict';
// Communes traversées à la demande (Epic 12, option B) : pipeline/communes.js,
// POST /api/stages/:id/communes, tracks.communes (migration 6), fiche et
// roadbook. geo.api.gouv.fr simulé (règle 6 : seul cet hôte est intercepté).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-communes-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { setOffline } = require('../pipeline/http');
const { communesAlong } = require('../pipeline/communes');

let realFetch;
let appServer;
let base;
const geoCalls = [];
let geoDelayMs = 0;
let geoEmpty = false;
// Commune selon la longitude : < 5.02 → A, < 5.04 → B, sinon C (format réel :
// tableau d'objets {nom, code, codeDepartement}, vérifié le 17/10/2026).
function fakeCommune(lon) {
  if (lon < 5.02) return { nom: 'Alpha', code: '01001', codeDepartement: '01' };
  if (lon < 5.04) return { nom: 'Bêta <b>', code: '01002', codeDepartement: '01' };
  return { nom: 'Gamma', code: '01003', codeDepartement: '01' };
}

before(async () => {
  realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.host !== 'geo.api.gouv.fr') return realFetch(url, opts);
    geoCalls.push(u.search);
    if (geoDelayMs) await new Promise((r) => setTimeout(r, geoDelayMs));
    const lon = Number(u.searchParams.get('lon'));
    return { ok: true, status: 200, json: async () => (geoEmpty ? [] : [fakeCommune(lon)]) };
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

// 6 km plein est à 45° N : un échantillon tous les 250 m.
const samples = [];
for (let i = 0; i <= 24; i++) samples.push({ dist_m: i * 250, lat: 45.0, lon: 5.0 + (0.06 * i) / 24 });

test('communesAlong : un point par km, communes consécutives dédoublonnées, km d\'entrée', async () => {
  setOffline(false);
  try {
    geoCalls.length = 0;
    const r = await communesAlong(samples);
    assert.strictEqual(r.points, 7); // km 0 à 6
    assert.strictEqual(geoCalls.length, 7);
    assert.deepStrictEqual(r.communes.map((c) => [c.nom, c.km]), [['Alpha', 0], ['Bêta <b>', 2], ['Gamma', 4]]);
    // Deuxième passage : tout vient du cache, aucun appel.
    geoCalls.length = 0;
    await communesAlong(samples);
    assert.strictEqual(geoCalls.length, 0);
  } finally {
    setOffline(true);
  }
});

test('communesAlong : point hors du cadre français → ni requête ni commune, compté à part', async () => {
  setOffline(false);
  try {
    geoCalls.length = 0;
    const r = await communesAlong([{ dist_m: 0, lat: 40.4, lon: -3.7 }, { dist_m: 1000, lat: 40.41, lon: -3.7 }]); // Madrid
    assert.strictEqual(r.pointsHorsFrance, 2);
    assert.deepStrictEqual(r.communes, []);
    assert.strictEqual(geoCalls.length, 0);
  } finally {
    setOffline(true);
  }
});

async function generatedStage() {
  const { generateStage } = require('../pipeline/generate');
  const created = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape communes', waypoints: [{ label: 'A', lat: 45.0, lon: 5.0 }, { label: 'B', lat: 45.0, lon: 5.06 }] }),
  })).json();
  await generateStage(created.id); // hors-ligne : simulateur
  return created.id;
}

test('route : hors-ligne → 503 ; étape non générée → 409', async () => {
  const id = await generatedStage();
  let res = await fetch(`${base}/api/stages/${id}/communes`, { method: 'POST' });
  assert.strictEqual(res.status, 503);
  const draft = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Brouillon', waypoints: [{ label: 'A' }, { label: 'B' }] }),
  })).json();
  setOffline(false);
  try {
    res = await fetch(`${base}/api/stages/${draft.id}/communes`, { method: 'POST' });
    assert.strictEqual(res.status, 409);
  } finally {
    setOffline(true);
  }
});

test('route : calcul, stockage, relecture sur la fiche, roadbook échappé ; régénération → remis à zéro', async () => {
  const id = await generatedStage();
  setOffline(false);
  try {
    const res = await fetch(`${base}/api/stages/${id}/communes`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).communes.length >= 2);
  } finally {
    setOffline(true);
  }
  const full = await (await fetch(`${base}/api/stages/${id}`)).json();
  assert.ok(full.track.communes.communes.some((c) => c.nom === 'Alpha'));
  const html = await (await fetch(`${base}/api/stages/${id}/roadbook.html`)).text();
  assert.match(html, /<h2>Communes traversées<\/h2>/);
  assert.match(html, /Bêta &lt;b&gt;/, 'nom de commune échappé (règle 1)');
  assert.doesNotMatch(html, /Bêta <b>/);
  const { generateStage } = require('../pipeline/generate');
  await generateStage(id);
  const again = await (await fetch(`${base}/api/stages/${id}`)).json();
  assert.strictEqual(again.track.communes, null, 'jamais une liste périmée après régénération');
});

test('tracks.communes illisible ou mal formé (sauvegarde forgée) → null, jamais d\'exception', async () => {
  const id = await generatedStage();
  const { getDb } = require('../backend/db');
  const { loadStageFull } = require('../pipeline/generate');
  const ok = (c) => JSON.stringify({ stepM: 1000, points: 1, communes: [{ nom: 'a', km: 1, ...c }] });
  for (const bad of ['pas du json', '{"communes": "x", "points": 1}', '{"communes": [{"nom": 3, "km": 1}], "points": 1}', '[]', 'null',
    // Relecture adverse : un département objet faisait planter le roadbook (500) et la fiche.
    ok({ departement: { toString: 1 } }), ok({ code: ['x'] }), ok({ km: -1 }), ok({ km: 1e21 }),
    JSON.stringify({ stepM: '<svg onload=1>', points: 1, communes: [] }), JSON.stringify({ stepM: 0, points: 1, communes: [] }),
    JSON.stringify({ stepM: 1000, points: 1.5, communes: [] }), JSON.stringify({ stepM: 1000, points: 1, pointsSansCommune: 'x', communes: [] })]) {
    getDb().prepare('UPDATE tracks SET communes = ? WHERE stage_id = ?').run(bad, id);
    assert.strictEqual(loadStageFull(id).track.communes, null, bad);
  }
  const html = await (await fetch(`${base}/api/stages/${id}/roadbook.html`)).text();
  assert.doesNotMatch(html, /Communes traversées/);
});

test('API qui répond [] (point sans commune française) : compté à part, pas d\'exception', async () => {
  setOffline(false);
  geoEmpty = true;
  try {
    const r = await communesAlong([{ dist_m: 0, lat: 46.5, lon: 6.6 }]); // Lausanne : dans la bbox, hors de France
    assert.strictEqual(r.pointsSansCommune, 1);
    assert.deepStrictEqual(r.communes, []);
  } finally {
    geoEmpty = false;
    setOffline(true);
  }
});

test('régénération pendant le calcul → 409, jamais la liste de l\'ancien tracé sur le nouveau', async () => {
  const id = await generatedStage();
  const { getDb } = require('../backend/db');
  setOffline(false);
  geoDelayMs = 40;
  try {
    // Cache vidé pour forcer des appels lents.
    getDb().prepare("DELETE FROM api_cache").run();
    const pending = fetch(`${base}/api/stages/${id}/communes`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 60));
    // Régénération simulée au milieu : la ligne tracks est remplacée.
    getDb().prepare("UPDATE tracks SET geojson = json_set(geojson, '$.properties.regen', 1), communes = NULL WHERE stage_id = ?").run(id);
    const res = await pending;
    assert.strictEqual(res.status, 409);
    assert.match((await res.json()).error, /régénérée pendant le calcul/);
    assert.strictEqual(getDb().prepare('SELECT communes FROM tracks WHERE stage_id = ?').get(id).communes, null);
  } finally {
    geoDelayMs = 0;
    setOffline(true);
  }
});
