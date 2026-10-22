'use strict';
// Issue #486 (revue globale du 22/10/2026) : une sauvegarde forgée déposait du
// HTML que trois pages réinséraient brut — stages.state (badge), climbs.
// km_blocks[].ele0 (profil de côte), stages.progress.percent (Archives).
// CLAUDE.md règle 1 : chaque couche se ferme et se teste séparément — l'import
// refuse la donnée, et l'affichage ne la réinsère jamais brute.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backupxss-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const PAYLOAD = '<img src=x onerror=alert(1)>';
let appServer;
let base;
let exported;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const ed = await (await json('/api/editions', 'POST', { name: 'Éd', year: 2001 })).json();
  const r = await json('/api/stages', 'POST', {
    name: 'B', edition_id: ed.id, date: '2001-07-07',
    waypoints: [{ label: 'A', kind: 'start', lat: 43.3, lon: -0.37 }, { label: 'Z', kind: 'finish', lat: 43.0, lon: -0.1 }],
  });
  assert.strictEqual(r.status, 200);
  exported = (await (await fetch(`${base}/api/backup/export`)).json()).tables;
});
after(() => {
  appServer?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const tamper = (fn) => {
  const tables = JSON.parse(JSON.stringify(exported));
  fn(tables);
  return json('/api/backup/import', 'POST', { confirm: true, tables });
};
const climb = (t, blocks) => { t.climbs = [{ id: 1, stage_id: t.stages[0].id, name: 'Côte', km_blocks: JSON.stringify(blocks) }]; };
const BLOCK = { fromM: 0, toM: 1000, ele0: 400, ele1: 470, gradient: 7 };

// --- Couche 1 : l'import refuse la donnée ----------------------------------

for (const [what, fn, re] of [
  ['state hors liste', (t) => { t.stages[0].state = PAYLOAD; }, /stages\[0\]\.state/],
  ['km_blocks pas un tableau', (t) => climb(t, { a: 1 }), /climbs\[0\]\.km_blocks : tableau/],
  ['km_blocks[].ele0 en texte', (t) => climb(t, [{ ...BLOCK, ele0: PAYLOAD }]), /climbs\[0\]\.km_blocks : ele0 : nombre attendu/],
  ['progress.percent en texte', (t) => { t.stages[0].progress = JSON.stringify({ step: 'routage', percent: PAYLOAD }); }, /stages\[0\]\.progress : percent/],
  ['progress en tableau', (t) => { t.stages[0].progress = '[1]'; }, /stages\[0\]\.progress : objet attendu/],
]) {
  test(`backup/import : ${what} → 400`, async () => {
    const r = await tamper(fn);
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, re);
  });
}

test('backup/import : des km_blocks et un progress tels que le pipeline les écrit passent', async () => {
  const r = await tamper((t) => {
    climb(t, [BLOCK, { ...BLOCK, fromM: 1000, toM: 2000 }]);
    t.stages[0].state = 'generating';
    t.stages[0].progress = JSON.stringify({ step: 'côtes', detail: 'détection et catégorisation', percent: 50 });
  });
  assert.strictEqual(r.status, 200, await r.text());
});

// --- Couche 2 : l'affichage ne réinsère jamais la donnée brute --------------

const EF = require('../frontend/common.js');
global.EF = EF;
const EFProfile = require('../frontend/profile.js');
const { stageRow } = require('../frontend/archives.js');

test('stateBadge : un state inconnu est échappé, jamais en classe ni en HTML', () => {
  const html = EF.stateBadge(PAYLOAD);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /^<span class="badge">&lt;img/);
  assert.match(EF.stateBadge('draft'), /class="badge draft">brouillon/);
});

test('renderClimbSVG : un ele0 non numérique ne sort pas dans le SVG', () => {
  const svg = EFProfile.renderClimbSVG({
    start_ele_m: 400, summit_ele_m: 470, start_km: 0, end_km: 2, length_km: 2,
    km_blocks: [{ ...BLOCK, ele0: PAYLOAD }, { ...BLOCK, fromM: 1000, toM: 2000 }],
  }, { width: 600, height: 200 });
  assert.doesNotMatch(svg, /<img/);
});

test('Archives : un progress.percent non numérique ne sort pas dans la ligne', () => {
  const html = stageRow({ id: 1, name: 'B', state: 'generating', progress: { step: 'routage', percent: PAYLOAD } });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /routage 0%/);
});
