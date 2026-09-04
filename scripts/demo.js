#!/usr/bin/env node
'use strict';
// Démo de validation finale — générée ET vérifiée automatiquement :
//   1. Étape créée : Pau → Hautacam via Lourdes, col du Soulor, Argelès-Gazost
//      (Soulor et Hautacam détectés et catégorisés).
//   2. Étape historique : Paris (Montgeron) → Lyon, édition 1903 — distance
//      officielle 467 km, écart de reconstitution affiché, col du Pin-Bouchain
//      détecté (étape 1) ; col de la République détecté (étape 2, Lyon → Marseille).
//   3. Carte globale du Tour 1903 complet (6 étapes générées).
//
// Par défaut la démo tourne en mode HORS-LIGNE (simulateur déterministe) pour être
// reproductible partout ; `node scripts/demo.js --online` utilise les vraies APIs
// (Géoplateforme, OSRM, opentopodata, Wikipédia) avec cache SQLite et rate limits.

const { setOffline, isOffline } = require('../pipeline/http');
if (!process.argv.includes('--online')) setOffline(true);

const { getDb } = require('../backend/db');
const { generateStage, loadStageFull } = require('../pipeline/generate');
const { importEdition, importAllEditions } = require('../pipeline/importer');
const { DIST_TOLERANCE_PCT } = require('../pipeline/checks');

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
}

function progress() {
  let last = '';
  return (p) => {
    const line = `    [${p.step}] ${p.detail || ''} ${p.percent != null ? p.percent + '%' : ''}`;
    if (line !== last) { process.stdout.write(line + '\r\n'); last = line; }
  };
}

async function demoStagePauHautacam(db) {
  console.log('\n■ Démo 1 — étape créée : Pau → Hautacam (~montagne, via Lourdes, Soulor, Argelès-Gazost)');
  const existing = db.prepare(`SELECT id FROM stages WHERE name = 'Pau → Hautacam (démo)'`).get();
  if (existing) db.prepare('DELETE FROM stages WHERE id = ?').run(existing.id);
  // Tour personnalisé « Démo » : permet à la carte globale et à la vitrine
  // statique d'inclure aussi l'étape créée.
  let demoEd = db.prepare(`SELECT id FROM editions WHERE name = 'Démo ÉtapeForge'`).get();
  if (!demoEd) {
    demoEd = { id: db.prepare(`INSERT INTO editions (name, is_custom) VALUES ('Démo ÉtapeForge', 1)`).run().lastInsertRowid };
  }
  const r = db
    .prepare(`INSERT INTO stages (name, stage_type, status, state, edition_id, stage_order)
              VALUES ('Pau → Hautacam (démo)', 'montagne', 'démo de validation', 'draft', ?, 1)`)
    .run(demoEd.id);
  const id = r.lastInsertRowid;
  const wps = [
    ['Pau', 'start'], ['Lourdes', 'via'], ['Col du Soulor', 'col'],
    ['Argelès-Gazost', 'via'], ['Hautacam', 'col'],
  ];
  const ins = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind) VALUES (?,?,?,?)');
  wps.forEach((w, i) => ins.run(id, i, w[0], w[1]));

  const full = await generateStage(id, { onProgress: progress() });
  const climbNames = full.climbs.map((c) => `${c.name} (cat. ${c.category})`).join(', ');
  console.log(`  → ${full.stage.generated_distance_km} km, D+ ${full.stage.total_ascent_m} m ; côtes : ${climbNames || 'aucune'}`);

  const soulor = full.climbs.find((c) => /soulor/i.test(c.name));
  const hautacam = full.climbs.find((c) => /hautacam/i.test(c.name));
  check('Col du Soulor détecté et catégorisé', !!soulor && !!soulor.category,
    soulor ? `cat. ${soulor.category}, ${soulor.length_km} km à ${soulor.avg_gradient} %, sommet ${soulor.summit_ele_m} m` : 'non détecté');
  check('Hautacam détecté et catégorisé', !!hautacam && !!hautacam.category,
    hautacam ? `cat. ${hautacam.category}, ${hautacam.length_km} km à ${hautacam.avg_gradient} %, sommet ${hautacam.summit_ele_m} m` : 'non détecté');
  check('Audits qualité sans échec', full.stage.checks && full.stage.checks.ok);
  return id;
}

