'use strict';
// Récits d'étapes rédigés par Claude (story 41.4) : faits assemblés par le
// code, vérification des nombres et des noms, seconde demande, refus, stockage
// et route en lecture seule. Le client Claude est un double injecté : aucun
// appel réseau, aucun mock de fetch global (CLAUDE.md règle 6).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-recits-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const recits = require('../pipeline/recits');
const { main } = require('../scripts/generate-recits');

/** Double du client du SDK : rend les réponses données dans l'ordre et garde
 * les paramètres de chaque appel. */
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(JSON.parse(JSON.stringify(params)));
          const r = responses[calls.length - 1];
          if (!r) throw new Error('appel inattendu');
          return r;
        },
      },
    },
  };
}
const reply = (text, extra = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
  usage: { input_tokens: 1000, output_tokens: 300 },
  ...extra,
});

const GOOD_14 = "Le 14 juillet 1978, le contre-la-montre part de Besse-et-Saint-Anastaise.\n\n"
  + 'Après Murol et La Garandie, il monte au Puy de Dôme, à 1 415 m, col de 1re catégorie, au bout de 52,5 km.';

test('stageFacts : faits structurés de 1978/14, sans les notes de curation', () => {
  const f = recits.stageFacts(1978, '14');
  assert.strictEqual(f.depart, 'Besse-et-Saint-Anastaise');
  assert.strictEqual(f.arrivee, 'Puy de Dôme');
  assert.strictEqual(f.date_texte, '14 juillet 1978');
  assert.strictEqual(f.contre_la_montre, true);
  assert.strictEqual(f.distance_profil_km, 52.5);
  const pdd = f.points[f.points.length - 1];
  assert.deepStrictEqual([pdd.altitude_m, pdd.categorie], [1415, '1re catégorie']);
  assert.ok(!JSON.stringify(f).includes('règle'), 'aucune note de curation dans les faits');
  assert.strictEqual(recits.stageFacts(1978, '99'), null);
});

test('stageFacts : une altitude imprimée « peu lisible » n\'est pas donnée comme un fait', () => {
  const f = recits.stageFacts(1978, '13');
  const sb = f.points.find((p) => p.nom === 'Super-Besse');
  assert.ok(sb, 'Super-Besse dans les faits');
  assert.strictEqual(sb.altitude_m, undefined);
});

test('curatedKeys : ordre des étapes (1a, 1b, 2 … 12a, 12b …), pas celui des clés JS', () => {
  const keys = recits.curatedKeys(1978);
  assert.deepStrictEqual(keys.slice(0, 3), ['1a', '1b', '2']);
  assert.ok(keys.indexOf('12a') > keys.indexOf('11') && keys.indexOf('12b') < keys.indexOf('13'));
});

test('numbersIn : espaces des milliers et virgule décimale du français', () => {
  assert.deepStrictEqual(recits.numbersIn('1 415 m, 1\u202f473 m, 135,5 km, en 1978'), [1415, 1473, 135.5, 1978]);
});

test('verifyNarrative : un texte fidèle aux faits passe', () => {
  const v = recits.verifyNarrative(GOOD_14, recits.stageFacts(1978, '14'));
  assert.deepStrictEqual(v, { ok: true, nombres: [], noms: [] });
});

test('verifyNarrative : un nombre, un nom inventés, et les chiffres de l\'URL source sont refusés', () => {
  const f = recits.stageFacts(1978, '14');
  const v = recits.verifyNarrative(`${GOOD_14} Bernard Hinault y gagne sur 53 km ; le Dico date de 1977.`, f);
  assert.strictEqual(v.ok, false);
  assert.deepStrictEqual(v.nombres.sort(), ['1977', '53 (km)']);
  assert.ok(v.noms.includes('Bernard') && v.noms.includes('Hinault') && v.noms.includes('Dico'), v.noms.join());
});

test('verifyNarrative : un nombre doit être un fait de même nature (relecture adverse)', () => {
  const f3 = recits.stageFacts(1978, '3');
  const f14 = recits.stageFacts(1978, '14');
  // 7 est le km d'un point de 1978/3 (et le mois de sa date ISO) : sans
  // unité, seuls l'année, le jour (2) et le numéro d'étape (3) passent.
  assert.deepStrictEqual(recits.verifyNarrative('7 échappés, 5 sprints.', f3).nombres, ['7', '5']);
  assert.ok(recits.verifyNarrative('Étape 3, le 2 juillet 1978.', f3).ok);
  // Un km n'autorise pas une altitude, et inversement.
  assert.deepStrictEqual(recits.verifyNarrative('Au km 1 415, à 52,5 m.', f14).nombres, ['1 415 (km)', '52,5 (alt)']);
  assert.ok(recits.verifyNarrative('Au km 52,5, à 1 415 mètres, col de 1re catégorie.', f14).ok);
  assert.deepStrictEqual(recits.verifyNarrative('Une pente de 7 %.', f14).nombres, ['7 (pct)']);
  // Nombres en lettres : refusés, la consigne les interdit.
  assert.deepStrictEqual(recits.verifyNarrative('douze kilomètres de plaine', f14).nombres, ['douze']);
});

