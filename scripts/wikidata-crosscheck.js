'use strict';
// Recoupe pipeline/data/stage_towns.json avec Wikidata (backlog 34.1) :
// villes de départ et d'arrivée placées loin de la ville que Wikidata
// rattache à l'étape (homonyme probable), distances qui divergent de plus de
// 5 %, étapes absentes de Wikidata. Rapport seulement : aucune donnée n'est
// modifiée (CLAUDE.md règle 12, la correction passe par la curation).
//
// Usage : node scripts/wikidata-crosscheck.js [--years 1987,2022-femmes] [--out rapport.json] [--md rapport.md]
//   réseau requis ; une requête par édition, 1,5 s au moins entre deux,
//   réponses gardées en cache disque (--cache <dossier>, par défaut dans le
//   dossier temporaire) pour qu'une relance n'interroge plus le service.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { editionQuery, stagesFromBindings, compareEdition } = require('../pipeline/wikidataTowns');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'EtapeForge-curation/1.0 (https://github.com/Opaland/Tdf-generator)';
const MIN_DELAY_MS = 1500;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

let lastCall = 0;
async function sparql(query, cacheDir) {
  const file = path.join(cacheDir, `${require('crypto').createHash('sha1').update(query).digest('hex')}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastCall + (attempt ? 10000 : MIN_DELAY_MS) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(90000),
    });
    // Une seule nouvelle tentative, 10 s plus tard, sur saturation ou panne.
    if (res.status !== 429 && res.status < 500) break;
  }
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const json = await res.json();
  // Réponse vide : pas mise en cache (un incident passager resterait sinon
  // pour toujours).
  if (json.results?.bindings?.length) fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json'), 'utf8'));
  const wanted = arg('years') ? arg('years').split(',') : Object.keys(doc.editions);
  const cacheDir = arg('cache') || path.join(os.tmpdir(), 'etapeforge-wikidata-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString().slice(0, 10), source: 'Wikidata (CC0), query.wikidata.org', editions: {}, errors: {} };
  for (const key of wanted) {
    const ed = doc.editions[key];
    if (!ed) { report.errors[key] = 'édition absente de stage_towns.json'; continue; }
    const year = key.split('-')[0];
    try {
      const json = await sparql(editionQuery(year, ed.category), cacheDir);
      const wd = stagesFromBindings(json.results?.bindings);
      if (!wd.length) { report.errors[key] = 'aucune étape sur Wikidata'; continue; }
      const findings = compareEdition(key, ed.stages, wd);
      report.editions[key] = { stages: ed.stages.length, wikidataStages: wd.length, findings };
      const towns = findings.filter((f) => f.kind === 'départ' || f.kind === 'arrivée').length;
      console.log(`${key} : ${ed.stages.length} étapes, ${wd.length} sur Wikidata — ${towns} ville(s) à vérifier, ${findings.length - towns} autre(s) écart(s)`);
      for (const f of findings) console.log(`    ${f.where} ${f.kind} : ${f.detail}`);
    } catch (e) {
      report.errors[key] = e.message;
      console.log(`${key} : erreur (${e.message})`);
    }
  }
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 1));
  if (arg('md')) fs.writeFileSync(arg('md'), toMarkdown(report));
}

/** Rapport lisible : pistes à vérifier, jamais des corrections. */
function toMarkdown(report) {
  const all = Object.entries(report.editions).flatMap(([, v]) => v.findings);
  const count = (k) => all.filter((f) => f.kind === k).length;
  const lines = [
    '# Recoupement des villes-étapes avec Wikidata',
    '',
    `Généré le ${report.generatedAt} par \`node scripts/wikidata-crosscheck.js --md\` (backlog 34.1).`,
    `Source : ${report.source}. ${Object.keys(report.editions).length} éditions comparées à \`pipeline/data/stage_towns.json\`.`,
    '',
    '**Ce sont des pistes, pas des corrections.** Un écart vient aussi bien d\'un homonyme',
    'géocodé chez nous que d\'une erreur ou d\'une date décalée sur Wikidata. Chaque',
    'correction passe par la curation, source citée (CLAUDE.md règle 12).',
    '',
    `- Villes à plus de 10 km de la ville Wikidata : ${count('départ')} départs, ${count('arrivée')} arrivées`,
    `- Distances à plus de 5 % (et 1 km) de Wikidata : ${count('distance')}`,
    `- Dates décalées (mêmes villes, autre jour sur Wikidata) : ${count('date')}`,
    `- Étapes sans correspondance (ni mêmes villes à ±2 jours, ni même jour) : ${count('absente')}`,
    '',
    'Appariement : mêmes villes (à 10 km près) le même jour, puis à ±2 jours',
    '(date décalée), puis, à défaut, même jour et distance la plus proche — seul',
    'ce dernier cas peut faire apparaître un homonyme. Une ligne par occurrence :',
    'une ville présente dans deux étapes apparaît deux fois.',
    '',
  ];
  for (const [kind, title] of [['ville', 'Villes'], ['distance', 'Distances'], ['date', 'Dates décalées'], ['absente', 'Étapes sans correspondance']]) {
    const rows = all.filter((f) => (kind === 'ville' ? f.kind === 'départ' || f.kind === 'arrivée' : f.kind === kind));
    if (!rows.length) continue;
    lines.push(`## ${title}`, '', '| Étape | Écart | Confiance actuelle |', '|---|---|---|');
    for (const f of rows) lines.push(`| ${f.where}${kind === 'ville' ? ` (${f.kind})` : ''} | ${f.detail.replace(/\|/g, '\\|')} | ${f.confidence || '—'} |`);
    lines.push('');
  }
  const errs = Object.entries(report.errors);
  if (errs.length) lines.push('## Erreurs', '', ...errs.map(([k, e]) => `- ${k} : ${e}`), '');
  return lines.join('\n');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
