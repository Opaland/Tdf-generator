'use strict';
// Sprint 8 : visite guidée sur l'accueil (présentation à ~1 semaine). Les
// données (EF.TOUR_STEPS) sont la partie vérifiable sans navigateur — le
// rendu DOM lui-même (frontend/onboarding.js) est exercé au clic aléatoire
// par le monkey testing existant (scripts/monkey.js clique tout élément
// cliquable visible, dont #btn-tour), pas dupliqué ici en CI sans navigateur
// (contrainte notée dans test/noNativeDialogs.test.js).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const src = fs.readFileSync(path.join(FRONTEND_DIR, 'onboarding.js'), 'utf8');

// EF.TOUR_STEPS est un littéral de tableau simple : on l'extrait en évaluant
// le fichier dans un bac à sable minimal plutôt qu'en dupliquant les données
// à la main ici (qui dériveraient silencieusement du vrai fichier).
function loadTourSteps() {
  const sandbox = { EF: {}, document: { addEventListener() {} } };
  const run = new Function('EF', 'document', src + '\nreturn EF;');
  const ef = run(sandbox.EF, sandbox.document);
  return ef.TOUR_STEPS;
}

test('EF.TOUR_STEPS existe et couvre les 4 fonctionnalités clés attendues', () => {
  const steps = loadTourSteps();
  assert.strictEqual(steps.length, 4);
});

test('chaque étape a un titre, un texte non vide et un bouton d\'action explicite', () => {
  const steps = loadTourSteps();
  for (const s of steps) {
    assert.ok(s.title && s.title.trim(), `étape sans titre : ${JSON.stringify(s)}`);
    assert.ok(s.body && s.body.trim().length > 10, `étape "${s.title}" sans description utile`);
    assert.ok(s.cta && s.cta.trim(), `étape "${s.title}" sans texte de bouton`);
  }
});

test('chaque lien de la visite guidée pointe vers une page réelle du frontend', () => {
  const steps = loadTourSteps();
  for (const s of steps) {
    const file = s.href.replace(/^\//, '');
    assert.ok(
      fs.existsSync(path.join(FRONTEND_DIR, file)),
      `${s.title} pointe vers ${s.href}, qui n'existe pas dans frontend/`
    );
  }
});

test('les 4 fonctionnalités mises en avant par le backlog sont bien représentées', () => {
  const steps = loadTourSteps();
  const hrefs = steps.map((s) => s.href);
  assert.deepStrictEqual(
    hrefs.slice().sort(),
    ['/archives.html', '/cols.html', '/compare.html', '/traces.html'].sort()
  );
});

test('index.html référence bien onboarding.js et un bouton #btn-tour', () => {
  const html = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/onboarding\.js"><\/script>/);
  assert.match(html, /id="btn-tour"/);
});
