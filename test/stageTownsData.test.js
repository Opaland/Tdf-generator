'use strict';
// Jeu de données pipeline/data/stage_towns.json (Epic 32.4) : forme, et
// aucune étape dont départ et arrivée contredisent sa longueur, hors celles
// listées par la vérification (distance Wikipédia probablement mal lue).

const os = require('os');
const path = require('path');
// Sans dossier de données fixé, charger build-stage-towns en crée un
// (mkdtemp) qui n'était jamais supprimé (Epic 36.2) ; rien ne s'y écrit ici.
process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-towns-data-test-${process.pid}`);

const { test, after } = require('node:test');
const assert = require('node:assert');
const { haversine } = require('../pipeline/geo');
const { removeSync } = require('../pipeline/fsPortable');
const { maxCrowM } = require('../scripts/build-stage-towns');
const doc = require('../pipeline/data/stage_towns.json');

after(() => removeSync(process.env.ETAPEFORGE_DATA_DIR));

const CONF = new Set(['ok', 'ambigu', 'verifie', 'douteux']);

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
  const { curatedStages, stageTowns } = require('../pipeline/placeSearch');
  // Sans les itinéraires détaillés (Epic 33) : curation + villes seulement.
  const near = (r) => searchNear({ lat: 49.163382, lon: 6.659574 }, r, { tracked: [], waypointed: [] }, curatedStages(), stageTowns(), []).results;
  const at10 = near(10000);
  assert.deepStrictEqual(at10.map((r) => `${r.year}/${r.stage}`), ['1992/10']);
  const at20 = near(20000);
  const saar = at20.find((r) => r.year === 1970 && r.stage === '9');
  assert.ok(saar && saar.basis === 'endpoint' && saar.nearestLabel === 'Saarlouis', JSON.stringify(at20));
});

test('Porcelette avec les itinéraires détaillés (Epic 33) : 1970/9 par Carling et Saint-Avold, 1992/10 par Longeville', () => {
  const { searchNear } = require('../pipeline/placeSearch');
  const at10 = searchNear({ lat: 49.163382, lon: 6.659574 }, 10000, { tracked: [], waypointed: [] }).results;
  assert.deepStrictEqual(at10.map((r) => [`${r.year}/${r.stage}`, r.nearestLabel]), [['1970/9', 'Carling'], ['1992/10', 'Longeville-lès-Saint-Avold']]);
  assert.ok(at10.every((r) => r.basis.startsWith('itinerary-') && /^https:\/\/www\.ledicodutour\.com\//.test(r.sourceUrl)));
});

test('relecture adverse : positions fausses du premier jet corrigées ou exclues de la recherche', () => {
  const { stageTowns } = require('../pipeline/placeSearch');
  const { haversine: h } = require('../pipeline/geo');
  const usable = new Map();
  for (const t of stageTowns()) for (const w of t.towns) usable.set(w.label, w);
  const truth = {
    'Les Menuires': { lat: 45.3236, lon: 6.5379 },
    'Luxembourg City': { lat: 49.6116, lon: 6.1319 },
    'Méribel': { lat: 45.3967, lon: 6.5656 },
    Geneva: { lat: 46.2044, lon: 6.1432 },
    Charleroi: { lat: 50.4108, lon: 4.4446 },
  };
  for (const [label, p] of Object.entries(truth)) {
    const w = usable.get(label);
    // Soit absente de la recherche (douteux), soit à moins de 15 km de la réalité.
    if (w) assert.ok(h(w, p) < 15000, `${label} à ${Math.round(h(w, p) / 1000)} km de sa position réelle`);
  }
});

test('demi-étapes : chacune gardée (Cholet, arrivée de 1936/19b, trouvée)', () => {
  const { searchNear } = require('../pipeline/placeSearch');
  const r = searchNear({ lat: 47.06, lon: -0.879 }, 5000, { tracked: [], waypointed: [] }).results.filter((x) => x.year === 1936);
  assert.ok(r.some((x) => /^19[bc]$/.test(x.stage)), JSON.stringify(r));
});
