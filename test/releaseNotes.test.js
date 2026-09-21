'use strict';
// Bandeau « Quoi de neuf » (backlog #234) : EF.compareVersions()/
// EF.checkReleaseNotes() (frontend/common.js). DOM minimal simulé (mêmes
// principes que test/sortableHeaders.test.js) plutôt qu'un vrai navigateur —
// le fake <div> reconnaît juste le bouton de fermeture qu'on sait générer,
// pas un parseur HTML général.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const EF = require('../frontend/common.js');

test('compareVersions : comparaison numérique, jamais lexicographique ("1.10.0" > "1.9.0")', () => {
  assert.ok(EF.compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(EF.compareVersions('1.9.0', '1.10.0') < 0);
  assert.strictEqual(EF.compareVersions('1.2.0', '1.2.0'), 0);
  assert.strictEqual(EF.compareVersions('1.2', '1.2.0'), 0, 'segment manquant traité comme 0');
  assert.ok(EF.compareVersions('2.0.0', '1.9.9') > 0);
});

function fakeLocalStorage(initial) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    store,
  };
}

function fakeDocument() {
  return {
    created: [],
    createElement(tag) {
      const closeBtn = { addEventListener(type, fn) { closeBtn.onClick = fn; } };
      const el = {
        tag, className: '', innerHTML: '', removed: false,
        querySelector: (sel) => (sel === '.whats-new-close' ? closeBtn : null),
        remove() { el.removed = true; },
      };
      this.created.push(el);
      return el;
    },
  };
}

function fakeHeader() {
  return { afterCalls: [], after(el) { this.afterCalls.push(el); } };
}

const NOTES = [
  { version: '1.1.0', date: '2026-09-18', title: 'Bilan personnel', items: ['Nouveau tableau de bord.', 'Installable sur téléphone.'] },
];

let header;

beforeEach(() => {
  header = fakeHeader();
  global.document = fakeDocument();
  global.window = { EF_STATIC: false };
});

test('checkReleaseNotes : première visite (aucune version stockée) → pose le jalon, aucun bandeau', async () => {
  const ls = fakeLocalStorage();
  global.localStorage = ls;
  global.fetch = async () => { throw new Error('ne devait pas être appelé : rien à comparer sans jalon'); };
  await EF.checkReleaseNotes(header, '1.1.0');
  assert.strictEqual(ls.store['ef-last-seen-version'], '1.1.0');
  assert.strictEqual(header.afterCalls.length, 0);
});

test('checkReleaseNotes : version déjà vue == version courante → aucun bandeau', async () => {
  global.localStorage = fakeLocalStorage({ 'ef-last-seen-version': '1.1.0' });
  global.fetch = async () => ({ json: async () => NOTES });
  await EF.checkReleaseNotes(header, '1.1.0');
  assert.strictEqual(header.afterCalls.length, 0);
});

test('checkReleaseNotes : nouvelle version → bandeau affiché avec les notes non vues, texte échappé', async () => {
  global.localStorage = fakeLocalStorage({ 'ef-last-seen-version': '1.0.0' });
  const xssNotes = [{ version: '1.1.0', title: '<img src=x onerror=alert(1)>', items: ['<script>alert(2)</script>'] }];
  global.fetch = async () => ({ json: async () => xssNotes });
  await EF.checkReleaseNotes(header, '1.1.0');
  assert.strictEqual(header.afterCalls.length, 1);
  const box = header.afterCalls[0];
  assert.ok(box.innerHTML.includes('&lt;script&gt;'), 'le contenu des notes doit être échappé');
  assert.ok(!box.innerHTML.includes('<script>alert'));
});

test('checkReleaseNotes : fermeture du bandeau avance le jalon et retire le bandeau du DOM', async () => {
  const ls = fakeLocalStorage({ 'ef-last-seen-version': '1.0.0' });
  global.localStorage = ls;
  global.fetch = async () => ({ json: async () => NOTES });
  await EF.checkReleaseNotes(header, '1.1.0');
  const box = header.afterCalls[0];
  const closeBtn = box.querySelector('.whats-new-close');
  closeBtn.onClick();
  assert.strictEqual(ls.store['ef-last-seen-version'], '1.1.0');
  assert.strictEqual(box.removed, true);
});

test('checkReleaseNotes : mode démo statique (EF_STATIC) → jamais de bandeau, jamais de requête réseau', async () => {
  global.window = { EF_STATIC: true };
  global.localStorage = fakeLocalStorage({ 'ef-last-seen-version': '1.0.0' });
  global.fetch = async () => { throw new Error('ne devait pas être appelé en mode EF_STATIC'); };
  await EF.checkReleaseNotes(header, '1.1.0');
  assert.strictEqual(header.afterCalls.length, 0);
});

test('checkReleaseNotes : pas de version courante fournie (API en panne) → dégradation silencieuse, pas de plantage', async () => {
  global.localStorage = fakeLocalStorage({ 'ef-last-seen-version': '1.0.0' });
  global.fetch = async () => { throw new Error('ne devait pas être appelé sans version courante'); };
  await EF.checkReleaseNotes(header, undefined);
  assert.strictEqual(header.afterCalls.length, 0);
});

// Trouvaille de relecture adverse (18/09/2026) : checkReleaseNotes() est
// appelée SANS await depuis initChrome() (fire-and-forget). Une exception
// SYNCHRONE avant le premier await (ex. Safari navigation privée, storage
// désactivé) n'était rattrapée ni par l'appelant (qui n'attend pas cette
// promesse) ni par le catch interne, placé après cette exception — rejet de
// promesse non géré sur CHAQUE page. La promesse renvoyée ne doit JAMAIS
// rejeter, quelle que soit l'étape qui échoue.
test('checkReleaseNotes : localStorage.getItem() lève une exception synchrone (storage désactivé) → ne rejette jamais', async () => {
  global.localStorage = {
    getItem() { throw new DOMException('storage désactivé', 'SecurityError'); },
    setItem() {},
  };
  global.fetch = async () => { throw new Error('ne devait pas être appelé'); };
  await assert.doesNotReject(EF.checkReleaseNotes(header, '1.1.0'));
  assert.strictEqual(header.afterCalls.length, 0);
});

// Trouvaille de relecture adverse : le bandeau affichait les entrées dans
// l'ordre brut de release-notes.json, jamais trié par version — un
// développeur qui ajoute une future entrée en bas du fichier plutôt qu'en
// haut l'aurait affichée après une version plus ancienne.
test('checkReleaseNotes : plusieurs versions non vues → affichées triées (la plus récente en premier), pas dans l\'ordre du fichier', async () => {
  global.localStorage = fakeLocalStorage({ 'ef-last-seen-version': '1.0.0' });
  const outOfOrder = [
    { version: '1.1.0', title: 'Premiere' },
    { version: '1.2.0', title: 'Deuxieme' }, // volontairement APRÈS 1.1.0 dans le fichier
  ];
  global.fetch = async () => ({ json: async () => outOfOrder });
  await EF.checkReleaseNotes(header, '1.2.0');
  const html = header.afterCalls[0].innerHTML;
  assert.ok(html.indexOf('v1.2.0') < html.indexOf('v1.1.0'), `1.2.0 doit apparaître avant 1.1.0 : ${html}`);
});
