'use strict';
// Epic 35.4 (revue globale du 19/10/2026) : modifier une étape curée depuis
// l'éditeur effaçait sa provenance. L'éditeur ne relisait que
// {label, kind, lat, lon}, et le PUT (DELETE + INSERT des waypoints) n'avait
// ni bonus_sec, ni country_hint, ni region_hint : « parcours curé » devenait
// « éditeur », bonifications et indices disparaissaient.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-provenance-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { keepProvenance, clearProvenance } = require('../frontend/editor.js');

let appServer;
let base;
const send = (method, p, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fields = (w) => ({ label: w.label, kind: w.kind, lat: w.lat, lon: w.lon, source: w.source, altitude_hint_m: w.altitude_hint_m, bonus_sec: w.bonus_sec, country_hint: w.country_hint, region_hint: w.region_hint });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

let stageId;
let before1;

test("renommer une étape curée depuis l'éditeur garde chaque champ de chaque waypoint", async () => {
  // 2026 : la fixture hors-ligne dont les parcours curés portent des
  // bonifications et des indices de pays/région (1903 n'en a aucun).
  const imp = await (await send('POST', '/api/editions/import', { year: 2026 })).json();
  // L'étape qui porte le plus de champs de provenance.
  let best = null;
  for (const s of imp.stages) {
    const full = await (await fetch(`${base}/api/stages/${s.id}`)).json();
    const score = full.waypoints.filter((w) => w.bonus_sec || w.country_hint || w.region_hint).length * 100
      + full.waypoints.filter((w) => w.source === 'parcours curé').length;
    if (!best || score > best.score) best = { score, full };
  }
  assert.ok(best.full.waypoints.some((w) => w.source === 'parcours curé'), 'fixture : au moins un point curé');
  assert.ok(best.score >= 100, 'fixture : au moins un point avec bonification ou indice de pays/région');
  stageId = best.full.stage.id;
  before1 = best.full.waypoints.map(fields);

  // Ce que l'éditeur envoie désormais (frontend/editor.js : keepProvenance).
  const body = { name: 'Nom modifié', waypoints: best.full.waypoints.map(keepProvenance) };
  const put = await send('PUT', `/api/stages/${stageId}`, body);
  assert.strictEqual(put.status, 200);
  const after1 = (await (await fetch(`${base}/api/stages/${stageId}`)).json()).waypoints.map(fields);
  assert.deepStrictEqual(after1, before1);
});

test('PUT : un waypoint invalide ne laisse aucune écriture partielle', async () => {
  const wps = before1.map((w) => ({ ...w }));
  wps[0].lat = 999;
  const put = await send('PUT', `/api/stages/${stageId}`, { name: 'Ne doit pas être écrit', waypoints: wps });
  assert.strictEqual(put.status, 400);
  const full = await (await fetch(`${base}/api/stages/${stageId}`)).json();
  assert.strictEqual(full.stage.name, 'Nom modifié');
});

test('bonus_sec : liste de secondes seulement', async () => {
  for (const bad of ['10', [10, 'x'], [-1], { a: 1 }]) {
    const wps = before1.map((w) => ({ ...w }));
    wps[0].bonus_sec = bad;
    const r = await send('PUT', `/api/stages/${stageId}`, { waypoints: wps });
    assert.strictEqual(r.status, 400, JSON.stringify(bad));
  }
});

test('éditeur : retaper le libellé efface la provenance, la réordonner la garde', () => {
  const wp = keepProvenance({ label: 'Col de la République', kind: 'col', lat: 45.3, lon: 4.5, source: 'parcours curé', altitude_hint_m: 1161, bonus_sec: [10], country_hint: 'fr', region_hint: 'Loire', extra: 'x' });
  assert.strictEqual(wp.extra, undefined, 'seuls les champs connus du PUT');
  assert.strictEqual(wp.source, 'parcours curé');
  clearProvenance(wp);
  assert.deepStrictEqual([wp.source, wp.altitude_hint_m, wp.bonus_sec, wp.country_hint, wp.region_hint], ['éditeur', null, null, null, null]);
});