test('verifyNarrative : pas de faux refus sur les mots qui ouvrent un récit', () => {
  const f = recits.stageFacts(1978, '14');
  const v = recits.verifyNarrative("Départ de Besse-et-Saint-Anastaise. Arrivée au Puy de Dôme. Au-delà de Murol, là-haut. Lorsque le peloton passe. Distance : 52,5 kilomètres.", f);
  assert.deepStrictEqual(v, { ok: true, nombres: [], noms: [] });
});

test('stageFacts : un km mesuré à l\'échelle ou mal lu n\'est pas un fait (règle 4)', () => {
  const f = recits.stageFacts(1978, '2');
  const berchem = f.points.find((p) => p.nom === 'Berchem');
  assert.ok(berchem && berchem.km === undefined, 'Berchem : aucun km imprimé, km omis');
  const enclus = f.points.find((p) => p.nom === "Mont de l'Enclus");
  assert.ok(enclus && enclus.km === undefined, 'km peu lisible : omis');
  assert.ok(!('date' in f), 'pas de date ISO, dont les chiffres autoriseraient des nombres');
});

test('writeNarrative : un texte fautif est redemandé une fois, avec les écarts et la réponse entière', async () => {
  const facts = recits.stageFacts(1978, '14');
  const client = fakeClient([reply(`${GOOD_14} Il fait 53 km.`), reply(GOOD_14)]);
  const r = await recits.writeNarrative(client, facts);
  assert.strictEqual(r.attempts, 2);
  assert.strictEqual(r.text, GOOD_14);
  assert.deepStrictEqual(r.usage, { input_tokens: 2000, output_tokens: 600 });
  assert.strictEqual(r.cost_usd, (2000 * 4 + 600 * 20) / 1e6);
  const first = client.calls[0];
  assert.strictEqual(first.model, 'claude-opus-5-5');
  assert.strictEqual(first.fallbacks, 'default');
  assert.deepStrictEqual(first.betas, ['server-side-fallback-2026-07-01']);
  assert.strictEqual(first.thinking, undefined, 'pas de réglage de réflexion interdit sur Opus 5.5');
  const second = client.calls[1].messages;
  assert.strictEqual(second.length, 3);
  assert.strictEqual(second[1].role, 'assistant');
  assert.strictEqual(second[1].content[0].type, 'thinking', 'blocs de réflexion renvoyés tels quels');
  assert.match(second[2].content, /53/);
});

test('writeNarrative : deux textes fautifs → UNVERIFIED, rien n\'est rendu', async () => {
  const facts = recits.stageFacts(1978, '14');
  const client = fakeClient([reply('Bernard Hinault gagne.'), reply('Bernard Hinault gagne encore.')]);
  await assert.rejects(recits.writeNarrative(client, facts), (e) => e.code === 'UNVERIFIED' && e.usage.input_tokens === 2000);
});

