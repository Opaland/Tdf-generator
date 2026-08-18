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
const { importEdition } = require('../pipeline/importer');

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
  console.log('\n■ Démo 2 — édition historique 1903 : import + reconstruction des 6 étapes');
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
  check('Étape 1 : écart de reconstitution affiché et ≤ 25 %', Math.abs(delta1) <= 25,
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
  console.log('\n■ Démo 3 — carte globale du Tour 1903 complet');
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

async function main() {
  console.log(`ÉtapeForge — démo de validation ${isOffline() ? '(mode hors-ligne : simulateur déterministe)' : '(mode en ligne : APIs réelles)'}`);
  const db = getDb();
  await demoStagePauHautacam(db);
  const edition = await demo1903(db);
  await demoTourMap(db, edition);

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
