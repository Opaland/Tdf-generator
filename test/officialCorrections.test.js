'use strict';
// Epic 33.19 : corrections sourcées des distances, dates et villes officielles
// du tableau en.wikipedia, appliquées à l'import ; la valeur Wikipédia
// d'origine reste visible (CLAUDE.md règle 12).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-corrections-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, after } = require('node:test');
const assert = require('node:assert');
const oc = require('../pipeline/officialCorrections');

// Correction de test sur la fixture 1903, posée avant le chargement de
// l'importeur (qui lit `correctStage` à son require).
const realCorrect = oc.correctStage;
const TEST = oc.validateCorrections({ corrections: { '1903/1': { distanceKm: 471, source: 'source de test <b>' } } });
oc.correctStage = (s, k, c) => realCorrect(s, k, c || TEST);
const { importEdition } = require('../pipeline/importer');

after(() => {
  oc.correctStage = realCorrect;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('validateCorrections : source obligatoire, champs et valeurs contrôlés, clé de curation', () => {
  const ok = { distanceKm: 255, source: 'fr.wikipedia' };
  assert.deepStrictEqual(Object.keys(oc.validateCorrections({ corrections: { '1987/11': ok, '1970/5b': ok, '2022-femmes/3': ok } })), ['1987/11', '1970/5b', '2022-femmes/3']);
  for (const [bad, re] of [
    [{ '1987/11': { distanceKm: 255 } }, /source manquante/],
    [{ '1987/11': { distanceKm: 255, source: '  ' } }, /source manquante/],
    [{ '1987/11': { source: 'x' } }, /aucune valeur/],
    [{ '1987/11': { km: 255, source: 'x' } }, /champ inconnu/],
    [{ '1987/11': { distanceKm: '255', source: 'x' } }, /valeur invalide/],
    [{ '1905/3': { dateIso: '1905-13-45', source: 'x' } }, /valeur invalide/],
    [{ '1905/3': { dateIso: '15/07/1905', source: 'x' } }, /valeur invalide/],
    [{ '1984/6': { start: ' ', source: 'x' } }, /valeur invalide/],
    [{ 'Tour 1987/11': ok }, /clé invalide/],
  ]) assert.throws(() => oc.validateCorrections({ corrections: bad }), re, JSON.stringify(bad));
  assert.throws(() => oc.validateCorrections({}), /corrections/);
});

test('le fichier du dépôt est valide et chaque clé désigne une étape de stage_towns.json, déjà corrigée', () => {
  const corr = oc.loadCorrections();
  const { stageCurationKey } = require('../pipeline/wikipedia');
  const towns = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json'), 'utf8'));
  const byKey = new Map();
  for (const [ek, ed] of Object.entries(towns.editions)) {
    const counts = new Map();
    for (const s of ed.stages) counts.set(s.number, (counts.get(s.number) || 0) + 1);
    const seen = new Map();
    for (const s of ed.stages) {
      const o = seen.get(s.number) || 0;
      seen.set(s.number, o + 1);
      byKey.set(`${ek}/${stageCurationKey(s.number, o, counts.get(s.number))}`, s);
    }
  }
  assert.ok(Object.keys(corr).length >= 24);
  for (const [k, c] of Object.entries(corr)) {
    const s = byKey.get(k);
    assert.ok(s, `${k} : aucune étape`);
    if (c.distanceKm != null) assert.strictEqual(s.distanceKm, c.distanceKm, k);
    if (c.dateIso != null) assert.strictEqual(s.date, c.dateIso, k);
    if (c.start != null) assert.strictEqual(s.start.label, c.start, k);
  }
});

test('correctStage : valeur Wikipédia gardée à côté ; sans entrée ou déjà juste, rien n\'est signalé', () => {
  const corr = oc.validateCorrections({ corrections: { '1987/11': { distanceKm: 255, source: 'fr' } } });
  const { stage, applied } = realCorrect({ number: 11, distanceKm: 206, start: 'Poitiers' }, '1987/11', corr);
  assert.strictEqual(stage.distanceKm, 255);
  assert.deepStrictEqual(applied, [{ field: 'distanceKm', wikipedia: 206, value: 255, source: 'fr' }]);
  assert.deepStrictEqual(realCorrect({ distanceKm: 255 }, '1987/11', corr).applied, []);
  assert.deepStrictEqual(realCorrect({ distanceKm: 206 }, '1987/12', corr).applied, []);
});

test('import d\'une édition : distance corrigée en base, valeur Wikipédia et source dans la source de l\'étape', async () => {
  const { stages } = await importEdition(1903);
  const { getDb } = require('../backend/db');
  const rows = getDb().prepare('SELECT id, stage_order, official_distance_km, source FROM stages WHERE id IN (' + stages.map((s) => s.id).join(',') + ') ORDER BY stage_order').all();
  const first = rows.find((r) => r.stage_order === 1);
  const src = JSON.parse(first.source);
  assert.strictEqual(first.official_distance_km, 471);
  assert.match(src.distance_officielle, /corrigé/);
  assert.strictEqual(src.corrections.length, 1);
  assert.strictEqual(src.corrections[0].value, 471);
  assert.ok(Number.isFinite(src.corrections[0].wikipedia) && src.corrections[0].wikipedia !== 471, 'valeur Wikipédia gardée');
  const other = JSON.parse(rows.find((r) => r.stage_order === 2).source);
  assert.strictEqual(other.distance_officielle, 'wikipedia');
  assert.strictEqual(other.corrections, undefined);
});

test('fiche : la correction s\'affiche avec la valeur d\'origine et la source, échappées', () => {
  global.EF = { esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'), dec: (v) => String(v).replace('.', ','), day: (v) => v.split('-').reverse().join('/'), qs: () => null };
  global.EFProfile = require('../frontend/profile.js');
  const { correctionsHtml } = require('../frontend/stage.js');
  const html = correctionsHtml({ corrections: [
    { field: 'distanceKm', wikipedia: 206, value: 237.5, source: 'fr <script>' },
    { field: 'dateIso', wikipedia: '1905-07-14', value: '1905-07-15', source: 'fr' },
    { field: 'inconnu', value: 1, source: 'x' },
  ] });
  assert.match(html, /distance 237,5 km au lieu de 206 km/);
  assert.match(html, /date 15\/07\/1905 au lieu de 14\/07\/1905/);
  assert.match(html, /fr &lt;script>/);
  assert.doesNotMatch(html, /inconnu/);
  assert.strictEqual(correctionsHtml(null), '');
  assert.strictEqual(correctionsHtml({ villes: 'wikipedia' }), '');
});
