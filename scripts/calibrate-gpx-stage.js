#!/usr/bin/env node
'use strict';
// Backlog #10 section B, chantier « calibrer sur le Tour 2026 » : pour une
// étape dont on a un tracé GPX officiel/fiable (ex. cdn.cyclingstage.com),
// mesure l'écart de distance reconstituée selon la densité de points de
// passage injectés, et recommande le pas le plus grossier qui rentre dans
// la tolérance ±DIST_TOLERANCE_PCT % (pipeline/checks.js) — plutôt que de
// deviner un nombre de vias au hasard.
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
// --named-cols "Col A,Col B" (optionnel) : fusionne ces cols déjà curés
// (kind:'col') dans la liste ré-échantillonnée à chaque pas testé, au lieu
// de les remplacer — sinon on perd le nommage et l'altitude connue
// (known_cols.json) d'un col célèbre au profit de la seule précision de
// distance. Coordonnée reprise telle quelle de known_cols.json si connue
// (jamais re-arrondie — ces valeurs sourcées portent parfois 6-7 décimales),
// sinon géocodée normalement (pipeline/geocode.js). Le col est ensuite situé
// dans la séquence par son point le plus proche sur le tracé GPX brut — ce
// « snap » sert uniquement au tri et au retrait des points ré-échantillonnés
// trop proches (micro-segment redondant), jamais à modifier sa coordonnée.
// Un col dont le snap dépasse 3× --snap-tolerance-km (défaut 2 km, donc 6 km)
// est ignoré avec un avertissement plutôt qu'inséré à un mauvais endroit —
// signe probable d'un géocodage erroné (nom absent de known_cols.json ET
// homonyme sans rapport le plus proche du `near` par défaut).
//
// Usage :
//   node scripts/calibrate-gpx-stage.js <gpx> <officialKm> <year> <stage> \
//     --start "Label:countryCode" --finish "Label:countryCode" \
//     [--category hommes] [--steps 8,4,2] [--out vias.json] \
//     [--named-cols "Col A,Col B"] [--snap-tolerance-km 2]
//
// Exemple (étape 2, Tour 2026, Tarragone → Barcelone, 168,5 km officiels) :
//   node scripts/calibrate-gpx-stage.js stage2.gpx 168.5 2026 2 \
//     --start "Tarragona:spain" --finish "Barcelona:spain" --steps 8,4,2
//
// Exemple avec cols nommés (étape 6, via col d'Aspin et col du Tourmalet) :
//   node scripts/calibrate-gpx-stage.js stage6.gpx 186.2 2026 6 \
//     --start Pau --finish "Gavarnie-Gèdre" --steps 8,4,2 \
//     --named-cols "Col d'Aspin,Col du Tourmalet"

