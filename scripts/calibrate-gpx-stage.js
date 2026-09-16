#!/usr/bin/env node
'use strict';
// Backlog #10 section B, chantier « calibrer sur le Tour 2026 » : pour une
// étape dont on a un tracé GPX officiel/fiable (ex. cdn.cyclingstage.com),
// mesure l'écart de distance reconstituée selon la densité de points de
// passage injectés, et recommande le pas le plus grossier qui rentre dans
// la tolérance ±10 % — plutôt que de deviner un nombre de vias au hasard.
//
// Ce n'est pas un « modèle mathématique » au sens paramétrique (le pipeline
// n'a pas de coefficient à ajuster) : les deux seules causes d'écart connues
// sont (a) des vias trop clairsemés, laissant le routeur couper au plus
// court entre deux points distants, et (b) un mauvais géocodage. Ce script
// calibre uniquement (a), en réutilisant le mécanisme déjà en place pour
// 2026/1 (vias "Tracé GPX km X.X" avec lat/lon explicites, voir
// pipeline/data/historic_routes.json) plutôt que d'en inventer un nouveau.
//
// Nécessite un accès réseau réel (géocodage + routage à chaque étape testée
// — un ré-import complet de l'édition par pas testé, voir plus bas) :
// volontairement hors de `npm test`, à lancer à part avec `npm run
// calibrate-gpx`, même logique que scripts/parity-check.js.
//
// Usage :
//   node scripts/calibrate-gpx-stage.js <gpx> <officialKm> <year> <stage> \
//     --start "Label:countryCode" --finish "Label:countryCode" \
//     [--category hommes] [--steps 8,4,2] [--out vias.json]
//
// Exemple (étape 2, Tour 2026, Tarragone → Barcelone, 168,5 km officiels) :
//   node scripts/calibrate-gpx-stage.js stage2.gpx 168.5 2026 2 \
//     --start "Tarragona:spain" --finish "Barcelona:spain" --steps 8,4,2

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function parseLabelCountry(s, fallbackLabel) {
  if (!s) return { label: fallbackLabel };
  const [label, country] = s.split(':');
  return country ? { label, country } : { label };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [gpxPath, officialKmStr, yearStr, stageStr] = positional;
  if (!gpxPath || !officialKmStr || !yearStr || !stageStr) {
    console.error(
      'Usage: node scripts/calibrate-gpx-stage.js <gpx> <officialKm> <year> <stage> --start "Label:country" --finish "Label:country" [--category hommes] [--steps 8,4,2] [--out vias.json]'
    );
    process.exit(1);
  }
  const officialKm = parseFloat(officialKmStr);
  const year = String(parseInt(yearStr, 10));
  const stageNumber = String(parseInt(stageStr, 10));
  const category = flags.category || 'hommes';
  const steps = (flags.steps || '8,4,2').split(',').map((s) => parseFloat(s.trim()));
  const startLC = parseLabelCountry(flags.start);
  const finishLC = parseLabelCountry(flags.finish);
  if (!startLC.label || !finishLC.label) {
    console.error('--start et --finish sont requis, format "Label:countryCode"');
    process.exit(1);
  }

  // Base de données isolée dédiée à la calibration — ne touche jamais la
  // base réelle ni pipeline/data/historic_routes.json (mutation en mémoire
  // seulement, voir plus bas).
  const dataDir = path.join(require('os').tmpdir(), `etapeforge-calibrate-${Date.now()}`);
  process.env.ETAPEFORGE_DATA_DIR = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });

  const { getDb } = require('../backend/db');
  const { importEdition } = require('../pipeline/importer');
  const { generateStage } = require('../pipeline/generate');
  const wp = require('../pipeline/wikipedia');
  const { resamplePolyline } = require('../pipeline/geo');
  const { parseGpx } = require('../pipeline/importTrack');

  const { points } = parseGpx(fs.readFileSync(gpxPath, 'utf8'));
  console.log(`Points GPX bruts : ${points.length}`);

  const db = getDb();
  const results = [];
  let bestVias = null;

  for (const stepKm of steps) {
    const resampled = resamplePolyline(points, stepKm * 1000).slice(1, -1);
    const vias = resampled.map((p) => ({
      label: `Tracé GPX km ${(p.dist / 1000).toFixed(1)}`,
      kind: 'via',
      lat: Math.round(p.lat * 1e5) / 1e5,
      lon: Math.round(p.lon * 1e5) / 1e5,
    }));

    // reconstructionWaypoints() (pipeline/wikipedia.js) n'est consultée
    // qu'AU MOMENT DE L'IMPORT (pipeline/importer.js) : les waypoints sont
    // ensuite figés dans la table `waypoints`. Il faut donc ré-importer
    // l'édition entière (DELETE + INSERT, nouveaux stage_id à chaque fois)
    // après chaque mise à jour de HISTORIC_ROUTES pour que le nouveau jeu
    // de vias soit effectivement pris en compte par generateStage().
    wp.HISTORIC_ROUTES[year] = wp.HISTORIC_ROUTES[year] || { stages: {} };
    wp.HISTORIC_ROUTES[year].stages[stageNumber] = { start: startLC, finish: finishLC, vias };

    const t0 = Date.now();
    const { stages } = await importEdition(parseInt(year, 10), { category });
    const stage = stages.find((s) => s.number === parseInt(stageNumber, 10));
    if (!stage) throw new Error(`Étape ${stageNumber} introuvable après import de ${year}`);
    await generateStage(stage.id);
    const dtS = ((Date.now() - t0) / 1000).toFixed(1);

    const row = db.prepare('SELECT generated_distance_km FROM stages WHERE id = ?').get(stage.id);
    const km = row.generated_distance_km;
    const err = ((km - officialKm) / officialKm) * 100;
    const ok = Math.abs(err) <= 10;
    results.push({ stepKm, vias: vias.length, km, err, ok, dtS });
    console.log(
      `pas=${stepKm}km  vias=${vias.length}  généré=${km.toFixed(1)}km  écart=${err.toFixed(1)}%  ${ok ? 'OK' : '*** HORS TOLERANCE ***'}  (${dtS}s)`
    );
    // Le plus GROSSIER des pas testés qui passe (moins de vias à maintenir,
    // moins de requêtes au routeur) : sans la condition `stepKm >
    // bestVias.stepKm`, un pas plus fin testé après un pas plus grossier qui
    // passait déjà écraserait `bestVias` sans raison — trouvaille de revue
    // adverse (25/08/2026) sur la première version de ce script, qui
    // recommandait silencieusement le pas le plus FIN passant la tolérance
    // (le dernier testé dans l'ordre par défaut --steps 8,4,2), l'inverse
    // de ce que le message affiché prétendait.
    if (ok && (!bestVias || stepKm > bestVias.stepKm)) bestVias = { stepKm, vias };
  }

  console.log('');
  if (bestVias) {
    console.log(`Recommandation : pas=${bestVias.stepKm}km (le plus grossier testé qui rentre dans ±10%).`);
    if (flags.out) {
      fs.writeFileSync(flags.out, JSON.stringify(bestVias.vias, null, 2));
      console.log(`Vias écrits dans ${flags.out} — à coller dans pipeline/data/historic_routes.json.`);
    }
  } else {
    console.log('Aucun pas testé ne rentre dans la tolérance ±10% — tester un pas plus fin ou vérifier le GPX/officialKm.');
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
