'use strict';
// pollWhileGenerating() (frontend/archives.js) sondait la liste des éditions
// pendant une génération en cours sans aucun try/catch autour de
// loadEditions() (même trouvaille que poll(), frontend/stage.js — voir
// test/stagePoll.test.js) : une panne réseau transitoire faisait rejeter
// EF.api() sans que rien ne la rattrape, arrêtant le sondage en silence —
// la liste restait figée sur un état "génération…" périmé jusqu'au
// rechargement manuel de la page. Moins grave que dans stage.js (la page ne
// se bloque pas entièrement, juste la liste ne se rafraîchit plus), d'où le
// filet plus simple : pas de message utilisateur dédié, juste une reprise
// automatique avec un intervalle qui s'allonge.
//
// pollWhileGenerating est require()-able côté test grâce à la garde
// `typeof document` ajoutée par ce correctif (même schéma que
// stage.js/compare.js/editor.js/profile.js).

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

global.EF = { qs: () => null, esc: (s) => String(s ?? '') };

const { pollWhileGenerating } = require('../frontend/archives.js');

let scheduled;

beforeEach(() => {
  scheduled = [];
  global.setTimeout = (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; };
  global.clearTimeout = () => {};
});

test('pollWhileGenerating() : panne réseau transitoire (loadEditions rejette) → pas d\'exception non gérée, sondage reprogrammé', async () => {
  global.EF.api = async () => { throw new Error('fetch failed'); };
  await assert.doesNotReject(pollWhileGenerating());
  assert.strictEqual(scheduled.length, 1, 'le sondage doit être reprogrammé après une panne, pas abandonné');
  assert.strictEqual(scheduled[0].fn, pollWhileGenerating);
  assert.ok(scheduled[0].delay >= 1500, 'même en échec, ne jamais sonder plus vite que l\'intervalle nominal');
});

test('pollWhileGenerating() : échecs répétés → l\'intervalle de nouvelle tentative s\'allonge, plafonné à 10 s', async () => {
  global.EF.api = async () => { throw new Error('panne'); };
  await pollWhileGenerating();
  const firstDelay = scheduled[0].delay;
  await pollWhileGenerating();
  const secondDelay = scheduled[1].delay;
  assert.ok(secondDelay > firstDelay, `le 2e délai (${secondDelay}) doit dépasser le 1er (${firstDelay})`);
  assert.ok(secondDelay <= 10000, 'le backoff ne doit jamais dépasser 10 s');
});
