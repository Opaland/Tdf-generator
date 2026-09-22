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
function syntheticGpx({ withTime = false } = {}) {
  const pts = [];
  const lat0 = 43.0;
  const lon0 = 0.5;
  const mPerDegLat = 110540;
  let i = 0;
  for (let m = 0; m <= 16000; m += 100) {
    const lat = lat0 + m / mPerDegLat;
    const ele = m <= 10000 ? 400 : 400 + (m - 10000) * 0.07;
    const time = withTime ? `<time>${new Date(Date.UTC(2026, 8, 9, 8, 0, i * 15)).toISOString()}</time>` : '';
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>${ele.toFixed(1)}</ele>${time}</trkpt>`);
    i++;
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
  // syntheticGpx() ne porte aucun <time> : les statistiques de vitesse
  // (pipeline/rideStats.js) doivent rester NULL, jamais un 0 qui se ferait
  // passer pour une mesure de temps qui n'a jamais existé.
  assert.strictEqual(full.stage.elapsed_time_s, null);
  assert.strictEqual(full.stage.avg_speed_kmh, null);
  assert.strictEqual(full.stage.max_speed_kmh, null);
});

/** Même profil que syntheticGpx(), avec un <time> par point (1 point/5 s, 20 km/h). */
function syntheticGpxWithTime() {
  const pts = [];
  const lat0 = 43.0;
  const lon0 = 0.5;
  const mPerDegLat = 110540;
  const speedMps = (20 * 1000) / 3600; // 20 km/h
  const startMs = Date.parse('2026-06-01T09:00:00Z');
  for (let m = 0; m <= 16000; m += 100) {
    const lat = lat0 + m / mPerDegLat;
    const ele = m <= 10000 ? 400 : 400 + (m - 10000) * 0.07;
    const timeS = m / speedMps;
    const time = new Date(startMs + timeS * 1000).toISOString();
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>${ele.toFixed(1)}</ele><time>${time}</time></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie horodatée</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('importTrackAsStage : une trace horodatée persiste durée et vitesses', async () => {
  const { points } = parseGpx(syntheticGpxWithTime());
  const id = await importTrackAsStage(points, { name: 'Trace horodatée test', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.state, 'done');
  // 16 000 m à 20 km/h (5,555… m/s) → 2 880 s.
  assert.ok(Math.abs(full.stage.elapsed_time_s - 2880) < 2, `durée ${full.stage.elapsed_time_s} ≈ 2880 s`);
  assert.ok(Math.abs(full.stage.avg_speed_kmh - 20) < 0.5, `vitesse moyenne ${full.stage.avg_speed_kmh} ≈ 20 km/h`);
  assert.ok(Math.abs(full.stage.max_speed_kmh - 20) < 0.5, `vitesse max ${full.stage.max_speed_kmh} ≈ 20 km/h`);
});

test('parseGpx extrait <time> par trkpt quand présent', () => {
  const { points } = parseGpx(syntheticGpx({ withTime: true }));
  assert.ok(points[0].time instanceof Date);
  assert.strictEqual(points[0].time.toISOString(), '2026-09-09T08:00:00.000Z');
  assert.strictEqual(points[points.length - 1].time.toISOString(), '2026-09-09T08:40:00.000Z');
});

test('parseGpx : <time> absent → points[].time reste null, pas de plantage', () => {
  const { points } = parseGpx(syntheticGpx({ withTime: false }));
  assert.strictEqual(points[0].time, null);
});

test('importTrackAsStage : date et durée écoulée dérivées des timestamps GPX', async () => {
  const { points } = parseGpx(syntheticGpx({ withTime: true }));
  const id = await importTrackAsStage(points, { name: 'Trace avec horodatage', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.date, '2026-09-09');
  // 160 intervalles de 15 s (161 points, indices 0..160) = 2400 s.
  assert.strictEqual(full.stage.elapsed_time_s, 2400);
});

test('importTrackAsStage : sans <time> sur la trace, date et durée restent null (pas 0, pas de plantage)', async () => {
  const { points } = parseGpx(syntheticGpx({ withTime: false }));
  const id = await importTrackAsStage(points, { name: 'Trace sans horodatage', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.date, null);
  assert.strictEqual(full.stage.elapsed_time_s, null);
});

// Trouvaille de relecture adverse (18/09/2026) : parseGpx() capture tous les
// <trkpt> d'un document par une seule regex globale, sans respecter les
// frontières <trk>/<trkseg> — un GPX à plusieurs pistes non triées
// chronologiquement (export à la main de deux sorties fusionnées dans un
// seul fichier) donnait un elapsed_time_s de 0 trompeur (last - first
// négatif, écrasé par Math.max(0, …)) au lieu de refléter le vrai
// intervalle ou de rester null.
test('importTrackAsStage : timestamps non triés (GPX multi-piste fusionné) → durée réelle (min/max), pas 0', async () => {
  const late = Array.from({ length: 5 }, (_, i) =>
    `<trkpt lat="${(43 + i * 0.001).toFixed(6)}" lon="0.5"><ele>${400 + i}</ele><time>${new Date(Date.UTC(2026, 8, 9, 12, 0, i * 10)).toISOString()}</time></trkpt>`
  ).join('');
  const early = Array.from({ length: 5 }, (_, i) =>
    `<trkpt lat="${(43.1 + i * 0.001).toFixed(6)}" lon="0.5"><ele>${400 + i}</ele><time>${new Date(Date.UTC(2026, 8, 9, 8, 0, i * 10)).toISOString()}</time></trkpt>`
  ).join('');
  const gpx = `<?xml version="1.0"?><gpx><trk><name>Fusion</name><trkseg>${late}</trkseg></trk><trk><trkseg>${early}</trkseg></trk></gpx>`;
  const { points } = parseGpx(gpx);
  const id = await importTrackAsStage(points, { name: 'Trace multi-piste', source: 'test' });
  const full = loadStageFull(id);
  // Vrai intervalle chronologique : 08:00:00 → 12:00:40 = 4h00m40s = 14440 s.
  assert.strictEqual(full.stage.elapsed_time_s, 14440);
  assert.strictEqual(full.stage.date, '2026-09-09');
});

test('importTrackAsStage : un seul point daté sur toute la trace → date/durée restent null (un "écoulé" n\'a pas de sens sur un seul point)', async () => {
  const { points } = parseGpx(syntheticGpx({ withTime: false }));
  points[10].time = new Date('2026-09-09T08:00:00Z');
  const id = await importTrackAsStage(points, { name: 'Trace un seul point daté', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.date, null);
  assert.strictEqual(full.stage.elapsed_time_s, null);
});
