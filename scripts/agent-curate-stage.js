#!/usr/bin/env node
'use strict';
// Outil de développement (pas une fonctionnalité de l'app, voir docs/AGENT.md
// pour le raisonnement complet) : pour une étape hors tolérance, demande à
// Claude une liste de vias plausibles, puis — point central — fait rejouer
// la proposition par le VRAI pipeline (géocodage + routage + checks.js)
// avant d'afficher quoi que ce soit. Le modèle ne calcule jamais une
// distance ; il ne fait que proposer des noms de lieux, exactement le
// travail de recherche qu'un humain ferait sur cyclingstage.com/Wikipédia.
//
// N'écrit jamais dans pipeline/data/historic_routes.json : affiche une
// proposition vérifiée, à copier-coller et sourcer à la main — même
// protocole que toute curation de cette session (une PR, les tests, la
// revue adverse si le diff touche du code).
//
// Nécessite ANTHROPIC_API_KEY (clé du mainteneur, jamais celle d'un
// utilisateur final — voir docs/BRIEF.md, « pas de dépendance cloud
// propriétaire en fonctionnement normal » : ce script tourne hors du
// chemin d'exécution normal de l'app). Absence de la clé = message clair
// et sortie non nulle, jamais de repli silencieux.
//
// Usage :
//   ANTHROPIC_API_KEY=sk-... node scripts/agent-curate-stage.js --year 1992 --stage 13

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; } else { flags[key] = true; }
    }
  }
  return flags;
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY non défini — aucun appel réseau effectué.');
    console.error('Cet outil est volontairement hors du fonctionnement normal de l\'app (docs/AGENT.md) :');
    console.error('exporte ta propre clé pour l\'utiliser, jamais celle d\'un utilisateur final.');
    process.exit(1);
  }
  const model = process.env.ETAPEFORGE_AGENT_MODEL || 'claude-sonnet-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status} ${res.statusText} : ${await res.text()}`);
  }
  const json = await res.json();
  return (json.content || []).map((b) => b.text || '').join('');
}

