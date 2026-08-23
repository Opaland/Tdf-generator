'use strict';
// Indice de pénibilité cumulée façon VeloViewer (backlog issue #10, section
// C) : un score qui ne se limite pas au D+ brut affiché aujourd'hui, mais
// pondère les côtes par catégorie et intègre la fatigue accumulée (jours de
// montagne consécutifs dans le calendrier de l'édition). VeloViewer ne
// publie pas sa formule exacte — celle-ci est une heuristique documentée et
// transparente, pas une reconstruction du score propriétaire.

// Mêmes catégories que categorize() dans climbs.js (HC/1/2/3/4) — pondération
// arbitraire mais monotone, documentée ici plutôt que devinée par l'UI.
const CATEGORY_POINTS = { HC: 5, '1': 4, '2': 3, '3': 2, '4': 1 };

function climbScore(climbs) {
  return (climbs || []).reduce((sum, c) => sum + (CATEGORY_POINTS[c.category] || 0), 0);
}

/**
 * Un jour est "de montagne" si l'étape contient au moins une côte HC/1/2 —
 * seuil délibérément resserré : une simple bosse cat.3/4 isolée ne doit pas
 * suffire à faire compter un jour de plaine dans la série de fatigue.
 */
function isMountainDay(stageType, climbs) {
  if ((climbs || []).some((c) => c.category === 'HC' || c.category === '1' || c.category === '2')) return true;
  return stageType === 'montagne';
}

/**
 * Compte les jours de montagne consécutifs se terminant à `stageOrder`
 * inclus, dans la même édition — en ne regardant que des étapes déjà
 * générées (état 'done', climbs connus) et des numéros d'étape strictement
 * consécutifs (un trou dans la numérotation, une étape non générée, ou un
 * jour non-montagne arrêtent le décompte).
 */
function consecutiveMountainDays(db, editionId, stageOrder) {
  if (!editionId || stageOrder == null) return 0;
  const rows = db
    .prepare(
      `SELECT s.stage_order, s.stage_type, s.state,
              (SELECT GROUP_CONCAT(c.category) FROM climbs c WHERE c.stage_id = s.id) AS categories
       FROM stages s WHERE s.edition_id = ? AND s.stage_order <= ? ORDER BY s.stage_order DESC`
    )
    .all(editionId, stageOrder);
  let streak = 0;
  let expected = stageOrder;
  for (const row of rows) {
    if (row.stage_order !== expected) break;
    if (row.state !== 'done') break;
    const climbs = (row.categories || '').split(',').filter(Boolean).map((category) => ({ category }));
    if (!isMountainDay(row.stage_type, climbs)) break;
    streak++;
    expected--;
  }
  return streak;
}

/**
 * Indice de pénibilité cumulée : score des côtes catégorisées + contribution
 * du D+ (échelle arbitraire : 500 m de D+ ≈ 1 point de côte cat.4) x facteur
 * de fatigue croissant avec les jours de montagne consécutifs (+15 % par
 * jour au-delà du premier, plafonné à +60 % — 5 jours de montagne d'affilée
 * ou plus).
 */
function painIndex({ totalAscentM, climbs, mountainStreak }) {
  const cScore = climbScore(climbs);
  const ascentContribution = (totalAscentM || 0) / 500;
  const fatigueFactor = 1 + Math.min(0.15 * Math.max((mountainStreak || 0) - 1, 0), 0.6);
  return {
    score: Math.round((cScore + ascentContribution) * fatigueFactor * 10) / 10,
    climbScore: cScore,
    ascentContribution: Math.round(ascentContribution * 10) / 10,
    mountainStreak: mountainStreak || 0,
    fatigueFactor: Math.round(fatigueFactor * 100) / 100,
  };
}

module.exports = { CATEGORY_POINTS, climbScore, isMountainDay, consecutiveMountainDays, painIndex };
