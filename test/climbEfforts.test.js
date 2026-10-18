'use strict';
// Côtes = segments (Epic 31.3) : pipeline/climbEfforts.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { climbEfforts } = require('../pipeline/climbEfforts');

const M_PER_DEG = 111195;
/** Trace en ligne droite vers le nord, échantillons tous les 100 m.
 * offsetM : position (m) du départ de la trace sur la route commune.
 * speed : m/s (null = trace sans horodatage). reverse : parcourue vers le sud. */
function samples({ offsetM = 0, lengthM = 5000, speed = 5, reverse = false }) {
  const out = [];
  for (let d = 0; d <= lengthM; d += 100) {
    const road = reverse ? offsetM - d : offsetM + d;
    out.push({ dist_m: d, lat: 45 + road / M_PER_DEG, lon: 6, elapsed_s: speed == null ? null : d / speed });
  }
  return out;
}

test('même côte, pied détecté à des endroits différents : chaque passage est chronométré entre les repères du premier', () => {
  const traces = [{ id: 1, name: 'A', date: '2026-06-01' }, { id: 2, name: 'B', date: '2026-06-08' }];
  const climbs = new Map([
    [1, [{ name: 'Côte X', category: '3', start_km: 1, end_km: 3, summit_ele_m: 500 }]],
    // Trace B part 500 m plus tôt sur la même route, pied détecté 300 m plus bas.
    [2, [{ name: 'Côte X', category: '4', start_km: 1.2, end_km: 3.5, summit_ele_m: 498 }]],
  ]);
  const smp = new Map([[1, samples({ speed: 5 })], [2, samples({ offsetM: -500, speed: 4 })]]);
  const [g] = climbEfforts(traces, climbs, smp);
  assert.strictEqual(g.name, 'Côte X');
  assert.strictEqual(g.category, '3');
  assert.strictEqual(g.summitEleM, 500);
  assert.strictEqual(g.refLengthKm, 2);
  assert.strictEqual(g.count, 2);
  // 2 000 m de référence : 400 s à 5 m/s, 500 s à 4 m/s (et non 2 300 m à 4 m/s).
  assert.deepStrictEqual(g.passages.map((p) => p.timeS), [400, 500]);
  assert.strictEqual(g.bestTimeS, 400);
});

test('autre versant, trace sans horodatage, autre sommet : raisons explicites, jamais de temps estimé', () => {
  const traces = [
    { id: 1, name: 'Réf', date: '2026-06-01' },
    { id: 2, name: 'Versant opposé', date: '2026-06-02' },
    { id: 3, name: 'Sans heure', date: '2026-06-03' },
    { id: 4, name: 'Ailleurs', date: '2026-06-04' },
  ];
  const climbs = new Map([
    [1, [{ name: 'Col', category: '2', start_km: 1, end_km: 3, summit_ele_m: 900 }]],
    // Arrive au même sommet (route 3 000 m) par le nord : jamais au pied de référence (route 1 000 m).
    [2, [{ name: 'Col', category: '2', start_km: 1, end_km: 2, summit_ele_m: 900 }]],
    [3, [{ name: 'Col', category: '2', start_km: 1, end_km: 3, summit_ele_m: 900 }]],
    [4, [{ name: 'Autre', category: '4', start_km: 1, end_km: 3, summit_ele_m: 300 }]],
  ]);
  const smp = new Map([
    [1, samples({})],
    [2, samples({ offsetM: 5000, lengthM: 2000, reverse: true })],
    [3, samples({ speed: null })],
    [4, samples({ offsetM: 50000 })],
  ]);
  const groups = climbEfforts(traces, climbs, smp);
  assert.strictEqual(groups.length, 2);
  const col = groups.find((g) => g.name === 'Col');
  assert.deepStrictEqual(col.passages.map((p) => [p.stageName, p.timeS, p.reason]), [
    ['Réf', 400, null], ['Versant opposé', null, 'pied'], ['Sans heure', null, 'sans-temps'],
  ]);
  assert.strictEqual(col.timedCount, 1);
  assert.strictEqual(groups.find((g) => g.name === 'Autre').count, 1);
});

