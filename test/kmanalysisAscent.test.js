'use strict';
// Epic 35.5 (revue globale du 19/10/2026) : le « D+ cumulé » du tableau km
// par km perdait chaque segment à cheval sur une borne de km — ~25 % du D+
// de l'étape au pas de 250 m (mesuré sur Paris → Lyon : 1 193 m contre
// 1 592 m en tête de fiche).

const { test } = require('node:test');
const assert = require('node:assert');
const { analyzeByKm } = require('../pipeline/kmanalysis');

/** Profil régulier : `step` m entre échantillons, montée de `rate` m par m. */
function ramp(totalM, step, rate) {
  const out = [];
  for (let d = 0; d <= totalM; d += step) out.push({ dist: d, eleRaw: 100 + d * rate, eleSmooth: 100 + d * rate });
  return out;
}
const positiveSum = (samples) => samples.slice(1).reduce((s, b, i) => s + Math.max(0, b.eleSmooth - samples[i].eleSmooth), 0);

test('pas de 250 m : le D+ cumulé du dernier km égale le D+ total du profil', () => {
  // 300 m n'est pas un diviseur de 1 000 : des segments enjambent les bornes.
  for (const step of [250, 300, 100, 333]) {
    const s = ramp(20000, step, 0.05);
    const rows = analyzeByKm(s);
    const total = positiveSum(s);
    assert.ok(Math.abs(rows[rows.length - 1].cumAscent - Math.round(total)) <= 1, `pas ${step} : ${rows[rows.length - 1].cumAscent} pour ${total}`);
  }
});

test('un segment à cheval sur deux km est réparti au prorata, et sa pente compte dans les deux', () => {
  const s = [
    { dist: 0, eleRaw: 0, eleSmooth: 0 },
    { dist: 800, eleRaw: 0, eleSmooth: 0 },
    { dist: 1200, eleRaw: 40, eleSmooth: 40 }, // 10 % sur 400 m, moitié dans chaque km
    { dist: 2000, eleRaw: 40, eleSmooth: 40 },
  ];
  const rows = analyzeByKm(s);
  assert.deepStrictEqual(rows.map((r) => r.ascent), [20, 20]);
  assert.deepStrictEqual(rows.map((r) => r.maxGradient100), [10, 10]);
  assert.strictEqual(rows[1].cumAscent, 40);
});

test('une altitude manquante n\'est jamais comptée comme 0 m (règle 10)', () => {
  // Profil négatif (sorti du domaine réaliste, CLAUDE.md règle 10) : un 0 m
  // de repli y créerait une montée fantôme de 50 m.
  const s = [
    { dist: 0, eleRaw: -50, eleSmooth: -50 },
    { dist: 500, eleRaw: null, eleSmooth: null },
    { dist: 1000, eleRaw: -50, eleSmooth: -50 },
  ];
  const rows = analyzeByKm(s);
  assert.strictEqual(rows[0].ascent, 0);
  assert.strictEqual(rows[0].maxGradient100, 0);
});
