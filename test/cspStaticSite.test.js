'use strict';
// Story 42.4 (issue #566, phase 2) : le site GitHub Pages (scripts/build-site.js)
// n'a pas d'en-têtes HTTP à lui : chaque page porte sa CSP dans une balise
// <meta>. Pages de l'application : aucune ligne de script en ligne ; pages
// d'édition autonomes : chaque script en ligne autorisé par son empreinte.
// Construction dans son propre processus (CLAUDE.md règle 4).
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-csp-site-'));
const DIST = path.join(dir, 'dist');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

before(() => {
  const env = { ...process.env, ETAPEFORGE_DATA_DIR: path.join(dir, 'data'), ETAPEFORGE_OFFLINE: '1', ETAPEFORGE_DIST_DIR: DIST };
  const setup = `
    const { importTrackAsStage } = require(${JSON.stringify(path.join(ROOT, 'pipeline/importTrack'))});
    const { getDb } = require(${JSON.stringify(path.join(ROOT, 'backend/db'))});
    (async () => {
      const pts = [];
      for (let i = 0; i <= 60; i++) pts.push({ lat: 45.3 + i * 0.001, lon: 5.7, ele: 300 + i });
      const id = await importTrackAsStage(pts, { name: 'Trace CSP' });
      const db = getDb();
      const ed = db.prepare("INSERT INTO editions (name, is_custom) VALUES ('Perso', 1)").run().lastInsertRowid;
      db.prepare('UPDATE stages SET edition_id = ?, stage_order = 1 WHERE id = ?').run(ed, id);
    })().catch((e) => { console.error(e); process.exit(1); });`;
  execFileSync(process.execPath, ['-e', setup], { env, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.js')], { env, stdio: 'pipe', timeout: 120000 });
});

function metaCsp(html) {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    out[name] = values;
  }
  return out;
}

const inlineScripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1])).map((m) => m[2]);
const sha = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

test('site Pages : chaque page HTML porte une balise CSP sans unsafe-inline pour les scripts', () => {
  const pages = fs.readdirSync(DIST).filter((f) => f.endsWith('.html'));
  assert.ok(pages.includes('index.html') && pages.includes('stage.html') && pages.some((f) => /^tour-.*\.html$/.test(f)), `pages attendues : ${pages}`);
  for (const f of pages) {
    const html = fs.readFileSync(path.join(DIST, f), 'utf8');
    const d = metaCsp(html);
    assert.ok(d, `${f} : balise CSP absente`);
    // La balise doit précéder tout script et toute ressource.
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.search(/<script|<link/), `${f} : CSP après un script ou une feuille`);
    assert.ok(d['script-src'] && !d['script-src'].includes("'unsafe-inline'"), `${f} : script-src sans unsafe-inline`);
    assert.deepStrictEqual(d['object-src'], ["'none'"], f);
    assert.ok(!d['frame-ancestors'], `${f} : frame-ancestors est ignoré dans une balise <meta>`);
    for (const body of inlineScripts(html)) assert.ok(d['script-src'].includes(sha(body)), `${f} : script en ligne sans empreinte autorisée`);
  }
});

test('site Pages : les pages de l’application n’ont plus aucun script en ligne', () => {
  const app = fs.readdirSync(DIST).filter((f) => f.endsWith('.html') && !/^tour-/.test(f));
  for (const f of app) {
    const html = fs.readFileSync(path.join(DIST, f), 'utf8');
    assert.deepStrictEqual(inlineScripts(html).map((s) => s.trim()).filter(Boolean), [], `${f} : script en ligne`);
    assert.deepStrictEqual(metaCsp(html)['script-src'], ["'self'"], `${f} : script-src 'self' attendu`);
    if (/common\.js/.test(html)) {
      assert.ok(html.indexOf('src="static.js"') >= 0 && html.indexOf('src="static.js"') < html.indexOf('src="common.js"'), `${f} : static.js avant common.js`);
    }
  }
  assert.match(fs.readFileSync(path.join(DIST, 'static.js'), 'utf8'), /window\.EF_STATIC = true/);
});
