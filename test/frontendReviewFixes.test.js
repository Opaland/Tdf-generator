'use strict';
// Epic 35.8 (revue globale du 19/10/2026) : trois défauts d'affichage.

// Fuseau des Amériques AVANT tout usage de Date : « 2026-06-14 » lu à minuit
// UTC s'y affichait « 13/06/2026 ».
process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert');

test('dates calendaires : le jour affiché ne recule pas en UTC−', () => {
  const { formatPeriodLabel } = require('../frontend/traces.js');
  assert.strictEqual(new Date('2026-06-14T00:00:00Z').getDate(), 13, 'précondition : fuseau UTC− actif');
  assert.strictEqual(formatPeriodLabel('day', '2026-06-14'), '14/06/2026');
  assert.strictEqual(formatPeriodLabel('week', '2026-06-08'), 'sem. du 08/06/2026');
  assert.strictEqual(formatPeriodLabel('month', '2026-06'), 'juin 2026');
});

test('carte globale : « Max cat. » donne la catégorie la plus dure', () => {
  const { maxCategory } = require('../frontend/tourmap.js');
  assert.strictEqual(maxCategory([{ category: '2' }, { category: 'HC' }, { category: '4' }]), 'HC');
  assert.strictEqual(maxCategory([{ category: '3' }, { category: '1' }]), '1');
  assert.strictEqual(maxCategory([{ category: 4 }]), 4);
  assert.strictEqual(maxCategory([]), '');
  assert.strictEqual(maxCategory(undefined), '');
});

test('fiche : un 404 affiche « Étape introuvable » et arrête le sondage', async () => {
  const els = {};
  global.document = { getElementById: (id) => (els[id] ??= { textContent: '', style: {} }), addEventListener: () => {} };
  const scheduled = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay) => { scheduled.push(delay); return 1; };
  global.EF = {
    qs: () => '99999',
    esc: (s) => String(s ?? ''),
    api: async () => { throw Object.assign(new Error('Étape introuvable'), { status: 404 }); },
  };
  try {
    const { poll } = require('../frontend/stage.js');
    await poll();
    assert.strictEqual(els['pg-title'].textContent, 'Étape introuvable');
    assert.deepStrictEqual(scheduled, [], 'aucune nouvelle tentative programmée');
    // Une vraie panne réseau (sans status) reste retentée.
    global.EF.api = async () => { throw new Error('Failed to fetch'); };
    await poll();
    assert.strictEqual(scheduled.length, 1);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});
