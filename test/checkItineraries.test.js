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
const { checkStage, checkStoredStage, officialKm, measuredTowns } = require('../scripts/check-itineraries');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

const town = (label, km, extra = {}) => ({ label, km, kind: 'ville', lat: 49, lon: 6 + km / 100, ...extra });

test('checkStage : écart routé / profil, tolérance ±5 % incluse, au-delà hors', async () => {
  const towns = [town('A', 0), town('A2', 1), town('B', 50), town('C', 100)];
  const at = (factor) => async (a, b) => (b.km - a.km) * 1000 * factor;
  assert.strictEqual((await checkStage(towns, at(1.049), 100)).ok, true);
  assert.strictEqual((await checkStage(towns, at(0.951), 100)).ok, true);
  // Verdict sur la valeur publiée (arrondie à 0,1) : 5,04 % → 5,0 → dans la tolérance.
  assert.strictEqual((await checkStage(towns, at(1.0504), 100)).ok, true);
  const hors = await checkStage(towns, at(1.06), 100);
  assert.strictEqual(hors.ok, false);
  assert.ok(Math.abs(hors.deltaPct - 6) < 1e-9);
  // Premier tronçon (km 0 = départ fictif, zone neutralisée) jamais mesuré.
  const neutral = await checkStage(towns, async (a, b) => (a.km === 0 ? 40000 : (b.km - a.km) * 1000), 100);
  assert.strictEqual(neutral.ok, true);
  assert.strictEqual((await checkStage(towns, at(0.94), 100)).ok, false);
});

test('checkStage : côte/lieu-dit au centre de sa commune non routés ; moins de la moitié du profil couverte → null', async () => {
  const seen = [];
  const router = async (a, b) => { seen.push(`${a.label}>${b.label}`); return (b.km - a.km) * 1000; };
  const towns = [town('A', 0), town('A2', 1), town('Côte', 30, { kind: 'côte', geocodeAs: 'X' }), town('B', 60)];
  await checkStage(towns, router, 60);
  assert.deepStrictEqual(seen, ['A2>B']);
  // Au moins deux points routables mais moins de la moitié de l'étape : non contrôlable.
  assert.strictEqual(await checkStage([town('A', 0), town('A2', 1), town('B', 40), { label: 'Z', km: 100, kind: 'ville' }], router, 100), null);
  // Longueur inconnue : non contrôlable.
  assert.strictEqual(await checkStage([town('A', 0), town('A2', 1), town('B', 60)], router, null), null);
  // Couverture publiée : 59 km contrôlés sur 100.
  assert.strictEqual((await checkStage([town('A', 0), town('A2', 1), town('B', 60)], router, 100)).coveragePct, 59);
});

test('officialKm : length_km, sinon distance stage_towns, sinon dernier km d\'une transcription complète ; partielle sans longueur → null', () => {
  const towns = [{ km: 0 }, { km: 80 }];
  assert.strictEqual(officialKm({ length_km: 100, partial: true, towns }, { distanceKm: 90 }), 100);
  assert.strictEqual(officialKm({ partial: true, towns }, { distanceKm: 90 }), 90);
  assert.strictEqual(officialKm({ towns }, null), 80);
  assert.strictEqual(officialKm({ partial: true, towns }, null), null);
});

test('measuredTowns : un circuit final (circuit_km) sort de la mesure, la part mesurée baisse d\'autant', async () => {
  // L'arrivée est à 1 km de l'entrée du circuit, 20 km de tours plus loin au profil.
  const towns = [town('A', 0), town('B', 10), town('C', 30), town('Entrée', 50), town('Arrivée', 70, { lon: 6.51 })];
  assert.deepStrictEqual(measuredTowns({ towns }).map((t) => t.label), ['A', 'B', 'C', 'Entrée', 'Arrivée']);
  const kept = measuredTowns({ towns, circuit_km: 50 });
  assert.deepStrictEqual(kept.map((t) => t.label), ['A', 'B', 'C', 'Entrée']);
  const leg = (a, b) => Math.abs(b.lon - a.lon) * 100 * 1000; // 1 km par 0,01° : ligne droite
  const all = await checkStage(towns, leg, 70);
  const cut = await checkStage(kept, leg, 70);
  assert.strictEqual(all.ok, false); // les tours du circuit ne se routent pas
  assert.strictEqual(cut.ok, true);
  assert.strictEqual(cut.coveragePct, 57); // 40 km mesurés sur 70
  // Le contrôle d'une étape stockée (celui de main) applique bien circuit_km.
  const stored = await checkStoredStage({ towns, circuit_km: 50 }, leg, null);
  assert.strictEqual(stored.ok, true);
  assert.strictEqual(stored.coveragePct, 57);
});
