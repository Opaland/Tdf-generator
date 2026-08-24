#!/usr/bin/env node
'use strict';
// Monkey testing permanent et reproductible — persona "Fatiha" : cyclosportive
// amatrice pressée, pas développeuse, clique vite sans lire, colle des trucs
// copiés depuis WhatsApp (emoji, liens, texte mélangé), teste sur mobile,
// ferme/navigue en plein chargement, tape n'importe quoi dans les champs.
//
// Générique : interagit avec ce qui est réellement visible sur chaque page
// (pas de sélecteurs codés en dur) — clique des éléments cliquables au
// hasard, remplit les champs visibles avec des chaînes hostiles, redimensionne
// le viewport, navigue en arrière, recharge en plein chargement.
//
// Reproductible par graine : `MONKEY_SEEDS=1,2,3 MONKEY_ACTIONS=40 npm run monkey`
// rejoue exactement les mêmes actions (même choix de page/élément/chaîne à
// chaque étape) — utile pour figer un scénario qui a trouvé un bug avant de
// le corriger, puis vérifier qu'il ne revient pas. Sans MONKEY_SEEDS, une
// graine aléatoire est tirée et affichée pour pouvoir la rejouer ensuite.
//
// Exploratoire, volontairement hors CI (comme le monkey testing de
// Rando-generator, dont ce script reprend l'esprit et la convention de noms
// de variables d'environnement) : une trouvaille ne doit jamais bloquer un
// build sur un flake de timing, elle doit être lue par un humain puis
// éventuellement figée dans un test permanent (voir test/serverFuzz.test.js
// pour deux bugs trouvés ainsi et verrouillés en régression).

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SEEDS = (process.env.MONKEY_SEEDS || String(Date.now() % 1e9))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const ACTIONS_PER_PAGE = parseInt(process.env.MONKEY_ACTIONS || '25', 10);
const BASE_PORT = 0; // port éphémère choisi par l'OS, un serveur par graine

// --- PRNG déterministe (mulberry32) : Math.random() n'est pas reproductible. ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NASTY_STRINGS = [
  '<script>window.__xss=1</script>',
  '<img src=x onerror="window.__xss=2">',
  "'; DROP TABLE stages; --",
  '" OR 1=1 --',
  '💥🚴‍♀️🇫🇷 Étape n°1 — Col d\'Izoard 😭😭😭 !!! whatsapp link https://wa.me/33612345678',
  'a'.repeat(5000),
  '   ',
  ' ',
  'مرحبا بالعالم שלום עולם',
  '-99999999999999',
  'NaN',
  '../../etc/passwd',
  '{{7*7}}',
  '${7*7}',
  '\n\n\n\t\t\ttab city\n',
  '0',
  '-0.0000001',
  '99999999999999999999999999',
  'javascript:alert(1)',
  'null',
  'undefined',
];

const PAGES = [
  { path: '/', name: 'editeur' },
  { path: '/tour.html', name: 'tour' },
  { path: '/cols.html', name: 'cols' },
  { path: '/compare.html', name: 'compare' },
  { path: '/traces.html', name: 'traces' },
  { path: '/archives.html', name: 'archives' },
  { path: '/diag.html', name: 'diag' },
  { path: '/login.html', name: 'login' },
];

function seedDemoData(dataDir) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'demo.js')], {
    env: { ...process.env, ETAPEFORGE_DATA_DIR: dataDir, ETAPEFORGE_OFFLINE: '1' },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error('échec de la préparation des données de démo (scripts/demo.js)');
}

