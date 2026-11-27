'use strict';
// Page par édition (story 41.6, issue #631) : préparation des itinéraires
// curés pour l'affichage, en lecture seule.

const fs = require('fs');
const crypto = require('crypto');
const { test } = require('node:test');
const assert = require('node:assert');
const ep = require('../pipeline/editionPages');

const FIXTURE = {
  1965: {
    stages: {
      '2': {
        source_url: 'https://example.org/65_2.jpg',
        towns: [
          { label: 'A', km: 0, kind: 'ville', note: '85 m imprimés ; départ', lat: 50, lon: 5, confidence: 'ok' },
          { label: 'Côte de B', km: 9.5, kind: 'côte', note: '220 m imprimés ; 3e cat.', lat: 50.1, lon: 5.1, confidence: 'ok' },
          { label: 'C', km: 20, kind: 'ville', note: 'aucun km imprimé (graduation 20) ; non placé : km approché (règle 4)', confidence: 'non-place' },
          { label: 'Col de D', km: 30, kind: 'col', note: '1449 m imprimés ; 2e cat. ; altitude peu lisible', lat: 50.2, lon: 5.2, geocodeAs: 'D' },
          { label: 'E', km: 41.5, kind: 'ville', note: 'km imprimé illisible (mesuré ≈ 41,4)', lat: 50.3, lon: 5.3, confidence: 'ok' },
        ],
        route_check: { routed_km: 44.1, profile_km: 41.5, delta_pct: 6.3, tolerance_pct: 5, coverage_pct: 92, car_legs: 0 },
        note: 'Hors tolérance : cause non établie.',
      },
      '1a': {
        source_url: 'https://example.org/65_1a.jpg',
        towns: [
          { label: 'F', km: 0, kind: 'ville', lat: 50, lon: 6 },
          { label: 'G', km: 140, kind: 'ville', note: '1er passage', lat: 50.5, lon: 5.6 },
          { label: 'G', km: 149, kind: 'ville', lat: 50.5, lon: 5.6 },
        ],
        circuit_km: 140,
        route_check: { routed_km: 139, profile_km: 140, tolerance_pct: 5, coverage_pct: 95 },
      },
      '10': { towns: [{ label: 'H', km: 0, kind: 'ville' }, { label: 'I', km: 200, kind: 'ville' }] },
    },
  },
  '2022-femmes': { stages: { '1': { towns: [] } } },
};

test('ordre des étapes : 1a, 2, 10 (pas l’ordre des clés JS)', () => {
  assert.deepStrictEqual(ep.stageOrder(['2', '10', '1a', '12b', '12a']), ['1a', '2', '10', '12a', '12b']);
  assert.deepStrictEqual(ep.editionPage(1965, FIXTURE).stages.map((s) => s.key), ['1a', '2', '10']);
});

test('écart profil / reconstitution toujours rendu, hors tolérance compris', () => {
  const s = ep.editionPage(1965, FIXTURE).stages.find((x) => x.key === '2');
  assert.deepStrictEqual(s.check, {
    routed_km: 44.1, profile_km: 41.5, delta_pct: 6.3, tolerance_pct: 5, coverage_pct: 92, within: false, car_legs: 0,
  });
  assert.strictEqual(s.note, 'Hors tolérance : cause non établie.');
  assert.strictEqual(s.distance_km, 41.5);
  assert.strictEqual(s.depart, 'A');
  assert.strictEqual(s.arrivee, 'E');
});

test('écart recalculé quand delta_pct manque ; étape sans contrôle → null', () => {
  const p = ep.editionPage('1965', FIXTURE);
  const a = p.stages.find((x) => x.key === '1a');
  assert.strictEqual(a.check.delta_pct, -0.7);
  assert.strictEqual(a.check.within, true);
  assert.strictEqual(a.circuit_km, 140);
  assert.strictEqual(p.stages.find((x) => x.key === '10').check, null);
});

test('km non imprimé marqué, altitude douteuse marquée, côte au village hors carte', () => {
  const pts = ep.editionPage(1965, FIXTURE).stages.find((x) => x.key === '2').points;
  assert.deepStrictEqual(pts.map((p) => p.km_printed), [true, true, false, true, false]);
  assert.strictEqual(pts[1].altitude_m, 220);
  assert.strictEqual(pts[1].category, '3');
  assert.strictEqual(pts[1].altitude_doubtful, false);
  assert.strictEqual(pts[3].altitude_m, 1449);
  assert.strictEqual(pts[3].altitude_doubtful, true);
  // geocodeAs : la position est celle du village, pas de la route
  assert.strictEqual(pts[3].placed, false);
  assert.strictEqual(pts[3].lat, undefined);
  assert.strictEqual(pts[3].at_village, true);
  assert.strictEqual(pts[2].placed, false);
  assert.strictEqual(pts[2].lat, undefined);
  assert.strictEqual(pts[4].placed, true);
});

test('index : seulement les années, avec étapes, points, placés et contrôles', () => {
  assert.deepStrictEqual(ep.editionIndex(FIXTURE), [
    { year: 1965, stages: 3, points: 10, placed: 6, checked: 2, within: 1 },
  ]);
});

test('année invalide ou absente → null', () => {
  for (const y of ['1966', 'abcd', '2022-femmes', '../x', '19650']) assert.strictEqual(ep.editionPage(y, FIXTURE), null);
});

test('kmIsPrinted reconnaît les formules de la curation', () => {
  for (const n of ['aucun km imprimé (mesuré ≈ 3,4)', 'km imprimé illisible (mesuré ≈ 6,4)', 'km peu lisible (129½ ou 129)',
    'km de la graduation : nom posé sur la graduation', 'non placé : km approché (règle 4)', 'aucun km propre : colonne sur la graduation 10']) {
    assert.strictEqual(ep.kmIsPrinted(n), false, n);
  }
  for (const n of ['85 m imprimés ; départ', 'km lu 41,5', '', undefined]) assert.strictEqual(ep.kmIsPrinted(n), true, String(n));
});

test('données réelles : lues sans être réécrites, 1965 publiée', () => {
  const before = crypto.createHash('sha256').update(fs.readFileSync(ep.DATA_FILE)).digest('hex');
  const idx = ep.editionIndex();
  const page = ep.editionPage(1965);
  const after = crypto.createHash('sha256').update(fs.readFileSync(ep.DATA_FILE)).digest('hex');
  assert.strictEqual(after, before);
  assert.ok(idx.some((e) => e.year === 1965));
  assert.ok(page.stages.length >= 20);
  // chaque étape contrôlée porte un écart chiffré
  for (const s of page.stages) if (s.check) assert.ok(Number.isFinite(s.check.delta_pct), s.key);
});
