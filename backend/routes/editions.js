'use strict';
// Éditions / tours : liste, import Wikipédia, suggestions, carte.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { getDb } = require('../db');
const { importEdition, importAllEditions, CATEGORIES } = require('../../pipeline/importer');
const { historicHighlights } = require('../../pipeline/wikipedia');
const { stagePayload, loadExportable } = require('../exports');
const { wrap, requireString, optionalNumber } = require('../apiHelpers');

module.exports = function register(app) {
  // ---------------------------------------------------------------- éditions / tours
  app.get('/api/editions', (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        // COUNT(DISTINCT ...) partout : la jointure waypoints multiplie les lignes
        // par étape (plusieurs waypoints par étape), un SUM/COUNT non-distinct sur
        // s.id ou s.state compterait alors chaque étape plusieurs fois.
        `SELECT e.*,
                COUNT(DISTINCT s.id) AS stage_count,
                COUNT(DISTINCT CASE WHEN s.state = 'done' THEN s.id END) AS done_count,
                COUNT(DISTINCT CASE WHEN w.source = 'parcours curé' THEN s.id END) AS curated_stage_count
         FROM editions e
         LEFT JOIN stages s ON s.edition_id = e.id
         LEFT JOIN waypoints w ON w.stage_id = s.id
         GROUP BY e.id ORDER BY e.year, e.name`
      )
      .all()
      .map((e) => ({ ...e, source: e.source ? JSON.parse(e.source) : null }));
    res.json(rows);
  });

  /** Éditions pré-2020 marquées "mythiques" dans historic_routes.json (backlog
   * #10, section D) — pour les vignettes cliquables de l'écran Archives. Pure
   * lecture de données statiques, aucun accès DB nécessaire. */
  app.get('/api/editions/highlights', (req, res) => {
    res.json(historicHighlights());
  });

  /** Suggestion de prochaine étape à générer (backlog #10) : pondérée par
   * variété de terrain déjà produite, pas par ordre d'ajout — parmi les
   * brouillons, celui dont le stage_type est le moins représenté dans les
   * étapes déjà terminées. Sans étape terminée, aucun signal de variété
   * n'existe : on suggère la première étape brouillon en le disant
   * explicitement, plutôt que de fabriquer une pertinence qui n'existe pas
   * encore (CLAUDE.md règle 9). */
  app.get('/api/suggest-next', (req, res) => {
    const db = getDb();
    const done = db.prepare(`SELECT stage_type FROM stages WHERE state = 'done'`).all();
    const drafts = db
      .prepare(`SELECT id, name, stage_type, edition_id FROM stages WHERE state = 'draft' ORDER BY id`)
      .all();
    if (!drafts.length) return res.json({ suggestion: null });
    if (!done.length) {
      return res.json({
        suggestion: drafts[0],
        reason: `Aucune étape terminée pour l'instant : première étape brouillon, sans signal de variété.`,
      });
    }
    const counts = {};
    for (const d of done) {
      const t = d.stage_type || 'inconnu';
      counts[t] = (counts[t] || 0) + 1;
    }
    let best = drafts[0];
    let bestCount = Infinity;
    for (const s of drafts) {
      const c = counts[s.stage_type || 'inconnu'] || 0;
      if (c < bestCount) { bestCount = c; best = s; }
    }
    const typeLabel = best.stage_type || 'inconnu';
    const reason = bestCount === 0
      ? `Type « ${typeLabel} » absent des étapes déjà générées.`
      : `Type « ${typeLabel} » sous-représenté (${bestCount} étape${bestCount > 1 ? 's' : ''} déjà générée${bestCount > 1 ? 's' : ''} de ce type).`;
    res.json({ suggestion: best, reason });
  });

  app.post('/api/editions', (req, res) => {
    const body = req.body || {};
    const name = requireString(body.name, 'name', 200);
    const year = optionalNumber(body.year, 'year');
    const category = body.category || 'hommes';
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category doit être ${CATEGORIES.join(' ou ')}` });
    }
    const db = getDb();
    const r = db
      .prepare('INSERT INTO editions (year, name, is_custom, category) VALUES (?, ?, ?, ?)')
      .run(year, name, body.is_custom ? 1 : 0, category);
    res.json({ id: r.lastInsertRowid });
  });

  app.get('/api/editions/:id', (req, res) => {
    const db = getDb();
    const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(parseInt(req.params.id, 10));
    if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
    const curatedStageIds = new Set(
      db
        .prepare(
          `SELECT DISTINCT s.id FROM stages s
           JOIN waypoints w ON w.stage_id = s.id
           WHERE s.edition_id = ? AND w.source = 'parcours curé'`
        )
        .all(edition.id)
        .map((r) => r.id)
    );
    const stages = db
      .prepare('SELECT * FROM stages WHERE edition_id = ? ORDER BY stage_order, id')
      .all(edition.id)
      .map((s) => ({
        ...s,
        checks: s.checks ? JSON.parse(s.checks) : null,
        progress: s.progress ? JSON.parse(s.progress) : null,
        source: s.source ? JSON.parse(s.source) : null,
        is_curated: curatedStageIds.has(s.id),
      }));
    res.json({ ...edition, source: edition.source ? JSON.parse(edition.source) : null, stages });
  });

  app.post('/api/editions/import', wrap(async (req, res) => {
    const body = req.body || {};
    const category = body.category || 'hommes';
    try {
      const result = await importEdition(body.year, { category, refuseIfGenerated: body.replace !== true });
      res.json({ edition: result.edition, stages: result.stages });
    } catch (err) {
      if (err.status !== 409) throw err;
      res.status(409).json({ error: err.message, edition_id: err.editionId, generated: err.generated });
    }
  }));

  // Import en masse (toutes les éditions 1903 → LAST_KNOWN_YEAR, hors guerres
  // mondiales) : même idiome fire-and-forget que `running` pour la génération
  // d'étape ci-dessus, mais il n'y a pas de ligne DB existante sur laquelle
  // accrocher une progression (contrairement à une étape) — un objet de
  // module suffit, un seul import en masse a du sens à la fois sur une
  // instance locale mono-utilisateur.
  let importAllJob = null; // { running, total, done, imported, failed, startedAt, error? }

  app.post('/api/editions/import-all', (req, res) => {
    if (importAllJob && importAllJob.running) {
      return res.status(409).json({ error: 'Import en masse déjà en cours' });
    }
    importAllJob = { running: true, total: 0, done: 0, imported: [], failed: [], skipped: [], startedAt: new Date().toISOString() };
    importAllEditions({
      refuseIfGenerated: true,
      onProgress: (p) => {
        importAllJob.total = p.total;
        importAllJob.done = p.index;
      },
    })
      .then((result) => {
        importAllJob.imported = result.imported;
        importAllJob.failed = result.failed;
        importAllJob.skipped = result.skipped;
        importAllJob.total = result.total;
        importAllJob.done = result.total;
      })
      .catch((err) => {
        importAllJob.error = String(err.message || err);
      })
      .finally(() => {
        importAllJob.running = false;
      });
    res.status(202).json({ started: true });
  });

  app.get('/api/editions/import-all/status', (req, res) => {
    res.json(importAllJob || { running: false, total: 0, done: 0, imported: [], failed: [], skipped: [] });
  });

  /** Données carte globale d'un tour : tracés décimés + profils miniatures. */
  app.get('/api/editions/:id/mapdata', wrap(async (req, res) => {
    const db = getDb();
    const editionId = parseInt(req.params.id, 10);
    const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(editionId);
    if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
    const ids = db.prepare('SELECT id FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(editionId);
    const stages = ids.map((r) => stagePayload(loadExportable(r.id), { maxSamples: 200, maxTrack: 500 }));
    res.json({ edition: { ...edition, source: edition.source ? JSON.parse(edition.source) : null }, stages });
  }));
};
