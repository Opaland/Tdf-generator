'use strict';
// Suivi de session (revue-personas, Sprint 5, backlog #66) : EF.api()
// (frontend/common.js) n'avait aucun timeout sur son fetch() — un serveur
// qui cesse de répondre en cours de requête (crash, coupure réseau)
// laissait l'appelant bloqué indéfiniment, bouton figé sur « … », sans
// jamais afficher d'erreur. Exécute le vrai code de common.js dans un bac à
// sable minimal (fetch/AbortController réels de Node — ce comportement ne
// dépend d'aucune API DOM, pas besoin d'un navigateur pour le vérifier).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'common.js'), 'utf8');

function loadEF({ fetchImpl, isStatic = false } = {}) {
  const sandbox = { EF_STATIC: isStatic };
  const run = new Function('window', 'fetch', 'AbortController', 'document', src + '\nreturn EF;');
  return run(sandbox, fetchImpl, AbortController, { createElement: () => ({}) });
}

test('EF.api() abandonne après timeoutMs si le serveur ne répond jamais, avec un message explicite', async () => {
  const calls = [];
  const neverResolvingFetch = (url, opts) => {
    calls.push({ url, opts });
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  const EF = loadEF({ fetchImpl: neverResolvingFetch });
  await assert.rejects(EF.api('/api/stages', { timeoutMs: 30 }), (err) => {
    assert.match(err.message, /serveur ne répond pas/i);
    return true;
  });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].opts.signal instanceof AbortSignal, 'un AbortSignal doit être passé à fetch()');
});

test('EF.api() ne transmet pas timeoutMs à fetch() (extrait des options avant l\'appel)', async () => {
  let receivedOpts;
  const fetchImpl = (url, opts) => {
    receivedOpts = opts;
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  };
  const EF = loadEF({ fetchImpl });
  await EF.api('/api/stages', { timeoutMs: 5000 });
  assert.strictEqual(receivedOpts.timeoutMs, undefined);
  assert.ok('signal' in receivedOpts);
});

test('EF.api() résout normalement un appel qui répond avant le délai (pas de régression)', async () => {
  const fetchImpl = () => Promise.resolve({ ok: true, json: async () => ({ hello: 'world' }) });
  const EF = loadEF({ fetchImpl });
  const result = await EF.api('/api/stages', { timeoutMs: 5000 });
  assert.deepStrictEqual(result, { hello: 'world' });
});

test('EF.api() sans timeoutMs explicite utilise EF.DEFAULT_TIMEOUT_MS (> 0, pas un bavardage indéfini)', async () => {
  let receivedOpts;
  const fetchImpl = (url, opts) => {
    receivedOpts = opts;
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  const EF = loadEF({ fetchImpl });
  assert.ok(EF.DEFAULT_TIMEOUT_MS > 0);
  await EF.api('/api/stages');
  assert.ok(receivedOpts.signal instanceof AbortSignal);
});

test('EF.api() ne masque pas une vraie erreur réseau (non-timeout) derrière le message de délai', async () => {
  const fetchImpl = () => Promise.reject(new Error('network down'));
  const EF = loadEF({ fetchImpl });
  await assert.rejects(EF.api('/api/stages', { timeoutMs: 5000 }), /network down/);
});
