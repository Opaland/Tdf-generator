'use strict';
// Récits d'étapes rédigés par Claude (story 41.4, étude docs/ETUDE-NETATMO-
// SITE-TOUR.md § 4). Le code assemble les FAITS d'une étape curée ; Claude
// n'écrit qu'à partir d'eux ; chaque nombre et chaque nom propre du texte est
// ensuite vérifié contre ces faits (règle 12 : aucune donnée historique
// inventée). Un texte qui échoue est redemandé une fois avec la liste des
// écarts, puis écarté — jamais stocké non vérifié.
//
// Ce module n'appelle l'API qu'à travers un client passé en paramètre
// (scripts/generate-recits.js le crée ; les tests passent un faux client) :
// le serveur ne génère jamais rien, il lit seulement le fichier des récits.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { townsStageFor } = require('./placeSearch');

const DATA_DIR = path.join(__dirname, 'data');
const NARRATIVES_FILE = path.join(DATA_DIR, 'stage_narratives.json');

/** Modèle par défaut : Claude Opus 5.5 ; ETAPEFORGE_RECITS_MODEL le change
 * (choix du propriétaire, story 41.2), lu par le script seulement. */
const DEFAULT_MODEL = 'claude-opus-5-5';

/** Tarifs publics en $ par million de jetons (entrée, sortie), vérifiés le
 * 11/11/2026 dans la référence de l'API Claude. Un modèle absent de la table
 * donne un coût inconnu (null), jamais un coût faux. */
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const KIND = { ville: 'ville', 'lieu-dit': 'lieu-dit', côte: 'côte', col: 'col' };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let cache = null;
function sources() {
  if (!cache) {
    cache = {
      itineraries: readJson(path.join(DATA_DIR, 'stage_itineraries.json')).editions || {},
      towns: readJson(path.join(DATA_DIR, 'stage_towns.json')).editions || {},
    };
  }
  return cache;
}

/** Étapes curées (itinéraire détaillé) d'une édition masculine : [clé…]. */
function curatedKeys(year) {
  const ed = sources().itineraries[String(year)];
  // Ordre des étapes, pas celui des clés d'objet JS (qui place « 2 » … « 22 »
  // avant « 1a », « 12a »).
  const order = (k) => [parseInt(k, 10), k];
  return ed && ed.stages ? Object.keys(ed.stages).sort((x, y) => {
    const [a, ka] = order(x);
    const [b, kb] = order(y);
    return a - b || (ka < kb ? -1 : ka > kb ? 1 : 0);
  }) : [];
}

