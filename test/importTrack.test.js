'use strict';
// Test de l'import de traces : parseur GPX + pipeline aval (côtes, km/km) sur
// une trace synthétique contenant une montée connue. Base SQLite jetable.

process.env.ETAPEFORGE_DATA_DIR = require('path').join(require('os').tmpdir(), `etapeforge-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { parseGpx, importTrackAsStage } = require('../pipeline/importTrack');
const { loadStageFull } = require('../pipeline/generate');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

/** GPX synthétique : 10 km plat à 400 m puis 6 km à 7 % vers le nord. */
function syntheticGpx() {
  const pts = [];
  const lat0 = 43.0;
  const lon0 = 0.5;
  const mPerDegLat = 110540;
  for (let m = 0; m <= 16000; m += 100) {
    const lat = lat0 + m / mPerDegLat;
    const ele = m <= 10000 ? 400 : 400 + (m - 10000) * 0.07;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>${ele.toFixed(1)}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie test</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('parseGpx extrait points, altitudes et nom', () => {
  const { points, name } = parseGpx(syntheticGpx());
  assert.strictEqual(name, 'Sortie test');
  assert.strictEqual(points.length, 161);
  assert.ok(Math.abs(points[0].ele - 400) < 0.1);
  assert.ok(Math.abs(points[points.length - 1].ele - 820) < 0.5);
});

test("importTrackAsStage : la montée de la trace est détectée et catégorisée", async () => {
  const { points } = parseGpx(syntheticGpx());
  const id = await importTrackAsStage(points, { name: 'Trace test', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.state, 'done');
  assert.ok(Math.abs(full.stage.generated_distance_km - 16) < 0.3, `distance ${full.stage.generated_distance_km} ≈ 16 km`);
  assert.strictEqual(full.climbs.length, 1, 'une montée détectée');
  const c = full.climbs[0];
  // Le lissage (moyenne glissante 1 500 m) adoucit pied et sommet : la montée
  // détectée est un peu plus longue et un peu moins pentue que la rampe brute.
  assert.ok(Math.abs(c.length_km - 6) < 1.5, `longueur ${c.length_km} ≈ 6 km`);
  assert.ok(c.avg_gradient > 5.3 && c.avg_gradient < 7.5, `pente ${c.avg_gradient} ≈ 6-7 %`);
  assert.strictEqual(c.category, '1', 'score ≈ 42 → cat. 1');
  assert.ok(full.kmAnalysis.length >= 16 && full.kmAnalysis.length <= 17, 'analyse km par km présente (16-17 lignes)');
  assert.ok(full.track && full.track.router === 'trace');
});
