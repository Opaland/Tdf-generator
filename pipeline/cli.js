#!/usr/bin/env node
'use strict';
// CLI du pipeline :
//   npm run generate -- --stage 12            # (re)génère l'étape 12
//   npm run generate -- --edition 1903        # importe puis génère toute l'édition
//   npm run generate -- --import 1903         # import seul (pas de génération)
//   Options : --offline (simulateur), --force (regénère même si déjà 'done')

const { getDb } = require('../backend/db');
const { setOffline, isOffline } = require('./http');
const { generateStage } = require('./generate');
const { importEdition } = require('./importer');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function progressPrinter() {
  let lastLine = '';
  return (p) => {
    const line = `  [${p.step}] ${p.detail || ''} ${p.percent != null ? p.percent + '%' : ''}`;
    if (line !== lastLine) {
      process.stdout.write(line + '\n');
      lastLine = line;
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.offline) setOffline(true);
  const db = getDb();

  if (args.import) {
    const year = args.import === true ? args._[0] : args.import;
    const res = await importEdition(year, { onProgress: progressPrinter() });
    console.log(`✔ Édition ${year} importée : ${res.stages.length} étapes (edition_id=${res.edition.id})`);
    return;
  }

  if (args.stage) {
    const id = parseInt(args.stage, 10);
    console.log(`Génération de l'étape ${id}${isOffline() ? ' (mode hors-ligne : simulateur)' : ''}…`);
    const full = await generateStage(id, { onProgress: progressPrinter() });
    printStageSummary(full);
    return;
  }

  if (args.edition) {
    const year = parseInt(args.edition, 10);
    let edition = db.prepare('SELECT * FROM editions WHERE year = ?').get(year);
    if (!edition) {
      console.log(`Édition ${year} absente : import depuis Wikipédia…`);
      const res = await importEdition(year, { onProgress: progressPrinter() });
      edition = res.edition;
    }
    const stages = db
      .prepare('SELECT id, name, state FROM stages WHERE edition_id = ? ORDER BY stage_order')
      .all(edition.id);
    console.log(`Édition ${year} : ${stages.length} étapes${isOffline() ? ' (mode hors-ligne : simulateur)' : ''}`);
    for (const s of stages) {
      if (s.state === 'done' && !args.force) {
        console.log(`— ${s.name} : déjà générée (--force pour regénérer)`);
        continue;
      }
      console.log(`▶ ${s.name}`);
      const full = await generateStage(s.id, { onProgress: progressPrinter() });
      printStageSummary(full);
    }
    return;
  }

  console.log(
    `Usage :
  node pipeline/cli.js --stage <id> [--offline]
  node pipeline/cli.js --edition <année> [--offline] [--force]
  node pipeline/cli.js --import <année> [--offline]`
  );
}

function printStageSummary(full) {
  const st = full.stage;
  console.log(`✔ ${st.name} : ${st.generated_distance_km} km, D+ ${st.total_ascent_m} m`);
  if (st.official_distance_km) {
    const delta = ((st.generated_distance_km - st.official_distance_km) / st.official_distance_km) * 100;
    console.log(
      `  distance officielle ${st.official_distance_km} km / reconstitution ${st.generated_distance_km} km (écart ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)`
    );
  }
  for (const c of full.climbs) {
    console.log(
      `  ⛰ ${c.name} — cat. ${c.category} — km ${c.start_km}→${c.end_km} — ${c.length_km} km à ${c.avg_gradient} % (sommet ${c.summit_ele_m} m)`
    );
  }
  const checks = st.checks;
  if (checks) {
    for (const item of checks.items) {
      const icon = item.status === 'ok' ? '✓' : item.status === 'warn' ? '⚠' : '✗';
      console.log(`  ${icon} ${item.label} : ${item.detail}`);
    }
  }
}

main().catch((err) => {
  console.error('Erreur :', err.message);
  process.exit(1);
});