function dateText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[3])} ${MOIS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Altitude et catégorie imprimées, lues dans la note du point (format de
 * la transcription : « 1415 m imprimés ; 1re catégorie »). */
function printedAltitude(note) {
  const m = /(?:^|; )(\d{1,4}) m imprimés/.exec(note || '');
  return m ? Number(m[1]) : null;
}
function printedCategory(note) {
  const n = note || '';
  if (/\bHC\b|hors catégorie/i.test(n)) return 'hors catégorie';
  const m = /\b([1-4])(?:re|e|ère)\s*cat(?:\.|égorie)/i.exec(n);
  return m ? `${m[1]}${m[1] === '1' ? 're' : 'e'} catégorie` : null;
}

/** Faits d'une étape curée, assemblés par le code seul. Rien des notes de
 * curation (hypothèses, écarts du profil) n'y entre : seulement ce que le
 * profil imprime et les champs structurés. null si l'étape n'est pas curée. */
function stageFacts(year, key) {
  const { itineraries, towns } = sources();
  const it = itineraries[String(year)] && itineraries[String(year)].stages[String(key)];
  if (!it) return null;
  const st = townsStageFor((towns[String(year)] || {}).stages, key) || {};
  const pts = it.towns || [];
  const facts = {
    edition: Number(year),
    etape: String(key),
    date: st.date || null,
    date_texte: dateText(st.date),
    depart: pts.length ? pts[0].label : null,
    arrivee: pts.length ? pts[pts.length - 1].label : null,
    // Distance de Wikipédia (stage_towns.json), pas une distance officielle
    // vérifiée : nommée d'après sa source.
    distance_wikipedia_km: Number.isFinite(st.distanceKm) ? st.distanceKm : null,
    distance_profil_km: pts.length ? pts[pts.length - 1].km : null,
    contre_la_montre: /contre-la-montre/i.test(it.note || '') || undefined,
    points: pts.map((t) => {
      const p = { nom: t.label, km: t.km, type: KIND[t.kind] || t.kind };
      // Une altitude lue « peu lisible » n'est pas un fait certain : omise.
      const alt = /altitude peu lisible/.test(t.note || '') ? null : printedAltitude(t.note);
      if (alt != null) p.altitude_m = alt;
      if (t.kind === 'côte' || t.kind === 'col') {
        const cat = printedCategory(t.note);
        if (cat) p.categorie = cat;
      }
      return p;
    }),
    source: it.source_url || null,
  };
  if (!facts.contre_la_montre) delete facts.contre_la_montre;
  return facts;
}

/** Empreinte stable des faits : un récit n'est plus affiché quand elle change. */
function factsHash(facts) {
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
}

// --- Vérification -----------------------------------------------------

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Nombres d'un texte français : « 1 473 », « 1 473 », « 135,5 », « 1978 ». */
function numbersIn(text) {
  const out = [];
  const re = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?/g;
  let m;
  while ((m = re.exec(text))) out.push(Number(m[0].replace(/[ \u00a0\u202f]/g, '').replace(',', '.')));
  return out;
}

/** Tous les nombres des faits, et tous leurs mots (pour les noms propres). */
function factCorpus(facts) {
  const nums = new Set();
  const words = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'number') nums.add(v);
    else if (typeof v === 'string') {
      for (const n of numbersIn(v)) nums.add(n);
      for (const w of fold(v).split(/[^a-z0-9]+/)) if (w) words.add(w);
    } else if (Array.isArray(v)) v.forEach(walk);
    // L'URL de la source n'est pas un fait de l'étape : ses chiffres
    // (« 1977_1986 ») et ses mots ne doivent rien autoriser dans le texte.
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'source') walk(x);
  };
  walk(facts);
  return { nums, words };
}

/** Mots à majuscule tolérés hors des faits : mots outils en début de phrase,
 * et le nom de la course. Tout autre nom propre doit venir des faits. */
const COMMON = new Set(('le la les l un une des du de d au aux en dans sur sous par pour avec sans '
  + 'entre vers apres avant puis ensuite enfin alors ainsi cette ce cet ces son sa ses leur leurs '
  + 'il elle ils elles on c est etait fut qui que quand ou et mais car donc or ni si tout toute '
  + 'tous toutes depuis des plus moins tres deja encore premier premiere derniere dernier '
  + 'tour france etape cote col partie parcours route course coureurs peloton '
  + 'a au-dela la-haut lundi mardi mercredi jeudi vendredi samedi dimanche').split(' '));

/** Vérifie un récit contre ses faits : { ok, nombres: [...], noms: [...] }
 * (les nombres et noms du texte absents des faits). */
