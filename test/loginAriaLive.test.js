'use strict';
// Trouvaille de sprint dédié : #auth-msg (frontend/login.html), dont
// login.js remplace tout le textContent à chaque tentative de connexion
// ("Connexion…", erreur du serveur, ou vidé au changement d'onglet), n'était
// jamais annoncé aux lecteurs d'écran — aucun mécanisme aria-live nulle part
// dans le frontend (vérifié : `grep -rn aria-live frontend/` ne trouve rien
// d'autre non plus, ce n'est donc pas "le seul écran oublié" d'un motif
// existant ailleurs, mais un premier pas). login.html/login.js ont été
// ajoutés dans une PR distincte (#12) de l'audit a11y qui a produit les
// issues #16-23, donc jamais couvert par cet audit.
//
// role="status" plutôt qu'un aria-live brut : implique aria-live="polite"
// (pas d'interruption pour une simple mise à jour de statut) ET
// aria-atomic="true" (réannonce le message complet à chaque changement,
// pas seulement la différence — nécessaire ici puisque textContent est
// entièrement remplacé, jamais complété).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'login.html'), 'utf8');

test('#auth-msg porte role="status" pour que login.js annonce ses messages aux lecteurs d\'écran', () => {
  const m = html.match(/<p\s+id="auth-msg"[^>]*>/);
  assert.ok(m, '#auth-msg doit exister dans login.html');
  assert.match(m[0], /role="status"/, 'role="status" manquant — les messages de connexion/inscription ne seraient jamais annoncés');
});
