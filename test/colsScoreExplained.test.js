'use strict';
// Trouvaille de revue-personas (persona cycliste amateur) : la colonne
// "Score" de frontend/cols.html n'était expliquée nulle part à l'écran — ni
// title, ni légende, ni note de bas de tableau. La formule (longueur_km ×
// pente_moy_%) est documentée dans le README mais ne remontait jamais
// jusqu'à l'écran qui l'affiche, contrairement au reste de l'appli qui
// explique systématiquement ses heuristiques en ligne (ex. indice
// d'irrégularité, indice de pénibilité sur la fiche étape).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'cols.html'), 'utf8');

test('en-tête "Score" porte un title expliquant la formule', () => {
  const m = html.match(/<th\s+data-k="score"[^>]*>/);
  assert.ok(m, 'le <th data-k="score"> doit exister');
  assert.match(m[0], /title="[^"]*longueur[^"]*pente[^"]*"/i, 'title manquant ou n\'explique pas la formule (longueur × pente)');
});

test('une note sous le tableau explique aussi la formule (pas seulement au survol)', () => {
  assert.match(html, /Score = longueur.*pente moyenne/is, 'note explicative absente — un utilisateur tactile/clavier ne voit jamais le title');
});
