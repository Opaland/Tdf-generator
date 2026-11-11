#!/usr/bin/env node
'use strict';
// Récits d'étapes rédigés par Claude (story 41.4) — génération hors serveur.
//
// Usage :
//   node scripts/generate-recits.js 1978 [1979/5 …] [--limit 10] [--dry-run] [--force]
//
// - Une année = toutes ses étapes curées ; « année/étape » = une seule.
// - --limit N : au plus N rédactions par lancement (10 par défaut : l'échantillon
//   de l'étude, docs/ETUDE-NETATMO-SITE-TOUR.md § 4, avant tout lancement complet).
// - --dry-run : montre les faits et un coût estimé, sans aucun appel à l'API.
// - --force : rédige même si un récit à jour existe (faits inchangés).
//
// Sans --dry-run, il faut une clé (ANTHROPIC_API_KEY, ou ANTHROPIC_AUTH_TOKEN) :
// l'appel est payant. Modèle : ETAPEFORGE_RECITS_MODEL, sinon Claude Opus 5.5.
// Le fichier pipeline/data/stage_narratives.json est réécrit après chaque
// récit vérifié ; un récit non vérifié n'y entre jamais.

const fs = require('fs');
const recits = require('../pipeline/recits');

function parseArgs(argv) {
  const out = { targets: [], limit: 10, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--limit') {
      out.limit = Number(argv[++i]);
      if (!Number.isInteger(out.limit) || out.limit < 1) throw new Error('--limit attend un entier ≥ 1');
    } else if (/^\d{4}(\/\w+)?$/.test(a)) out.targets.push(a);
    else throw new Error(`argument inconnu : ${a}`);
  }
  if (!out.targets.length) throw new Error('indiquer au moins une année ou année/étape (ex. 1978, 1978/14)');
  return out;
}

function expand(targets) {
  const list = [];
  for (const t of targets) {
    const [year, key] = t.split('/');
    const keys = key ? [key] : recits.curatedKeys(year);
    if (!keys.length) console.error(`${year} : aucune étape curée`);
    for (const k of keys) list.push([year, k]);
  }
  return list;
}

/** Estimation grossière avant tout appel : ≈ 4 caractères par jeton, et la
 * sortie supposée de 500 jetons + la réflexion (non comptée ici). */
function estimate(facts, model) {
  const inputTokens = Math.round((recits.SYSTEM.length + JSON.stringify(facts, null, 1).length) / 4);
  return { inputTokens, cost: recits.costUsd(model, { input_tokens: inputTokens, output_tokens: 500 }) };
}

function writeDoc(doc, file) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

async function main(argv = process.argv.slice(2), { client: injected, log = console.log, file = recits.NARRATIVES_FILE } = {}) {
  const args = parseArgs(argv);
  const model = process.env.ETAPEFORGE_RECITS_MODEL || recits.DEFAULT_MODEL;
  const doc = recits.readNarratives(file);
  if (!doc._notes) {
    doc._notes = "Récits d'étapes rédigés par Claude à partir des faits curés (pipeline/recits.js) ; chaque nombre et chaque nom propre vérifié contre les faits ; facts_hash : empreinte des faits au moment de la rédaction (un récit dont les faits ont changé n'est plus affiché).";
  }
  let client = injected;
  if (!args.dryRun && !client) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw new Error('aucune clé : définir ANTHROPIC_API_KEY (appel payant), ou lancer avec --dry-run');
    }
    let Anthropic;
    try {
      // Dépendance de développement : absente de l'image de production
      // (npm ci --omit=dev), où le serveur n'en a pas besoin.
      Anthropic = require('@anthropic-ai/sdk');
    } catch {
      throw new Error('SDK @anthropic-ai/sdk absent : lancer `npm ci` (dépendances de développement comprises)');
    }
    client = new (Anthropic.default || Anthropic)();
  }
  let done = 0;
  let spent = 0;
  let estimated = 0;
  for (const [year, key] of expand(args.targets)) {
    if (done >= args.limit) {
      log(`--limit ${args.limit} atteint : arrêt.`);
      break;
    }
    const facts = recits.stageFacts(year, key);
    if (!facts) {
      log(`${year}/${key} : étape non curée, ignorée`);
      continue;
    }
    const hash = recits.factsHash(facts);
    const prev = doc.narratives[year] && doc.narratives[year][key];
    if (prev && prev.facts_hash === hash && !args.force) {
      log(`${year}/${key} : récit à jour, ignoré`);
      continue;
    }
    if (args.dryRun) {
      const e = estimate(facts, model);
      estimated += e.cost || 0;
      log(`${year}/${key} : ${facts.points.length} points, ≈ ${e.inputTokens} jetons en entrée, ≈ ${e.cost == null ? '?' : e.cost.toFixed(3)} $ (hors réflexion)`);
      done++;
      continue;
    }
    try {
      const r = await recits.writeNarrative(client, facts, { model });
      (doc.narratives[year] ||= {})[key] = {
        text: r.text,
        model: r.model,
        generated_at: new Date().toISOString(),
        facts_hash: hash,
        usage: r.usage,
        cost_usd: r.cost_usd,
        attempts: r.attempts,
      };
      writeDoc(doc, file);
      spent += r.cost_usd || 0;
      log(`${year}/${key} : récit vérifié (${r.attempts} demande${r.attempts > 1 ? 's' : ''}, ${r.cost_usd == null ? 'coût inconnu' : `${r.cost_usd.toFixed(4)} $`})`);
    } catch (err) {
      if (err.code === 'UNVERIFIED' || err.code === 'REFUSAL') {
        if (err.usage) spent += recits.costUsd(model, err.usage) || 0;
        log(`${year}/${key} : écarté — ${err.message}`);
      } else {
        throw err;
      }
    }
    done++;
  }
  log(args.dryRun ? `Estimation : ≈ ${estimated.toFixed(2)} $ pour ${done} étape(s), sans la réflexion.` : `Dépense : ${spent.toFixed(4)} $ pour ${done} étape(s).`);
  return { done, spent };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Erreur : ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