function verifyNarrative(text, facts) {
  const { nums, words } = factCorpus(facts);
  const nombres = [...new Set(numbersIn(text).filter((n) => !nums.has(n)))];
  const noms = new Set();
  const re = /\p{Lu}[\p{L}'’-]*/gu;
  let m;
  while ((m = re.exec(text))) {
    for (const part of fold(m[0]).split(/['’-]/)) {
      if (part.length < 2 || COMMON.has(part) || words.has(part)) continue;
      noms.add(m[0]);
    }
  }
  return { ok: !nombres.length && !noms.size, nombres, noms: [...noms] };
}

// --- Génération (client injecté) ---------------------------------------

const SYSTEM = `Tu rédiges, en français, le récit d'une étape historique du Tour de France pour un site d'histoire du Tour.
Tu reçois les FAITS de l'étape en JSON : ce sont les seules informations dont tu disposes.
Règles strictes :
- N'écris aucun nom de lieu, de personne ou d'équipe qui ne figure pas dans les faits.
- N'écris aucun nombre (km, altitude, date, catégorie) qui ne figure pas dans les faits, et recopie-le tel quel (virgule décimale, km au dixième s'il est donné ainsi). N'arrondis pas, ne calcule rien (pas de différence, de somme ni de pente), n'écris aucun nombre en lettres.
- Ne cite ni vainqueur, ni coureur, ni météo, ni anecdote, ni enjeu sportif : tu ne les connais pas par les faits.
- distance_profil_km est la longueur imprimée sur le profil de l'étape ; distance_wikipedia_km vient de Wikipédia. Donne la distance du profil ; ne présente jamais l'une ou l'autre comme officielle.
- Choisis les passages marquants (départ, arrivée, cols et côtes avec leur altitude et leur catégorie) ; ne recopie pas la liste entière.
- 120 à 200 mots, deux ou trois paragraphes séparés par une ligne vide, texte brut sans titre, sans liste ni mise en forme.`;

function textOf(content) {
  return (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

function costUsd(model, usage) {
  const p = PRICES[model];
  if (!p) return null;
  return Math.round(((usage.input_tokens * p[0] + usage.output_tokens * p[1]) / 1e6) * 1e5) / 1e5;
}

/** Rédige le récit d'une étape. `client` : instance du SDK Anthropic (ou un
 * double de test exposant beta.messages.create). Rend { text, model,
 * usage, cost_usd, attempts } si le texte passe la vérification, sinon
 * lève une erreur `code: 'UNVERIFIED'` (ou 'REFUSAL'). */
async function writeNarrative(client, facts, { model = DEFAULT_MODEL, effort = 'medium' } = {}) {
  const messages = [{ role: 'user', content: `FAITS :\n${JSON.stringify(facts, null, 1)}` }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      output_config: { effort },
      // Repli côté serveur sur un refus de classifieur (sinon la demande
      // s'arrête) : forme « default », sans liste de modèles à entretenir.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    usage.input_tokens += (res.usage && res.usage.input_tokens) || 0;
    usage.output_tokens += (res.usage && res.usage.output_tokens) || 0;
    if (res.stop_reason === 'refusal') {
      const err = new Error(`refus du modèle${res.stop_details && res.stop_details.category ? ` (${res.stop_details.category})` : ''}`);
      err.code = 'REFUSAL';
      throw err;
    }
    const text = textOf(res.content);
    const v = verifyNarrative(text, facts);
    last = { text, v, model: res.model || model };
    if (v.ok && text && res.stop_reason !== 'max_tokens') {
      return { text, model: last.model, usage, cost_usd: costUsd(model, usage), attempts: attempt };
    }
    // Seconde demande : le contenu entier de la réponse est renvoyé tel quel
    // (blocs de réflexion compris), puis la liste des écarts.
    messages.push({ role: 'assistant', content: res.content });
    messages.push({
      role: 'user',
      content: `Ce texte contient des éléments absents des faits : ${[...v.nombres, ...v.noms].join(', ') || 'texte vide ou tronqué'}. Réécris le récit entier sans eux, en respectant toutes les règles.`,
    });
  }
  const err = new Error(`récit non vérifié après 2 demandes : ${[...last.v.nombres, ...last.v.noms].join(', ')}`);
  err.code = 'UNVERIFIED';
  err.usage = usage;
  throw err;
}

// --- Stockage -----------------------------------------------------------

function readNarratives(file = NARRATIVES_FILE) {
  try {
    const doc = readJson(file);
    return doc && typeof doc === 'object' && doc.narratives ? doc : { narratives: {} };
  } catch {
    return { narratives: {} };
  }
}

/** Récit affichable d'une étape : seulement si l'empreinte stockée est celle
 * des faits actuels (sinon les faits ont changé depuis la rédaction). */
function currentNarrative(year, key, doc = readNarratives()) {
  const n = doc.narratives[String(year)] && doc.narratives[String(year)][String(key)];
  if (!n || typeof n.text !== 'string') return null;
  const facts = stageFacts(year, key);
  if (!facts || factsHash(facts) !== n.facts_hash) return null;
  return { text: n.text, model: n.model, generated_at: n.generated_at };
}

module.exports = {
  DEFAULT_MODEL, NARRATIVES_FILE, PRICES, SYSTEM,
  curatedKeys, stageFacts, factsHash, numbersIn, verifyNarrative,
  writeNarrative, costUsd, readNarratives, currentNarrative,
  _resetCache: () => { cache = null; },
};