async function monkeyOnPage(context, base, pageDef, actionsCount, rand) {
  const page = await context.newPage();
  const findings = [];
  const seenErrors = new Set();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!seenErrors.has(text)) {
        seenErrors.add(text);
        findings.push({ kind: 'console.error', page: pageDef.name, detail: text.slice(0, 300) });
      }
    }
  });
  page.on('pageerror', (err) => {
    findings.push({ kind: 'pageerror (exception non capturée)', page: pageDef.name, detail: String(err).slice(0, 300) });
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      findings.push({ kind: `HTTP ${res.status()}`, page: pageDef.name, detail: res.url() });
    }
  });

  try {
    await page.goto(`${base}${pageDef.path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch (err) {
    findings.push({ kind: 'goto failed', page: pageDef.name, detail: String(err.message).slice(0, 300) });
    await page.close();
    return findings;
  }

  if (rand() < 0.4) await page.setViewportSize({ width: 375, height: 667 });

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let i = 0; i < actionsCount; i++) {
    const action = pick(['fill', 'click', 'reload-mid', 'back', 'resize', 'keyboard']);
    try {
      if (action === 'fill') {
        const inputs = await page.locator('input:visible, textarea:visible').all();
        if (inputs.length) {
          const el = pick(inputs);
          const type = await el.getAttribute('type');
          if (type === 'file' || type === 'checkbox' || type === 'radio') continue;
          await el.fill(pick(NASTY_STRINGS), { timeout: 2000 }).catch(() => {});
        }
      } else if (action === 'click') {
        const clickables = await page.locator('button:visible, a:visible, [role="button"]:visible, input[type=submit]:visible, .tab:visible, label.field:visible').all();
        if (clickables.length) {
          await pick(clickables).click({ timeout: 2000, force: true }).catch(() => {});
        }
      } else if (action === 'reload-mid') {
        page.reload({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(150);
      } else if (action === 'back') {
        await page.goBack({ waitUntil: 'commit', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(150);
        if (page.url() === 'about:blank') await page.goto(`${base}${pageDef.path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      } else if (action === 'resize') {
        const [w, h] = pick([[375, 667], [768, 1024], [1440, 900], [320, 480]]);
        await page.setViewportSize({ width: w, height: h });
      } else if (action === 'keyboard') {
        await page.keyboard.press(pick(['Enter', 'Escape', 'Tab', 'Backspace'])).catch(() => {});
      }
    } catch (err) {
      findings.push({ kind: 'action-exception', page: pageDef.name, detail: `${action}: ${String(err.message).slice(0, 200)}` });
    }
    await page.waitForTimeout(50);
  }

  // eslint-disable-next-line no-undef -- `window` s'exécute dans la page, pas dans Node.
  const xssTriggered = await page.evaluate(() => window.__xss).catch(() => undefined);
  if (xssTriggered) findings.push({ kind: 'XSS DÉCLENCHÉ', page: pageDef.name, detail: `window.__xss = ${xssTriggered}` });

  // Débordement horizontal mobile (issue #16/#17, trouvé une première fois
  // "à la main" avec Playwright hors CI, jamais reproduit automatiquement
  // depuis — cf. #85 : rien ne le verrouille contre une régression). Vérifié
  // à un viewport mobile fixe (375×812) systématiquement, pas seulement
  // quand le tirage aléatoire de `action === 'resize'` y passe par hasard.
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(150);
    /* eslint-disable no-undef -- `document`/`window` s'exécutent dans la page, pas dans Node. */
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    /* eslint-enable no-undef */
    if (overflow.scrollWidth > overflow.innerWidth + 2) {
      findings.push({
        kind: 'DÉBORDEMENT MOBILE',
        page: pageDef.name,
        detail: `scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth} à 375px`,
      });
    }
  } catch (err) {
    // Une navigation encore en vol (reload/back juste avant) détruit le
    // contexte JS pendant l'evaluate() — même risque, même traitement que
    // xssTriggered ci-dessus (.catch(() => undefined)) : ce n'est pas un
    // bug de l'app, pas la peine de le remonter comme une trouvaille.
    if (!/execution context was destroyed|target (page|closed)/i.test(err.message || '')) {
      findings.push({ kind: 'action-exception', page: pageDef.name, detail: `check mobile: ${String(err.message).slice(0, 200)}` });
    }
  }

  // Visite guidée (Sprint 8, #btn-tour uniquement sur l'accueil) : vérifiée
  // de façon déterministe plutôt que laissée au seul clic aléatoire — trouvaille
  // de revue-personas (persona testeur QA) : les actions aléatoires ci-dessus
  // peuvent ouvrir #btn-tour sans jamais le refermer proprement dans la même
  // session, donc rien ne garantissait qu'un run de monkey exerce vraiment
  // go()/render() (bouton Précédent désactivé au 1er pas, libellé "Terminer"
  // au dernier, fermeture Escape) plutôt que juste l'ouverture.
  try {
    const tourBtn = await page.$('#btn-tour');
    if (tourBtn) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await tourBtn.click();
      await page.waitForSelector('.tour-overlay', { timeout: 2000 });
      const prevDisabledAtStart = await page.$eval('#tour-prev', (b) => b.disabled);
      if (!prevDisabledAtStart) {
        findings.push({ kind: 'VISITE GUIDÉE', page: pageDef.name, detail: 'bouton Précédent pas désactivé à la première étape' });
      }
      // Clique "Suivant" jusqu'à "Terminer" plutôt que de lire
      // EF.TOUR_STEPS.length depuis la page : `const EF = ...` en haut de
      // common.js est une liaison lexicale, pas une propriété de `window`
      // (contrairement à `var`) — `window.EF` y est `undefined`, trouvaille
      // en exécutant ce script pour de vrai (TypeError reproduit avant ce
      // correctif).
      let lastLabel = '';
      for (let i = 0; i < 10; i++) {
        lastLabel = await page.textContent('#tour-next');
        if (lastLabel.includes('Terminer')) break;
        await page.click('#tour-next');
      }
      if (!lastLabel.includes('Terminer')) {
        findings.push({ kind: 'VISITE GUIDÉE', page: pageDef.name, detail: `bouton "Terminer" jamais atteint après 10 clics "Suivant" (dernier libellé : "${lastLabel}")` });
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('.tour-overlay', { state: 'detached', timeout: 2000 });
    }
  } catch (err) {
    if (!/execution context was destroyed|target (page|closed)/i.test(err.message || '')) {
      findings.push({ kind: 'action-exception', page: pageDef.name, detail: `check visite guidée: ${String(err.message).slice(0, 200)}` });
    }
  }

  await page.close();
  return findings;
}

