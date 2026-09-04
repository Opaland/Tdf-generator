'use strict';
// Bloc « checks » : audits qualité d'une étape générée.
// - distance reconstituée vs distance cible (tolérance ±10 %)
// - cols atteints (tracé < 500 m du sommet)
// - altitudes de sommets vs valeurs connues
// - segments/points approximés listés

const { COL_TOLERANCE_M } = require('./routing');

const ALT_TOLERANCE_M = 120;

// Écart maximal accepté entre la distance officielle d'une étape et celle du
// tracé reconstitué. Décidé par Cédric le 04/09/2026 : ±10 %, contre ±25 %
// jusque-là. Un seuil qui change ce qui est *vérifié* ne s'invente pas — il
// vient d'une décision, elle est datée ici, et le nombre n'existe qu'en un
// seul endroit : le message affiché, les tests et `scripts/demo.js` le lisent
// tous d'ici plutôt que de le réécrire (une valeur recopiée dérive).
//
// Conséquence assumée et mesurée sur la démo 1903 hors ligne : les étapes 4
// (-10,5 %) et 6 (-21,8 %) passent d'« ok » à « fail ». C'est le but — un
// tracé reconstitué qui s'écarte d'un cinquième de la distance officielle
// n'est pas une reconstitution fidèle, et le badge de l'étape doit le dire.
const DIST_TOLERANCE_PCT = 10;

// Part de la distance officielle en dessous de laquelle la reconstitution
// n'est plus « imprécise » mais absente (étape en circuit sans via curé, voir
// plus bas). Volontairement indépendant de DIST_TOLERANCE_PCT : les deux
// valent 10 depuis le 04/09/2026, mais l'un est un écart en pourcentage et
// l'autre une fraction de la cible — les confondre en un seul nombre ferait
// bouger le message dédié chaque fois qu'on resserre la tolérance.
const QUASI_NUL_RATIO = 0.1;

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

  // 1) Distance vs cible.
  if (stage.official_distance_km) {
    const target = stage.official_distance_km;
    const deltaPct = ((kmGen - target) / target) * 100;
    const ok = Math.abs(deltaPct) <= DIST_TOLERANCE_PCT;
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
    const nearZero = kmGen < target * QUASI_NUL_RATIO;
    items.push({
      id: 'distance',
      label: 'Distance reconstituée vs cible',
      status: ok ? 'ok' : 'fail',
      detail: nearZero
        ? `reconstitution quasi nulle (${kmGen.toFixed(1)} km pour ${target} km officiels) — ` +
          `probablement une étape en circuit (départ = arrivée) sans aucun point de passage curé : ` +
          `impossible de reconstruire un tracé réel sans via, voir pipeline/data/historic_routes.json`
        : `officielle ${target} km / reconstitution ${kmGen.toFixed(1)} km ` +
          `(écart ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)} %, tolérance ±${DIST_TOLERANCE_PCT} %)`,
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

module.exports = { runChecks, ALT_TOLERANCE_M, DIST_TOLERANCE_PCT };
