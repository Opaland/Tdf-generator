'use strict';
// Statistiques de temps/vitesse d'une sortie importée (trace GPS horodatée),
// façon VeloViewer : date, durée totale, vitesse moyenne, vitesse maximale lissée.

const { test } = require('node:test');
const assert = require('node:assert');
const { computeRideStats } = require('../pipeline/rideStats');

/** Construit une trace de points espacés régulièrement dans le temps, à vitesse constante. */
function buildConstantSpeedTrack(speedKmh, durationS, hz = 1) {
  const speedMps = (speedKmh * 1000) / 3600;
  const points = [];
  const startLat = 45;
  const startMs = Date.parse('2026-06-01T10:00:00.000Z');
  const n = durationS * hz;
  for (let i = 0; i <= n; i++) {
    const t = i / hz;
    // Mètres par degré de latitude dérivés du même rayon terrestre que
    // `haversine` (pipeline/geo.js, R = 6 371 000 m) — pas la valeur
    // usuellement citée (111 320 m), qui suppose un rayon légèrement
    // différent et désaccorderait la trace synthétique de la fonction
    // qu'elle sert à éprouver.
    const metersPerDegreeLat = (2 * Math.PI * 6371000) / 360;
    const distM = speedMps * t;
    points.push({
      lat: startLat + distM / metersPerDegreeLat,
      lon: 4,
      time: new Date(startMs + t * 1000),
    });
  }
  return points;
}

test('sans horodatage exploitable, rend null plutôt que des zéros trompeurs', () => {
  const points = [{ lat: 45, lon: 4 }, { lat: 45.01, lon: 4 }];
  assert.strictEqual(computeRideStats(points), null);
});

test('un seul point horodaté ne suffit pas à mesurer une durée', () => {
  const points = [{ lat: 45, lon: 4, time: new Date('2026-06-01T10:00:00Z') }];
  assert.strictEqual(computeRideStats(points), null);
});

test('trace à vitesse constante : date, durée, distance et vitesse moyenne exactes', () => {
  // 20 km/h pendant 1800 s (30 min) → 10 000 m parcourus.
  const points = buildConstantSpeedTrack(20, 1800);
  const stats = computeRideStats(points);
  assert.ok(stats);
  assert.strictEqual(stats.date, '2026-06-01');
  assert.strictEqual(stats.elapsedTimeS, 1800);
  assert.ok(Math.abs(stats.totalDistanceM - 10000) < 5, `distance attendue ~10000 m, obtenu ${stats.totalDistanceM}`);
  assert.ok(Math.abs(stats.avgSpeedKmh - 20) < 0.1, `vitesse moyenne attendue ~20 km/h, obtenu ${stats.avgSpeedKmh}`);
});

test('vitesse constante : la vitesse maximale lissée rejoint la moyenne', () => {
  const points = buildConstantSpeedTrack(25, 600);
  const stats = computeRideStats(points);
  assert.ok(Math.abs(stats.maxSpeedKmh - 25) < 0.5, `vitesse max attendue ~25 km/h, obtenu ${stats.maxSpeedKmh}`);
});

test('une pointe brève et isolée ne domine pas la vitesse maximale lissée', () => {
  // 10 minutes à 15 km/h, sauf une seule paire de points consécutifs séparée
  // de 200 m en 1 s (720 km/h instantané — un saut GPS, pas un vrai effort).
  // Un lissage sur fenêtre de 30 s ne doit pas rapporter 720 km/h.
  const points = buildConstantSpeedTrack(15, 600);
  const spikeIndex = 300;
  points[spikeIndex] = { ...points[spikeIndex], lat: points[spikeIndex - 1].lat + 200 / 111320 };
  const stats = computeRideStats(points);
  assert.ok(stats.maxSpeedKmh < 100, `un saut GPS isolé n'a pas dû produire ${stats.maxSpeedKmh} km/h après lissage`);
});

test('deux points horodatés identiques (durée nulle) ne font pas planter le calcul', () => {
  const points = [
    { lat: 45, lon: 4, time: new Date(1000) },
    { lat: 45, lon: 4, time: new Date(1000) },
    { lat: 45.001, lon: 4, time: new Date(2000) },
  ];
  const stats = computeRideStats(points);
  assert.ok(stats);
  assert.ok(Number.isFinite(stats.avgSpeedKmh));
  assert.ok(Number.isFinite(stats.maxSpeedKmh));
});

test('des points hors service (time manquant au milieu) sont ignorés, pas comptés comme un arrêt', () => {
  const withGaps = buildConstantSpeedTrack(20, 60).map((p, i) => (i === 30 ? { lat: p.lat, lon: p.lon } : p));
  const stats = computeRideStats(withGaps);
  assert.ok(stats);
  assert.ok(Math.abs(stats.avgSpeedKmh - 20) < 1);
});

test('timestamps non triés (points fusionnés hors ordre) : durée réelle (min/max), pas 0 ni négative', () => {
  // Même classe de défaut que l'ex-dateAndDurationFromPoints() de
  // importTrack.js (trouvaille de relecture adverse, 18/09/2026) : un GPX à
  // plusieurs pistes non triées chronologiquement donnerait un `dernier -
  // premier` négatif (écrasé en 0) si on prenait simplement le premier et le
  // dernier élément du tableau au lieu du vrai minimum/maximum temporel.
  const points = [
    { lat: 45, lon: 4, time: new Date('2026-06-01T12:00:00Z') },
    { lat: 45.01, lon: 4, time: new Date('2026-06-01T12:00:10Z') },
    { lat: 45.02, lon: 4, time: new Date('2026-06-01T08:00:00Z') },
    { lat: 45.03, lon: 4, time: new Date('2026-06-01T08:00:10Z') },
  ];
  const stats = computeRideStats(points);
  assert.ok(stats);
  assert.strictEqual(stats.date, '2026-06-01');
  assert.strictEqual(stats.elapsedTimeS, 4 * 3600 + 10);
});
