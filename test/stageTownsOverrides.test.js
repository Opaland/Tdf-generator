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

after(() => {
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

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

test('snapCommuneAnchors : commune IGN recalée sur le bourg OSM le plus proche ; jamais une « municipality », un quartier, au-delà de 8 km, ni une position non IGN', async () => {
  const { snapCommuneAnchors } = require('../scripts/build-stage-towns');
  // Avignon : centroïde IGN 3,7 km au sud-est de la ville ; la « municipality » OSM est à 11 km.
  const town = (label, lat, lon, how = 'commune-ign') => ({ label, lat, lon, how, confidence: 'ok' });
  const eds = { 1987: { stages: [
    { number: 17, start: town('Millau', 44.1, 3.08, 'nominatim'), finish: town('Avignon', 43.93635, 4.84886) },
    { number: 18, start: town('Loin', 45, 5), finish: town('Quartier', 46, 6) },
  ] } };
  const cands = {
    Avignon: [{ lat: 43.96365, lon: 4.94246, osmClass: 'boundary', addresstype: 'municipality' }, { lat: 43.94925, lon: 4.8059, osmClass: 'boundary', addresstype: 'city' }],
    Millau: [{ lat: 44.1, lon: 3.09, osmClass: 'place', addresstype: 'town' }], // à 0,8 km : seule la garde « commune-ign » le protège
    Loin: [{ lat: 45.1, lon: 5, osmClass: 'place', addresstype: 'town' }], // 11 km
    Quartier: [{ lat: 46.01, lon: 6, osmClass: 'boundary', addresstype: 'city_district' }],
  };
  await snapCommuneAnchors(eds, async (l) => cands[l] || [], () => {});
  const [s17, s18] = eds[1987].stages;
  assert.deepStrictEqual([s17.finish.lat, s17.finish.lon], [43.94925, 4.8059]);
  assert.deepStrictEqual([s17.start.lat, s17.start.lon], [44.1, 3.08]); // nominatim : intact
  assert.strictEqual(s18.start.lat, 45); // au-delà de 8 km
  assert.strictEqual(s18.finish.lat, 46); // quartier
  // Deux bourgs éligibles : le plus proche ; un hameau compte ; un point OSM d'une autre classe (rivière) jamais.
  const e2 = { 2000: { stages: [{ number: 1, start: town('A', 45, 5), finish: town('B', 46, 6) }, { number: 2, start: town('C', 47, 7), finish: town('C', 47, 7) }] } };
  const c2 = {
    A: [{ lat: 45.05, lon: 5, osmClass: 'place', addresstype: 'town' }, { lat: 45.01, lon: 5, osmClass: 'place', addresstype: 'town' }],
    B: [{ lat: 46.01, lon: 6, osmClass: 'place', addresstype: 'hamlet' }],
    C: [{ lat: 47.01, lon: 7, osmClass: 'waterway', addresstype: 'village' }],
  };
  await snapCommuneAnchors(e2, async (l) => c2[l] || [], () => {});
  assert.strictEqual(e2[2000].stages[0].start.lat, 45.01);
  assert.strictEqual(e2[2000].stages[0].finish.lat, 46.01);
  assert.strictEqual(e2[2000].stages[1].start.lat, 47);
});

test('applyOverrides : une occurrence peut corriger le libellé (lien Wikipédia faux), jamais une entrée par libellé', () => {
  const eds = { 1984: { stages: [{ number: 6, start: { label: 'Louvroil', dep: '59', lat: 50.26447, lon: 3.96232, how: 'commune-ign', confidence: 'ok' },
    finish: { label: 'Alençon', lat: 48.43121, lon: 0.09114, how: 'commune-ign', confidence: 'ok' } }] } };
  const occ = { '1984/6/start': { label: ' Cergy-Pontoise ', lat: 49.04529, lon: 2.05944, how: 'geocode+nominatim', note: 'lien faux' } };
  applyOverrides(eds, { occurrences: occ });
  const st = eds[1984].stages[0].start;
  assert.deepStrictEqual([st.label, st.lat, st.dep], ['Cergy-Pontoise', 49.04529, undefined]);
  // Réappliquer ne change rien (régénération --verify-only).
  const before = JSON.stringify(eds);
  applyOverrides(eds, { occurrences: occ });
  assert.strictEqual(JSON.stringify(eds), before);
  assert.throws(() => applyOverrides(eds, { towns: { 'Alençon': { label: 'Autre', lat: 1, lon: 1, how: 'x' } } }), /label refusé/);
  assert.throws(() => applyOverrides(eds, { occurrences: { '1984/6/finish': { label: '', lat: 1, lon: 1, how: 'x' } } }), /label refusé/);
});