test('les repères viennent du premier passage chronologique, pas du premier importé', () => {
  const traces = [{ id: 9, name: 'Récente', date: '2026-07-01' }, { id: 3, name: 'Ancienne', date: '2026-05-01' }];
  const climbs = new Map([
    [9, [{ name: 'C', category: '4', start_km: 1.5, end_km: 3, summit_ele_m: 400 }]],
    [3, [{ name: 'C', category: '4', start_km: 1, end_km: 3, summit_ele_m: 400 }]],
  ]);
  const smp = new Map([[9, samples({})], [3, samples({})]]);
  const [g] = climbEfforts(traces, climbs, smp);
  assert.strictEqual(g.refLengthKm, 2);
  assert.deepStrictEqual(g.passages.map((p) => [p.stageName, p.timeS]), [['Ancienne', 400], ['Récente', 400]]);
});

test('aucune côte ou aucun échantillon : liste vide, sans exception', () => {
  assert.deepStrictEqual(climbEfforts([], new Map(), new Map()), []);
  assert.deepStrictEqual(climbEfforts([{ id: 1, name: 'x', date: null }], new Map([[1, [{ start_km: 0, end_km: 1 }]]]), new Map()), []);
});

test('boucle qui part du pied puis y repasse : chronométrée depuis le dernier passage au pied, pas depuis le départ', () => {
  // Réf : route 0 → 5 000 m, côte de 1 000 à 3 000 m, 5 m/s.
  const ref = samples({});
  // Sortie 2 : départ au pied (route 1 000 m), boucle de 15 km ailleurs, retour au pied, puis montée à 4 m/s.
  const loop = [];
  let d = 0;
  let t = 0;
  for (let i = 0; i <= 75; i++, d += 100, t += 20) loop.push({ dist_m: d, lat: 45 + 1000 / M_PER_DEG, lon: 6 + i * 0.001, elapsed_s: t });
  for (let i = 75; i >= 0; i--, d += 100, t += 20) loop.push({ dist_m: d, lat: 45 + 1100 / M_PER_DEG, lon: 6 + i * 0.001, elapsed_s: t });
  const footIdx = loop.length;
  for (let r = 1050; r <= 3050; r += 100, d += 100, t += 25) loop.push({ dist_m: d, lat: 45 + r / M_PER_DEG, lon: 6, elapsed_s: t });
  const endKm = (loop[loop.length - 1].dist_m) / 1000;
  const traces = [{ id: 1, name: 'Réf', date: '2026-06-01' }, { id: 2, name: 'Boucle', date: '2026-06-02' }];
  const climbs = new Map([
    [1, [{ name: 'C', category: '3', start_km: 1, end_km: 3, summit_ele_m: 500 }]],
    [2, [{ name: 'C', category: '3', start_km: loop[footIdx].dist_m / 1000, end_km: endKm, summit_ele_m: 500 }]],
  ]);
  const [g] = climbEfforts(traces, climbs, new Map([[1, ref], [2, loop]]));
  const boucle = g.passages.find((p) => p.stageName === 'Boucle');
  // ~2 000 m à 4 m/s = ~500 s (± un échantillon), jamais la boucle entière (~3 500 s).
  assert.ok(boucle.timeS != null && Math.abs(boucle.timeS - 500) <= 30, JSON.stringify(boucle));
});

test('même côte montée deux fois dans la sortie : deux passages numérotés', () => {
  const s1 = samples({ lengthM: 3000 });
  // Montée, redescente, remontée sur la même route.
  const s2 = [];
  let d = 0;
  for (const leg of [[0, 3000], [3000, 1000], [1000, 3000]]) {
    const step = leg[1] > leg[0] ? 100 : -100;
    for (let r = leg[0]; r !== leg[1] + step; r += step, d += 100) s2.push({ dist_m: d, lat: 45 + r / M_PER_DEG, lon: 6, elapsed_s: d / 5 });
  }
  const traces = [{ id: 1, name: 'Réf', date: '2026-06-01' }, { id: 2, name: 'Double', date: '2026-06-02' }];
  const climbs = new Map([
    [1, [{ name: 'C', category: '4', start_km: 1, end_km: 3, summit_ele_m: 400 }]],
    [2, [{ name: 'C', category: '4', start_km: 1, end_km: 3, summit_ele_m: 400 }, { name: 'C', category: '4', start_km: 5.1, end_km: 7.1, summit_ele_m: 400 }]],
  ]);
  const [g] = climbEfforts(traces, climbs, new Map([[1, s1], [2, s2]]));
  const double = g.passages.filter((p) => p.stageName === 'Double');
  assert.deepStrictEqual(double.map((p) => p.ascent), [1, 2]);
  assert.ok(double.every((p) => Math.abs(p.timeS - 400) <= 25), JSON.stringify(double));
});
