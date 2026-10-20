'use strict';
// Epic 35.16 (revue globale du 19/10/2026) : après un import GPX/FIT ou par
// lien, le bilan de « Mes traces » restait à l'état d'avant l'import.

const { test } = require('node:test');
const assert = require('node:assert');

function setup({ importOk, okFiles }) {
  const els = {};
  const el = () => ({ textContent: '', innerHTML: '', value: 'https://www.sports-tracker.com/workout/x/y', style: {}, addEventListener: () => {}, querySelector: () => el(), querySelectorAll: () => [] });
  global.window = {};
  global.document = {
    addEventListener: () => {},
    getElementById: (id) => (els[id] ??= el()),
    querySelector: () => el(),
    querySelectorAll: () => [],
  };
  const calls = [];
  // Seuls les deux imports sont simulés ; tout autre appel est une erreur du test.
  global.fetch = async (url) => {
    assert.match(String(url), /^\/api\/import\/gpx\?/);
    if (okFiles) {
      const ok = okFiles.some((f) => String(url).includes(`name=${f}`));
      return { ok, status: ok ? 200 : 400, json: async () => (ok ? { id: 7, points: 10 } : { error: 'GPX invalide' }) };
    }
    return { ok: importOk, status: importOk ? 200 : 400, json: async () => (importOk ? { id: 7, points: 10 } : { error: 'GPX invalide' }) };
  };
  // Le bilan est demandé via EF.api : il suffit de compter ces appels, le
  // rendu échoue en silence (catch dans loadSummary) faute de DOM complet.
  global.EF = {
    esc: (s) => String(s ?? ''),
    api: async (url) => {
      calls.push(url);
      if (url === '/api/import/link') {
        if (!importOk) throw new Error('lien invalide');
        return { id: 8, points: 12 };
      }
      return null;
    },
  };
  return calls;
}

const gpx = (name) => ({ name, text: async () => '<gpx/>' });
const summaryCalls = (calls) => calls.filter((u) => u === '/api/traces/summary').length;

test('import GPX réussi : le bilan est redemandé', async () => {
  const calls = setup({ importOk: true });
  const { importTraceFiles } = require('../frontend/traces.js');
  await importTraceFiles([gpx('a.gpx'), gpx('b.gpx')]);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(summaryCalls(calls), 1, 'un seul rafraîchissement pour plusieurs fichiers');
});

test('import GPX en échec : pas de rafraîchissement inutile', async () => {
  const calls = setup({ importOk: false });
  const { importTraceFiles } = require('../frontend/traces.js');
  await importTraceFiles([gpx('a.gpx')]);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(summaryCalls(calls), 0);
  assert.match(global.document.getElementById('gpx-msg').textContent, /GPX invalide/);
});

test('un fichier réussi puis un en échec : le bilan est quand même redemandé', async () => {
  const calls = setup({ okFiles: ['a'] });
  const { importTraceFiles } = require('../frontend/traces.js');
  await importTraceFiles([gpx('a.gpx'), gpx('bad.gpx'), gpx('c.gpx')]);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(summaryCalls(calls), 1);
  assert.match(global.document.getElementById('gpx-msg').textContent, /bad\.gpx : GPX invalide/);
});

test('import par lien réussi : le bilan est redemandé', async () => {
  const calls = setup({ importOk: true });
  const { importFromLink } = require('../frontend/traces.js');
  await importFromLink();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(summaryCalls(calls), 1);
});

test('graphique hebdomadaire : une seule semaine ne remplit pas tout le graphique', () => {
  global.EF = { esc: (s) => String(s ?? '') };
  const { buildWeeklyBarChart } = require('../frontend/traces.js');
  const svg = buildWeeklyBarChart([{ date: '2026-06-10', distanceKm: 42 }], 600, 160);
  const w = Number(svg.match(/<rect [^>]* width="([\d.]+)"/)[1]);
  assert.ok(w <= 48, `barre de ${w} px pour une semaine`);
  const x = Number(svg.match(/<rect x="([\d.]+)"/)[1]);
  assert.ok(Math.abs(x + w / 2 - (44 + (600 - 44 - 12) / 2)) < 1, 'barre centrée dans son créneau');
});
