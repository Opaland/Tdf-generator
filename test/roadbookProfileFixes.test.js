'use strict';
// Epic 35.15 (revue globale du 19/10/2026) : roadbook et étiquettes du profil.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-roadbook-fixes-test-${process.pid}`);
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

/** Étape en arrivée au sommet : 10 km, le col (dernier point) enregistré en « col ». */
async function summitFinishStage({ rawAtVillage = 520 } = {}) {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Arrivée au sommet', waypoints: [{ label: 'Village' }, { label: 'Hameau' }, { label: 'Col du Test' }] }),
  })).json();
  const { getDb } = require('../backend/db');
  const db = getDb();
  const id = create.id;
  db.prepare('DELETE FROM waypoints WHERE stage_id = ?').run(id);
  const insW = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
  insW.run(id, 0, 'Village', 'start', 45.0, 6.0);
  insW.run(id, 1, 'Hameau', 'via', 45.0, 6.05);
  insW.run(id, 2, 'Col du Test', 'col', 45.0, 6.1);
  const insS = db.prepare('INSERT INTO elevation_samples (stage_id, idx, dist_m, lat, lon, ele_raw_m, ele_smooth_m) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let k = 0; k <= 10; k++) {
    const raw = k === 0 ? rawAtVillage : 500 + k * 97;
    insS.run(id, k, k * 1000, 45.0, 6.0 + k * 0.01, raw, 500 + k * 94);
  }
  db.prepare(`INSERT INTO climbs (stage_id, name, category, score, start_km, end_km, length_km, start_ele_m, summit_ele_m, avg_gradient, max_gradient)
              VALUES (?, 'Col du Test', '1', 300, 0, 10, 10, 500, 1471, 9.7, 11)`).run(id);
  db.prepare("UPDATE stages SET state = 'done', generated_distance_km = 10 WHERE id = ?").run(id);
  return id;
}

function waypointRows(html) {
  const tbody = html.split('<h2>Villes et points de passage</h2>')[1].split('<tbody>')[1].split('</tbody>')[0];
  return [...tbody.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td>(.*?)<\/td>/g)].map((c) => c[1]));
}

test('roadbook : le col a la même altitude dans les deux tableaux, et l\'arrivée au sommet est une arrivée', async () => {
  const id = await summitFinishStage();
  const html = await (await fetch(`${base}/api/stages/${id}/roadbook.html`)).text();
  const rows = waypointRows(html);
  const last = rows[rows.length - 1];
  assert.strictEqual(last[2], 'Arrivée (col)');
  assert.strictEqual(last[4], '1471 m', 'altitude du sommet de la côte, pas la lissée (1440 m)');
  assert.match(html, /<td>1471 m<\/td><\/tr>/, 'même valeur dans le tableau des côtes');
  // Point hors côte : altitude mesurée, pas lissée.
  assert.strictEqual(rows[0][4], '520 m');
  assert.strictEqual(rows[0][2], 'Départ');
});

test('roadbook : une altitude manquante s\'affiche « — », jamais 0 m', async () => {
  const id = await summitFinishStage({ rawAtVillage: null });
  const { getDb } = require('../backend/db');
  getDb().prepare('UPDATE elevation_samples SET ele_smooth_m = NULL WHERE stage_id = ? AND idx = 0').run(id);
  const html = await (await fetch(`${base}/api/stages/${id}/roadbook.html`)).text();
  assert.strictEqual(waypointRows(html)[0][4], '—');
});

test('roadbook : le tableau des côtes défile horizontalement au lieu de déborder en mobile', async () => {
  const id = await summitFinishStage();
  const html = await (await fetch(`${base}/api/stages/${id}/roadbook.html`)).text();
  assert.match(html, /<h2>Côtes<\/h2>\s*<div class="scrollx">\s*<table>/);
  assert.match(html, /\.scrollx \{ overflow-x: auto; \}/);
});

test('profil : une étiquette près du bord droit part vers la gauche, une trop longue est raccourcie', () => {
  const { fitLabel } = require('../frontend/profile.js');
  const near = fitLabel('Hautacam (1520 m)', 970, 200, 1000);
  assert.strictEqual(near.flip, true);
  assert.strictEqual(near.text, 'Hautacam (1520 m)');
  const mid = fitLabel('Hautacam (1520 m)', 400, 200, 1000);
  assert.strictEqual(mid.flip, false);
  // Sommet en haut du graphique : peu de hauteur disponible.
  const top = fitLabel('Col du Grand Colombier (1501 m)', 400, 52, 1000);
  assert.ok(top.text.endsWith('…') && top.text.length < 31, top.text);
});

test('profil : l\'étiquette d\'un point de passage donne l\'altitude mesurée, et rien plutôt que « 0 m »', () => {
  const { renderProfileSVG } = require('../frontend/profile.js');
  const profile = [];
  for (let k = 0; k <= 20; k++) profile.push({ d: k * 1000, e: 400 + k * 10, r: 400 + k * 10 + 7, lat: 45, lon: 6 + k * 0.01 });
  profile[10].r = null;
  profile[10].e = null;
  const svg = renderProfileSVG({
    stage: { generated_distance_km: 20 },
    climbs: [],
    waypoints: [
      { label: 'Départ', kind: 'start', lat: 45, lon: 6 },
      { label: 'Trou', kind: 'via', lat: 45, lon: 6.1 },
      { label: 'Fin', kind: 'finish', lat: 45, lon: 6.2 },
    ],
    profile,
  }, { width: 1000, height: 260 });
  assert.match(svg, />Départ \(407 m\)</);
  assert.match(svg, />Trou</);
  assert.doesNotMatch(svg, /Trou \(0 m\)/);
});

test('côtes : un lieu qui est déjà un relief n\'est pas préfixé « Côte de », et un doublon prend son km', async () => {
  const { nameClimbs } = require('../pipeline/climbs');
  const climbs = [{ endM: 8000 }, { endM: 14000 }, { endM: 30000 }];
  const samples = [{ dist: 8000, lat: 45, lon: 6 }, { dist: 14000, lat: 45.1, lon: 6 }, { dist: 30000, lat: 45.2, lon: 6 }];
  const labels = { 45: 'Col du Pin-Bouchain', 45.1: 'Col du Pin-Bouchain', 45.2: 'Tarare' };
  await nameClimbs(climbs, [], samples, async (lat) => ({ label: labels[lat] }));
  assert.deepStrictEqual(climbs.map((c) => c.name), ['Col du Pin-Bouchain (km 8)', 'Col du Pin-Bouchain (km 14)', 'Côte de Tarare']);
  assert.strictEqual(climbs[0].rawLabel, 'Col du Pin-Bouchain');
});
