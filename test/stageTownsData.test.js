'use strict';
// Jeu de données pipeline/data/stage_towns.json (Epic 32.4) : forme, et
// aucune étape dont départ et arrivée contredisent sa longueur, hors celles
// listées par la vérification (distance Wikipédia probablement mal lue).

const { test } = require('node:test');
const assert = require('node:assert');
const { haversine } = require('../pipeline/geo');
const { maxCrowM } = require('../scripts/build-stage-towns');
const doc = require('../pipeline/data/stage_towns.json');

const CONF = new Set(['ok', 'ambigu', 'approx', 'verifie']);

test('stage_towns.json : positions finies et confiance connue, ou absence explicite', () => {
  let n = 0;
  for (const [key, ed] of Object.entries(doc.editions)) {
    assert.match(key, /^\d{4}(-femmes)?$/);
    for (const s of ed.stages) {
      for (const t of [s.start, s.finish]) {
        assert.strictEqual(typeof t.label, 'string', `${key}/${s.number}`);
        if (t.lat === undefined) continue;
        n++;
        assert.ok(Number.isFinite(t.lat) && Number.isFinite(t.lon) && Math.abs(t.lat) <= 90 && Math.abs(t.lon) <= 180, `${key}/${s.number} ${t.label}`);
        assert.ok(CONF.has(t.confidence), `${key}/${s.number} ${t.label} : ${t.confidence}`);
      }
    }
  }
  assert.ok(Object.keys(doc.editions).length >= 110 && n > 4000, `${Object.keys(doc.editions).length} éditions, ${n} villes`);
});

test('stage_towns.json : aucune contradiction distance/longueur hors liste unverifiedStages', () => {
  const listed = new Set(doc.unverifiedStages);
  const bad = [];
  for (const [key, ed] of Object.entries(doc.editions)) {
    for (const s of ed.stages) {
      if (!s.distanceKm || s.start.lat === undefined || s.finish.lat === undefined || s.start.label === s.finish.label) continue;
      if (haversine(s.start, s.finish) > maxCrowM(s.distanceKm) && !listed.has(`${s.start.label} → ${s.finish.label}`)) {
        bad.push(`${key}/${s.number} ${s.start.label} → ${s.finish.label}`);
      }
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('Porcelette (centre communal IGN) : 1992/10 à moins de 10 km, et à 20 km le départ de 1970/9 à Sarrelouis', () => {
  const { searchNear } = require('../pipeline/placeSearch');
  const at10 = searchNear({ lat: 49.163382, lon: 6.659574 }, 10000, { tracked: [], waypointed: [] }).results;
  assert.deepStrictEqual(at10.map((r) => `${r.year}/${r.stage}`), ['1992/10']);
  const at20 = searchNear({ lat: 49.163382, lon: 6.659574 }, 20000, { tracked: [], waypointed: [] }).results;
  const saar = at20.find((r) => r.year === 1970 && r.stage === '9');
  assert.ok(saar && saar.basis === 'endpoint' && saar.nearestLabel === 'Saarlouis', JSON.stringify(at20));
});
