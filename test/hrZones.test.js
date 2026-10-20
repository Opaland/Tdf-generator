'use strict';
// Zones de FC (Epic 30.5) : GET/PUT /api/profile (FC max saisie) et calcul du
// temps par zone côté fiche (frontend/stage.js).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-hrzones-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

global.EF = { qs: () => null, esc: (s) => String(s ?? '').replace(/</g, '&lt;'), formatDuration: (s) => `${Math.round(s / 60)} min` };
const { hrZoneTimes, buildZonesTable } = require('../frontend/stage.js');

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

const put = (body) => fetch(`${base}/api/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('/api/profile : null par défaut, entier 100–240 accepté, le reste refusé sans effet, null efface', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/profile`)).json(), { hrMaxBpm: null, privacyZones: [] });
  assert.strictEqual((await put({ hrMaxBpm: 187 })).status, 200);
  for (const bad of [99, 241, 187.5, '187', true, [187], {}, undefined]) {
    assert.strictEqual((await put({ hrMaxBpm: bad })).status, 400, JSON.stringify(bad));
  }
  assert.deepStrictEqual(await (await fetch(`${base}/api/profile`)).json(), { hrMaxBpm: 187, privacyZones: [] });
  assert.strictEqual((await put({ hrMaxBpm: null })).status, 200);
  assert.deepStrictEqual(await (await fetch(`${base}/api/profile`)).json(), { hrMaxBpm: null, privacyZones: [] });
});

const s = (elapsed_s, hr_bpm) => ({ elapsed_s, hr_bpm });

test('hrZoneTimes : intervalle attribué à la zone de la FC du premier échantillon', () => {
  // FC max 200 : 110 → Z1 (55 %), 150 → Z3 (75 %), 185 → Z5 (92,5 %), 90 → sous Z1.
  const t = hrZoneTimes([s(0, 110), s(60, 150), s(180, 185), s(200, 90), s(260, 90)], 200);
  assert.deepStrictEqual(t.zones, [60, 0, 120, 0, 20]);
  assert.strictEqual(t.below, 60);
  assert.strictEqual(t.uncounted, 0);
});

test('hrZoneTimes : bornes — 60 % exact en Z2, ≥ 100 % en Z5', () => {
  assert.deepStrictEqual(hrZoneTimes([s(0, 120), s(10, 0)], 200).zones, [0, 10, 0, 0, 0]);
  assert.deepStrictEqual(hrZoneTimes([s(0, 210), s(10, 0)], 200).zones, [0, 0, 0, 0, 10]);
});

test('hrZoneTimes : FC absente ou arrêt long → non compté, jamais réparti ; temps absent ou non croissant ignoré', () => {
  const t = hrZoneTimes([s(0, null), s(30, 150), s(1000, 150), s(null, 150), s(1100, 150), s(1090, 150)], 200);
  assert.deepStrictEqual(t.zones, [0, 0, 0, 0, 0]);
  assert.strictEqual(t.uncounted, 30 + 970);
});

test('buildZonesTable : bornes en bpm et message si rien d\'exploitable', () => {
  const html = buildZonesTable(hrZoneTimes([s(0, 150), s(600, 150)], 200), 200);
  assert.match(html, /140–159</);
  assert.match(html, /≥ 180</);
  assert.match(html, /100 %/);
  assert.match(buildZonesTable({ zones: [0, 0, 0, 0, 0], below: 0, uncounted: 50 }, 200), /Aucun intervalle/);
});

test('zones : pour toute FC max de 100 à 240 et tout bpm entier, la zone calculée est celle que le tableau affiche', () => {
  const { hrZoneBounds } = require('../frontend/stage.js');
  for (let hrMax = 100; hrMax <= 240; hrMax++) {
    const html = buildZonesTable({ zones: [1, 1, 1, 1, 1], below: 1, uncounted: 0 }, hrMax);
    const ranges = [...html.matchAll(/<td style="white-space:nowrap">(≥ \d+|\d+–\d+|&lt; \d+|< \d+)<\/td>/g)].map((m) => m[1]);
    assert.strictEqual(ranges.length, 6, `hrMax ${hrMax}`);
    const bounds = hrZoneBounds(hrMax);
    for (let bpm = 25; bpm <= 250; bpm++) {
      const t = hrZoneTimes([{ elapsed_s: 0, hr_bpm: bpm }, { elapsed_s: 1, hr_bpm: bpm }], hrMax);
      const z = t.zones.findIndex((v) => v === 1);
      const shown = z === -1 ? ranges[5] : ranges[z];
      const m = shown.match(/(\d+)–(\d+)/);
      if (m) assert.ok(bpm >= +m[1] && bpm <= +m[2], `hrMax ${hrMax}, ${bpm} bpm compté en ${shown}`);
      else if (/≥/.test(shown)) assert.ok(bpm >= bounds[4].lo, `hrMax ${hrMax}, ${bpm} bpm`);
      else assert.ok(bpm < bounds[0].lo, `hrMax ${hrMax}, ${bpm} bpm sous Z1`);
    }
  }
});
