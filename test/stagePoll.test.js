'use strict';
// poll() (frontend/stage.js) sondait GET /api/stages/:id (et POST .../generate
// pour lancer une génération depuis un brouillon) sans aucun try/catch
// (trouvaille de sprint dédié) : une panne réseau transitoire (serveur qui
// redémarre, Wi-Fi qui coupe) faisait rejeter EF.api() sans que rien ne la
// rattrape — exception non gérée dans le callback du setTimeout, boucle de
// sondage arrêtée en silence, barre de progression figée indéfiniment sans
// le moindre message, jusqu'au rechargement manuel de la page. poll() est
// require()-able côté test (fonction déclarée hors du bloc DOMContentLoaded,
// sous la garde `typeof document` — même schéma que similarItemHtml, déjà
// exporté par ce fichier).
//
// Le correctif n'entoure que les deux appels réseau, jamais renderFiche()/
// loadSimilarStages() (état "done") : un bug de rendu sans rapport avec le
// réseau ne doit pas être mêlé au message "connexion perdue" ni retenté en
// boucle indéfiniment.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

global.EF = { qs: () => 'stage-test-id', esc: (s) => String(s ?? '') };

const { poll } = require('../frontend/stage.js');

function makeEl() {
  return { textContent: '', style: {} };
}

let els;
let scheduled;

beforeEach(() => {
  els = {};
  global.document = { getElementById: (id) => (els[id] ??= makeEl()) };
  scheduled = [];
  global.setTimeout = (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; };
  poll.started = false;
  poll.failures = 0;
});

test('poll() : panne réseau transitoire sur GET /api/stages/:id → pas d\'exception non gérée, message affiché, nouveau sondage reprogrammé', async () => {
  global.EF.api = async () => { throw new Error('fetch failed'); };
  await assert.doesNotReject(poll());
  assert.match(els['pg-detail'].textContent, /Connexion perdue/, 'un message doit remplacer la barre figée sans explication');
  assert.match(els['pg-detail'].textContent, /fetch failed/, 'le message d\'erreur original doit rester visible pour le diagnostic');
  assert.strictEqual(scheduled.length, 1, 'le sondage doit être reprogrammé, pas abandonné');
  assert.strictEqual(scheduled[0].fn, poll);
});

test('poll() : panne réseau transitoire sur POST .../generate (lancement depuis un brouillon) → même filet, et le lancement est retenté (poll.started remis à false)', async () => {
  let calls = 0;
  global.EF.api = async (path) => {
    calls++;
    if (path.endsWith('/generate')) throw new Error('panne au lancement');
    return { stage: { state: 'draft' } };
  };
  await assert.doesNotReject(poll());
  assert.strictEqual(calls, 2, 'le GET de statut puis le POST de lancement doivent bien être tentés');
  assert.match(els['pg-detail'].textContent, /Connexion perdue/);
  assert.strictEqual(poll.started, false, 'le lancement doit pouvoir être retenté au prochain sondage, pas resté bloqué à true pour toujours');
  assert.strictEqual(scheduled.length, 1);
});

test('poll() : échecs répétés → l\'intervalle de nouvelle tentative s\'allonge (backoff), plafonné à 10 s', async () => {
  global.EF.api = async () => { throw new Error('panne'); };
  await poll();
  const firstDelay = scheduled[0].delay;
  await poll();
  const secondDelay = scheduled[1].delay;
  assert.ok(secondDelay > firstDelay, `le 2e délai (${secondDelay}) doit dépasser le 1er (${firstDelay})`);
  assert.ok(secondDelay <= 10000, 'le backoff ne doit jamais dépasser 10 s');
});

test('poll() : un sondage réussi après des échecs réinitialise le compteur de tentatives et l\'intervalle fixe de 900 ms', async () => {
  global.EF.api = async () => { throw new Error('panne'); };
  await poll();
  await poll();
  assert.ok(poll.failures >= 2);
  global.EF.api = async () => ({ stage: { state: 'generating', name: 'Étape test', progress: { step: 'x', detail: 'y', percent: 50 } } });
  await poll();
  assert.strictEqual(poll.failures, 0, 'un sondage réussi doit remettre le compteur d\'échecs à zéro');
  assert.strictEqual(scheduled[scheduled.length - 1].delay, 900, 'le sondage normal (sans échec) doit garder son intervalle fixe de 900 ms');
  assert.doesNotMatch(els['pg-detail'].textContent, /Connexion perdue/, 'le message d\'erreur ne doit pas persister après un sondage réussi');
});

test('poll() : état "error" — inchangé, pas de nouveau sondage programmé, pas de message "connexion perdue"', async () => {
  global.EF.api = async () => ({ stage: { state: 'error', error: 'Wikipédia injoignable' } });
  await assert.doesNotReject(poll());
  assert.strictEqual(els['pg-title'].textContent, 'Échec de la génération');
  assert.strictEqual(els['pg-detail'].textContent, 'Wikipédia injoignable');
  assert.strictEqual(scheduled.length, 0, 'un échec de génération définitif ne doit jamais être reprogrammé');
});
