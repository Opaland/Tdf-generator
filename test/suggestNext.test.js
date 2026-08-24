'use strict';
// Suggestion de prochaine étape à générer (backlog #10, "réfléchisses à…").
// GET /api/suggest-next pondère par variété de terrain déjà générée (stage_type
// le moins représenté parmi les étapes state='done') plutôt que par ordre
// d'ajout — voir backend/server.js pour l'algorithme et sa justification.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-suggestnext-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
let getDb;

before(async () => {
  const { app } = require('../backend/server');
  ({ getDb } = require('../backend/db'));
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // Table vidée entre chaque test pour ne pas laisser une suggestion d'un
  // test précédent fausser le comptage par type.
  const db = getDb();
  db.prepare('DELETE FROM waypoints').run();
  db.prepare('DELETE FROM stages').run();
});

async function createDraft(name, stage_type) {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, stage_type,
      waypoints: [{ label: 'Départ' }, { label: 'Arrivée' }],
    }),
  });
  const json = await res.json();
  return json.id;
}

function markDone(id) {
  getDb().prepare(`UPDATE stages SET state = 'done' WHERE id = ?`).run(id);
}

test('GET /api/suggest-next : aucune étape brouillon → suggestion null', async () => {
  const res = await fetch(`${base}/api/suggest-next`);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.suggestion, null);
});

test('GET /api/suggest-next : aucune étape terminée → première étape brouillon, raison "aucun signal"', async () => {
  const id = await createDraft('Pau → Hautacam', 'montagne');
  const res = await fetch(`${base}/api/suggest-next`);
  const json = await res.json();
  assert.strictEqual(json.suggestion.id, id);
  assert.match(json.reason, /sans signal de variété/i);
});

test('GET /api/suggest-next : privilégie le type sous-représenté parmi les étapes terminées', async () => {
  const plaineDone = await createDraft('Étape plaine 1', 'plaine');
  markDone(plaineDone);
  const montagneDone = await createDraft('Étape montagne 1', 'montagne');
  markDone(montagneDone);
  // Deux brouillons : un de chaque type déjà représenté une fois, plus un
  // 3e type jamais généré — celui-ci doit gagner (0 étape < 1 étape).
  await createDraft('Brouillon plaine', 'plaine');
  const clmDraft = await createDraft('Brouillon CLM', 'clm');
  const res = await fetch(`${base}/api/suggest-next`);
  const json = await res.json();
  assert.strictEqual(json.suggestion.id, clmDraft, 'le type jamais généré (clm) doit être suggéré avant un type déjà représenté');
  assert.match(json.reason, /absent des étapes déjà générées/);
});

test('GET /api/suggest-next : à égalité de comptage, le brouillon le plus ancien (id le plus bas) gagne (déterministe)', async () => {
  const done = await createDraft('Étape 1', 'plaine');
  markDone(done);
  const first = await createDraft('Brouillon montagne A', 'montagne');
  await createDraft('Brouillon montagne B', 'montagne');
  const res = await fetch(`${base}/api/suggest-next`);
  const json = await res.json();
  assert.strictEqual(json.suggestion.id, first);
});

test('GET /api/suggest-next : un stage_type absent (null) est traité comme un type "inconnu" cohérent, pas un crash', async () => {
  const id = await createDraft('Sans type', null);
  const res = await fetch(`${base}/api/suggest-next`);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.suggestion.id, id);
});

test('GET /api/suggest-next : stage_type="" (chaîne vide) et null comptent pour le même bucket "inconnu" (choix explicite, pas un accident)', async () => {
  const doneEmpty = await createDraft('Étape terminée sans type renseigné', '');
  markDone(doneEmpty);
  await createDraft('Brouillon sans type (null)', null);
  const draftPlaine = await createDraft('Brouillon plaine', 'plaine');
  const res = await fetch(`${base}/api/suggest-next`);
  const json = await res.json();
  // "" et null fusionnent dans le même compartiment "inconnu" (1 étape déjà
  // générée) : le brouillon "plaine" (0 étape déjà générée) doit gagner.
  assert.strictEqual(json.suggestion.id, draftPlaine, '"" et null doivent partager le compte "inconnu", donc plaine (jamais généré) doit être préféré');
});
