'use strict';
// GET /api/traces/climb-efforts (Epic 31.3) de bout en bout : deux imports
// réels de la même montée, à des allures différentes, + rendu frontend.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-efforts-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
const { buildEffortRows } = require('../frontend/traces.js');

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

// 1 km de plat, 4 km à 7 %, 1 km de plat ; vitesse constante (m/s).
function ride(speed, day) {
  const pts = [];
  for (let d = 0; d <= 6000; d += 20) {
    const ele = 400 + Math.max(0, Math.min(d, 5000) - 1000) * 0.07;
    pts.push({ lat: 45.2 + d / 111195, lon: 6.1, ele, time: new Date(Date.UTC(2026, 5, day, 8, 0, 0) + (d / speed) * 1000) });
  }
  return pts;
}

test('deux montées de la même côte : un groupe, deux temps cohérents avec les allures', async () => {
  const { importTrackAsStage } = require('../pipeline/importTrack');
  await importTrackAsStage(ride(4, 1), { name: 'Lente' });
  await importTrackAsStage(ride(5, 8), { name: 'Rapide' });
  const { climbs } = await (await fetch(`${base}/api/traces/climb-efforts`)).json();
  assert.strictEqual(climbs.length, 1, JSON.stringify(climbs));
  const [c] = climbs;
  assert.strictEqual(c.count, 2);
  assert.strictEqual(c.timedCount, 2);
  const [lente, rapide] = c.passages;
  assert.strictEqual(lente.stageName, 'Lente');
  // Même longueur de référence pour les deux : le rapport des temps est celui des allures.
  const ratio = lente.timeS / rapide.timeS;
  assert.ok(Math.abs(ratio - 5 / 4) < 0.02, `rapport ${ratio}`);
  assert.ok(Math.abs(lente.timeS - (c.refLengthKm * 1000) / 4) <= 60, `${lente.timeS} s pour ${c.refLengthKm} km à 4 m/s`);
  assert.strictEqual(c.bestTimeS, rapide.timeS);
});

test('buildEffortRows : textes échappés, meilleur temps marqué, raison lisible si pas de temps', () => {
  const html = buildEffortRows([{
    name: '<img src=x>', category: '3', summitEleM: 680, refLengthKm: 4, count: 2, timedCount: 1, bestTimeS: 900,
    passages: [
      { stageId: 1, stageName: '<b>A</b>', date: '2026-06-01', timeS: 900, reason: null },
      { stageId: 2, stageName: 'B', date: null, timeS: null, reason: 'sans-temps' },
    ],
  }]);
  assert.ok(!html.includes('<img') && !html.includes('<b>A</b>'));
  assert.match(html, /★/);
  assert.match(html, /réimportez-la/);
  assert.match(html, /2 passages \(1 chronométré\)/);
});
