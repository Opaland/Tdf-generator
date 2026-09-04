'use strict';
// Bloc « checks » : audits qualité d'une étape générée.
// - distance reconstituée vs distance cible (tolérance à paliers, voir
//   GPX_TOLERANCE_PCT/NON_GPX_TOLERANCE_PCT ci-dessous)
// - cols atteints (tracé < 500 m du sommet)
// - altitudes de sommets vs valeurs connues
// - segments/points approximés listés
// - points de passage curés trop espacés (risque de détour halluciné)

const { COL_TOLERANCE_M } = require('./routing');

const ALT_TOLERANCE_M = 120;

// Tolérance de distance à deux paliers (03-04/09/2026, suite signalement
// utilisateur Nidervisse/Porcelette, Tour 1992 étape 10) : une tolérance
// unique à ±25 % masquait la différence entre une étape reconstruite à partir
// d'un trajet GPX officiel rééchantillonné et une étape reconstruite à partir
// de points de passage nommés sans GPX, où même un road book COMPLET peut
// rester loin de la cible (le routeur suit des routes réelles plus sinueuses
// que celles empruntées par la course — vérifié sur 1992 étape 10 après
// sourcing complet des 53 points du road book ET correction du géocodage du
// départ : 257.3 km reconstitués pour 217 km officiels, soit +18.6 %, encore
// hors tolérance ±15 %).
//
// ±5 % côté GPX reste néanmoins un seuil serré : relecture adverse du
// 04/09/2026 a montré que Lille (2025 étape 1, tracé GPX rééchantillonné tous
// les 8 km, palier 1 batch 1) reconstruit à -7,9 % — donc en dehors de ±5 %
// bien que la source soit un GPX officiel fidèle (écart mesuré 184.7 km GPX
// brut / 184.9 km officiels avant routage). Le sinuosité introduite par le
// routage entre points rééchantillonnés peut donc dépasser ±5 % même sur une
// étape bien sourcée ; Copenhague/Troyes/Caen/Barcelone (mêmes palier 1,
// même convention de label) n'ont pas été revérifiées contre ce nouveau seuil
// à ce jour — voir PR d'introduction de ce fichier pour le suivi.
const GPX_TOLERANCE_PCT = 5;
const NON_GPX_TOLERANCE_PCT = 15;

// Écart maximal (vol d'oiseau) entre deux points de passage curés consécutifs
// avant avertissement : au-delà, le routeur peut improviser un chemin
// plausible mais faux entre les deux — trouvaille concrète sur le Tour 1992
// étape 10 (10 km sans via entre Boulay-Moselle et Boucheporn, comblés par un
// détour halluciné passant par Nidervisse et Porcelette, jamais empruntés par
// la course). Ne s'applique qu'aux étapes déjà partiellement curées (plus de
// 2 waypoints, donc au moins un via) : une étape entièrement non curée est
// déjà signalée par le check distance (quasi nulle ou générique), pas besoin
// d'un second avertissement redondant sur son unique leg départ→arrivée.
const VIA_GAP_WARN_M = 12000;

/** Une étape est considérée « tracé GPX officiel » si la majorité de ses
 * waypoints portent le label conventionnel posé par la rééchantillonnage GPX
 * (voir historic_routes.json, ex. « Tracé GPX km 8.0 ») — même convention que
 * celle déjà utilisée pour les étapes du palier 1 (Troyes, Caen, Barcelone,
 * Copenhague…). Une étape sans aucun waypoint labellisé (tests, track import)
 * n'est jamais considérée GPX-sourcée. */
function isGpxSourced(waypointsOnTrack) {
  const labeled = (waypointsOnTrack || []).filter((w) => w.label);
  if (!labeled.length) return false;
  const gpxCount = labeled.filter((w) => /^Tracé GPX km/.test(w.label)).length;
  return gpxCount / labeled.length >= 0.5;
}

/**
 * @returns { ok, items: [{id, label, status: 'ok'|'warn'|'fail', detail}] }
 */