async function demo1903(db) {
  console.log('\n■ Démo 3 — édition historique 1903 : import + reconstruction des 6 étapes');
  const { edition, stages } = await importEdition(1903, { onProgress: progress() });
  check('Import 1903 : 6 étapes', stages.length === 6, `${stages.length} étapes importées`);

  for (const s of stages) {
    console.log(`  ▶ ${s.name} (officiel : ${s.distanceKm} km)`);
    await generateStage(s.id, { onProgress: () => {} });
    const f = loadStageFull(s.id);
    const delta = ((f.stage.generated_distance_km - f.stage.official_distance_km) / f.stage.official_distance_km) * 100;
    console.log(`    reconstitution : ${f.stage.generated_distance_km} km (écart ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)`);
  }

  const st1 = db.prepare('SELECT id FROM stages WHERE edition_id = ? AND stage_order = 1').get(edition.id);
  const full1 = loadStageFull(st1.id);
  check('Étape 1 : distance officielle 467 km', full1.stage.official_distance_km === 467);
  const delta1 = ((full1.stage.generated_distance_km - 467) / 467) * 100;
  check(`Étape 1 : écart de reconstitution affiché et ≤ ${DIST_TOLERANCE_PCT} %`, Math.abs(delta1) <= DIST_TOLERANCE_PCT,
    `officielle 467 km / reconstitution ${full1.stage.generated_distance_km} km (${delta1 >= 0 ? '+' : ''}${delta1.toFixed(1)} %)`);
  // Étape 1 : col du Pin-Bouchain (759 m, entre Tarare et Roanne) — tout premier
  // col franchi dans l'histoire du Tour. Le col de la République (1 161 m,
  // premier col > 1000 m) est franchi à l'étape 2, pas ici.
  const pinBouchain = full1.climbs.find((c) => /pin.bouchain/i.test(c.name));
  check('Col du Pin-Bouchain détecté (étape 1)', !!pinBouchain,
    pinBouchain ? `cat. ${pinBouchain.category}, ${pinBouchain.length_km} km à ${pinBouchain.avg_gradient} %, sommet ${pinBouchain.summit_ele_m} m` : 'non détecté');

  const st2 = db.prepare('SELECT id FROM stages WHERE edition_id = ? AND stage_order = 2').get(edition.id);
  const full2 = loadStageFull(st2.id);
  const republique = full2.climbs.find((c) => /r[ée]publique/i.test(c.name));
  check('Col de la République détecté (étape 2)', !!republique,
    republique ? `cat. ${republique.category}, ${republique.length_km} km à ${republique.avg_gradient} %, sommet ${republique.summit_ele_m} m` : 'non détecté');
  return edition;
}

async function demoTourMap(db, edition) {
  console.log('\n■ Démo 4 — carte globale du Tour 1903 complet');
  const stages = db.prepare(`SELECT id, state FROM stages WHERE edition_id = ? ORDER BY stage_order`).all(edition.id);
  const done = stages.filter((s) => s.state === 'done');
  check('6 étapes générées avec tracé', done.length === 6, `${done.length}/6`);
  let tracks = 0;
  for (const s of stages) {
    const f = loadStageFull(s.id);
    if (f.track && f.track.geojson.geometry.coordinates.length > 100 && f.samples.length > 100) tracks++;
  }
  check('Tracés et profils présents pour la carte globale', tracks === 6, `${tracks}/6`);
  console.log('  → ouvrir http://localhost:4567/tour.html (sélectionner « Tour de France 1903 »)');
}

