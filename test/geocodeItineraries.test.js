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
const { geocodeStage, anchorsFor, stageAnchors, snapToTown, assembleCandidates } = require('../scripts/geocode-itineraries');

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
    ['A', 't', 'ok'], ['B', 't', 'ok'], ['C', 't', 'ambigu'], ['D', null, 'non-place'], ['E', 'stage_towns', 'ok'],
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
  // Sans longueur, le dernier point transcrit est pris pour l'arrivée : ancre imposée.
  assert.strictEqual((await geocodeStage(towns, { finish }, async (l) => cands[l] || []))[1].how, 'stage_towns');
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

test('snapToTown : commune IGN recalée sur le bourg OSM le plus proche ; jamais sur un quartier, un homonyme lointain ou au-delà de 8 km', () => {
  const town = (dN, extra = {}) => ({ ...at(dN, 0), how: 'nominatim', osmClass: 'boundary', addresstype: 'village', ...extra });
  const lat = (dN) => Math.round(at(dN, 0).lat * 1e4);
  const snap = (...osm) => Math.round(snapToTown([{ ...at(0, 0), how: 'commune-ign' }, ...osm])[0].lat * 1e4);
  assert.strictEqual(snap(town(7700), town(120000)), lat(7700));
  assert.strictEqual(snap(town(6000), town(3000)), lat(3000), 'le plus proche, pas n\'importe lequel dans le rayon');
  assert.strictEqual(snap(town(2500, { addresstype: 'city_district' }), town(3100)), lat(3100), 'Pontorson : quartier écarté');
  assert.strictEqual(snap(town(1000, { osmClass: 'natural', addresstype: 'water' })), lat(0), 'lac homonyme écarté');
  assert.strictEqual(snap(town(8000)), lat(8000), 'borne incluse');
  assert.strictEqual(snap(town(9000)), lat(0));
  // Seule une commune IGN est recalée.
  const other = snapToTown([{ ...at(0, 0), how: 'commune-ign-prefixe' }, town(3000)])[0];
  assert.strictEqual(other.lat, at(0, 0).lat);
});

test('assembleCandidates : recalage branché, sauf pour un point géocodé sous un autre nom (geocodeAs)', () => {
  const communes = [{ name: 'Lamballe-Armor', lat: at(0, 0).lat, lon: at(0, 0).lon, population: 1 }];
  const osm = [{ ...at(3000, 0), how: 'nominatim', osmClass: 'boundary', addresstype: 'town' }];
  const snapped = assembleCandidates({ label: 'Lamballe-Armor', kind: 'ville', communes, osm }).find((c) => c.how === 'commune-ign');
  assert.ok(Math.abs(snapped.lat - at(3000, 0).lat) < 1e-4);
  const kept = assembleCandidates({ label: 'Lamballe-Armor', original: 'Lamballe', kind: 'ville', communes, osm }).find((c) => c.how === 'commune-ign');
  assert.ok(Math.abs(kept.lat - at(0, 0).lat) < 1e-4);
});

test('geocodeStage : ville d\'arrivée = ancre stage_towns ; point non final à 9 km de l\'ancre refusé (marge de 3 km)', async () => {
  const cands = { A: [at(0, 0)], Y: [at(0, 11000)], Z: [at(0, 15000)] };
  const towns = [{ label: 'A', km: 0, kind: 'ville' }, { label: 'Y', km: 19, kind: 'ville' }, { label: 'Z', km: 20, kind: 'ville' }];
  const out = await geocodeStage(towns, { finish: at(0, 20000) }, async (l) => cands[l] || []);
  assert.strictEqual(out[1].confidence, 'non-place', 'Y à 9 km de l\'arrivée pour 1 km de profil');
  assert.deepStrictEqual([out[2].how, out[2].lat], ['stage_towns', at(0, 20000).lat]);
  // Arrivée géocodée sous un autre nom (station, aérodrome…) : pas d'ancre imposée.
  const gs = await geocodeStage([towns[0], { ...towns[2], geocodeAs: 'Z' }], { finish: at(0, 20000) }, async (l) => cands[l] || []);
  assert.strictEqual(gs[1].how, undefined);
});

