'use strict';
// Contrôle des itinéraires à ±5 % (Epic 33) : scripts/check-itineraries.js,
// routeur injecté — aucun appel réseau.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-itincheck-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { checkStage, checkStoredStage, officialKm, measuredTowns, isSuspectLeg, isBacktrack, retracedKm } = require('../scripts/check-itineraries');

after(() => fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true }));

const town = (label, km, extra = {}) => ({ label, km, kind: 'ville', lat: 49, lon: 6 + km / 100, ...extra });

test('checkStage : écart routé / profil, tolérance ±5 % incluse, au-delà hors', async () => {
  const towns = [town('A', 0), town('A2', 1), town('B', 50), town('C', 100)];
  const at = (factor) => async (a, b) => (b.km - a.km) * 1000 * factor;
  assert.strictEqual((await checkStage(towns, at(1.049), 100)).ok, true);
  assert.strictEqual((await checkStage(towns, at(0.951), 100)).ok, true);
  // Verdict sur la valeur publiée (arrondie à 0,1) : 5,04 % → 5,0 → dans la tolérance.
  assert.strictEqual((await checkStage(towns, at(1.0504), 100)).ok, true);
  const hors = await checkStage(towns, at(1.06), 100);
  assert.strictEqual(hors.ok, false);
  assert.ok(Math.abs(hors.deltaPct - 6) < 1e-9);
  // Premier tronçon (km 0 = départ fictif, zone neutralisée) jamais mesuré.
  const neutral = await checkStage(towns, async (a, b) => (a.km === 0 ? 40000 : (b.km - a.km) * 1000), 100);
  assert.strictEqual(neutral.ok, true);
  assert.strictEqual((await checkStage(towns, at(0.94), 100)).ok, false);
});

test('checkStage : côte/lieu-dit au centre de sa commune non routés ; moins de la moitié du profil couverte → null', async () => {
  const seen = [];
  const router = async (a, b) => { seen.push(`${a.label}>${b.label}`); return (b.km - a.km) * 1000; };
  const towns = [town('A', 0), town('A2', 1), town('Côte', 30, { kind: 'côte', geocodeAs: 'X' }), town('B', 60)];
  await checkStage(towns, router, 60);
  assert.deepStrictEqual(seen, ['A2>B']);
  // Au moins deux points routables mais moins de la moitié de l'étape : non contrôlable.
  assert.strictEqual(await checkStage([town('A', 0), town('A2', 1), town('B', 40), { label: 'Z', km: 100, kind: 'ville' }], router, 100), null);
  // Longueur inconnue : non contrôlable.
  assert.strictEqual(await checkStage([town('A', 0), town('A2', 1), town('B', 60)], router, null), null);
  // Couverture publiée : 59 km contrôlés sur 100.
  assert.strictEqual((await checkStage([town('A', 0), town('A2', 1), town('B', 60)], router, 100)).coveragePct, 59);
});

test('officialKm : length_km, sinon distance stage_towns, sinon dernier km d\'une transcription complète ; partielle sans longueur → null', () => {
  const towns = [{ km: 0 }, { km: 80 }];
  assert.strictEqual(officialKm({ length_km: 100, partial: true, towns }, { distanceKm: 90 }), 100);
  assert.strictEqual(officialKm({ partial: true, towns }, { distanceKm: 90 }), 90);
  assert.strictEqual(officialKm({ towns }, null), 80);
  assert.strictEqual(officialKm({ partial: true, towns }, null), null);
});

