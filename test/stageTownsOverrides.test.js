'use strict';
// Positions vérifiées à la main pour stage_towns.json (Epic 33.9) :
// pipeline/data/stage_towns_overrides.json, réappliqué par
// scripts/build-stage-towns.js après chaque régénération.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-overrides-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { applyOverrides, writeStageTowns, readOverrides } = require('../scripts/build-stage-towns');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

const DATA = path.join(__dirname, '..', 'pipeline', 'data');
const overrides = JSON.parse(fs.readFileSync(path.join(DATA, 'stage_towns_overrides.json'), 'utf8'));

test('applyOverrides : une régénération qui redonne la position fausse est corrigée ; l\'occurrence prime sur le libellé', () => {
  // Ce que le géocodeur redonnait avant correction (édition 1988, 1985).
  const editions = {
    1988: { stages: [{ number: 19, start: { label: 'Limoges', lat: 45.8, lon: 1.2, how: 'commune-ign', confidence: 'ok' },
      finish: { label: 'Puy-de-Dôme', lat: 45.70874, lon: 3.11886, how: 'geocode+nominatim', confidence: 'ok' } }] },
    1985: { stages: [{ number: 21, start: { label: 'Lac de Vassivière', lat: 45.59263, lon: 1.38689, how: 'geocode', confidence: 'douteux' },
      finish: { label: 'Lac de Vassivière', lat: 45.59263, lon: 1.38689, how: 'geocode', confidence: 'douteux' } }] },
  };
  const n = applyOverrides(editions, {
    towns: { 'Puy-de-Dôme': { lat: 45.77265, lon: 2.96441, how: 'nominatim', note: 'sommet' }, 'Lac de Vassivière': { lat: 1, lon: 1, how: 'x', note: 'libellé' } },
    occurrences: { '1985/21/start': { lat: 45.79787, lon: 1.90067, how: 'nominatim', confidence: 'douteux', note: 'occurrence' } },
  });
  assert.strictEqual(n, 3);
  assert.deepStrictEqual([editions[1988].stages[0].finish.lat, editions[1988].stages[0].finish.confidence], [45.77265, 'ok']);
  assert.strictEqual(editions[1988].stages[0].start.lat, 45.8); // non listé : intact
  assert.deepStrictEqual([editions[1985].stages[0].start.lat, editions[1985].stages[0].start.confidence], [45.79787, 'douteux']);
  assert.strictEqual(editions[1985].stages[0].finish.lat, 1); // pas d'occurrence : le libellé s'applique
});

test('stage_towns.json porte déjà chaque position vérifiée (sinon une régénération la changerait)', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(DATA, 'stage_towns.json'), 'utf8'));
  const before = JSON.stringify(doc.editions);
  const n = applyOverrides(doc.editions, overrides);
  assert.ok(n >= 80, `${n} positions réappliquées`);
  assert.strictEqual(JSON.stringify(doc.editions), before);
  for (const o of [...Object.values(overrides.towns), ...Object.values(overrides.occurrences)]) {
    assert.ok(o.note && o.note.length > 10, 'chaque position vérifiée cite sa source');
  }
});

test('applyOverrides : une position redonnée « douteux » repasse « ok » (utilisable par la recherche) ; entrée sans lat/lon refusée', () => {
  // Luxembourg City avant correction : centre du pays, « douteux » (exclu de la recherche).
  const eds = { 1989: { stages: [{ number: 1, start: { label: 'Luxembourg City', lat: 49.81587, lon: 6.12968, how: 'geocode-pays', confidence: 'douteux' },
    finish: { label: 'Luxembourg City', lat: 49.81587, lon: 6.12968, how: 'geocode-pays', confidence: 'douteux' } }] } };
  applyOverrides(eds, { towns: { 'Luxembourg City': { lat: 49.61128, lon: 6.1298, how: 'nominatim', note: 'ville' } } });
  assert.deepStrictEqual([eds[1989].stages[0].start.lat, eds[1989].stages[0].start.confidence], [49.61128, 'ok']);
  assert.throws(() => applyOverrides(eds, { towns: { 'Luxembourg City': { how: 'x', note: 'faute de frappe' } } }), /lat\/lon/);
});

test('writeStageTowns : la seule écriture réapplique les positions vérifiées ; fichier d\'overrides absent = erreur, pas une régénération sans corrections', () => {
  const out = path.join(process.env.ETAPEFORGE_DATA_DIR, 'st.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const doc = { editions: { 1988: { stages: [{ number: 19, start: { label: 'Limoges', lat: 45.8, lon: 1.2 },
    finish: { label: 'Puy-de-Dôme', lat: 45.70874, lon: 3.11886, how: 'geocode+nominatim', confidence: 'ok' } }] } } };
  writeStageTowns(doc, out, overrides);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).editions[1988].stages[0].finish.lat, 45.77265);
  assert.throws(() => readOverrides(path.join(process.env.ETAPEFORGE_DATA_DIR, 'absent.json')));
  // Le générateur n'écrit stage_towns.json que par writeStageTowns.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-stage-towns.js'), 'utf8');
  assert.strictEqual((src.match(/writeFileSync\(/g) || []).length, 1);
});
