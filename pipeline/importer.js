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
      `INSERT INTO waypoints (stage_id, idx, label, kind, altitude_hint_m, source)
       VALUES (?, ?, ?, ?, ?, ?)`
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
        insWp.run(stageId, i, wp.label, wp.kind, wp.altitude_hint_m ?? null, wp.source);
      });
      stages.push({ id: stageId, number: s.number, name, distanceKm: s.distanceKm });
    }
    return { editionId, stages };
  })();

  if (onProgress) onProgress({ step: 'import', detail: `Édition ${year} importée (${result.stages.length} étapes)`, percent: 100 });
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(result.editionId);
  return { edition, stages: result.stages };
}

module.exports = { importEdition };
