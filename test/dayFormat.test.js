'use strict';
// Epic 35.21 (revue globale du 19/10/2026) : dates en AAAA-MM-JJ sur les
// fiches, en JJ/MM/AAAA dans Mes traces. Un seul affichage : JJ/MM/AAAA.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-dayformat-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
process.env.TZ = 'America/New_York'; // aucun décalage de fuseau possible

const { test, after } = require('node:test');
const assert = require('node:assert');

after(() => {
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('EF.day : AAAA-MM-JJ → JJ/MM/AAAA, tout autre texte rendu tel quel', () => {
  global.window = {};
  const EF = require('../frontend/common.js');
  assert.strictEqual(EF.day('2026-07-05'), '05/07/2026');
  assert.strictEqual(EF.day('1903-07-01'), '01/07/1903');
  assert.strictEqual(EF.day('1–2 Jul.'), '1–2 Jul.', 'date libre d\'un import Wikipédia');
  assert.strictEqual(EF.day(null), null);
  assert.strictEqual(EF.day(''), '');
  assert.strictEqual(EF.dec(12.3), '12,3');
  assert.strictEqual(EF.dec(null), null);
});

test('roadbook : la date de l\'étape en JJ/MM/AAAA', async () => {
  const { app } = require('../backend/server');
  let server;
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const created = await (await fetch(`${base}/api/stages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Daté', date: '2001-07-07', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
    })).json();
    const html = await (await fetch(`${base}/api/stages/${created.id}/roadbook.html`)).text();
    assert.match(html, /<p class="meta">07\/07\/2001 · /);
    // Mini-site autonome : frDay est injecté avec escHtml et appliqué à la date.
    const page = await (await fetch(`${base}/api/stages/${created.id}/export.html`)).text();
    assert.match(page, /escHtml\(frDay\(STAGE\.stage\.date\)\)/);
    const src = page.match(/function frDay\(v\) \{[\s\S]*?\n\}/)[0];
    const frDay = new Function(`${src}; return frDay;`)();
    assert.strictEqual(frDay('2001-07-07'), '07/07/2001');
    assert.strictEqual(frDay('1–2 Jul.'), '1–2 Jul.');
  } finally {
    server.close();
  }
});
