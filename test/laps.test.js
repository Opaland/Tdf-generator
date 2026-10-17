'use strict';
// Étapes en circuit (issue #251, Epic 8, option A) : `laps` développé à
// l'import par reconstructionWaypoints() (pipeline/wikipedia.js).

const { test } = require('node:test');
const assert = require('node:assert');
const { expandLaps } = require('../pipeline/wikipedia');
const HISTORIC_ROUTES = require('../pipeline/data/historic_routes.json');

test('expandLaps : sans laps, vias inchangés (même tableau)', () => {
  const vias = ['A', 'B'];
  assert.strictEqual(expandLaps(vias, undefined), vias);
  assert.strictEqual(expandLaps(vias, null), vias);
});

test('expandLaps : approche puis boucle répétée count fois au total', () => {
  assert.deepStrictEqual(
    expandLaps(['Approche', 'C1', 'C2', 'C3'], { count: 3, from: 1 }),
    ['Approche', 'C1', 'C2', 'C3', 'C1', 'C2', 'C3', 'C1', 'C2', 'C3']
  );
  // Boucle seule (circuit fermé dès le départ), un seul tour = vias inchangés.
  assert.deepStrictEqual(expandLaps(['C1', 'C2'], { count: 1, from: 0 }), ['C1', 'C2']);
  assert.deepStrictEqual(expandLaps(['C1', 'C2'], { count: 2, from: 0 }), ['C1', 'C2', 'C1', 'C2']);
  // Borne haute incluse (MAX_LAPS = 50) — seule 51 est refusée.
  assert.strictEqual(expandLaps(['C1'], { count: 50, from: 0 }).length, 50);
});

test('expandLaps : laps mal formé → erreur explicite, jamais une distance fausse en silence', () => {
  const vias = ['A', 'B', 'C'];
  for (const bad of [
    { count: 0, from: 0 }, { count: 51, from: 0 }, { count: 2.5, from: 0 }, { count: '3', from: 0 },
    { count: 3, from: -1 }, { count: 3, from: 3 }, { count: 3, from: 1.5 }, { count: 3 }, {},
  ]) {
    assert.throws(() => expandLaps(vias, bad), /laps\.(count|from) invalide/, JSON.stringify(bad));
  }
  assert.throws(() => expandLaps([], { count: 2, from: 0 }), /laps\.from invalide/);
});

test('historic_routes.json : chaque `laps` curé est bien formé, sans doublon à la jonction des tours', () => {
  const errors = [];
  for (const [key, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stage, entry] of Object.entries(edition.stages || {})) {
      if (entry.laps === undefined) continue;
      try {
        // Jonction entre deux tours : le test d'adjacence de
        // historicRoutes.test.js lit les vias bruts et ne voit pas la couture
        // fin de tour → début du tour suivant (relecture adverse).
        const labels = expandLaps(entry.vias || [], entry.laps).map((v) => (typeof v === 'string' ? v : v.label));
        labels.forEach((l, i) => {
          if (i > 0 && l === labels[i - 1]) errors.push(`${key} étape ${stage} : « ${l} » deux fois de suite (index ${i})`);
        });
      } catch (e) {
        errors.push(`${key} étape ${stage} : ${e.message}`);
      }
    }
  }
  assert.deepStrictEqual(errors, []);
});
