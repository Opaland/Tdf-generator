'use strict';
// Récit d'une étape historique rédigé par Claude (story 41.4) : lecture seule
// de pipeline/data/stage_narratives.json. Le serveur n'appelle jamais l'API
// Claude (génération par scripts/generate-recits.js) ; un récit dont les faits
// ont changé depuis la rédaction n'est pas rendu.

const { getDb } = require('../db');
const { stageLabels } = require('../../pipeline/placeSearch');
const { currentNarrative } = require('../../pipeline/recits');

/** Année et libellé (« 14 », « 12a ») d'une étape d'édition masculine, ou
 * null (tour personnalisé, édition féminine, étape inconnue). */
function stageKey(db, id) {
  const st = db.prepare('SELECT id, edition_id FROM stages WHERE id = ?').get(id);
  if (!st || st.edition_id == null) return null;
  const ed = db.prepare('SELECT year, is_custom, category FROM editions WHERE id = ?').get(st.edition_id);
  if (!ed || ed.is_custom || ed.year == null || (ed.category && ed.category !== 'hommes')) return null;
  const list = db.prepare('SELECT id, stage_order FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(st.edition_id);
  const labels = stageLabels(list.map((r) => r.stage_order));
  const i = list.findIndex((r) => r.id === st.id);
  return { year: ed.year, key: labels[i] };
}

module.exports = function registerRecits(app) {
  app.get('/api/stages/:id/recit', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'identifiant d\'étape invalide' });
    const k = stageKey(getDb(), id);
    res.json({ narrative: k ? currentNarrative(k.year, k.key) : null });
  });
};

module.exports.stageKey = stageKey;
