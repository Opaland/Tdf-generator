'use strict';
// Géocodage des itinéraires détaillés (Epic 33) : scripts/geocode-itineraries.js,
// candidats injectés — aucun appel réseau.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-itin-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { geocodeStage, anchorsFor, stageAnchors } = require('../scripts/geocode-itineraries');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

const M = 111195;
const at = (dN, dE) => ({ lat: 49 + dN / M, lon: 6 + dE / (M * Math.cos((49 * Math.PI) / 180)) });

test('geocodeStage : homonyme lointain écarté par l\'écart de km, candidat le moins détourné retenu, introuvable laissé sans coordonnées', async () => {
  const cands = {
    A: [{ ...at(0, 0), how: 't' }],
    B: [{ ...at(500000, 0), how: 'homonyme' }, { ...at(0, 9000), how: 't' }], // 10 km de profil depuis A
    C: [{ ...at(0, 18000), how: 't' }, { ...at(1500, 17000), how: 't2' }, { ...at(-8000, 18000), how: 'détour' }],
    D: [{ ...at(0, 80000), how: 'trop loin' }],
    E: [{ ...at(0, 30000), how: 't' }],
  };
  const towns = [{ label: 'A', km: 0 }, { label: 'B', km: 10 }, { label: 'C', km: 20 }, { label: 'D', km: 25 }, { label: 'E', km: 32 }]
    .map((t) => ({ ...t, kind: 'ville' }));
  const out = await geocodeStage(towns, { finish: at(0, 30000) }, async (label) => cands[label] || []);
  assert.deepStrictEqual(out.map((t) => [t.label, t.how ?? null, t.confidence]), [
    ['A', 't', 'ok'], ['B', 't', 'ok'], ['C', 't', 'ambigu'], ['D', null, 'non-place'], ['E', 't', 'ok'],
  ]);
  assert.strictEqual(towns[0].lat, undefined, 'entrée non mutée');
});

test('geocodeStage : côte au village éponyme (geocodeAs), jamais repère du point suivant ; marge élargie depuis le départ réel', async () => {
  const seen = [];
  const cands = {
    Depart: [at(0, 0)],
    Proche: [at(0, 13000)], // km 6 du profil mais 13 km du centre de la ville de départ : marge de départ
    Village: [at(0, 16000)],
    Suivant: [at(0, 30000)], // 14 km depuis le village, 17 km depuis Proche : budget 15+3 depuis Proche
  };
  const towns = [
    { label: 'Depart', km: 0, kind: 'ville' },
    { label: 'Proche', km: 6, kind: 'ville' },
    { label: 'Côte du Village', km: 8, kind: 'côte', geocodeAs: 'Village' },
    { label: 'Suivant', km: 21, kind: 'ville' },
  ];
  const out = await geocodeStage(towns, {}, async (label, kind) => { seen.push([label, kind]); return cands[label] || []; });
  assert.deepStrictEqual(seen[2], ['Village', 'ville']);
  assert.ok(out.every((t) => Number.isFinite(t.lat)), JSON.stringify(out));
  // Hors départ (repère au km 1), la marge normale s'applique : 13 km pour 6 km de profil, rejeté.
  const strict = await geocodeStage([{ label: 'Un', km: 1, kind: 'ville', ...at(0, 0) }, { label: 'Proche', km: 7, kind: 'ville' }], {}, async (l) => cands[l] || []);
  assert.strictEqual(strict[1].confidence, 'non-place');
});

test('anchorsFor : ancres de stage_towns, ville douteuse ignorée, étape scindée ramenée à son numéro', () => {
  const doc = { editions: { 1992: { stages: [{ number: 10, start: { lat: 1, lon: 2 }, finish: { lat: 3, lon: 4, confidence: 'douteux' } }] } } };
  assert.deepStrictEqual(anchorsFor(doc, '1992', '10a'), { start: { lat: 1, lon: 2 }, finish: undefined });
  assert.deepStrictEqual(anchorsFor(doc, '1993', '1'), {});
});

test('geocodeStage : longueur d\'étape fournie (totalKm) utilisée pour la contrainte vers l\'arrivée, pas le dernier point transcrit', async () => {
  const cands = { A: [at(0, 0)], B: [at(0, 10000)] };
  const towns = [{ label: 'A', km: 0, kind: 'ville' }, { label: 'B', km: 10, kind: 'ville' }];
  const finish = at(0, 30000); // arrivée 20 km après B
  assert.strictEqual((await geocodeStage(towns, { finish }, async (l) => cands[l] || []))[1].confidence, 'non-place');
  assert.strictEqual((await geocodeStage(towns, { finish }, async (l) => cands[l] || [], 31))[1].confidence, 'ok');
});

test('stageAnchors : arrivée retirée seulement pour une transcription partielle sans longueur', () => {
  const doc = { editions: { 1979: { stages: [{ number: 13, start: { lat: 1, lon: 2 }, finish: { lat: 3, lon: 4 } }] } } };
  assert.ok(stageAnchors(doc, '1979', '13', { towns: [] }).finish);
  assert.ok(stageAnchors(doc, '1979', '13', { partial: true, length_km: 205, towns: [] }).finish);
  assert.strictEqual(stageAnchors(doc, '1979', '13', { partial: true, towns: [] }).finish, undefined);
});

test('geocodeStage : la commune IGN compatible l\'emporte sur un résultat Nominatim moins détourné', async () => {
  const cands = {
    A: [{ ...at(0, 0), how: 'commune-ign' }],
    G: [{ ...at(0, 5000), how: 'nominatim' }, { ...at(9000, 5000), how: 'commune-ign' }],
  };
  const towns = [{ label: 'A', km: 0, kind: 'ville' }, { label: 'G', km: 10, kind: 'ville' }];
  const out = await geocodeStage(towns, {}, async (l) => cands[l] || []);
  assert.strictEqual(out[1].how, 'commune-ign');
});

test('geocodeStage : rang des sources — col connu > commune IGN exacte > reste (préfixe IGN, Nominatim)', async () => {
  const A = [{ ...at(0, 0), how: 'commune-ign' }];
  const run = async (cands) => (await geocodeStage([{ label: 'A', km: 0, kind: 'ville' }, { label: 'X', km: 10, kind: 'col' }], {}, async (l) => (l === 'A' ? A : cands)))[1].how;
  assert.strictEqual(await run([{ ...at(0, 5000), how: 'commune-ign' }, { ...at(9000, 5000), how: 'known-cols' }]), 'known-cols');
  // Préfixe IGN (autre commune) : ne prime pas sur le hameau Nominatim moins détourné.
  assert.strictEqual(await run([{ ...at(9000, 5000), how: 'commune-ign-prefixe' }, { ...at(0, 5000), how: 'nominatim' }]), 'nominatim');
});
