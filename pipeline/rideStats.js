'use strict';
// Statistiques de temps/vitesse d'une trace importée (GPX/FIT horodaté),
// dans l'esprit des indicateurs VeloViewer : date, durée, vitesse moyenne,
// vitesse maximale. Calculées sur les points bruts de la trace (avant
// ré-échantillonnage à pas constant par `resamplePolyline`, qui sert au
// profil altimétrique et n'a pas à porter le temps) — voir pipeline/importTrack.js.
//
// Seule source de vérité pour la date et la durée écoulée d'une trace : ce
// module a absorbé l'ancienne dateAndDurationFromPoints() de importTrack.js
// (même calcul, calculé deux fois à deux endroits — corrigé en rebasant
// cette PR sur la fondation temporelle mergée en parallèle sur main).
//
// Volontairement absent ici : un temps « en mouvement » distinct du temps total
// (ce qui suppose de définir un seuil d'arrêt — vitesse ou déplacement minimal —
// qui change ce qui est compté et ne se devine pas sans mesure sur des traces
// réelles). Cette étape-là reste à faire, avec sa propre mesure.

const { haversine } = require('./geo');

/**
 * Fenêtre de lissage pour la vitesse maximale, en secondes.
 *
 * Une vitesse instantanée point-à-point est dominée par le bruit GPS : deux
 * points consécutifs anormalement écartés (saut de position) produisent une
 * vitesse dépourvue de sens physique. Lisser sur une fenêtre de temps glissante
 * absorbe ce bruit sans supposer de seuil d'arrêt — c'est le même principe que
 * `movingAverageByDistance` (pipeline/geo.js) pour l'altitude, appliqué au
 * temps plutôt qu'à la distance. 30 s est une valeur usuelle de lissage pour
 * une vitesse « maximale » affichée (comparable à la fenêtre de lissage de
 * puissance des compteurs de vélo, elle aussi de l'ordre de quelques dizaines
 * de secondes) — un choix de présentation, pas une mesure.
 */
const MAX_SPEED_WINDOW_S = 30;

/**
 * Calcule les statistiques de temps/vitesse d'une trace, à partir de ses
 * points bruts avec horodatage.
 *
 * @param points [{lat, lon, time?}] — `time` : objet Date (voir parseGpx()/
 *   pointsFromFitRecords() dans pipeline/importTrack.js). Les points sans
 *   `time` exploitable sont ignorés (pas comptés comme un arrêt) plutôt que
 *   de casser le calcul.
 * @returns {date, elapsedTimeS, totalDistanceM, avgSpeedKmh, maxSpeedKmh} ou
 *   `null` si moins de deux points portent un horodatage exploitable — un
 *   GPX/FIT sans `<time>`, ou une étape reconstruite par routage, n'a rien à
 *   mesurer ici (§9 : pas de zéro qui se ferait passer pour une vraie mesure).
 */
function computeRideStats(points) {
  const timed = (points || []).filter(
    (p) => p.time instanceof Date && !Number.isNaN(p.time.getTime())
  );
  if (timed.length < 2) return null;

  // min()/max() plutôt que premier/dernier point du tableau (trouvaille de
  // relecture adverse, 18/09/2026, initialement documentée sur l'ex-
  // dateAndDurationFromPoints() de importTrack.js) : parseGpx() capture tous
  // les <trkpt> d'un document par une seule regex globale, sans respecter les
  // frontières <trk>/<trkseg> — un GPX à plusieurs pistes non triées
  // chronologiquement (export à la main de plusieurs sorties fusionnées dans
  // un seul fichier) donnerait sinon un `dernier - premier` négatif, écrasé
  // en 0 par un Math.max(0, …) — exactement le 0 trompeur que ce garde-fou
  // est censé exclure. Boucle plutôt que Math.min/max(...times.map(...)) :
  // un spread sur un tableau de plusieurs dizaines de milliers de points
  // (traces réelles longues) risquerait la limite d'arguments du moteur JS.
  let firstMs = timed[0].time.getTime();
  let lastMs = firstMs;
  for (let i = 1; i < timed.length; i++) {
    const ms = timed[i].time.getTime();
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;
  }
  const elapsedTimeS = (lastMs - firstMs) / 1000;
  if (!(elapsedTimeS > 0)) return null;
  const date = new Date(firstMs).toISOString().slice(0, 10);

  // Distance et vitesses, elles, suivent l'ORDRE DU TABLEAU (celui du
  // parcours réel), pas l'ordre chronologique ci-dessus : c'est la même
  // convention que `resamplePolyline`/`cumulativeDistances` ailleurs dans le
  // pipeline, où la séquence des points définit la géométrie de la route.
  const cumDist = new Array(timed.length);
  cumDist[0] = 0;
  for (let i = 1; i < timed.length; i++) {
    cumDist[i] = cumDist[i - 1] + haversine(timed[i - 1], timed[i]);
  }
  const totalDistanceM = cumDist[cumDist.length - 1];
  const avgSpeedKmh = (totalDistanceM / 1000) / (elapsedTimeS / 3600);

  let maxSpeedKmh = 0;
  let lo = 0;
  for (let hi = 0; hi < timed.length; hi++) {
    while (timed[hi].time.getTime() - timed[lo].time.getTime() > MAX_SPEED_WINDOW_S * 1000) lo++;
    const dtS = (timed[hi].time.getTime() - timed[lo].time.getTime()) / 1000;
    if (dtS <= 0) continue;
    const distM = cumDist[hi] - cumDist[lo];
    const speedKmh = (distM / 1000) / (dtS / 3600);
    if (speedKmh > maxSpeedKmh) maxSpeedKmh = speedKmh;
  }
  // Une trace plus courte que la fenêtre de lissage n'a jamais atteint 30 s :
  // la boucle ci-dessus rend alors la vitesse moyenne sur toute la trace, ce
  // qui est le comportement voulu (rien de plus long à lisser sur).
  if (elapsedTimeS < MAX_SPEED_WINDOW_S) maxSpeedKmh = Math.max(maxSpeedKmh, avgSpeedKmh);

  return { date, elapsedTimeS, totalDistanceM, avgSpeedKmh, maxSpeedKmh };
}

module.exports = { computeRideStats, MAX_SPEED_WINDOW_S };