// Import en masse de toutes les éditions (1903 → 2026, hors guerres
// mondiales) — volontairement HORS-LIGNE UNIQUEMENT : en mode --online ce
// serait ~113 requêtes Wikipédia réelles séquentielles rien que pour cette
// démo (respect du rate limit existant, minDelayMs 600 ms), coûteux et hors
// de proportion pour une démo de validation qui tourne aussi en CI
// (demo-online.yml) — l'import d'une seule année (demo1903 ci-dessus) suffit
// à vérifier le chemin réseau réel. Ici, seules les années avec une fixture
// locale (pipeline/fixtures/) peuvent réussir hors-ligne ; les autres
// échouent proprement (pas de données historiques inventées pour les
// combler) — ce test vérifie justement que l'échec est propre, pas masqué.
async function demoImportAll() {
  console.log('\n■ Démo 2 — import en masse : toutes les éditions 1903 → 2026 (hors guerres mondiales)');
  const { total, imported, failed } = await importAllEditions({
    onProgress: (p) => {
      if (p.index === 1 || p.index % 25 === 0 || p.index === p.total) {
        process.stdout.write(`    [import-masse] ${p.index}/${p.total} années tentées\r\n`);
      }
    },
  });
  console.log(`  → ${imported.length}/${total} importées (fixtures locales), ${failed.length} sans fixture hors-ligne`);
  check('Import en masse : parcourt toutes les années sans planter', total === imported.length + failed.length,
    `${total} années tentées`);
  check('Import en masse : les années avec fixture locale réussissent', imported.length >= 3,
    `importées : ${imported.map((i) => i.year).join(', ')}`);
  check('Import en masse : les années sans fixture échouent proprement (pas de donnée inventée)',
    failed.length > 0 && failed.every((f) => /fixture/i.test(f.error)),
    failed.length ? `ex. ${failed[0].year} : ${failed[0].error}` : 'aucun échec — inattendu hors-ligne');
}

// Chantier L, "CI de vérification croisée périodique" : demo1903 n'exerce
// en pratique que les services français (Géoplateforme, OSRM) — sa route
// entière est en France. Nominatim et opentopodata ("hors France") n'étaient
// donc jamais sondés par demo-online.yml (job nightly, --online, sans repli —
// backlog issue #10, section F), seulement disponibles à la demande via
// /api/diagnostic (page /diag.html, pour un humain). Réutilise les mêmes
// sondes (pipeline/diagnostic.js) pour que les 6 hôtes externes du projet
// soient vérifiés automatiquement, pas seulement ceux qu'une route française
// touche par accident.
async function demoDiagnostic() {
  console.log('\n■ Démo 5 — diagnostic de connectivité (6 sondes, hors France comprises)');
  const { runDiagnostic } = require('../pipeline/diagnostic');
  const { results } = await runDiagnostic();
  for (const r of results) check(`Diagnostic : ${r.name}`, r.ok, `${r.detail} (${r.ms} ms)`);
}

async function main() {
  console.log(`ÉtapeForge — démo de validation ${isOffline() ? '(mode hors-ligne : simulateur déterministe)' : '(mode en ligne : APIs réelles)'}`);
  const db = getDb();
  await demoStagePauHautacam(db);
  // Import en masse AVANT demo1903 : importEdition(1903) y écrase l'édition
  // (docstring pipeline/importer.js) — dans l'autre sens, l'import en masse
  // aurait réinitialisé les 6 étapes 1903 à l'état 'draft' juste après leur
  // génération par demo1903/demoTourMap, contredisant l'invite finale à
  // ouvrir tour.html sur une édition en fait non générée.
  if (isOffline()) await demoImportAll();
  const edition = await demo1903(db);
  await demoTourMap(db, edition);
  // Diagnostic réseau réel uniquement : runDiagnostic() ignore ETAPEFORGE_OFFLINE
  // et appelle toujours les vraies APIs — l'exécuter hors ligne romprait la
  // garantie "npm run demo par défaut ne touche jamais le réseau".
  if (!isOffline()) await demoDiagnostic();

  const fails = results.filter((r) => !r.ok);
  console.log(`\n═══ Bilan : ${results.length - fails.length}/${results.length} vérifications OK ═══`);
  if (fails.length) {
    for (const f of fails) console.log(`  ✗ ${f.label}`);
    process.exit(1);
  }
  console.log('Démo complète. Lancez `npm start` puis ouvrez http://localhost:4567');
}

main().catch((err) => {
  console.error('Échec de la démo :', err.message);
  process.exit(1);
});
