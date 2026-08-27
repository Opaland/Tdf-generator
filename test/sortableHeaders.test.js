'use strict';
// EF.sortableHeaders() (frontend/common.js) — trouvaille de revue-personas
// (27/08/2026, persona développeur accessibilité) : les <th> triables de
// frontend/cols.js et frontend/tourmap.js n'avaient ni tabindex/role, ni
// aria-sort — un simple addEventListener('click', ...) direct sur chaque
// <th>, invisible et inatteignable au clavier (grep "aria-sort" sur tout
// le dépôt : 0 résultat avant ce correctif). Ce helper partagé remplace les
// deux implémentations dupliquées et câble clic + clavier (Entrée/Espace)
// + aria-sort tenu à jour.
//
// Testé ici avec un DOM minimal simulé (mêmes principes que
// test/archivesPoll.test.js pour la logique frontend) plutôt qu'un vrai
// navigateur : npm test (CI incluse) n'installe aucun binaire Playwright —
// seul scripts/monkey.js (exploratoire, hors npm test) en a besoin.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const EF = require('../frontend/common.js');

function fakeTh(k) {
  const listeners = {};
  return {
    dataset: { k },
    tabIndex: undefined,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, evt = {}) { (listeners[type] || []).forEach((fn) => fn(evt)); },
  };
}

let ths;
let calls;

beforeEach(() => {
  ths = [fakeTh('name'), fakeTh('summit_ele_m')];
  global.document = { querySelectorAll: (sel) => (sel === '#t th' ? ths : []) };
  calls = [];
});

test('sortableHeaders() : pose tabindex=0 et role=button sur chaque <th>', () => {
  EF.sortableHeaders('#t th', () => ({ k: 'name', asc: true }), (prev, k) => ({ k, asc: true }), () => {});
  for (const th of ths) {
    assert.strictEqual(th.tabIndex, 0);
    assert.strictEqual(th.attrs.role, 'button');
  }
});

test('sortableHeaders() : aria-sort posé sur la colonne active, absent des autres, dès l\'initialisation', () => {
  EF.sortableHeaders('#t th', () => ({ k: 'summit_ele_m', asc: false }), (prev, k) => ({ k, asc: true }), () => {});
  assert.strictEqual(ths[0].attrs['aria-sort'], undefined);
  assert.strictEqual(ths[1].attrs['aria-sort'], 'descending');
});

test('sortableHeaders() : clic sur un <th> appelle nextSort() puis onChange(), et met à jour aria-sort', () => {
  let sort = { k: 'name', asc: true };
  EF.sortableHeaders(
    '#t th',
    () => sort,
    (prev, k) => (prev.k === k ? { k, asc: !prev.asc } : { k, asc: true }),
    (next) => { sort = next; calls.push(next); }
  );
  ths[1].fire('click');
  assert.deepStrictEqual(calls, [{ k: 'summit_ele_m', asc: true }]);
  assert.strictEqual(ths[1].attrs['aria-sort'], 'ascending');
  assert.strictEqual(ths[0].attrs['aria-sort'], undefined);
});

test('sortableHeaders() : Entrée et Espace au clavier déclenchent le tri comme un clic', () => {
  let sort = { k: 'name', asc: true };
  EF.sortableHeaders('#t th', () => sort, (prev, k) => ({ k, asc: true }), (next) => { sort = next; calls.push(next); });

  const preventedEnter = { key: 'Enter', prevented: false, preventDefault() { this.prevented = true; } };
  ths[1].fire('keydown', preventedEnter);
  assert.strictEqual(calls.length, 1);
  assert.ok(preventedEnter.prevented, 'Entrée sur un <th> ne doit pas déclencher le comportement par défaut du navigateur');

  const preventedSpace = { key: ' ', prevented: false, preventDefault() { this.prevented = true; } };
  ths[0].fire('keydown', preventedSpace);
  assert.strictEqual(calls.length, 2);
});

test('sortableHeaders() : une autre touche (ex. Tab) ne déclenche rien', () => {
  EF.sortableHeaders('#t th', () => ({ k: 'name', asc: true }), (prev, k) => ({ k, asc: true }), () => calls.push('called'));
  ths[0].fire('keydown', { key: 'Tab', preventDefault() {} });
  assert.strictEqual(calls.length, 0);
});

test('sortableHeaders() : re-cliquer la même colonne inverse le sens (via nextSort fourni par l\'appelant)', () => {
  let sort = { k: 'summit_ele_m', asc: false };
  EF.sortableHeaders(
    '#t th',
    () => sort,
    (prev, k) => (prev.k === k ? { k, asc: !prev.asc } : { k, asc: true }),
    (next) => { sort = next; }
  );
  ths[1].fire('click');
  assert.deepStrictEqual(sort, { k: 'summit_ele_m', asc: true });
  assert.strictEqual(ths[1].attrs['aria-sort'], 'ascending');
});
