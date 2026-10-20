'use strict';
// Epic 35.5 (revue globale du 19/10/2026) : une trace dont toutes les
// altitudes sont la sentinelle « pas de fix » (-32768) était importée avec un
// profil à 0 m partout présenté comme réel (checks.ok = true). Elle passe
// désormais par les fournisseurs d'altimétrie (simulateur hors-ligne ici).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-sentinel-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { importTrackAsStage } = require('../pipeline/importTrack');
const { loadStageFull } = require('../pipeline/generate');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

test('trace aux altitudes toutes aberrantes : profil des fournisseurs, pas 0 m partout', async () => {
  const points = [];
  for (let i = 0; i < 200; i++) points.push({ lat: 45.0 + i * 0.0005, lon: 6.0 + i * 0.0005, ele: -32768 });
  const id = await importTrackAsStage(points, { name: 'Sentinelle', source: 'gpx' });
  const full = loadStageFull(id);
  const eles = full.samples.map((s) => s.ele_raw_m);
  assert.ok(eles.every((e) => Number.isFinite(e)));
  assert.ok(!eles.every((e) => e === 0), 'pas un profil plat à 0 m');
});