const fs = require('fs');
const path = require('path');
const { DIST_TOLERANCE_PCT } = require('../pipeline/checks');

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
      'Usage: node scripts/calibrate-gpx-stage.js <gpx> <officialKm> <year> <stage> --start "Label:country" --finish "Label:country" [--category hommes] [--steps 8,4,2] [--out vias.json] [--named-cols "Col A,Col B"] [--snap-tolerance-km 2]'
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
  const { resamplePolyline, haversine } = require('../pipeline/geo');
  const { parseGpx } = require('../pipeline/importTrack');
  const { geocodeCol } = require('../pipeline/geocode');
  const KNOWN_COLS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'known_cols.json'), 'utf8'));

  const { points } = parseGpx(fs.readFileSync(gpxPath, 'utf8'));
  console.log(`Points GPX bruts : ${points.length}`);

  const namedCols = flags['named-cols'] ? flags['named-cols'].split(',').map((s) => s.trim()) : [];
  const snapToleranceM = parseFloat(flags['snap-tolerance-km'] || '2') * 1000;

  // Distances cumulées le long du tracé brut (indépendantes du pas testé) :
  // sert à situer chaque col nommé dans la séquence des points ré-échantillonnés.
  let cum = 0;
  const withDist = points.length ? [{ ...points[0], dist: 0 }] : [];
  for (let i = 1; i < points.length; i++) {
    cum += haversine(points[i - 1], points[i]);
    withDist.push({ ...points[i], dist: cum });
  }

  // Résout chaque col nommé une seule fois (indépendant du pas testé) :
  // known_cols.json prioritaire sur le géocodage à la volée, exactement
  // comme reconstructionWaypoints() (pipeline/wikipedia.js) en production —
  // sinon on retombe sur un homonyme déjà connu et déjà corrigé dans ce
  // référentiel (ex. Col du Télégraphe, Savoie vs faux résultat près
  // d'Aix-en-Provence).
  const resolvedCols = [];
  for (const label of namedCols) {
    const known = KNOWN_COLS[label];
    const res = known && known.lat != null
      ? { lat: known.lat, lon: known.lon, source: 'known_cols.json' }
      : await geocodeCol(label, {});
    if (!res || res.lat == null) {
      console.log(`AVERTISSEMENT : ${label} non géocodé, ignoré`);
      continue;
    }
    let best = null;
    let bestD = Infinity;
    for (const p of withDist) {
      const d = haversine(res, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    console.log(`${label} -> ${res.source === 'known_cols.json' ? 'known_cols.json' : 'géocodé'} (${res.lat},${res.lon}), snap à ${(bestD / 1000).toFixed(2)}km du tracé, km ${(best.dist / 1000).toFixed(1)}`);
    if (bestD > snapToleranceM * 3) {
      console.log(`  *** ATTENTION : snap > ${(snapToleranceM * 3 / 1000)}km, probable mauvais géocodage, col ignoré ***`);
      continue;
    }
    resolvedCols.push({ label, lat: res.lat, lon: res.lon, dist: best.dist, roundLat: res.source !== 'known_cols.json' });
  }

  const db = getDb();
  const results = [];
  let bestVias = null;

  for (const stepKm of steps) {
    const resampled = resamplePolyline(points, stepKm * 1000).slice(1, -1);
    const items = resampled.map((p) => ({
      label: `Tracé GPX km ${(p.dist / 1000).toFixed(1)}`,
      kind: 'via',
      lat: Math.round(p.lat * 1e5) / 1e5,
      lon: Math.round(p.lon * 1e5) / 1e5,
      dist: p.dist,
    }));
    for (const col of resolvedCols) {
      // Retire les points RÉ-ÉCHANTILLONNÉS (kind:'via') trop proches, pour
      // éviter un micro-segment redondant — mais jamais un col déjà fusionné
      // (kind:'col') : sans ce garde-fou, deux cols nommés à moins de
      // --snap-tolerance-km l'un de l'autre (double ascension, lacets
      // serrés) se supprimeraient silencieusement entre eux au fil de cette
      // boucle — trouvaille de revue adverse (16/09/2026), non déclenchée
      // sur les étapes déjà curées (tous les cols nommés y sont espacés de
      // plus de 8 km) mais un vrai bug latent pour un usage futur.
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'via' && Math.abs(items[i].dist - col.dist) < snapToleranceM) items.splice(i, 1);
      }
      items.push({
        label: col.label,
        kind: 'col',
        // Ne jamais ré-arrondir une coordonnée déjà sourcée (known_cols.json
        // porte parfois 6-7 décimales) — seules les coordonnées fraîchement
        // géocodées ici sont arrondies à 5 décimales, comme les points GPX.
        lat: col.roundLat ? Math.round(col.lat * 1e5) / 1e5 : col.lat,
        lon: col.roundLat ? Math.round(col.lon * 1e5) / 1e5 : col.lon,
        dist: col.dist,
      });
    }
    items.sort((a, b) => a.dist - b.dist);
    const vias = items.map((it) => ({ label: it.label, kind: it.kind, lat: it.lat, lon: it.lon }));

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
    const ok = Math.abs(err) <= DIST_TOLERANCE_PCT;
    results.push({ stepKm, vias: vias.length, km, err, ok, dtS });
    console.log(
      `pas=${stepKm}km  vias=${vias.length}  généré=${km.toFixed(1)}km  écart=${err.toFixed(1)}%  ${ok ? 'OK' : '*** HORS TOLERANCE ***'}  (${dtS}s)`
    );
    // Le plus GROSSIER des pas testés qui passe (moins de vias à maintenir,
    // moins de requêtes au routeur) : sans la condition `stepKm >
    // bestVias.stepKm`, un pas plus fin testé après un pas plus grossier qui
    // passait déjà écraserait `bestVias` sans raison — trouvaille de revue
    // adverse (16/09/2026) sur la première version de ce script, qui
    // recommandait silencieusement le pas le plus FIN passant la tolérance
    // (le dernier testé dans l'ordre par défaut --steps 8,4,2), l'inverse
    // de ce que le message affiché prétendait.
    if (ok && (!bestVias || stepKm > bestVias.stepKm)) bestVias = { stepKm, vias };
  }

  console.log('');
  if (bestVias) {
    console.log(`Recommandation : pas=${bestVias.stepKm}km (le plus grossier testé qui rentre dans ±${DIST_TOLERANCE_PCT}%).`);
    if (flags.out) {
      fs.writeFileSync(flags.out, JSON.stringify(bestVias.vias, null, 2));
      console.log(`Vias écrits dans ${flags.out} — à coller dans pipeline/data/historic_routes.json.`);
    }
  } else {
    console.log(`Aucun pas testé ne rentre dans la tolérance ±${DIST_TOLERANCE_PCT}% — tester un pas plus fin ou vérifier le GPX/officialKm.`);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
