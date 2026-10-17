'use strict';
// pipeline/surface.js + son branchement dans routing.js/generate.js (Epic
// 11.4, issue #350) : revêtement lu dans les WayTags que BRouter renvoie déjà.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-surface-test-${process.pid}`);

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { classifySurface, classifyWay, brouterSurfaceStretches, summarizeSurfaces } = require('../pipeline/surface');
const { setOffline } = require('../pipeline/http');
const { routeStage } = require('../pipeline/routing');

// Format réel de BRouter (vérifié en direct le 17/10/2026, profil fastbike) :
// 1re ligne = en-têtes, valeurs numériques en CHAÎNES.
const HEAD = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'];
const row = (dist, tags) => ['6000000', '45000000', '500', String(dist), '0', '0', '0', '0', '0', tags, '', '0', '0'];

test('classifySurface : quatre classes, et une valeur absente ou inconnue n\'est jamais « revêtu »', () => {
  assert.strictEqual(classifySurface('asphalt'), 'revetu');
  assert.strictEqual(classifySurface('paving_stones'), 'revetu');
  assert.strictEqual(classifySurface('sett'), 'paves');
  assert.strictEqual(classifySurface('cobblestone'), 'paves');
  assert.strictEqual(classifySurface('compacted'), 'non_revetu');
  assert.strictEqual(classifySurface('gravel'), 'non_revetu');
  assert.strictEqual(classifySurface(null), 'inconnu');
  assert.strictEqual(classifySurface('valeur_inventee'), 'inconnu');
});

test('classifyWay : sans tag surface, présomption par classe de route (revêtu pour une route classée, non revêtu pour une piste), inconnu sinon', () => {
  assert.strictEqual(classifyWay({ surface: null, highway: 'tertiary' }), 'revetu_presume');
  assert.strictEqual(classifyWay({ surface: null, highway: 'primary' }), 'revetu_presume');
  assert.strictEqual(classifyWay({ surface: null, highway: 'track' }), 'non_revetu_presume');
  assert.strictEqual(classifyWay({ surface: null, highway: 'service' }), 'inconnu');
  assert.strictEqual(classifyWay({ surface: null, highway: 'path' }), 'inconnu');
  assert.strictEqual(classifyWay({ surface: null, highway: null }), 'inconnu');
  // Le tag surface l'emporte toujours sur la classe de route (Finestre : unclassified + compacted).
  assert.strictEqual(classifyWay({ surface: 'compacted', highway: 'unclassified' }), 'non_revetu');
});

test('brouterSurfaceStretches : positions cumulées, tags bruts (jamais la classe, qui est mise en cache), fusion des lignes identiques', () => {
  const st = brouterSurfaceStretches([
    HEAD,
    row(100, 'highway=tertiary surface=asphalt'),
    row(50, 'highway=tertiary surface=asphalt'),
    row(200, 'highway=unclassified surface=compacted'),
    row(80, 'highway=tertiary'),
  ]);
  assert.deepStrictEqual(st, [
    { fromM: 0, toM: 150, surface: 'asphalt', highway: 'tertiary' },
    { fromM: 150, toM: 350, surface: 'compacted', highway: 'unclassified' },
    { fromM: 350, toM: 430, surface: null, highway: 'tertiary' },
  ]);
  assert.ok(st.every((s) => !('cls' in s)));
});

test('brouterSurfaceStretches : format inattendu → [] sans exception (la surface ne fait jamais échouer un routage réussi)', () => {
  assert.deepStrictEqual(brouterSurfaceStretches(undefined), []);
  assert.deepStrictEqual(brouterSurfaceStretches([]), []);
  assert.deepStrictEqual(brouterSurfaceStretches([['Longitude', 'Latitude']]), []);
  assert.deepStrictEqual(brouterSurfaceStretches([['Distance'], ['10']]), []); // pas de colonne WayTags
  assert.deepStrictEqual(brouterSurfaceStretches([HEAD, row('NaN', 'highway=primary')]), []);
});