function runChecks({ stage, distanceM, waypointsOnTrack, approxSegments, climbs, samples, legs }) {
  const items = [];
  const kmGen = distanceM / 1000;

  // 0) Legs aberrants : une distance routée très supérieure au vol d'oiseau
  //    signale presque toujours un waypoint mal géocodé (homonyme lointain).
  for (const l of legs || []) {
    if (l.roadM > 50000 && l.roadM > 5 * Math.max(1, l.straightM)) {
      items.push({
        id: `leg-${l.from}-${l.to}`,
        label: `Leg suspect : ${l.from} → ${l.to}`,
        status: 'fail',
        detail: `${(l.roadM / 1000).toFixed(0)} km routés pour ${(l.straightM / 1000).toFixed(0)} km à vol d'oiseau — waypoint probablement mal géocodé`,
      });
    }
  }

  // 0b) Points de passage espacés : entre deux points curés distants de plus
  // de VIA_GAP_WARN_M à vol d'oiseau, le routeur choisit lui-même la route —
  // et peut halluciner un détour plausible mais faux (voir constante
  // ci-dessus). Ne s'applique qu'aux étapes déjà partiellement curées (plus
  // de 2 waypoints) : une étape non curée (départ+arrivée seuls) est déjà
  // signalée par le check distance, pas besoin d'un avertissement redondant.
  if ((waypointsOnTrack || []).length > 2) {
    for (const l of legs || []) {
      const alreadyFlaggedAsSuspect = l.roadM > 50000 && l.roadM > 5 * Math.max(1, l.straightM);
      if (l.straightM > VIA_GAP_WARN_M && !alreadyFlaggedAsSuspect) {
        items.push({
          id: `via-gap-${l.from}-${l.to}`,
          label: `Points de passage espacés : ${l.from} → ${l.to}`,
          status: 'warn',
          detail: `${(l.straightM / 1000).toFixed(1)} km à vol d'oiseau sans point de passage intermédiaire — ` +
            `au-delà de ~${VIA_GAP_WARN_M / 1000} km, le routeur peut improviser un chemin plausible mais faux ` +
            `entre les deux (trouvaille Tour 1992 étape 10 : détour par Nidervisse/Porcelette, jamais empruntés ` +
            `par la course). Envisager un point de passage supplémentaire si une source existe.`,
        });
      }
    }
  }

  // 1) Distance vs cible.
  if (stage.official_distance_km) {
    const target = stage.official_distance_km;
    const deltaPct = ((kmGen - target) / target) * 100;
    const gpxSourced = isGpxSourced(waypointsOnTrack);
    const tolerancePct = gpxSourced ? GPX_TOLERANCE_PCT : NON_GPX_TOLERANCE_PCT;
    const ok = Math.abs(deltaPct) <= tolerancePct;
    // Distance quasi nulle (< 10 % de l'officielle) : signal qualitativement
    // différent d'un simple écart de tracé. Cas typique — trouvaille en
    // vérifiant le Tour 1992 (issue #108 suite) : une étape en circuit
    // (départ = arrivée) sans aucun via curé géocode les deux extrémités au
    // même point, donc routeStage() route entre deux points identiques —
    // ~0 m, pas juste « mal routé ». Le profil résultant n'a quasiment aucun
    // point échantillonné (aucune vraie polyligne à échantillonner), donc la
    // fiche d'étape est essentiellement vide plutôt que juste imprécise — un
    // message dédié évite de noyer ce cas dans le même libellé générique
    // qu'un tracé simplement mal deviné.
    const nearZero = kmGen < target * 0.1;
    items.push({
      id: 'distance',
      label: 'Distance reconstituée vs cible',
      status: ok ? 'ok' : 'fail',
      detail: nearZero
        ? `reconstitution quasi nulle (${kmGen.toFixed(1)} km pour ${target} km officiels) — ` +
          `probablement une étape en circuit (départ = arrivée) sans aucun point de passage curé : ` +
          `impossible de reconstruire un tracé réel sans via, voir pipeline/data/historic_routes.json`
        : `officielle ${target} km / reconstitution ${kmGen.toFixed(1)} km ` +
          `(écart ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)} %, tolérance ±${tolerancePct} % — ` +
          `${gpxSourced ? 'tracé GPX officiel' : 'points de passage sans GPX'})`,
    });
  } else {
    items.push({
      id: 'distance',
      label: 'Distance générée',
      status: 'ok',
      detail: `${kmGen.toFixed(1)} km (pas de distance cible : étape créée)`,
    });
  }

  // 2) Cols atteints.
  const cols = (waypointsOnTrack || []).filter((w) => w.kind === 'col' || w.kind === 'peak');
  for (const c of cols) {
    if (c.approximated) {
      items.push({
        id: `col-${c.label}`,
        label: `Col atteint : ${c.label}`,
        status: 'warn',
        detail: `sommet rejoint par interpolation (col contourné par la route, tolérance ${COL_TOLERANCE_M} m)`,
      });
    } else {
      const ok = (c.offTrackM || 0) < COL_TOLERANCE_M;
      items.push({
        id: `col-${c.label}`,
        label: `Col atteint : ${c.label}`,
        status: ok ? 'ok' : 'fail',
        detail: `tracé à ${Math.round(c.offTrackM || 0)} m du sommet (seuil ${COL_TOLERANCE_M} m)`,
      });
    }
  }
  if (!cols.length) {
    items.push({ id: 'cols', label: 'Cols déclarés', status: 'ok', detail: 'aucun col dans les waypoints' });
  }

  // 3) Altitudes de sommets vs valeurs connues (altitude_hint des waypoints col).
  for (const c of cols) {
    const hint = c.altitude_hint_m ?? c.ele;
    if (hint == null) continue;
    // Altitude mesurée : max de l'altitude brute autour du passage au sommet (±1 km).
    let measured = null;
    for (const s of samples || []) {
      // s.eleRaw peut être null sur un trou de couverture altimétrique
      // (pipeline/elevation.js) — filtré ici plutôt que laissé atteindre
      // Math.max, qui le coercerait arithmétiquement en 0 (même classe de
      // bug que pipeline/climbs.js:136, trouvaille de relecture adverse sur
      // le correctif du trou d'altimétrie).
      if (Math.abs(s.dist - c.alongM) <= 1000 && s.eleRaw != null) {
        measured = measured == null ? s.eleRaw : Math.max(measured, s.eleRaw);
      }
    }
    if (measured == null) continue;
    const diff = Math.abs(measured - hint);
    items.push({
      id: `alt-${c.label}`,
      label: `Altitude du sommet : ${c.label}`,
      status: diff <= ALT_TOLERANCE_M ? 'ok' : 'warn',
      detail: `mesurée ${Math.round(measured)} m / connue ${Math.round(hint)} m (écart ${Math.round(diff)} m)`,
    });
  }

  // 4) Segments approximés.
  if (approxSegments && approxSegments.length) {
    items.push({
      id: 'approx',
      label: 'Segments approximés',
      status: 'warn',
      detail: approxSegments
        .map((s) => `km ${(s.fromM / 1000).toFixed(1)}–${(s.toM / 1000).toFixed(1)} : ${s.reason}`)
        .join(' ; '),
    });
  } else {
    items.push({ id: 'approx', label: 'Segments approximés', status: 'ok', detail: 'aucun' });
  }

  // 5) Sanité du profil.
  if (samples && samples.length) {
    const holes = samples.filter((s) => s.eleRaw == null).length;
    items.push({
      id: 'profil',
      label: 'Échantillons altimétriques',
      status: holes ? 'warn' : 'ok',
      detail: `${samples.length} points${holes ? `, ${holes} manquants` : ''}`,
    });
  }

  void climbs;
  const ok = !items.some((i) => i.status === 'fail');
  return { ok, items };
}

module.exports = {
  runChecks,
  ALT_TOLERANCE_M,
  GPX_TOLERANCE_PCT,
  NON_GPX_TOLERANCE_PCT,
  VIA_GAP_WARN_M,
  isGpxSourced,
};
