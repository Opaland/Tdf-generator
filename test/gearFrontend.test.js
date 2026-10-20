'use strict';
// Matériel côté écran « Mes traces » (frontend/traces.js, Epic 29) :
// buildGearRows / buildGearSelect, require()-ables grâce à la garde
// `typeof document` de traces.js.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = { dec: (v) => (v == null ? v : String(v).replace('.', ',')), esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };

const { buildGearRows, buildGearSelect } = require('../frontend/traces.js');

const gear = (over) => ({ id: 1, name: 'Vélo', kind: 'velo', retired: false, traceCount: 0, distanceKm: 0, ascentM: 0, elapsedTimeS: null, timedCount: 0, ...over });

test('buildGearRows : nom échappé (règle 1), jamais de balise injectée', () => {
  const html = buildGearRows([gear({ name: '<img src=x onerror=alert(1)>"' })]);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;'));
});

test('buildGearRows : durée « — » sans sortie horodatée, mention partielle sinon', () => {
  assert.match(buildGearRows([gear({ traceCount: 2 })]), /<td>—<\/td>/);
  const partial = buildGearRows([gear({ traceCount: 3, timedCount: 1, elapsedTimeS: 3600 })]);
  assert.match(partial, /1 sur 3 horodatée/);
  const full = buildGearRows([gear({ traceCount: 2, timedCount: 2, elapsedTimeS: 7200 })]);
  assert.ok(!/horodatée/.test(full));
});

test('buildGearRows : bouton Supprimer seulement si autorisé ; retrait réversible', () => {
  assert.ok(!buildGearRows([gear()]).includes('data-gear-action="delete"'));
  assert.ok(buildGearRows([gear()], { canDelete: true }).includes('data-gear-action="delete"'));
  assert.ok(buildGearRows([gear({ retired: true })]).includes('data-gear-action="unretire"'));
  assert.match(buildGearRows([]), /Aucun matériel/);
});

test('buildGearSelect : retiré masqué sauf s\'il est déjà associé à la sortie', () => {
  const list = [gear({ id: 1, name: 'En service' }), gear({ id: 2, name: 'Ancien', retired: true })];
  const none = buildGearSelect(list, 9, null);
  assert.ok(none.includes('En service'));
  assert.ok(!none.includes('Ancien'));
  assert.match(none, /<option value="" selected>/);
  const linked = buildGearSelect(list, 9, 2);
  assert.match(linked, /<option value="2" selected>Ancien \(retiré\)<\/option>/);
  assert.match(linked, /data-trace-id="9"/);
});

test('buildGearSelect : nom échappé', () => {
  const html = buildGearSelect([gear({ name: '</option><script>x</script>' })], 1, null);
  assert.ok(!html.includes('<script>'));
});