test('summarizeSurfaces : le reste non couvert compte en « inconnu », tronçons notables fusionnés', () => {
  const sum = summarizeSurfaces([
    { fromM: 0, toM: 1000, surface: 'asphalt', highway: 'secondary' },
    { fromM: 1000, toM: 1300, surface: 'gravel', highway: 'track' },
    { fromM: 1300, toM: 1500, surface: 'dirt', highway: 'track' },
    { fromM: 1500, toM: 2000, surface: null, highway: 'tertiary' },
    { fromM: 2000, toM: 2400, surface: 'sett', highway: 'residential' },
    { fromM: 2400, toM: 2600, surface: null, highway: 'track' },
  ], 3000);
  assert.deepStrictEqual(sum.meters, { revetu: 1000, revetu_presume: 500, paves: 400, non_revetu: 500, non_revetu_presume: 200, inconnu: 400 });
  assert.deepStrictEqual(sum.stretches, [
    { fromM: 1000, toM: 1500, cls: 'non_revetu', surfaces: ['gravel', 'dirt'] },
    { fromM: 2000, toM: 2400, cls: 'paves', surfaces: ['sett'] },
    { fromM: 2400, toM: 2600, cls: 'non_revetu_presume', surfaces: [] },
  ]);
});

let realFetch;
before(() => { setOffline(false); realFetch = global.fetch; });
after(() => {
  global.fetch = realFetch;
  setOffline(true);
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('routeStage : tronçons replacés sur la distance de l\'étape, montée interpolée laissée en « inconnu »', async () => {
  const pied = { lat: 44.5, lon: 6.5, kind: 'via', label: 'Pied' };
  const sommet = { lat: 44.545, lon: 6.5, kind: 'col', label: 'Sommet' };
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push({ lat: 44.5 + (0.04 * i) / 40, lon: 6.5 }); // route arrêtée à 44.540, ~560 m sous le sommet → interpolation
  // Mock limité à brouter.de (CLAUDE.md règle 6) ; le reste passe au vrai fetch.
  global.fetch = async (url) => {
    if (!String(url).includes('brouter.de')) return realFetch(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat, 0]) },
          properties: {
            'track-length': '4448',
            messages: [HEAD, row(2224, 'highway=tertiary surface=asphalt'), row(2224, 'highway=unclassified surface=compacted')],
          },
        }],
      }),
    };
  };
  const r = await routeStage([pied, sommet]);
  assert.strictEqual(r.surfaceStretches.length, 2);
  const routedEnd = r.surfaceStretches[1].toM;
  assert.ok(routedEnd < r.distanceM - 400, 'les tronçons s\'arrêtent au pied de l\'interpolation');
  const sum = summarizeSurfaces(r.surfaceStretches, r.distanceM);
  assert.ok(Math.abs(sum.meters.revetu - sum.meters.non_revetu) <= 1, 'mise à l\'échelle proportionnelle sur la longueur réellement ajoutée');
  assert.ok(sum.meters.inconnu >= 400, 'la montée interpolée n\'est jamais comptée revêtue');
  assert.ok(Math.abs(sum.meters.revetu + sum.meters.non_revetu + sum.meters.inconnu - r.distanceM) <= 2); // arrondis par classe
});

// Relecture adverse : une sauvegarde importée peut porter n'importe quelle
// chaîne dans tracks.surfaces — la fiche ne doit jamais tomber pour autant.
test('loadStageFull : tracks.surfaces illisible ou mal formé → null, jamais d\'exception', () => {
  const { getDb } = require('../backend/db');
  const { loadStageFull } = require('../pipeline/generate');
  const db = getDb();
  const geo = JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[5, 45], [5.1, 45.1]] } });
  for (const bad of ['pas du json', '{"stretches":[]}', '{"meters":{"revetu":"x"},"stretches":[]}', '[]', 'null']) {
    const id = db.prepare(`INSERT INTO stages (name, state) VALUES ('Forgée', 'done')`).run().lastInsertRowid;
    db.prepare('INSERT INTO tracks (stage_id, geojson, distance_m, router, surfaces) VALUES (?, ?, 1000, ?, ?)').run(id, geo, 'brouter', bad);
    assert.strictEqual(loadStageFull(id).track.surfaces, null, bad);
  }
  const good = summarizeSurfaces([{ fromM: 0, toM: 500, surface: 'gravel', highway: 'track' }], 1000);
  const id = db.prepare(`INSERT INTO stages (name, state) VALUES ('Saine', 'done')`).run().lastInsertRowid;
  db.prepare('INSERT INTO tracks (stage_id, geojson, distance_m, router, surfaces) VALUES (?, ?, 1000, ?, ?)').run(id, geo, 'brouter', JSON.stringify(good));
  assert.deepStrictEqual(loadStageFull(id).track.surfaces, good);
});
