'use strict';
// Revue globale de fin de session (code-review, refacto) : le paramètre
// `next` de l'écran de connexion (frontend/login.js) était utilisé sans
// validation comme cible de `location.href` après connexion/inscription
// réussie — un lien `login.html?next=https://evil.example` fabriqué à la
// main (phishing) redirigeait la victime hors du site une fois
// authentifiée pour de vrai. EF.requireAuthOrRedirect() (common.js) ne
// génère jamais que des chemins relatifs same-origin, mais rien ne
// garantissait qu'un `next` reçu de l'URL le reste. Exécute le vrai code de
// login.js dans un bac à sable minimal (même motif que
// test/apiTimeout.test.js pour common.js) — login.js exécute son
// initialisation DOM au chargement du script, donc un `document` factice
// suffisant pour ne pas planter est nécessaire avant de pouvoir récupérer
// `safeNext`.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'login.js'), 'utf8');

function fakeEl() {
  return {
    classList: { toggle() {} },
    addEventListener() {},
    textContent: '',
    autocomplete: '',
    value: '',
  };
}

function loadSafeNext() {
  const doc = { getElementById: () => fakeEl() };
  const loc = { origin: 'https://etapeforge.example' };
  const run = new Function('document', 'location', src + '\nreturn safeNext;');
  return run(doc, loc);
}

const safeNext = loadSafeNext();

test('safeNext() : chemin relatif same-origin inchangé', () => {
  assert.strictEqual(safeNext('/stage.html?id=3'), '/stage.html?id=3');
  assert.strictEqual(safeNext('/'), '/');
});

test('safeNext() : absent -> "/"', () => {
  assert.strictEqual(safeNext(null), '/');
  assert.strictEqual(safeNext(undefined), '/');
  assert.strictEqual(safeNext(''), '/');
});

test('safeNext() : URL absolue vers un autre domaine -> "/" (pas de redirection ouverte)', () => {
  assert.strictEqual(safeNext('https://evil.example/phish'), '/');
  assert.strictEqual(safeNext('http://evil.example'), '/');
});

test('safeNext() : URL protocol-relative "//host" -> "/" (le navigateur la traiterait comme un autre domaine)', () => {
  assert.strictEqual(safeNext('//evil.example/phish'), '/');
});

test('safeNext() : évasion par antislash "/\\\\host" -> "/" (certains navigateurs la traitent comme protocol-relative)', () => {
  assert.strictEqual(safeNext('/\\evil.example'), '/');
});

test('safeNext() : schéma non-http (javascript:, data:) -> "/"', () => {
  assert.strictEqual(safeNext('javascript:alert(1)'), '/');
  assert.strictEqual(safeNext('data:text/html,x'), '/');
});

// Trouvaille de relecture adverse sur la première version de ce correctif
// (regex `/^\/(?!\/|\\)/`, jamais mergée) : une tabulation/CR/LF n'importe
// où dans `next` passait la regex (le caractère juste après le premier `/`
// n'est ni `/` ni `\`) mais le parseur d'URL du navigateur les supprime
// AVANT de parser — `/\t/evil.example` redevient donc `//evil.example`
// (protocol-relatif) une fois assigné à `location.href`. Vérifié en
// navigateur réel (Chromium/Playwright) : une vraie requête HTTP part vers
// l'hôte évadé. `new URL()` utilise ce même algorithme de normalisation,
// donc ce vecteur (et toute variante future du même type) est fermé par
// construction, pas par une règle ajoutée au cas par cas.
test('safeNext() : tabulation/CR/LF au début du chemin -> "/" (contournement d\'une regex naïve, pas de new URL())', () => {
  assert.strictEqual(safeNext('/\t/evil.example'), '/');
  assert.strictEqual(safeNext('/\n/evil.example'), '/');
  assert.strictEqual(safeNext('/\r/evil.example'), '/');
});

test('safeNext() : requête/fragment d\'un chemin same-origin préservés', () => {
  assert.strictEqual(safeNext('/stage.html?id=3#profil'), '/stage.html?id=3#profil');
});

test('safeNext() : sous-domaine piège ("etapeforge.example" en préfixe d\'un autre domaine) -> "/"', () => {
  // Le host réel est evil.com — "etapeforge.example" n'en est qu'un
  // sous-domaine, l'origine ne correspond donc pas à location.origin.
  assert.strictEqual(safeNext('https://etapeforge.example.evil.com/'), '/');
});

test('safeNext() : userinfo dans l\'URL ("evil.com@" en préfixe) n\'est pas le host réel -> accepté si l\'hôte après @ est bien le site', () => {
  // "evil.com" ici est un nom d'utilisateur (syntaxe userinfo), pas un host
  // — le host réel après @ est bien etapeforge.example, donc same-origin :
  // sans risque de redirection ouverte, à ne pas rejeter à tort.
  assert.strictEqual(safeNext('https://evil.com@etapeforge.example/dashboard'), '/dashboard');
});
