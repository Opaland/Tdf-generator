#!/usr/bin/env node
'use strict';
// Démo SPÉCULATIVE — Tour de France 2027 (parcours HYPOTHÉTIQUE, non officiel).
//
// Aucune étape du Tour 2027 n'est annoncée à ce jour : l'ASO présente
// habituellement le parcours de l'année N+1 en octobre de l'année N, donc
// rien d'officiel n'existe encore. Les deux étapes ci-dessous reprennent un
// parcours imaginé à titre d'exercice (projet externe « tdf2027 »,
// reconstruction déclarée « NON OFFICIELLE » par ses propres auteurs) choisi
// ici pour son intérêt algorithmique plutôt que pour son exactitude :
//   - étape 1, Édimbourg → Carlisle : géocodage hors France (repli Nominatim),
//     aucune donnée IGN disponible sur ce tronçon ;
//   - étape 19, Val-d'Isère → Sestriere : franchissement de frontière
//     France → Italie, avec le col de l'Iseran (2 764 m), le col du
//     Mont-Cenis (2 081 m) et la Colle delle Finestre (2 178 m, ascension en
//     partie non goudronnée) — un bon test du garde-fou « col difficilement
//     routable → interpolation pied-sommet, marquée approximée ».
//
// Contrairement à `scripts/demo.js`, ce script ne tourne qu'en mode EN LIGNE
// (aucune couverture Royaume-Uni/Italie dans le simulateur hors-ligne) et
// n'est pas un test de non-régression : `npm test` / `npm run demo` restent
// les garde-fous qui doivent passer avant tout commit.

const { setOffline, isOffline } = require('../pipeline/http');
if (!process.argv.includes('--online')) {
  console.error(
    'Cette démo spéculative nécessite un accès réseau réel : relancez avec\n' +
      '  node scripts/demo-2027.js --online\n' +
      '(aucune couverture Royaume-Uni/Italie dans le simulateur hors-ligne).'
  );
  process.exit(1);
}
setOffline(false);

const { getDb } = require('../backend/db');
const { generateStage, loadStageFull } = require('../pipeline/generate');

function progress() {
  let last = '';
  return (p) => {
    const line = `    [${p.step}] ${p.detail || ''} ${p.percent != null ? p.percent + '%' : ''}`;
    if (line !== last) { process.stdout.write(line + '\r\n'); last = line; }
  };
}

function ensureEdition(db) {
  let ed = db.prepare(`SELECT id FROM editions WHERE name = 'Tour de France 2027 (parcours hypothétique)'`).get();
  if (ed) return ed.id;
  return db
    .prepare(
      `INSERT INTO editions (name, is_custom) VALUES ('Tour de France 2027 (parcours hypothétique)', 1)`
    )
    .run().lastInsertRowid;
}

async function createStage(db, editionId, order, name, type, wps) {
  const existing = db.prepare('SELECT id FROM stages WHERE name = ?').get(name);
  if (existing) db.prepare('DELETE FROM stages WHERE id = ?').run(existing.id);
  const r = db
    .prepare(
      `INSERT INTO stages (name, stage_type, status, state, edition_id, stage_order)
       VALUES (?, ?, 'démo spéculative — parcours non officiel', 'draft', ?, ?)`
    )
    .run(name, type, editionId, order);
  const id = r.lastInsertRowid;
  const ins = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind) VALUES (?,?,?,?)');
  wps.forEach((w, i) => ins.run(id, i, w[0], w[1]));
  console.log(`\n■ ${name}`);
  const full = await generateStage(id, { onProgress: progress() });
  const climbNames = full.climbs.map((c) => `${c.name} (cat. ${c.category})`).join(', ');
  console.log(`  → ${full.stage.generated_distance_km} km, D+ ${full.stage.total_ascent_m} m ; côtes : ${climbNames || 'aucune'}`);
  return full;
}

async function main() {
  console.log(`ÉtapeForge — démo spéculative Tour 2027 ${isOffline() ? '(hors-ligne — non supporté, arrêt)' : '(mode en ligne : APIs réelles)'}`);
  if (isOffline()) process.exit(1);

  const db = getDb();
  const editionId = ensureEdition(db);

  await createStage(db, editionId, 1, 'Étape 1 (hypothèse) — Édimbourg → Carlisle', 'vallonnée', [
    ['Édimbourg', 'start'],
    ['Innerleithen', 'via'],
    ['Galashiels', 'via'],
    ['Melrose', 'via'],
    ['Hawick', 'via'],
    ['Newcastleton', 'via'],
    ['Carlisle', 'finish'],
  ]);

  const stage19 = await createStage(db, editionId, 19, "Étape 19 (hypothèse) — Val-d'Isère → Sestriere", 'montagne', [
    ["Val-d'Isère", 'start'],
    ["Col de l'Iseran", 'col'],
    ['Lanslebourg', 'via'],
    ['Col du Mont-Cenis', 'col'],
    ['Susa', 'via'],
    ['Colle delle Finestre', 'col'],
    ['Sestriere', 'finish'],
  ]);

  const iseran = stage19.climbs.find((c) => /iseran/i.test(c.name));
  const finestre = stage19.climbs.find((c) => /finestre/i.test(c.name));
  console.log(`\n${iseran ? '✓' : '✗'} Col de l'Iseran détecté${iseran ? ` — sommet ${iseran.summit_ele_m} m` : ''}`);
  console.log(`${finestre ? '✓' : '✗'} Colle delle Finestre détectée${finestre ? ` — sommet ${finestre.summit_ele_m} m` : ''}`);

  console.log('\nDémo spéculative terminée (parcours non officiel — voir README). Lancez `npm start` puis ouvrez http://localhost:4567');
}

main().catch((err) => {
  console.error('Échec de la démo spéculative :', err.message);
  process.exit(1);
});