test('measuredTowns : un circuit final (circuit_km) sort de la mesure, la part mesurée baisse d\'autant', async () => {
  // L'arrivée est à 1 km de l'entrée du circuit, 20 km de tours plus loin au profil.
  const towns = [town('A', 0), town('B', 10), town('C', 30), town('Entrée', 50), town('Arrivée', 70, { lon: 6.51 })];
  assert.deepStrictEqual(measuredTowns({ towns }).map((t) => t.label), ['A', 'B', 'C', 'Entrée', 'Arrivée']);
  const kept = measuredTowns({ towns, circuit_km: 50 });
  assert.deepStrictEqual(kept.map((t) => t.label), ['A', 'B', 'C', 'Entrée']);
  const leg = (a, b) => Math.abs(b.lon - a.lon) * 100 * 1000; // 1 km par 0,01° : ligne droite
  const all = await checkStage(towns, leg, 70);
  const cut = await checkStage(kept, leg, 70);
  assert.strictEqual(all.ok, false); // les tours du circuit ne se routent pas
  assert.strictEqual(cut.ok, true);
  assert.strictEqual(cut.coveragePct, 57); // 40 km mesurés sur 70
  // Le contrôle d'une étape stockée (celui de main) applique bien circuit_km.
  const stored = await checkStoredStage({ towns, circuit_km: 50 }, leg, null);
  assert.strictEqual(stored.ok, true);
  assert.strictEqual(stored.coveragePct, 57);
});

test('isSuspectLeg : km du profil plus court que la ligne droite, ou route très éloignée du profil ; un écart normal ne l\'est pas', () => {
  // 1987/7 avant relecture : Baires → Saint-Julien 12,5 km au profil pour 3,9 routés.
  assert.strictEqual(isSuspectLeg({ profileKm: 12.5, routedKm: 3.9, crowKm: 3.2 }), true);
  // 1987/6 : Andlau → Le Hohwald 5 km au profil, 7 à vol d'oiseau.
  assert.strictEqual(isSuspectLeg({ profileKm: 5, routedKm: 9.3, crowKm: 7.0 }), true);
  assert.strictEqual(isSuspectLeg({ profileKm: 5, routedKm: 6.5, crowKm: 6.4 }), true); // seule la ligne droite le trahit
  assert.strictEqual(isSuspectLeg({ profileKm: 5, routedKm: 5.9, crowKm: 5.8 }), false); // 0,8 km de marge
  assert.strictEqual(isSuspectLeg({ profileKm: 10, routedKm: 11.5, crowKm: 8 }), false);
  assert.strictEqual(isSuspectLeg({ profileKm: 6, routedKm: 8.5, crowKm: 5 }), false); // 2,5 km d'écart
  assert.strictEqual(isSuspectLeg({ profileKm: 10, routedKm: 13, crowKm: 9 }), false); // facteur 1,3
  // Bornes des seuils : 3 km d'écart, facteurs 1,4 et 0,7.
  assert.strictEqual(isSuspectLeg({ profileKm: 6.4, routedKm: 9.6, crowKm: 6 }), true); // 3,2 km, ×1,5
  assert.strictEqual(isSuspectLeg({ profileKm: 7, routedKm: 9.9, crowKm: 6 }), false); // 2,9 km, ×1,41
  assert.strictEqual(isSuspectLeg({ profileKm: 20, routedKm: 15, crowKm: 12 }), false); // 5 km mais ×0,75

});

test('checkStage : compte les tronçons suspects même quand le total est dans la tolérance', async () => {
  // Deux km décalés qui se compensent : total exact, deux tronçons faux.
  const towns = [town('A', 0), town('B', 10), town('C', 12), town('D', 30), town('E', 40)]
    .map((t, i) => ({ ...t, lon: 6 + [0, 0, 10, 20, 30, 40][i + 1] / 100 }));
  const leg = (a, b) => Math.abs(b.lon - a.lon) * 100 * 1000 * 1.0;
  const r = await checkStage(towns, leg, 40);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.suspectLegs, 2);
});

// Allers-retours (33.14) — géométrie synthétique à 45° N, pas de 100 m.
const KM_LAT = 1 / 111.2;
const KM_LON = 1 / (111.2 * Math.cos((45 * Math.PI) / 180));
const pt = (xKm, yKm) => ({ lat: 45 + yKm * KM_LAT, lon: 6 + xKm * KM_LON });
const line = (from, to, n = 30) => Array.from({ length: n + 1 }, (_, i) => pt(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n));
const IN = line([0, 0], [0, 3]); // A (0,0) → B (0,3), plein nord

