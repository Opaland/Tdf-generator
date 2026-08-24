'use strict';
// Config permissive (eslint:recommended) — pas de règles de style, juste les
// erreurs réelles (variable non définie, import mort, etc.). Voir backlog
// issue #10, section F.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'data/**', '.stryker-tmp/**', 'reports/**'] },
  js.configs.recommended,
  {
    files: ['eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['backend/**/*.js', 'pipeline/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Frontend générique : navigateur + globals partagés déclarés ailleurs
    // (common.js déclare EF, profile.js déclare EFProfile — ni l'un ni
    // l'autre ne doit se voir imposer sa propre déclaration comme un global
    // externe, sinon no-redeclare se déclenche sur le fichier qui la crée).
    files: ['frontend/**/*.js'],
    ignores: ['frontend/common.js', 'frontend/profile.js', 'frontend/compare.js', 'frontend/editor.js', 'frontend/stage.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, EF: 'readonly', EFProfile: 'readonly', L: 'readonly' },
    },
  },
  {
    files: ['frontend/common.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, L: 'readonly' } },
  },
  {
    // profile.js est un module UMD volontaire (voir la fin du fichier) :
    // servi tel quel au navigateur ET require()-able côté serveur
    // (backend/exports.js) pour partager la même décimation de profil.
    files: ['frontend/profile.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // compare.js : servi tel quel au navigateur ET require()-able côté test
    // (overlaySVG est une fonction pure, testée directement — voir
    // test/compare.test.js) grâce à la garde `typeof document`/`typeof
    // module` — backlog issue #14, "align start" du comparateur.
    files: ['frontend/compare.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node, EF: 'readonly', EFProfile: 'readonly' },
    },
  },
  {
    // editor.js : servi tel quel au navigateur ET require()-able côté test
    // (challengeIndexForDate est une fonction pure, testée directement —
    // voir test/editor.test.js) grâce à la garde `typeof document`/`typeof
    // module`, même schéma que compare.js — backlog #10, "défi du jour".
    files: ['frontend/editor.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node, EF: 'readonly', L: 'readonly' },
    },
  },
  {
    // stage.js : servi tel quel au navigateur ET require()-able côté test
    // (similarItemHtml est une fonction pure, testée directement — voir
    // test/similarStages.test.js) grâce à la garde `typeof document`/`typeof
    // module`, même schéma que compare.js/editor.js — backlog #10, "étapes
    // similaires".
    files: ['frontend/stage.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.node, EF: 'readonly', EFProfile: 'readonly', L: 'readonly' },
    },
  },
];
