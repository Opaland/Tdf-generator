'use strict';
// Temps écoulé par échantillon (Epic 31.2) : pipeline/rideStats.js
// (elapsedAtSamples), migration 9, import de bout en bout.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-elapsed-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { elapsedAtSamples } = require('../pipeline/rideStats');
const { nearestRawIndices } = require('../pipeline/geo');

after(() => {
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const t0 = Date.UTC(2026, 5, 1, 8, 0, 0);
const at = (s) => new Date(t0 + s * 1000);

test('nearestRawIndices : point brut le plus proche, à égalité le premier', () => {
  assert.deepStrictEqual(nearestRawIndices([0, 100, 200], [0, 49, 50, 51, 200, 250].map((dist) => ({ dist }))), [0, 0, 0, 1, 2, 2]);
});

test('elapsedAtSamples : depuis le premier point horodaté, jamais interpolé ; trou = null', () => {
  const points = [{ time: at(10) }, { time: at(70) }, { time: null }, { time: at(200) }];
  const cum = [0, 100, 200, 300];
  const samples = [0, 40, 60, 190, 260].map((dist) => ({ dist }));
  assert.deepStrictEqual(elapsedAtSamples(points, cum, samples), [0, 0, 60, null, 190]);
});

test('elapsedAtSamples : aucun horodatage → tout null (jamais 0)', () => {
  assert.deepStrictEqual(elapsedAtSamples([{}, { time: new Date('x') }], [0, 10], [{ dist: 0 }, { dist: 10 }]), [null, null]);
});

test('import horodaté : elapsed_s croissant de 0 à la durée ; sans horodatage : null partout', async () => {
  const { importTrackAsStage } = require('../pipeline/importTrack');
  const { loadStageFull } = require('../pipeline/generate');
  const pts = (timed) => Array.from({ length: 41 }, (_, i) => ({ lat: 45.3 + i * 0.001, lon: 5.7, ele: 300 + i, time: timed ? at(i * 15) : null }));
  const full = loadStageFull(await importTrackAsStage(pts(true), { name: 'Horodatée' }));
  const el = full.samples.map((s) => s.elapsed_s);
  assert.strictEqual(el[0], 0);
  assert.strictEqual(el[el.length - 1], 600);
  for (let i = 1; i < el.length; i++) assert.ok(el[i] >= el[i - 1], `croissant à ${i}`);
  const none = loadStageFull(await importTrackAsStage(pts(false), { name: 'Sans heure' }));
  assert.ok(none.samples.every((s) => s.elapsed_s === null));
});

test('elapsedAtSamples : horodatages non croissants (horloge qui recule) → tout null, jamais négatif', () => {
  const points = [{ time: at(0) }, { time: at(60) }, { time: at(30) }, { time: at(90) }];
  assert.deepStrictEqual(elapsedAtSamples(points, [0, 100, 200, 300], [{ dist: 0 }, { dist: 300 }]), [null, null]);
});

test('elapsedAtSamples : points dupliqués au départ → le premier l\'emporte (0 s au départ)', () => {
  const points = [{ time: at(0) }, { time: at(5) }, { time: at(65) }];
  assert.deepStrictEqual(elapsedAtSamples(points, [0, 0, 100], [{ dist: 0 }, { dist: 100 }]), [0, 65]);
});