test('retracedKm : km du tracé sortant qui reprennent la route d\'arrivée, à 30 m près', () => {
  // Demi-tour : 2 km vers le sud sur la même route, puis vers l'est.
  const back = [...line([0, 3], [0, 1], 20), ...line([0, 1], [3, 1], 30).slice(1)];
  assert.ok(Math.abs(retracedKm(IN, back) - 2) <= 0.1, String(retracedKm(IN, back)));
  // Tout droit, ou virage à angle droit : rien de repris.
  assert.ok(retracedKm(IN, line([0, 3], [0, 6])) <= 0.1);
  assert.ok(retracedKm(IN, line([0, 3], [3, 3])) <= 0.1);
  // Virage serré vers une autre vallée (20° d'écart) : la route s'écarte, pas un aller-retour.
  const a = (20 * Math.PI) / 180;
  assert.ok(retracedKm(IN, line([0, 3], [3 * Math.sin(a), 3 - 3 * Math.cos(a)])) < 1);
  // Tolérance : retour parallèle à 25 m compté, à 40 m non.
  const para = (dxKm) => [pt(0, 3), ...line([dxKm, 3], [dxKm, 1], 20)];
  assert.ok(retracedKm(IN, para(0.025)) >= 1.9);
  assert.ok(retracedKm(IN, para(0.04)) <= 0.1);
  // Sans géométrie (routeur injecté qui ne rend qu'une distance) : 0.
  assert.strictEqual(retracedKm(null, back), 0);
  assert.strictEqual(retracedKm(IN, null), 0);
});

test('isBacktrack : 1 km repris suffit, en dessous non', () => {
  assert.strictEqual(isBacktrack({ retracedKm: 1 }), true);
  assert.strictEqual(isBacktrack({ retracedKm: 0.9 }), false);
});

test('checkStage : compte les allers-retours quand le routeur rend le tracé', async () => {
  // A → B (3 km nord) ; B → C repart 2 km vers le sud sur la même route.
  const towns = [{ ...pt(0, -1), label: 'Départ', km: 0 }, { ...pt(0, 0), label: 'A', km: 1 },
    { ...pt(0, 3), label: 'B', km: 4 }, { ...pt(3, 1), label: 'C', km: 9 }];
  const geom = { 'Départ>A': line([0, -1], [0, 0]), 'A>B': IN, 'B>C': [...line([0, 3], [0, 1], 20), ...line([0, 1], [3, 1], 30).slice(1)] };
  const router = (a, b) => {
    const points = geom[`${a.label}>${b.label}`];
    let m = 0;
    for (let i = 1; i < points.length; i++) m += Math.hypot((points[i].lat - points[i - 1].lat) / KM_LAT, (points[i].lon - points[i - 1].lon) / KM_LON) * 1000;
    return { distanceM: m, points, router: 'brouter' };
  };
  const r = await checkStage(towns, router, 9);
  assert.strictEqual(r.backtracks, 1);
  assert.strictEqual(r.legs.find((l) => l.from === 'B').retracedKm >= 1.9, true);
});

test('retracedKm : une petite boucle avant de reprendre la route d\'arrivée reste un aller-retour', () => {
  // Sortie vers l'est (200 m, hors tolérance), retour sur la route d'arrivée
  // à 2,5 km, puis 1,5 km vers le sud dessus.
  const loop = [...line([0, 3], [0.2, 3], 2), ...line([0.2, 3], [0.2, 2.5], 5).slice(1), ...line([0.2, 2.5], [0, 2.5], 2).slice(1), ...line([0, 2.5], [0, 1], 15).slice(1)];
  assert.ok(retracedKm(IN, loop) >= 1.4, String(retracedKm(IN, loop)));
});
