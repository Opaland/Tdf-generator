'use strict';
// Test de GET /api/editions et /api/editions/:id — backlog issue #10, section D,
// "filtre entièrement sourcé / reconstruction partielle" : distinguer une édition
// dont chaque étape a des points de passage vérifiés (historic_routes.json)
// d'une reconstruction Wikipédia-seule (villes de départ/arrivée uniquement).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-editions-test-${process.pid}`);
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

async function importYear(year) {
  const res = await fetch(`${base}/api/editions/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year }),
  });
  assert.strictEqual(res.status, 200);
  return res.json();
}

test('1903 (chaque étape a des points de passage curés) : entièrement sourcé', async () => {
  await importYear(1903);
  const editions = await (await fetch(`${base}/api/editions`)).json();
  const ed = editions.find((e) => e.year === 1903);
  assert.strictEqual(ed.stage_count, 6);
  assert.strictEqual(ed.curated_stage_count, 6, 'toutes les étapes 1903 ont un point de passage curé');
});

test('2025 (étapes reines seulement) : reconstruction partielle', async () => {
  await importYear(2025);
  const editions = await (await fetch(`${base}/api/editions`)).json();
  const ed = editions.find((e) => e.year === 2025);
  assert.strictEqual(ed.stage_count, 21);
  assert.ok(ed.curated_stage_count > 0, 'au moins les étapes reines sont curées');
  assert.ok(ed.curated_stage_count < ed.stage_count, 'pas toutes les étapes — reconstruction partielle');
});

test('GET /api/editions/:id : is_curated par étape correspond exactement aux étapes avec un waypoint curé', async () => {
  const { edition } = await importYear(2025);
  const full = await (await fetch(`${base}/api/editions/${edition.id}`)).json();
  const curatedCount = full.stages.filter((s) => s.is_curated).length;
  assert.ok(curatedCount > 0);
  // recoupe avec le compteur d'édition (même source de vérité, deux routes différentes)
  const editions = await (await fetch(`${base}/api/editions`)).json();
  const edSummary = editions.find((e) => e.id === edition.id);
  assert.strictEqual(curatedCount, edSummary.curated_stage_count);
});

test('done_count compte les étapes distinctes, pas les lignes de la jointure waypoints (régression)', async () => {
  // 1903 étape 1 a plusieurs waypoints curés (start + via col + finish) —
  // avant correctif, un SUM(CASE WHEN s.state='done'...) sur la ligne jointe
  // aux waypoints aurait compté cette étape plusieurs fois (une fois par
  // waypoint) dès qu'elle passe à l'état 'done'.
  const { edition, stages } = await importYear(1903);
  const { getDb } = require('../backend/db');
  const db = getDb();
  const stage1 = stages.find((s) => s.number === 1);
  const wpCount = db.prepare('SELECT COUNT(*) AS n FROM waypoints WHERE stage_id = ?').get(stage1.id).n;
  assert.ok(wpCount > 1, 'hypothèse du test : plusieurs waypoints sur cette étape');
  db.prepare(`UPDATE stages SET state = 'done' WHERE id = ?`).run(stage1.id);

  const editions = await (await fetch(`${base}/api/editions`)).json();
  const ed = editions.find((e) => e.id === edition.id);
  assert.strictEqual(ed.done_count, 1, `done_count doit rester 1 (une étape 'done'), pas ${wpCount} (nb de waypoints)`);
});

test('GET /api/editions/highlights : liste triée des éditions mythiques, sans besoin d\'import préalable', async () => {
  // Route servie directement depuis historic_routes.json (pipeline/wikipedia.js),
  // aucune dépendance à la base — vérifie ça explicitement en n'important aucune
  // édition avant l'appel (contrairement aux autres tests de ce fichier).
  const highlights = await (await fetch(`${base}/api/editions/highlights`)).json();
  assert.ok(Array.isArray(highlights));
  assert.ok(highlights.length >= 8, 'au moins les 8 années mythiques pré-2020 curées à ce jour');
  const years = highlights.map((h) => h.year);
  assert.deepStrictEqual(years, [...years].sort((a, b) => a - b), 'triée par année croissante');
  const y1922 = highlights.find((h) => h.year === 1922);
  assert.strictEqual(y1922.highlight, "Premier Izoard");
  assert.ok(!years.includes(2025), 'les éditions 2020+ (détaillées mais pas "mythiques") n\'ont pas de highlight');
});
