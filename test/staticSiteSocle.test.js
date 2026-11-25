'use strict';
// Story 41.5 (issue #623) : socle du site statique public. L'éditeur reste
// un outil local (décision 41.2) : ses pages et celles du compte, des traces
// et du diagnostic ne sont pas publiées, et rien n'y renvoie. La construction
// se fait sans réseau : un module chargé avant build-site.js fait échouer
// tout appel (http, https, net, tls, dns, fetch). Construction dans son
// propre processus (CLAUDE.md règle 4).
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-site-socle-'));
const DIST = path.join(dir, 'dist');
const GUARD = path.join(dir, 'garde-reseau.js');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const PRIVATE_PAGES = ['editeur.html', 'traces.html', 'login.html', 'diag.html'];
const PRIVATE_SCRIPTS = ['editor.js', 'traces.js', 'login.js', 'diag.js', 'onboarding.js'];

before(() => {
  const env = { ...process.env, ETAPEFORGE_DATA_DIR: path.join(dir, 'data'), ETAPEFORGE_OFFLINE: '1', ETAPEFORGE_DIST_DIR: DIST };
  const setup = `
    const { importTrackAsStage } = require(${JSON.stringify(path.join(ROOT, 'pipeline/importTrack'))});
    const { getDb } = require(${JSON.stringify(path.join(ROOT, 'backend/db'))});
    (async () => {
      const pts = [];
      for (let i = 0; i <= 60; i++) pts.push({ lat: 45.3 + i * 0.001, lon: 5.7, ele: 300 + i });
      const id = await importTrackAsStage(pts, { name: 'Trace socle' });
      const db = getDb();
      const ed = db.prepare("INSERT INTO editions (name, is_custom) VALUES ('Perso', 1)").run().lastInsertRowid;
      db.prepare('UPDATE stages SET edition_id = ?, stage_order = 1 WHERE id = ?').run(ed, id);
    })().catch((e) => { console.error(e); process.exit(1); });`;
  execFileSync(process.execPath, ['-e', setup], { env, stdio: 'pipe' });
  fs.writeFileSync(GUARD, `
    const deny = (name) => () => { throw new Error('appel réseau interdit pendant la construction : ' + name); };
    for (const m of ['http', 'https']) { const mod = require(m); mod.request = deny(m + '.request'); mod.get = deny(m + '.get'); }
    require('net').connect = deny('net.connect'); require('net').createConnection = deny('net.createConnection');
    require('tls').connect = deny('tls.connect');
    require('dns').lookup = deny('dns.lookup');
    globalThis.fetch = deny('fetch');
  `);
  execFileSync(process.execPath, ['--require', GUARD, path.join(ROOT, 'scripts/build-site.js')], { env, stdio: 'pipe', timeout: 120000 });
});

test('la garde réseau fait bien échouer un appel', () => {
  assert.throws(() => execFileSync(process.execPath, ['--require', GUARD, '-e', "require('https').get('https://example.org')"], { stdio: 'pipe' }));
});

test('npm run build:site lance la construction du site', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['build:site'], 'node scripts/build-site.js');
  assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8'), /run: npm run build:site/);
});

test('l’éditeur, les traces, la connexion et le diagnostic ne sont pas publiés', () => {
  for (const f of [...PRIVATE_PAGES, ...PRIVATE_SCRIPTS]) assert.ok(!fs.existsSync(path.join(DIST, f)), `${f} publié`);
  for (const f of ['index.html', 'stage.html', 'tour.html', 'cols.html', 'compare.html', 'archives.html', 'common.js']) {
    assert.ok(fs.existsSync(path.join(DIST, f)), `${f} manquant`);
  }
});

test('aucune page publiée ne renvoie à une page non publiée', () => {
  const re = new RegExp(`(href|src)="(\\.?/)?(${[...PRIVATE_PAGES, ...PRIVATE_SCRIPTS].join('|').replace(/\./g, '\\.')})`);
  for (const f of fs.readdirSync(DIST).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(DIST, f), 'utf8');
    assert.doesNotMatch(html, re, `${f} renvoie à une page non publiée`);
  }
});

test('navigation : en mode statique, ni éditeur ni traces, l’accueil à la place', () => {
  const EF = require('../frontend/common.js');
  const local = EF.navLinks(false).map((l) => l.nav);
  assert.ok(local.includes('editeur') && local.includes('traces'), 'navigation locale inchangée');
  const pub = EF.navLinks(true);
  assert.deepStrictEqual(pub.filter((l) => ['editeur', 'traces'].includes(l.nav)), []);
  assert.strictEqual(pub[0].nav, 'accueil');
  assert.strictEqual(pub[0].href, '/index.html');
});

test('pied de page public : mention ASO et sources', () => {
  const EF = require('../frontend/common.js');
  const html = EF.footerHtml({ attributions: 'Wikipédia · IGN · OpenStreetMap' }, true);
  assert.match(html, /site indépendant, non affilié à ASO/i);
  assert.match(html, /Wikipédia · IGN · OpenStreetMap/);
  assert.doesNotMatch(html, /diag\.html/);
  assert.match(EF.footerHtml({ attributions: 'x' }, false), /diag\.html/, 'pied local inchangé');
  assert.match(EF.footerHtml({ attributions: '<b>' }, true), /&lt;b&gt;/, 'attributions échappées');
});

test('pages d’édition autonomes publiées : mention ASO et sources dans le pied', () => {
  const pages = fs.readdirSync(DIST).filter((f) => /^tour-.*\.html$/.test(f));
  assert.ok(pages.length > 0);
  for (const f of pages) {
    const footer = fs.readFileSync(path.join(DIST, f), 'utf8').match(/<footer>([\s\S]*?)<\/footer>/);
    assert.ok(footer, `${f} : pied absent`);
    assert.match(footer[1], /non affilié à ASO/, f);
    assert.match(footer[1], /Wikipédia/, f);
  }
});
