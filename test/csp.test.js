'use strict';
// Story 42.2 (issue #566, phase 1) : politique de sécurité du contenu de
// l'application servie par Express, et aucune page de frontend/ avec un
// script en ligne (qu'une CSP sans 'unsafe-inline' bloquerait).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ETAPEFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-csp-'));
const { app, CSP } = require('../backend/server');

let server;
let base;
before(async () => {
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  require('../backend/db').closeDb();
});

function directives(header) {
  const out = {};
  for (const part of header.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    out[name] = values;
  }
  return out;
}

for (const route of ['/', '/stage.html', '/api/status']) {
  test(`CSP posée sur ${route}`, async () => {
    const res = await fetch(base + route);
    const header = res.headers.get('content-security-policy');
    assert.ok(header, 'en-tête Content-Security-Policy absent');
    assert.strictEqual(header, CSP);
    const d = directives(header);
    assert.deepStrictEqual(d['script-src'], ["'self'"], 'script-src doit se limiter à self');
    assert.deepStrictEqual(d['object-src'], ["'none'"]);
    assert.deepStrictEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepStrictEqual(d['base-uri'], ["'self'"]);
    assert.ok(d['default-src'].includes("'self'"));
    for (const host of ['https://data.geopf.fr', 'https://tile.openstreetmap.org']) {
      assert.ok(d['img-src'].includes(host), `tuiles ${host} autorisées en img-src`);
    }
    for (const [name, values] of Object.entries(d)) {
      if (name !== 'style-src') assert.ok(!values.includes("'unsafe-inline'"), `${name} sans unsafe-inline`);
      assert.ok(!values.includes("'unsafe-eval'"), `${name} sans unsafe-eval`);
    }
    const tt = res.headers.get('content-security-policy-report-only');
    assert.match(tt || '', /require-trusted-types-for 'script'/, 'Trusted Types en Report-Only');
  });
}

test('aucune page de frontend/ ne contient de script en ligne ni de gestionnaire on…=', () => {
  const dir = path.join(__dirname, '..', 'frontend');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc=/, `${f} : script en ligne interdit par la CSP`);
      assert.strictEqual(m[2].trim(), '', `${f} : script avec src et contenu`);
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${f} : gestionnaire d'événement en ligne`);
    assert.doesNotMatch(html, /javascript:/i, `${f} : URL javascript:`);
  }
});
