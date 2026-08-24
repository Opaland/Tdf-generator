#!/usr/bin/env node
'use strict';
// Sprint 9 — CLAUDE.md règle 9 : « si une phrase de commit, de PR ou de doc
// affirme quelque chose sur la performance, soit une commande le prouve,
// soit la phrase se reformule en hypothèse. » Personne n'avait encore
// chronométré pipeline/generate.js : ce script mesure, phase par phase, sans
// rien optimiser (le but est de savoir s'il y a un point chaud réel avant
// d'y toucher — voir docs/PERF-PIPELINE.md pour les résultats interprétés).
//
// Mode hors-ligne forcé (ETAPEFORGE_OFFLINE) : reproductible dans le
// sandbox, sans dépendre de la latence réseau des vraies APIs (qui mesurerait
// le réseau, pas le pipeline). Vérifié en lisant pipeline/http.js : le seul
// `sleep()` du module sert au backoff des vraies requêtes réseau — le
// simulateur hors-ligne (pipeline/geocode.js) n'a aucun délai artificiel.
//
// Usage : node scripts/benchmark.js [--runs N]  (par défaut 5)

const os = require('os');
const path = require('path');
const fs = require('fs');

const RUNS = (() => {
  const i = process.argv.indexOf('--runs');
  const n = i !== -1 ? parseInt(process.argv[i + 1], 10) : 5;
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

// Isolation par process (CLAUDE.md règle 4, même raison que scripts/monkey.js) :
// backend/db.js met sa connexion en cache au premier require(), liée à
// ETAPEFORGE_DATA_DIR — fixé une seule fois ici, jamais réassigné en cours de
// route dans ce process.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-bench-'));
process.env.ETAPEFORGE_DATA_DIR = dataDir;

const { setOffline } = require('../pipeline/http');
setOffline(true);

const { getDb } = require('../backend/db');
const { generateStage } = require('../pipeline/generate');
const { importEdition } = require('../pipeline/importer');

function createStage(db, name, waypoints) {
  const r = db
    .prepare(`INSERT INTO stages (name, stage_type, status, state, stage_order) VALUES (?, 'montagne', 'bench', 'draft', 1)`)
    .run(name);
  const id = r.lastInsertRowid;
  const ins = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind) VALUES (?,?,?,?)');
  waypoints.forEach((w, i) => ins.run(id, i, w[0], w[1]));
  return id;
}

// Ordre des étapes de progression émises par generateStage() (pipeline/generate.js) —
// 'terminé' n'est pas un step réel de la boucle, il marque juste la fin (audits +
// persistance SQLite, qui n'émettent pas de progress dédié).
const PHASE_ORDER = ['géocodage', 'routage', 'altimétrie', 'côtes', 'analyse', 'terminé'];

async function timeGeneration(stageId) {
  const marks = {};
  const t0 = process.hrtime.bigint();
  await generateStage(stageId, {
    onProgress(p) {
      if (!(p.step in marks)) marks[p.step] = process.hrtime.bigint();
    },
  });
  marks.terminé = process.hrtime.bigint();
  const ms = (a, b) => Number(b - a) / 1e6;
  const deltas = {};
  let prev = t0;
  for (const step of PHASE_ORDER) {
    if (marks[step] == null) continue;
    deltas[step] = ms(prev, marks[step]);
    prev = marks[step];
  }
  return { totalMs: ms(t0, marks.terminé), deltas };
}

function summarize(label, runs) {
  const avgTotal = runs.reduce((s, r) => s + r.totalMs, 0) / runs.length;
  console.log(`\n■ ${label} — moyenne sur ${runs.length} run(s) : ${avgTotal.toFixed(1)} ms`);
  const phaseAvg = {};
  for (const step of PHASE_ORDER) {
    const vals = runs.map((r) => r.deltas[step]).filter((v) => v != null);
    if (vals.length) phaseAvg[step] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  for (const [step, avgMs] of Object.entries(phaseAvg)) {
    const pct = ((avgMs / avgTotal) * 100).toFixed(0);
    console.log(`    ${step.padEnd(12)} ${avgMs.toFixed(1).padStart(8)} ms  (${pct}%)`);
  }
  return { label, avgTotalMs: avgTotal, phaseAvg };
}

const SYNTHETIC_SCENARIOS = [
  { name: 'plat court, 2 waypoints (Paris → Chartres)', waypoints: [['Paris', 'start'], ['Chartres', 'finish']] },
  {
    name: 'montagne, 5 waypoints dont 2 cols (Pau → Hautacam)',
    waypoints: [['Pau', 'start'], ['Lourdes', 'via'], ['Col du Soulor', 'col'], ['Argelès-Gazost', 'via'], ['Hautacam', 'col']],
  },
  {
    name: 'longue étape, 8 waypoints (Paris → Toulouse)',
    waypoints: [
      ['Paris', 'start'], ['Orléans', 'via'], ['Tours', 'via'], ['Poitiers', 'via'],
      ['Angoulême', 'via'], ['Périgueux', 'via'], ['Brive-la-Gaillarde', 'via'], ['Toulouse', 'finish'],
    ],
  },
];

async function main() {
  const db = getDb();
  console.log(`Benchmark pipeline/generate.js — mode hors-ligne (simulateur), ${RUNS} run(s)/scénario`);
  console.log(`Dossier de données temporaire : ${dataDir}`);

  const results = [];

  for (const scenario of SYNTHETIC_SCENARIOS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const id = createStage(db, `${scenario.name} #${i}`, scenario.waypoints);
      runs.push(await timeGeneration(id));
    }
    results.push(summarize(scenario.name, runs));
  }

  // Cas réel (backlog #10 section B) : édition 1903 importée depuis le
  // simulateur hors-ligne, étape 1 Paris → Lyon (467 km officiels) — même
  // scénario que scripts/demo.js, waypoints d'époque réels au lieu de
  // synthétiques.
  const { stages } = await importEdition(1903, { onProgress: () => {} });
  const historic = stages[0];
  // Régénère la même étape à chaque run (état déjà "done" après le 1er) —
  // pas une redondance : generateStage() DELETE + ré-INSERT les tables
  // dépendantes à chaque appel (voir pipeline/generate.js), donc chaque run
  // mesure une régénération complète, pas un no-op.
  const historicRuns = [];
  for (let i = 0; i < RUNS; i++) historicRuns.push(await timeGeneration(historic.id));
  results.push(summarize(`historique réel : ${historic.name} (${historic.distanceKm} km officiels)`, historicRuns));

  console.log(`\n${'='.repeat(60)}`);
  const slowest = results.reduce((a, b) => (b.avgTotalMs > a.avgTotalMs ? b : a));
  const slowestPhaseOverall = Object.entries(slowest.phaseAvg).reduce((a, b) => (b[1] > a[1] ? b : a));
  console.log(`Scénario le plus lent : ${slowest.label} (${slowest.avgTotalMs.toFixed(1)} ms)`);
  console.log(`Phase la plus coûteuse dans ce scénario : ${slowestPhaseOverall[0]} (${slowestPhaseOverall[1].toFixed(1)} ms)`);
  console.log(`\nRésultats bruts (JSON) :`);
  console.log(JSON.stringify(results, null, 2));

  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('ÉCHEC benchmark.js :', err);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
