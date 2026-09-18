'use strict';
// Bilan personnel façon VeloViewer (frontend/traces.js, backlog #228) — records
// jour/semaine/mois/année et graphiques SVG calculés côté client à partir de
// `daily` ({date, distanceKm, ascentM, elapsedTimeS}).
//
// buildCumulativeChart, buildWeeklyBarChart, computeAwards, isoWeekKey,
// formatPeriodLabel, formatDuration sont require()-ables côté test grâce à la
// garde `typeof document` ajoutée à traces.js — même schéma que
// archives.js/compare.js/editor.js/stage.js (test/archivesPoll.test.js).

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };

const {
  isoWeekKey, formatPeriodLabel, formatDuration, computeAwards, buildCumulativeChart, buildWeeklyBarChart,
} = require('../frontend/traces.js');

function day(date, distanceKm, ascentM, elapsedTimeS) {
  return { date, distanceKm, ascentM, elapsedTimeS: elapsedTimeS === undefined ? null : elapsedTimeS };
}

test('isoWeekKey : ramène une date au lundi de sa semaine ISO', () => {
  assert.strictEqual(isoWeekKey('2026-06-14'), '2026-06-08'); // dimanche → lundi de la même semaine
  assert.strictEqual(isoWeekKey('2026-06-08'), '2026-06-08'); // déjà un lundi
});

test('isoWeekKey : passage d\'année (semaine à cheval sur le 31/12 → 1er janvier)', () => {
  // 29/12/2025 est un lundi ; 05/01/2026 (lundi suivant) doit rester une clé distincte.
  assert.strictEqual(isoWeekKey('2025-12-31'), '2025-12-29');
  assert.strictEqual(isoWeekKey('2026-01-02'), '2025-12-29');
  assert.strictEqual(isoWeekKey('2026-01-05'), '2026-01-05');
});

test('formatPeriodLabel : formate chaque granularité sans plantage', () => {
  assert.strictEqual(formatPeriodLabel('day', '2026-06-14'), new Date('2026-06-14T00:00:00Z').toLocaleDateString('fr-FR'));
  assert.strictEqual(formatPeriodLabel('week', '2026-06-08'), `sem. du ${new Date('2026-06-08T00:00:00Z').toLocaleDateString('fr-FR')}`);
  assert.strictEqual(formatPeriodLabel('month', '2026-06'), new Date(Date.UTC(2026, 5, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
  assert.strictEqual(formatPeriodLabel('year', '2026'), '2026');
});

test('formatDuration : null reste null (jamais 0 ni NaN)', () => {
  assert.strictEqual(formatDuration(null), null);
  assert.strictEqual(formatDuration(3600), '1 h 00');
  assert.strictEqual(formatDuration(90), '2 min');
});

test('computeAwards : agrège correctement par jour/semaine/mois/année, temps ignoré quand null', () => {
  const daily = [
    day('2026-06-01', 30, 200, 3600),
    day('2026-06-02', 50, 400), // pas de durée connue ce jour-là
    day('2026-07-10', 10, 50, 900),
  ];
  const best = computeAwards(daily);
  assert.strictEqual(best.day.distance.distanceKm, 50);
  assert.strictEqual(best.month.distance.key, '2026-06');
  assert.strictEqual(Math.round(best.month.distance.distanceKm), 80);
  // Le mois de juin n'a qu'un seul jour avec une durée connue (3600 s) —
  // la somme du bucket doit valoir 3600, jamais 3600 + 0 confondu avec une
  // vraie mesure à 0 pour le 02/06.
  assert.strictEqual(best.month.time.key, '2026-06');
  assert.strictEqual(best.month.time.elapsedTimeS, 3600);
  assert.strictEqual(best.year.distance.key, '2026');
  assert.strictEqual(Math.round(best.year.distance.distanceKm), 90);
});

test('computeAwards : aucun jour horodaté → record de temps absent (null), jamais 0', () => {
  const daily = [day('2026-06-01', 30, 200), day('2026-06-02', 50, 400)];
  const best = computeAwards(daily);
  assert.strictEqual(best.day.time, null);
  assert.strictEqual(best.week.time, null);
});

// Trouvaille de relecture adverse (18/09/2026) : total cumulé nul (traces
// dégénérées arrondies à 0,0 km sur au moins 2 jours) faisait diviser par
// zéro dans y(v) = v/total → NaN injecté tel quel dans les coordonnées du
// path SVG, silencieusement (aucune exception JS, aucun message).
test('buildCumulativeChart : distance cumulée nulle → message, jamais de NaN dans le SVG', () => {
  const daily = [day('2026-06-01', 0, 0, 100), day('2026-06-02', 0, 0, 100)];
  const svg = buildCumulativeChart(daily, 700, 160);
  assert.ok(!svg.includes('NaN'), `pas de NaN dans le SVG : ${svg}`);
  assert.ok(!svg.includes('<svg'), 'message de repli affiché plutôt qu\'un graphique cassé');
});

test('buildCumulativeChart : cas normal (distance croissante) → SVG valide, pas de NaN', () => {
  const daily = [day('2026-06-01', 10, 0, 100), day('2026-06-02', 20, 0, 100), day('2026-06-05', 5, 0, 100)];
  const svg = buildCumulativeChart(daily, 700, 160);
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('NaN'));
});

test('buildCumulativeChart : moins de 2 jours → message de repli, pas de plantage', () => {
  assert.ok(!buildCumulativeChart([], 700, 160).includes('<svg'));
  assert.ok(!buildCumulativeChart([day('2026-06-01', 10, 0)], 700, 160).includes('<svg'));
});

test('buildWeeklyBarChart : semaines sans sortie insérées à 0, jamais de NaN, jamais de plantage sur un total nul', () => {
  const daily = [day('2026-06-01', 10, 0, 100), day('2026-06-22', 20, 0, 100)]; // 3 semaines d'écart
  const svg = buildWeeklyBarChart(daily, 700, 160);
  assert.ok(svg.includes('<svg'));
  assert.ok(!svg.includes('NaN'));

  const zeroSvg = buildWeeklyBarChart([day('2026-06-01', 0, 0), day('2026-06-08', 0, 0)], 700, 160);
  assert.ok(!zeroSvg.includes('NaN'), `pas de NaN même à distance totale nulle : ${zeroSvg}`);
});

test('buildWeeklyBarChart : daily vide → message, pas de plantage', () => {
  assert.ok(!buildWeeklyBarChart([], 700, 160).includes('<svg'));
});
