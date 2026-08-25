'use strict';
// Import d'une édition historique : liste des étapes depuis Wikipédia →
// tables editions / stages / waypoints. La reconstruction (routage/altimétrie)
// est faite ensuite par le pipeline standard (generateStage), étape par étape.

const { getDb } = require('../backend/db');
const {
  fetchEditionHtml,
  parseStagesFromHtml,
  reconstructionWaypoints,
  editionNotes,
} = require('./wikipedia');
const { isOffline } = require('./http');

/**
 * Importe (ou ré-importe) l'édition d'une année. Écrase l'édition existante de
 * la même année. Retourne { edition, stages: [{id, ...}] }.
 */
async function importEdition(year, { onProgress } = {}) {
  year = parseInt(year, 10);
  if (!Number.isInteger(year) || year < 1903 || year > 2100) {
    throw new Error(`Année invalide : ${year} (le Tour commence en 1903)`);
  }
  if (onProgress) onProgress({ step: 'import', detail: `Récupération de la liste des étapes ${year}`, percent: 5 });

  const html = await fetchEditionHtml(year);
  const parsed = parseStagesFromHtml(html, year);
  if (onProgress) onProgress({ step: 'import', detail: `${parsed.length} étapes trouvées`, percent: 40 });

  const db = getDb();
  const notes = editionNotes(year);
  const sourceInfo = {
    liste_etapes: isOffline()
      ? `fixture locale (structure Wikipédia « ${year} Tour de France », CC BY-SA) — mode hors-ligne`
      : `en.wikipedia.org — « ${year} Tour de France » (CC BY-SA)`,
    points_de_passage: 'parcours curés (pipeline/data/historic_routes.json), d\'après Wikipédia / bikeraceinfo.com',
    notes,
  };

  const result = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM editions WHERE year = ?').get(year);
    if (existing) {
      db.prepare('DELETE FROM stages WHERE edition_id = ?').run(existing.id);
      db.prepare('DELETE FROM editions WHERE id = ?').run(existing.id);
    }
    const ed = db
      .prepare('INSERT INTO editions (year, name, is_custom, source) VALUES (?, ?, 0, ?)')
      .run(year, `Tour de France ${year}`, JSON.stringify(sourceInfo));
    const editionId = ed.lastInsertRowid;

    const insStage = db.prepare(
      `INSERT INTO stages (edition_id, stage_order, name, date, stage_type, status,
         official_distance_km, state, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`
    );
    const insWp = db.prepare(
      `INSERT INTO waypoints (stage_id, idx, label, kind, altitude_hint_m, bonus_sec, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const stages = [];
    for (const s of parsed) {
      const name = `Étape ${s.number} : ${s.start} → ${s.finish}`;
      const stageSource = {
        villes: 'wikipedia',
        distance_officielle: 'wikipedia',
        date: 'wikipedia',
        type: 'wikipedia',
        vainqueur: s.winner || null,
        ligne_source: s.sourceRow,
      };
      const r = insStage.run(
        editionId, s.number, name, s.dateIso || s.dateText, s.type || null,
        'historique', s.distanceKm, JSON.stringify(stageSource)
      );
      const stageId = r.lastInsertRowid;
      const wps = reconstructionWaypoints(year, s);
      wps.forEach((wp, i) => {
        insWp.run(stageId, i, wp.label, wp.kind, wp.altitude_hint_m ?? null, wp.bonus_sec ? JSON.stringify(wp.bonus_sec) : null, wp.source);
      });
      stages.push({ id: stageId, number: s.number, name, distanceKm: s.distanceKm });
    }
    return { editionId, stages };
  })();

  if (onProgress) onProgress({ step: 'import', detail: `Édition ${year} importée (${result.stages.length} étapes)`, percent: 100 });
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(result.editionId);
  return { edition, stages: result.stages };
}

// Le Tour de France ne s'est pas couru pendant les deux guerres mondiales
// (1915-1918, 1940-1946) — fait structurel bien établi, indépendant de toute
// donnée de parcours (ville, col, distance) que ce dépôt exige normalement
// sourcée (CLAUDE.md règle 9) : sert uniquement à borner la plage d'années
// tentées ci-dessous, jamais à affirmer un fait de course. Une erreur sur ces
// bornes ne casserait rien silencieusement — l'année en trop échouerait
// simplement (pas de fixture/donnée Wikipédia), une année manquante ne
// serait juste pas tentée.
const WAR_GAP_YEARS = new Set([1915, 1916, 1917, 1918, 1940, 1941, 1942, 1943, 1944, 1945, 1946]);
// Même borne haute que le champ année de frontend/archives.html (`max="2026"`)
// — la dernière édition déjà courue au moment de ce dépôt.
const LAST_KNOWN_YEAR = 2026;

/** Liste des années de Tour de France valides, 1903 à LAST_KNOWN_YEAR, hors
 * les deux guerres mondiales. */
function allTdfYears() {
  const years = [];
  for (let y = 1903; y <= LAST_KNOWN_YEAR; y++) {
    if (!WAR_GAP_YEARS.has(y)) years.push(y);
  }
  return years;
}

/**
 * Importe toutes les éditions du Tour (1903 → LAST_KNOWN_YEAR, hors guerres
 * mondiales) via `importEdition()`, une par une. Une édition qui échoue
 * (pas de fixture locale en mode hors-ligne, page Wikipédia introuvable ou
 * mal formée, etc.) n'interrompt pas les suivantes — chaque échec est
 * collecté avec sa raison plutôt que masqué (pas de troncature silencieuse).
 * @returns { total, imported: [{year, editionId, stagesCount}], failed: [{year, error}] }
 */
async function importAllEditions({ onProgress } = {}) {
  const years = allTdfYears();
  const imported = [];
  const failed = [];
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    if (onProgress) {
      onProgress({ year, index: i + 1, total: years.length, imported: imported.length, failed: failed.length });
    }
    try {
      const { edition, stages } = await importEdition(year);
      imported.push({ year, editionId: edition.id, stagesCount: stages.length });
    } catch (err) {
      failed.push({ year, error: String(err.message || err) });
    }
  }
  return { total: years.length, imported, failed };
}

module.exports = { importEdition, importAllEditions, allTdfYears };
