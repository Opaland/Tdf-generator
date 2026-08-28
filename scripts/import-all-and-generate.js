#!/usr/bin/env node
'use strict';
// Import + génération complète de toutes les éditions Hommes du Tour de
// France (1903 → LAST_KNOWN_YEAR, hors guerres mondiales) avec les vraies
// APIs (Wikipédia, IGN/Géoplateforme, OSRM, opentopodata) — pas le simulateur
// hors-ligne. Réservé à un déclenchement manuel (voir .github/workflows/
// pages.yml, input `full`) : ~2200 étapes, plusieurs heures même en
// parallèle, sollicite les mêmes APIs publiques gratuites que le reste du
// pipeline — jamais lancé automatiquement à chaque push.
//
// Génère les étapes avec un pool de N en parallèle (GEN_CONCURRENCY, 8 par
// défaut) plutôt qu'une boucle séquentielle : chaque hôte externe reste
// sérialisé par pipeline/rateLimiter.js (courtoisie serveur inchangée, même
// délai minimal par hôte qu'en séquentiel), mais le CPU local et les hôtes
// DIFFÉRENTS (géocodage/routage/altimétrie) se chevauchent entre étapes —
// mesuré en conditions réelles (26/08/2026) : ~2/min en séquentiel (concur-
// rence 1) contre ~13-15/min à concurrence 8, un facteur ~7 pour un facteur
// 8 de parallélisme, pas linéaire (les hôtes les plus sollicités restent le
// vrai goulot). Reprend automatiquement là où un run précédent s'est arrêté
// (state != 'done'), utile après une interruption CI ou un job relancé.
//
// Usage : node scripts/import-all-and-generate.js
// Variables : GEN_CONCURRENCY (défaut 8)

const fs = require('fs');
const path = require('path');
const { getDb, DATA_DIR } = require('../backend/db');
const { importAllEditions } = require('../pipeline/importer');
const { generateStage } = require('../pipeline/generate');

// Marqueur de fin de passe complète (voir .github/workflows/pages.yml,
// step "Vérifier si le catalogue complet restauré est réellement terminé") :
// trouvaille en production (28/08/2026, relecture adverse sur ce même
// workflow) — sans ce marqueur, un cache "full" restauré par un push
// ordinaire serait indiscernable, par son seul préfixe de clé, d'un run
// interrompu à mi-parcours (annulé, timeout) qui a quand même sauvegardé sa
// progression partielle (le workflow sauvegarde toujours le cache, même en
// échec — voir plus haut). Supprimé au tout début de ce script, réécrit
// seulement si toute la passe (import + génération) se termine sans lever
// d'exception — les échecs individuels d'étapes (voir genFailed plus bas)
// restent tolérés, comme déjà le cas pour generateAllRemaining() : ce
// marqueur atteste juste que la PASSE a fini, pas que chaque étape a
// réussi (scripts/build-site.js ne publie de toute façon que les étapes à
// l'état 'done').
const COMPLETE_MARKER = path.join(DATA_DIR, '.full-complete');

const CONCURRENCY = parseInt(process.env.GEN_CONCURRENCY || '8', 10);

function ts() {
  return new Date().toISOString().slice(11, 19);
}

async function importAll() {
  console.log(`[${ts()}] Import de masse des éditions (1903 → dernière connue, hors guerres mondiales)…`);
  const { total, imported, failed } = await importAllEditions({
    onProgress: (p) => {
      if (p.index === 1 || p.index % 10 === 0 || p.index === p.total) {
        console.log(`[${ts()}]   import ${p.index}/${p.total} années tentées (${p.imported} ok, ${p.failed} échecs)`);
      }
    },
  });
  console.log(`[${ts()}] Import terminé : ${imported.length}/${total} éditions importées, ${failed.length} échecs.`);
  if (failed.length) {
    for (const f of failed) console.log(`[${ts()}]   ÉCHEC import ${f.year} : ${f.error}`);
  }
  return imported;
}

async function generateAllRemaining(db) {
  // state != 'done' couvre aussi bien les étapes fraîchement importées
  // ('draft') qu'une reprise après interruption ('generating', 'error').
  const rows = db.prepare(`SELECT id, edition_id FROM stages WHERE state != 'done' ORDER BY id`).all();
  const editionYear = new Map(db.prepare('SELECT id, year FROM editions').all().map((e) => [e.id, e.year]));
  console.log(`[${ts()}] Génération de ${rows.length} étapes (concurrence = ${CONCURRENCY})…`);

  let idx = 0;
  let done = 0;
  let ok = 0;
  const genFailed = [];
  const startedAt = Date.now();

  async function worker() {
    while (idx < rows.length) {
      const i = idx++;
      const { id, edition_id: editionId } = rows[i];
      const year = editionYear.get(editionId);
      try {
        await generateStage(id, { onProgress: () => {} });
        ok++;
      } catch (err) {
        genFailed.push({ id, year, error: String((err && err.message) || err) });
        console.log(`[${ts()}]   ÉCHEC génération étape ${id} (${year}) : ${String((err && err.message) || err)}`);
      }
      done++;
      if (done % 10 === 0 || done === rows.length) {
        const elapsedMin = (Date.now() - startedAt) / 60000;
        const rate = done / elapsedMin;
        const etaMin = rate > 0 ? (rows.length - done) / rate : null;
        console.log(
          `[${ts()}] ${done}/${rows.length} étapes (${ok} ok, ${genFailed.length} échecs) — ` +
          `${elapsedMin.toFixed(1)} min écoulées, ~${rate.toFixed(1)}/min, ETA ~${etaMin != null ? etaMin.toFixed(0) : '?'} min`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`[${ts()}] TERMINÉ. Étapes : ${ok}/${rows.length} générées ce run, ${genFailed.length} échecs.`);
  if (genFailed.length) {
    console.log(`[${ts()}] Détail des échecs :`);
    for (const f of genFailed) console.log(`  - étape ${f.id} (${f.year}) : ${f.error}`);
  }
}

async function main() {
  const db = getDb();
  fs.rmSync(COMPLETE_MARKER, { force: true });
  await importAll();
  await generateAllRemaining(db);
  fs.writeFileSync(COMPLETE_MARKER, new Date().toISOString());
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`[${ts()}] ERREUR FATALE :`, err);
  process.exit(1);
});