test('geocodeStage : une subdivision OSM (commune déléguée) passe après le village homonyme, même plus « sur le chemin »', async () => {
  // 1990/11 : « Bonneval » → city_district (sur le chemin) puis village.
  const cands = {
    A: [{ ...at(0, 0), how: 't' }],
    B: [{ ...at(0, 9000), how: 'nominatim', osmClass: 'boundary', addresstype: 'city_district' },
      { ...at(2500, 9000), how: 'nominatim', osmClass: 'place', addresstype: 'village' }],
    C: [{ ...at(0, 18000), how: 't' }],
  };
  const towns = [{ label: 'A', km: 0 }, { label: 'B', km: 10 }, { label: 'C', km: 20 }].map((t) => ({ ...t, kind: 'ville' }));
  const out = await geocodeStage(towns, {}, async (l) => cands[l] || []);
  assert.strictEqual(out[1].lat, at(2500, 9000).lat);
  // Seule la subdivision est compatible : elle reste retenue (mieux que rien).
  const only = await geocodeStage(towns, {}, async (l) => (l === 'B' ? [cands.B[0]] : cands[l]));
  assert.strictEqual(only[1].lat, at(0, 9000).lat);
  // Tous les types de subdivision, pas seulement city_district (relecture adverse).
  for (const addresstype of ['suburb', 'quarter', 'neighbourhood', 'borough', 'county', 'state', 'country']) {
    const sub = await geocodeStage(towns, {}, async (l) => (l === 'B' ? [{ ...cands.B[0], addresstype }, cands.B[1]] : cands[l]));
    assert.strictEqual(sub[1].lat, at(2500, 9000).lat, addresstype);
  }
  // Commune IGN exacte et col connu restent devant un village Nominatim.
  for (const how of ['commune-ign', 'known-cols']) {
    const strong = await geocodeStage(towns, {}, async (l) => (l === 'B' ? [{ ...at(0, 9000), how }, cands.B[1]] : cands[l]));
    assert.strictEqual(strong[1].how, how);
  }
  // Une commune IGN par préfixe (autre commune) ne bat pas la subdivision : même rang, moindre détour.
  const pref = await geocodeStage(towns, {}, async (l) => (l === 'B' ? [cands.B[0], { ...at(3000, 9000), how: 'commune-ign-prefixe' }] : cands[l]));
  assert.strictEqual(pref[1].lat, at(0, 9000).lat);
});

test('geocodeStage : un point retiré avec une note n\'est jamais re-géocodé ; sans note, il est retenté', async () => {
  const cands = { A: [{ ...at(0, 0), how: 't' }], B: [{ ...at(0, 9000), how: 't' }], C: [{ ...at(0, 18000), how: 't' }] };
  const towns = [{ label: 'A', km: 0 }, { label: 'B', km: 10, confidence: 'non-place', note: 'position non sourcée' }, { label: 'C', km: 20 }]
    .map((t) => ({ ...t, kind: 'ville' }));
  const out = await geocodeStage(towns, {}, async (l) => cands[l] || []);
  assert.strictEqual(out[1].lat, undefined);
  assert.strictEqual(out[1].confidence, 'non-place');
  assert.strictEqual(out[2].lat, at(0, 18000).lat);
  const retry = await geocodeStage(towns.map((t) => ({ ...t, note: undefined })), {}, async (l) => cands[l] || []);
  assert.strictEqual(retry[1].lat, at(0, 9000).lat);
  // Une note sur un point jamais tenté (pas « non-place ») ne bloque pas le géocodage.
  const noted = await geocodeStage(towns.map((t) => ({ ...t, confidence: undefined })), {}, async (l) => cands[l] || []);
  assert.strictEqual(noted[1].lat, at(0, 9000).lat);
});
