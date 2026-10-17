#!/usr/bin/env node
'use strict';
// Test de bout en bout minimal dans un vrai navigateur (Epic 27.3, piste 3 de
// docs/TESTING.md) : démarre le serveur sur la base de la démo hors-ligne
// (`npm run demo` d'abord), ouvre chaque écran en desktop (1440 px) et en
// mobile (375 px), et échoue si :
//   - une erreur JavaScript ou une erreur console de la page elle-même ;
//   - une requête vers le serveur local échoue (404/500 compris) ;
//   - un débordement horizontal (scrollWidth > largeur de la fenêtre).
// Les requêtes externes (tuiles IGN/OSM, CDN) sont coupées : le test reste
// déterministe, sans réseau, comme le reste de la porte bloquante.
//
// Usage : npm run demo && npm run e2e

const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = Number(process.env.E2E_PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 375, height: 800 }];

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`serveur injoignable sur ${BASE}`);
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'backend', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ETAPEFORGE_OFFLINE: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const failures = [];
  let browser;
  try {
    await waitForServer();
    const stages = await (await fetch(`${BASE}/api/stages`)).json();
    const editions = await (await fetch(`${BASE}/api/editions`)).json();
    const done = stages.find((s) => s.state === 'done');
    if (!done || !editions.length) throw new Error('base vide : lancer `npm run demo` avant `npm run e2e`');
    const pages = [
      '/index.html', '/archives.html', '/cols.html', '/compare.html', '/diag.html', '/traces.html',
      `/stage.html?id=${done.id}`, `/tour.html?id=${editions[0].id}`,
    ];

    // E2E_CHROMIUM : navigateur déjà installé dont la version ne correspond pas
    // au paquet playwright du dépôt (ex. bac à sable cloud, /opt/pw-browsers/chromium) ;
    // en CI, `npx playwright install chromium` installe la bonne version.
    browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
    for (const vp of VIEWPORTS) {
      for (const url of pages) {
        const ctx = await browser.newContext({ viewport: vp });
        const page = await ctx.newPage();
        const errs = [];
        await page.route('**/*', (route) => {
          const u = route.request().url();
          return u.startsWith(BASE) || u.startsWith('data:') ? route.continue() : route.abort();
        });
        page.on('pageerror', (e) => errs.push(`JS : ${e.message}`));
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const src = m.location()?.url || '';
          // Une requête externe coupée volontairement ci-dessus produit une
          // erreur console attribuée à son URL externe : seule la page locale compte.
          if (src && !src.startsWith(BASE)) return;
          if (/Failed to load resource/.test(m.text()) && !src) return;
          errs.push(`console : ${m.text()}`);
        });
        page.on('response', (r) => {
          if (r.url().startsWith(BASE) && r.status() >= 400) errs.push(`HTTP ${r.status()} : ${r.url().slice(BASE.length)}`);
        });
        await page.goto(BASE + url, { waitUntil: 'load' });
        await page.waitForTimeout(800); // rendu asynchrone (fetch /api puis DOM)
        // eslint-disable-next-line no-undef -- exécuté dans le navigateur (page.evaluate)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) errs.push(`débordement horizontal de ${overflow} px`);
        const label = `${vp.width}px ${url}`;
        if (errs.length) failures.push(`${label}\n    ${errs.join('\n    ')}`);
        else console.log(`✔ ${label}`);
        await ctx.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  if (failures.length) {
    console.error(`\n✗ ${failures.length} écran(s) en échec :\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nE2E : tous les écrans chargent sans erreur ni débordement.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
