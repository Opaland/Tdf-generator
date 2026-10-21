#!/usr/bin/env node
'use strict';
// Epic 17 (story 17.1/17.2) — CLAUDE.md règle 9 : la pagination de
// /api/stages et /api/climbs ne se décide pas sur une intuition. Ce script
// construit une base à l'échelle du catalogue complet visé (~2 200 étapes,
// .github/workflows/pages.yml) avec le simulateur hors-ligne, puis
// chronomètre les routes qui lisent toute une table et mesure la taille du
// fichier SQLite. Rien n'est optimisé ici : on mesure d'abord.
//
// Usage : node scripts/scale-bench.js [--editions 110] [--stages 20]
// Isolation par process (CLAUDE.md règle 4) : base temporaire dédiée.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { removeSync } = require('../pipeline/fsPortable');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  const n = i !== -1 ? parseInt(process.argv[i + 1], 10) : def;
  return Number.isFinite(n) && n > 0 ? n : def;
};
const EDITIONS = arg('--editions', 110);
const STAGES = arg('--stages', 20);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-scale-'));
process.env.ETAPEFORGE_DATA_DIR = dataDir;
process.env.ETAPEFORGE_OFFLINE = '1';

const { getDb, DB_PATH } = require('../backend/db');
const { generateStage } = require('../pipeline/generate');

// Générateur pseudo-aléatoire déterministe (mêmes étapes à chaque exécution).
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

async function build() {
  const db = getDb();
  const insEd = db.prepare('INSERT INTO editions (year, name) VALUES (?, ?)');
  const insSt = db.prepare('INSERT INTO stages (edition_id, stage_order, name, state) VALUES (?, ?, ?, ?)');
  const insWp = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon) VALUES (?, ?, ?, ?, ?, ?)');
  const ids = [];
  for (let e = 0; e < EDITIONS; e++) {
    const edId = insEd.run(1903 + e, `Édition synthétique ${1903 + e}`).lastInsertRowid;
    for (let s = 1; s <= STAGES; s++) {
      const id = insSt.run(edId, s, `Étape ${s}`, 'draft').lastInsertRowid;
      // 5 points sur ~150-200 km en France métropolitaine, dont un col.
      let lat = 43.5 + rnd() * 5, lon = -0.5 + rnd() * 6.5;
      for (let w = 0; w < 5; w++) {
        const kind = w === 0 ? 'start' : w === 4 ? 'finish' : w === 3 ? 'col' : 'via';
        insWp.run(id, w, `P${w}`, kind, lat, lon);
        lat += (rnd() - 0.5) * 0.6; lon += 0.25 + rnd() * 0.3;
      }
      ids.push(id);
    }
  }
  const t0 = Date.now();
  for (const [i, id] of ids.entries()) {
    await generateStage(id);
    if ((i + 1) % 200 === 0) process.stderr.write(`  ${i + 1}/${ids.length} étapes générées (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  return ids;
}

async function measure(ids) {
  const { app } = require('../backend/server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const edId = getDb().prepare('SELECT id FROM editions LIMIT 1').get().id;
  const routes = [
    '/api/stages', '/api/climbs', '/api/editions', `/api/editions/${edId}`, `/api/editions/${edId}/mapdata`,
    `/api/stages/${ids[0]}`, `/api/stages/${ids[0]}/similar`, '/api/traces/summary',
  ];
  const rows = [];
  for (const r of routes) {
    const times = [];
    let bytes = 0;
    for (let k = 0; k < 5; k++) {
      const t = process.hrtime.bigint();
      const res = await fetch(base + r);
      const body = await res.arrayBuffer();
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
      bytes = body.byteLength;
    }
    times.sort((a, b) => a - b);
    rows.push({ route: r, median_ms: Math.round(times[2]), max_ms: Math.round(times[4]), kb: Math.round(bytes / 1024) });
  }
  server.close();
  return rows;
}

(async () => {
  const t0 = Date.now();
  const ids = await build();
  const buildS = (Date.now() - t0) / 1000;
  const rows = await measure(ids);
  getDb().pragma('wal_checkpoint(TRUNCATE)');
  const mb = fs.statSync(DB_PATH).size / 1024 / 1024;
  console.log(`Base : ${ids.length} étapes (${EDITIONS} éditions × ${STAGES}), générées en ${buildS.toFixed(0)} s, fichier SQLite ${mb.toFixed(1)} Mo (${(mb * 1024 / ids.length).toFixed(1)} Ko/étape)`);
  console.table(rows);
  removeSync(dataDir);
})().catch((e) => {
  console.error(e);
  removeSync(dataDir);
  process.exit(1);
});
