'use strict';
// Contrôle des itinéraires à ±5 % (Epic 33) : scripts/check-itineraries.js,
// routeur injecté — aucun appel réseau.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-itincheck-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { checkStage } = require('../scripts/check-itineraries');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

const town = (label, km, extra = {}) => ({ label, km, kind: 'ville', lat: 49, lon: 6 + km / 100, ...extra });

test('checkStage : écart routé / profil, tolérance ±5 % incluse, au-delà hors', async () => {
  const towns = [town('A', 0), town('B', 50), town('C', 100)];
  const at = (factor) => async (a, b) => (b.km - a.km) * 1000 * factor;
  assert.strictEqual((await checkStage(towns, at(1.049))).ok, true);
  assert.strictEqual((await checkStage(towns, at(0.951))).ok, true);
  const hors = await checkStage(towns, at(1.06));
  assert.strictEqual(hors.ok, false);
  assert.ok(Math.abs(hors.deltaPct - 6) < 1e-9);
  assert.strictEqual((await checkStage(towns, at(0.94))).ok, false);
});

test('checkStage : côte/lieu-dit au centre de sa commune non routés ; moins de la moitié du profil couverte → null', async () => {
  const seen = [];
  const router = async (a, b) => { seen.push(`${a.label}>${b.label}`); return (b.km - a.km) * 1000; };
  const towns = [town('A', 0), town('Côte', 30, { kind: 'côte', geocodeAs: 'X' }), town('B', 60)];
  await checkStage(towns, router);
  assert.deepStrictEqual(seen, ['A>B']);
  assert.strictEqual(await checkStage([town('A', 0), town('B', 40), { label: 'Z', km: 100, kind: 'ville' }], router), null);
});