// Le modèle répond parfois avec un bloc ```json ... ``` malgré l'instruction
// contraire — on l'accepte plutôt que de planter sur un format par ailleurs
// correct.
function parseSuggestions(raw) {
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`Réponse du modèle non-JSON, impossible de continuer :\n${raw}`, { cause: e });
  }
  if (!Array.isArray(parsed)) throw new Error('Réponse du modèle : attendu un tableau JSON.');
  return parsed;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const year = flags.year;
  const stageNumber = flags.stage;
  if (!year || !stageNumber) {
    console.error('Usage : node scripts/agent-curate-stage.js --year <année> --stage <numéro>');
    process.exit(1);
  }

  // Base de données isolée — ne touche jamais la base réelle ni
  // pipeline/data/historic_routes.json (mutation en mémoire seulement, même
  // principe que scripts/calibrate-gpx-stage.js).
  const dataDir = path.join(require('os').tmpdir(), `etapeforge-agent-${Date.now()}`);
  process.env.ETAPEFORGE_DATA_DIR = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });

  const { getDb } = require('../backend/db');
  const { importEdition } = require('../pipeline/importer');
  const { generateStage } = require('../pipeline/generate');
  const { geocode, geocodeCol, isColQuery } = require('../pipeline/geocode');
  const { DIST_TOLERANCE_PCT } = require('../pipeline/checks');
  const wp = require('../pipeline/wikipedia');

  const db = getDb();

  console.log(`Import de ${year} (état actuel, non modifié)...`);
  const { stages } = await importEdition(parseInt(year, 10), { category: flags.category || 'hommes' });
  const stage = stages.find((s) => s.number === parseInt(stageNumber, 10));
  if (!stage) throw new Error(`Étape ${stageNumber} introuvable pour ${year}`);
  await generateStage(stage.id);

  const before = db.prepare('SELECT official_distance_km, generated_distance_km, name FROM stages WHERE id = ?').get(stage.id);
  const beforeErr = before.generated_distance_km != null && before.official_distance_km
    ? ((before.generated_distance_km - before.official_distance_km) / before.official_distance_km) * 100
    : null;

  console.log(`Étape : ${before.name}`);
  console.log(`Officiel : ${before.official_distance_km} km`);
  console.log(`Reconstruit actuel : ${before.generated_distance_km != null ? before.generated_distance_km.toFixed(1) + ' km' : 'n/a'}`);
  if (beforeErr != null) console.log(`Écart actuel : ${beforeErr.toFixed(1)} %`);

  if (beforeErr != null && Math.abs(beforeErr) <= DIST_TOLERANCE_PCT) {
    console.log(`Déjà dans la tolérance ±${DIST_TOLERANCE_PCT}% — rien à proposer.`);
    return;
  }

  const existing = (wp.HISTORIC_ROUTES[year] && wp.HISTORIC_ROUTES[year].stages[stageNumber]) || {};
  const startLabel = typeof existing.start === 'string' ? existing.start : (existing.start && existing.start.label) || '';
  const finishLabel = typeof existing.finish === 'string' ? existing.finish : (existing.finish && existing.finish.label) || '';

  const prompt = `Tu travailles sur ÉtapeForge, un outil de reconstitution de parcours historiques du Tour de France. L'étape ${stageNumber} du Tour ${year} va de "${startLabel}" à "${finishLabel}", distance officielle ${before.official_distance_km} km. La reconstitution automatique actuelle (routage réel entre les points connus) donne ${before.generated_distance_km != null ? before.generated_distance_km.toFixed(1) : 'n/a'} km, soit un écart de ${beforeErr != null ? beforeErr.toFixed(1) : 'n/a'} % — hors de la tolérance ±${DIST_TOLERANCE_PCT}%, signe que des villes ou cols intermédiaires réels du parcours manquent.

Propose une liste ordonnée (dans l'ordre géographique du départ vers l'arrivée) de villes ou cols par lesquels cette étape est réellement passée, d'après ce que tu sais de l'histoire du Tour de France. Ne propose QUE des lieux dont tu es raisonnablement confiant — un lieu incertain doit être marqué "confidence":"uncertain", jamais présenté avec la même assurance qu'un lieu que tu sais sourcé.

Réponds UNIQUEMENT avec un tableau JSON, sans texte autour, format :
[{"label": "Nom du lieu", "kind": "via"|"col", "confidence": "sourced"|"plausible"|"uncertain", "rationale": "pourquoi ce lieu"}]`;

  console.log('\nAppel au modèle...');
  const raw = await callClaude(prompt);
  const suggestions = parseSuggestions(raw);
  console.log(`${suggestions.length} lieu(x) suggéré(s).`);

  const resolvedVias = [];
  for (const s of suggestions) {
    const label = s.label;
    if (!label) continue;
    let res;
    try {
      res = s.kind === 'col' || isColQuery(label) ? await geocodeCol(label, {}) : await geocode(label, {});
    } catch (e) {
      console.log(`  ✗ ${label} : géocodage échoué (${e.message}) — ignoré`);
      continue;
    }
    if (!res || res.lat == null) {
      console.log(`  ✗ ${label} : pas de résultat de géocodage — ignoré`);
      continue;
    }
    console.log(`  ✓ ${label} [${s.confidence || 'n/a'}] -> ${res.lat.toFixed(4)},${res.lon.toFixed(4)} (${s.rationale || ''})`);
    resolvedVias.push({ label, kind: s.kind === 'col' ? 'col' : 'via', lat: res.lat, lon: res.lon });
  }

  if (!resolvedVias.length) {
    console.log('\nAucun lieu suggéré n\'a pu être géocodé — rien à vérifier.');
    return;
  }

  console.log('\nRejoue le pipeline réel avec ces vias (remplace les vias existants)...');
  wp.HISTORIC_ROUTES[year].stages[stageNumber] = { ...existing, vias: resolvedVias };
  const { stages: stages2 } = await importEdition(parseInt(year, 10), { category: flags.category || 'hommes' });
  const stage2 = stages2.find((s) => s.number === parseInt(stageNumber, 10));
  await generateStage(stage2.id);
  const after = db.prepare('SELECT official_distance_km, generated_distance_km FROM stages WHERE id = ?').get(stage2.id);
  const afterErr = ((after.generated_distance_km - after.official_distance_km) / after.official_distance_km) * 100;
  const ok = Math.abs(afterErr) <= DIST_TOLERANCE_PCT;

  console.log(`\nRésultat VÉRIFIÉ (pipeline réel, pas une estimation du modèle) :`);
  console.log(`  avant : ${before.generated_distance_km != null ? before.generated_distance_km.toFixed(1) : 'n/a'} km (${beforeErr != null ? beforeErr.toFixed(1) : 'n/a'} %)`);
  console.log(`  après : ${after.generated_distance_km.toFixed(1)} km (${afterErr.toFixed(1)} %) ${ok ? 'OK' : '*** TOUJOURS HORS TOLÉRANCE ***'}`);
  console.log(`\nÀ vérifier/sourcer à la main avant de coller dans pipeline/data/historic_routes.json :`);
  console.log(JSON.stringify({ start: existing.start, finish: existing.finish, vias: resolvedVias }, null, 2));
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