test('writeNarrative : un refus du modèle → REFUSAL, sans seconde demande', async () => {
  const client = fakeClient([reply('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } })]);
  await assert.rejects(recits.writeNarrative(client, recits.stageFacts(1978, '14')), (e) => e.code === 'REFUSAL');
  assert.strictEqual(client.calls.length, 1);
});

test('writeNarrative : un texte tronqué (max_tokens) n\'est jamais accepté tel quel', async () => {
  const client = fakeClient([reply(GOOD_14, { stop_reason: 'max_tokens' }), reply(GOOD_14)]);
  const r = await recits.writeNarrative(client, recits.stageFacts(1978, '14'));
  assert.strictEqual(r.attempts, 2);
});

test('script : --dry-run n\'appelle rien et n\'écrit rien ; sans clé il refuse de partir', async () => {
  const file = path.join(os.tmpdir(), `recits-dry-${process.pid}.json`);
  const logs = [];
  const r = await main(['1978/14', '--dry-run'], { file, log: (l) => logs.push(l) });
  assert.strictEqual(r.done, 1);
  assert.ok(!fs.existsSync(file));
  const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    await assert.rejects(main(['1978/14'], { file, log: () => {} }), /aucune clé/);
  } finally {
    if (saved.k !== undefined) process.env.ANTHROPIC_API_KEY = saved.k;
    if (saved.t !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.t;
  }
});

test('script : récit vérifié stocké avec son empreinte ; écarté sinon ; --limit respecté ; à jour ignoré', async () => {
  const file = path.join(os.tmpdir(), `recits-gen-${process.pid}.json`);
  try {
    const client = fakeClient([reply(GOOD_14), reply('Bernard Hinault.'), reply('Bernard Hinault.')]);
    const r = await main(['1978/14', '1978/13', '1978/12a', '--limit', '2'], { file, client, log: () => {} });
    assert.strictEqual(r.done, 2);
    assert.strictEqual(client.calls.length, 3, '12a non traitée : limite atteinte');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepStrictEqual(Object.keys(doc.narratives['1978']), ['14'], '13 écartée, jamais stockée');
    const n = doc.narratives['1978']['14'];
    assert.strictEqual(n.facts_hash, recits.factsHash(recits.stageFacts(1978, '14')));
    assert.deepStrictEqual(recits.currentNarrative(1978, '14', doc), { text: GOOD_14, model: n.model, generated_at: n.generated_at });
    // Relance : faits inchangés → aucun appel.
    const again = fakeClient([]);
    await main(['1978/14'], { file, client: again, log: () => {} });
    assert.strictEqual(again.calls.length, 0);
    // Faits changés depuis la rédaction → plus affiché.
    doc.narratives['1978']['14'].facts_hash = 'ancien';
    assert.strictEqual(recits.currentNarrative(1978, '14', doc), null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('fichier des récits du dépôt : tout récit affiché passe la vérification contre ses faits actuels', () => {
  const doc = recits.readNarratives();
  for (const [year, stages] of Object.entries(doc.narratives)) {
    for (const [key, n] of Object.entries(stages)) {
      const facts = recits.stageFacts(year, key);
      if (!facts || recits.factsHash(facts) !== n.facts_hash) continue; // périmé : non affiché
      const v = recits.verifyNarrative(n.text, facts);
      assert.ok(v.ok, `${year}/${key} : ${[...v.nombres, ...v.noms].join(', ')}`);
    }
  }
});

test('fiche d\'étape : le récit est inséré en texte seul, jamais par innerHTML', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'stage.js'), 'utf8');
  const body = src.slice(src.indexOf('async function loadRecit'), src.indexOf('async function loadSimilarStages'));
  assert.ok(body.includes('textContent'));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(body));
});

let appServer;
let base;
before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('GET /api/stages/:id/recit : identifiant invalide → 400 ; étape sans récit → narrative null', async () => {
  const { getDb } = require('../backend/db');
  const db = getDb();
  const ed = db.prepare("INSERT INTO editions (year, name, category, source) VALUES (1978, 'Tour 1978', 'hommes', '{}')").run().lastInsertRowid;
  const ids = [[1, '1a'], [1, '1b'], [2, '2']].map(([o, k], i) => db.prepare('INSERT INTO stages (edition_id, stage_order, name, date) VALUES (?, ?, ?, ?)').run(ed, o, `É${i}`, recits.stageDate(1978, k)).lastInsertRowid);
  assert.strictEqual((await fetch(`${base}/api/stages/abc/recit`)).status, 400);
  const res = await fetch(`${base}/api/stages/${ids[1]}/recit`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { narrative: null });
  const { stageKey } = require('../backend/routes/recits');
  assert.deepStrictEqual(stageKey(db, ids[1]), { year: 1978, key: '1b' });
  assert.deepStrictEqual(stageKey(db, ids[2]), { year: 1978, key: '2' });
  const custom = db.prepare("INSERT INTO stages (name) VALUES ('perso')").run().lastInsertRowid;
  assert.strictEqual(stageKey(db, custom), null);
});

test('stageKey : seulement l\'étape historique importée, à la date des faits (relecture adverse)', () => {
  const { getDb } = require('../backend/db');
  const db = getDb();
  const { stageKey } = require('../backend/routes/recits');
  const mk = (source) => db.prepare("INSERT INTO editions (year, name, category, source) VALUES (1978, 'T', 'hommes', ?)").run(source).lastInsertRowid;
  const add = (ed, order, date) => db.prepare('INSERT INTO stages (edition_id, stage_order, name, date) VALUES (?, ?, ?, ?)').run(ed, order, 'É', date).lastInsertRowid;
  const imported = mk('{"liste_etapes":"wikipedia"}');
  const s1 = add(imported, 1, recits.stageDate(1978, '1a'));
  add(imported, 1, recits.stageDate(1978, '1b'));
  const s2 = add(imported, 2, recits.stageDate(1978, '2'));
  assert.deepStrictEqual(stageKey(db, s1), { year: 1978, key: '1a' });
  assert.deepStrictEqual(stageKey(db, s2), { year: 1978, key: '2' });
  // Réordonnée : la date n'est plus celle de l'étape à cette place.
  db.prepare('UPDATE stages SET stage_order = 9 WHERE id = ?').run(s2);
  db.prepare('UPDATE stages SET stage_order = 2 WHERE id = ?').run(s1);
  assert.strictEqual(stageKey(db, s1), null);
  // Édition créée à la main, numérotée 1978 : jamais de récit historique.
  const manual = mk(null);
  assert.strictEqual(stageKey(db, add(manual, 2, recits.stageDate(1978, '2'))), null);
});
