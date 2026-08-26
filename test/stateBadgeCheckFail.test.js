'use strict';
// EF.stateBadge() (frontend/common.js) ne mappait que `state`
// (done/generating/error/draft), jamais `checks` — une étape dont l'audit
// qualité échoue clairement (ex. distance reconstituée à -100 % de
// l'officielle, checks.ok === false) affichait pourtant le même badge vert
// "générée" qu'une étape saine, dans le tableau de l'éditeur ET dans
// Archives : rien ne distinguait visuellement "généré avec succès" de
// "généré mais fondamentalement cassé" sans ouvrir chaque fiche
// individuellement. Trouvaille du persona chef de projet (agent
// revue-personas).
//
// EF est require()-able côté test grâce à la garde `typeof module` ajoutée
// par ce correctif (même schéma que stage.js/compare.js/editor.js/
// archives.js) — la vraie implémentation est testée, pas une copie.

const { test } = require('node:test');
const assert = require('node:assert');

const EF = require('../frontend/common.js');

test('stateBadge("done", { ok: false, ... }) : badge distinct, pas le badge vert normal', () => {
  const html = EF.stateBadge('done', { ok: false, items: [{ status: 'fail' }] });
  assert.match(html, /done-checkfail/);
  assert.match(html, /générée ⚠/);
  assert.doesNotMatch(html, /class="badge done">/, 'ne doit jamais rendre le badge vert normal quand un audit a échoué');
});

test('stateBadge("done", { ok: true, ... }) : badge vert normal, inchangé', () => {
  const html = EF.stateBadge('done', { ok: true, items: [{ status: 'ok' }] });
  assert.match(html, /class="badge done">/);
  assert.match(html, />générée</);
  assert.doesNotMatch(html, /done-checkfail/);
});

test('stateBadge("done", { ok: true, ... }) avec un simple \'warn\' dans items : reste le badge normal (checks.ok fait déjà foi)', () => {
  // stateBadge fait confiance à checks.ok tel quel — pipeline/checks.js
  // calcule déjà `ok = !items.some(i => i.status === 'fail')`, donc un
  // simple 'warn' (ex. segments approximés, tolérance d'altitude) n'y fait
  // jamais passer ok à false. Ce test verrouille que stateBadge ne
  // réinterprète pas items lui-même.
  const html = EF.stateBadge('done', { ok: true, items: [{ status: 'warn' }] });
  assert.doesNotMatch(html, /done-checkfail/, 'un simple warn (ok resté true) ne doit pas déclencher le badge d\'échec');
});

test('stateBadge("done") sans checks (undefined) : badge vert normal, pas d\'exception', () => {
  assert.doesNotThrow(() => EF.stateBadge('done', undefined));
  const html = EF.stateBadge('done', undefined);
  assert.match(html, /class="badge done">/);
});

test('stateBadge("generating"/"error"/"draft") : jamais affecté par checks, même si ok === false', () => {
  for (const state of ['generating', 'error', 'draft']) {
    const html = EF.stateBadge(state, { ok: false, items: [{ status: 'fail' }] });
    assert.doesNotMatch(html, /done-checkfail/, `${state} ne doit jamais devenir le badge d'échec d'audit (réservé à "done")`);
    assert.match(html, new RegExp(`class="badge ${state}"`));
  }
});