async function runSeed(seed) {
  const { chromium } = require('playwright');
  const rand = mulberry32(seed);
  const dataDir = path.join(os.tmpdir(), `etapeforge-monkey-${seed}-${process.pid}`);
  seedDemoData(dataDir);

  process.env.ETAPEFORGE_DATA_DIR = dataDir;
  process.env.ETAPEFORGE_OFFLINE = '1';
  const { app } = require('../backend/server');
  const appServer = await new Promise((resolve) => {
    const s = app.listen(BASE_PORT, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${appServer.address().port}`;

  const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {};
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext();

  console.log(`\n=== graine ${seed} (${ACTIONS_PER_PAGE} actions/page, ${PAGES.length} pages) ===`);
  const allFindings = [];
  for (const pageDef of PAGES) {
    const findings = await monkeyOnPage(context, base, pageDef, ACTIONS_PER_PAGE, rand);
    for (const f of findings) console.log(`  [${pageDef.name}] [${f.kind}] ${f.detail}`);
    allFindings.push(...findings);
  }

  await browser.close();
  appServer.close();

  if (!allFindings.length) console.log(`  (rien à signaler pour la graine ${seed})`);
  return allFindings;
}

/**
 * Une graine = un processus enfant isolé. Nécessaire (pas juste prudent) :
 * backend/db.js met en cache sa connexion SQLite dans une variable de module
 * lue depuis ETAPEFORGE_DATA_DIR au premier require ; enchaîner plusieurs
 * graines dans le même process Node ferait écrire la 2e graine dans la base
 * de la 1re dès qu'un module intermédiaire (pipeline/generate.js etc.) garde
 * une référence à l'ancien module backend/db en cache.
 */
function runSeedInChildProcess(seed) {
  const res = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, MONKEY_SEEDS: String(seed) },
    stdio: 'inherit',
  });
  return res.status === 0;
}

async function main() {
  console.log(`Graine(s) : ${SEEDS.join(', ')} — ${ACTIONS_PER_PAGE} actions/page — persona Fatiha`);
  if (SEEDS.length === 1) {
    const findings = await runSeed(SEEDS[0]);
    if (findings.length) {
      console.log(`\n═══ Bilan : ${findings.length} observation(s) (graine ${SEEDS[0]}) ═══`);
      console.log(`Rejouer : MONKEY_SEEDS=${SEEDS[0]} npm run monkey`);
      process.exit(1);
    }
    console.log(`\n═══ Bilan : 0 observation (graine ${SEEDS[0]}) ═══`);
    return;
  }

  let failed = 0;
  for (const seed of SEEDS) {
    if (!runSeedInChildProcess(seed)) failed++;
  }
  console.log(`\n═══ Bilan global : ${failed}/${SEEDS.length} graine(s) avec observation(s) [${SEEDS.join(', ')}] ═══`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('ÉCHEC monkey.js :', err);
  process.exit(1);
});
