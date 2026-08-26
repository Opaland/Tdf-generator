#!/usr/bin/env node
'use strict';
// Backlog issue #10, section F : « Test de parité réel vs simulateur (L) » —
// jusqu'ici jamais mesuré (« seul le chemin hors-ligne est jamais testé dans
// un sandbox de dev », confirmé le 25/08/2026, avant le déblocage de l'accès
// réseau de cet environnement). Génère la MÊME étape (mêmes waypoints) une
// fois avec le simulateur hors-ligne, une fois avec les vraies APIs
// (Géoplateforme, OSRM, opentopodata), et diffuse les écarts — distance,
// D+, côtes détectées (nombre, catégorie, longueur, pente moyenne, sommet).
//
// Ce n'est pas un test pass/fail : le simulateur est un profil synthétique
// déterministe, aucune égalité exacte avec le vrai relief n'est attendue.
// L'objectif est de mesurer l'ampleur réelle de l'écart plutôt que de la
// supposer.
//
// Nécessite un accès réseau réel pour sa moitié « en ligne » (pas de repli
// hors-ligne comme scripts/demo.js) : volontairement hors de `npm test`,
// à lancer à part avec `npm run parity` quand le réseau est disponible —
// même logique que scripts/demo-2027.js. `npm test` / `npm run demo`
// restent les garde-fous qui doivent passer avant tout commit.
//
// Étape utilisée : Pau → Lourdes → Col du Soulor → Argelès-Gazost →
// Hautacam, les mêmes waypoints que la démo 1 de scripts/demo.js (terrain de
// montagne réel et bien connu, aucune dépendance à une donnée curée qui
// biaiserait la comparaison).

const { setOffline } = require('../pipeline/http');
const { getDb } = require('../backend/db');
const { generateStage } = require('../pipeline/generate');

const WAYPOINTS = [
  ['Pau', 'start'],
  ['Lourdes', 'via'],
  ['Col du Soulor', 'col'],
  ['Argelès-Gazost', 'via'],
  ['Hautacam', 'col'],
];

function makeStage(db, name) {
  const r = db
    .prepare(`INSERT INTO stages (name, stage_type, status, state) VALUES (?, 'montagne', 'test de parité', 'draft')`)
    .run(name);
  const id = r.lastInsertRowid;
  const ins = db.prepare('INSERT INTO waypoints (stage_id, idx, label, kind) VALUES (?,?,?,?)');
  WAYPOINTS.forEach((w, i) => ins.run(id, i, w[0], w[1]));
  return id;
}

function progress(label) {
  let last = '';
  return (p) => {
    const line = `  [${label}] ${p.step} ${p.detail || ''} ${p.percent != null ? p.percent + '%' : ''}`;
    if (line !== last) { process.stdout.write(line + '\n'); last = line; }
  };
}

function summarize(full) {
  return {
    distanceKm: full.stage.generated_distance_km,
    ascentM: full.stage.total_ascent_m,
    router: full.track ? full.track.router : null,
    climbs: full.climbs.map((c) => ({
      name: c.name,
      category: c.category,
      lengthKm: c.length_km,
      avgGradient: c.avg_gradient,
      summitEleM: c.summit_ele_m,
    })),
  };
}

function printSummary(label, s) {
  console.log(`\n■ ${label}`);
  console.log(`  routeur : ${s.router || '?'}`);
  console.log(`  distance reconstituée : ${s.distanceKm} km`);
  console.log(`  D+ : ${s.ascentM} m`);
  if (!s.climbs.length) {
    console.log('  côtes détectées : aucune');
  } else {
    for (const c of s.climbs) {
      console.log(`  côte : ${c.name} — cat. ${c.category}, ${c.lengthKm} km à ${c.avgGradient} % (sommet ${c.summitEleM} m)`);
    }
  }
}

function pctDelta(a, b) {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

async function main() {
  const db = getDb();

  console.log('=== Génération hors-ligne (simulateur) ===');
  setOffline(true);
  const offlineId = makeStage(db, 'Pau → Hautacam (parité, hors-ligne)');
  const offlineFull = await generateStage(offlineId, { onProgress: progress('hors-ligne') });
  const offline = summarize(offlineFull);
  printSummary('Hors-ligne (simulateur)', offline);

  console.log('\n=== Génération en ligne (vraies APIs) ===');
  setOffline(false);
  const onlineId = makeStage(db, 'Pau → Hautacam (parité, en ligne)');
  const onlineFull = await generateStage(onlineId, { onProgress: progress('en ligne') });
  const online = summarize(onlineFull);
  printSummary('En ligne (vraies APIs)', online);

  console.log('\n=== Écart ===');
  const distDelta = pctDelta(offline.distanceKm, online.distanceKm);
  const ascentDelta = pctDelta(offline.ascentM, online.ascentM);
  console.log(`  distance : ${offline.distanceKm} km (hors-ligne) vs ${online.distanceKm} km (en ligne)` +
    (distDelta != null ? ` — écart ${distDelta >= 0 ? '+' : ''}${distDelta.toFixed(1)} %` : ''));
  console.log(`  D+ : ${offline.ascentM} m (hors-ligne) vs ${online.ascentM} m (en ligne)` +
    (ascentDelta != null ? ` — écart ${ascentDelta >= 0 ? '+' : ''}${ascentDelta.toFixed(1)} %` : ''));
  console.log(`  côtes détectées : ${offline.climbs.length} (hors-ligne) vs ${online.climbs.length} (en ligne)`);

  const offlineNames = new Set(offline.climbs.map((c) => c.name));
  const onlineNames = new Set(online.climbs.map((c) => c.name));
  const onlyOffline = [...offlineNames].filter((n) => !onlineNames.has(n));
  const onlyOnline = [...onlineNames].filter((n) => !offlineNames.has(n));
  if (onlyOffline.length) console.log(`  détectées seulement hors-ligne : ${onlyOffline.join(', ')}`);
  if (onlyOnline.length) console.log(`  détectées seulement en ligne : ${onlyOnline.join(', ')}`);
}

main().catch((err) => {
  console.error('ERREUR :', err.message);
  process.exit(1);
});
