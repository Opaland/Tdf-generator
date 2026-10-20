'use strict';
// Epic 35.3 (revue globale du 19/10/2026) : réimporter une année ne doit
// jamais effacer en silence ce que l'utilisateur a produit.
// - un tour personnalisé de la même année était supprimé avec ses étapes ;
// - les étapes déjà générées d'une édition étaient détruites (ids changés,
//   liens cassés) par un simple clic sur une vignette ou le « défi du jour ».

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-reimport-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('réimporter 1903 ne supprime pas un tour personnalisé de 1903', async () => {
  const custom = await (await post('/api/editions', { name: 'Mon tour 1903', year: 1903, is_custom: true })).json();
  const st = await (await post('/api/stages', { name: 'Perso', edition_id: custom.id, waypoints: [{ label: 'A', kind: 'start', lat: 48.85, lon: 2.35 }, { label: 'B', kind: 'finish', lat: 48.9, lon: 2.4 }] })).json();
  for (let i = 0; i < 2; i++) assert.strictEqual((await post('/api/editions/import', { year: 1903 })).status, 200);
  assert.strictEqual((await fetch(`${base}/api/editions/${custom.id}`)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/stages/${st.id}`)).status, 200);
});

test('réimport d\'une édition déjà générée : 409 sans rien effacer, puis remplacement sur demande explicite', async () => {
  const imp = await (await post('/api/editions/import', { year: 1903 })).json();
  const { generateStage } = require('../pipeline/generate');
  const stageId = imp.stages[0].id;
  await generateStage(stageId);

  const refused = await post('/api/editions/import', { year: 1903 });
  assert.strictEqual(refused.status, 409);
  const body = await refused.json();
  assert.strictEqual(body.generated, 1);
  assert.strictEqual(body.edition_id, imp.edition.id);
  assert.match(body.error, /1 étape générée/);
  const kept = await (await fetch(`${base}/api/stages/${stageId}`)).json();
  assert.strictEqual(kept.stage.state, 'done', 'étape générée intacte');

  const replaced = await post('/api/editions/import', { year: 1903, replace: true });
  assert.strictEqual(replaced.status, 200);
  assert.strictEqual((await fetch(`${base}/api/stages/${stageId}`)).status, 404);
});

test('import en masse : une édition déjà générée est laissée intacte et comptée à part', async () => {
  const { importAllEditions } = require('../pipeline/importer');
  const { getDb } = require('../backend/db');
  const ed = getDb().prepare("SELECT id FROM editions WHERE year = 1903 AND is_custom = 0").get();
  const sid = getDb().prepare('SELECT id FROM stages WHERE edition_id = ? ORDER BY stage_order LIMIT 1').get(ed.id).id;
  await require('../pipeline/generate').generateStage(sid);
  const { skipped, imported } = await importAllEditions();
  assert.deepStrictEqual(skipped.map((s) => s.year), [1903]);
  assert.ok(!imported.some((i) => i.year === 1903));
  assert.strictEqual((await fetch(`${base}/api/stages/${sid}`)).status, 200);
});

test('année non entière ou hors plage : 400 avec un message juste', async () => {
  const frac = await post('/api/editions/import', { year: 1903.7 });
  assert.strictEqual(frac.status, 400);
  const far = await post('/api/editions/import', { year: 3000 });
  assert.strictEqual(far.status, 400);
  assert.match((await far.json()).error, /1903 à 2100/);
});
