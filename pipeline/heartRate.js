'use strict';
// Fréquence cardiaque d'une trace importée (issue #228, phase 5, Epic 30).
// Valeur absente = null, jamais 0 : un 0 se lirait comme une mesure réelle et
// ferait chuter une moyenne en silence (CLAUDE.md règle 10).

const { nearestRawIndices } = require('./geo');

const MIN_HR = 25;
const MAX_HR = 250;
// Moins de la moitié des points bruts avec une FC : capteur décroché ou
// branché en cours de route, moyenne et max ne décriraient pas la sortie.
const MIN_COVERAGE = 0.5;

/** bpm plausible, sinon null (sentinel capteur, 0 « pas de ceinture »…). */
function plausibleHr(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_HR && n <= MAX_HR ? n : null;
}

/** Moyenne et max sur les points bruts. La moyenne est arithmétique par
 * point : pondérée par le temps si l'enregistrement est à pas de temps
 * régulier (cas courant, 1 s), pas sinon — hypothèse, pas une garantie. */
function hrSummary(points) {
  const values = points.map((p) => plausibleHr(p.hr)).filter((v) => v != null);
  if (!points.length || values.length < points.length * MIN_COVERAGE) {
    return { avgHrBpm: null, maxHrBpm: null, coverage: points.length ? values.length / points.length : 0 };
  }
  let sum = 0;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return { avgHrBpm: Math.round(sum / values.length), maxHrBpm: Math.round(max), coverage: values.length / points.length };
}

/**
 * FC de chaque échantillon ré-échantillonné : celle du point brut le plus
 * proche en abscisse curviligne, jamais interpolée (une FC intermédiaire
 * inventée entre deux mesures n'a jamais été enregistrée). `cum` : distances
 * cumulées des points bruts, dans le même ordre ; `samples` triés par `dist`.
 * Tout null si la couverture est insuffisante (même seuil que hrSummary).
 */
function hrAtSamples(points, cum, samples) {
  const hrs = points.map((p) => plausibleHr(p.hr));
  const valid = hrs.filter((v) => v != null).length;
  if (!points.length || valid < points.length * MIN_COVERAGE) return samples.map(() => null);
  return nearestRawIndices(cum, samples).map((j) => (hrs[j] == null ? null : Math.round(hrs[j])));
}

/** Copie d'une ligne `stages` sans ses champs de FC. */
function stageWithoutHr(stage) {
  if (!stage) return stage;
  const rest = { ...stage };
  delete rest.avg_hr_bpm;
  delete rest.max_hr_bpm;
  return rest;
}

/** Copie d'un loadStageFull() sans aucune FC (étape et échantillons), ni
 * temps par échantillon (Epic 31.2, même règle de diffusion) : pour
 * tout ce qui est publié hors de l'instance (démo statique GitHub Pages) —
 * donnée de santé, jamais diffusée (Epic 30, relecture adverse). */
function fullWithoutHr(full) {
  if (!full) return full;
  return {
    ...full,
    stage: stageWithoutHr(full.stage),
    samples: (full.samples || []).map((s) => {
      const rest = { ...s };
      delete rest.hr_bpm;
      delete rest.elapsed_s;
      return rest;
    }),
  };
}

module.exports = { plausibleHr, hrSummary, hrAtSamples, stageWithoutHr, fullWithoutHr, MIN_HR, MAX_HR, MIN_COVERAGE };
