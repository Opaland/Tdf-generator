'use strict';
// Bloc « checks » : audits qualité d'une étape générée.
// - distance reconstituée vs distance cible (tolérance ±5 %)
// - cols atteints (tracé < 500 m du sommet)
// - altitudes de sommets vs valeurs connues
// - segments/points approximés listés
// - points de passage curés trop espacés (risque de détour halluciné)
// - le tracé repasse sur lui-même en sens inverse (aller-retour halluciné)

const { COL_TOLERANCE_M } = require('./routing');
const { haversine } = require('./geo');

const ALT_TOLERANCE_M = 120;
// Au-delà de ce taux d'échantillons manquants, le profil (D+, côtes
// détectées) n'est plus seulement incomplet, il n'est plus fiable du tout —
// mérite un `fail` explicite plutôt qu'un `warn` identique à 5 % de trous.
// Trouvaille en régénérant le Tour 1992 à froid (08/09/2026) : les étapes
// 0, 7 et 8 avaient 100 % d'échantillons manquants (0 côte détectée malgré
// des cols curés, ex. le Cauberg) et remontaient le même `warn` qu'un trou
// isolé de quelques points — corrigé en amont dans pipeline/elevation.js
// (repli opentopodata sur la bbox France), ce seuil reste un garde-fou pour
// le cas résiduel où même le repli échoue.
const PROFIL_HOLE_FAIL_RATIO = 0.5;

// Écart maximal accepté entre la distance officielle d'une étape et celle du
// tracé reconstitué. Décidé par Cédric le 24/09/2026 : ±5 %, contre ±10 %
// jusque-là (elle-même contre ±25 % avant le 04/09/2026). Un seuil qui
// change ce qui est *vérifié* ne s'invente pas — il vient d'une décision,
// elle est datée ici, et le nombre n'existe qu'en un seul endroit : le
// message affiché, les tests et `scripts/demo.js` le lisent tous d'ici
// plutôt que de le réécrire (une valeur recopiée dérive).
//
// Conséquence mesurée avant ce resserrement (audit du 24/09/2026, régénération
// à froid en accès réseau réel des 93 étapes déjà curées de `historic_routes.
// json`, 28 éditions, résultats non committés — non reproductible depuis ce
// commentaire seul) : à ±10 %, 37/93 étaient dans la tolérance ; à ±5 %,
// seules 25/93 le restent. Les 68 étapes concernées sont corrigées une par
// une dans des PR séparées qui suivent celle-ci — chacune est la preuve
// vérifiable de son propre écart mesuré, pas ce commentaire. Conséquence
// *aussi* mesurée sur la démo 1903 hors ligne (simulateur, pas le réseau
// réel, celle-ci reproductible par `npm run demo`) : seule l'étape 1
// (-1,4 %) reste « ok », les étapes 2 à 6 passent à « fail » (+7,8 % à
// -21,8 %) — le simulateur hors-ligne n'a jamais été calibré pour ±5 %,
// c'est un chantier séparé de la correction des points de passage curés
// (qui, eux, pilotent la reconstitution en ligne), pas traité ici.
const DIST_TOLERANCE_PCT = 5;

// Part de la distance officielle en dessous de laquelle la reconstitution
// n'est plus « imprécise » mais absente (étape en circuit sans via curé, voir
// plus bas). Volontairement indépendant de DIST_TOLERANCE_PCT (l'un est un
// écart en pourcentage, l'autre une fraction de la cible — les confondre en
// un seul nombre ferait bouger le message dédié chaque fois qu'on resserre
// la tolérance, comme le 24/09/2026 où DIST_TOLERANCE_PCT est passé à 5
// sans toucher celui-ci).
const QUASI_NUL_RATIO = 0.1;

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

// Distance à vol d'oiseau en dessous de laquelle départ et arrivée géocodés
// sont considérés comme « le même point » (vrai circuit) plutôt que deux
// communes distinctes rapprochées. Trouvaille Tour 2002 étape 9 (Lanester →
// Lorient, ~2,5 km à vol d'oiseau, issue #189) : le message « probablement un
// circuit (départ = arrivée) » était affiché alors que Lanester et Lorient
// sont deux communes bien distinctes, jamais géocodées au même point — un
// vrai circuit (même ville en départ et en arrivée) géocode les deux
// extrémités exactement au même point, distance ~0.
const CIRCUIT_SAME_POINT_M = 500;

/**
 * @returns { ok, items: [{id, label, status: 'ok'|'warn'|'fail', detail}] }
 */
function runChecks({ stage, distanceM, waypointsOnTrack, approxSegments, climbs, samples, legs, backtrackZones }) {
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
    // Distinguer un vrai circuit (départ et arrivée géocodés au même point)
    // de deux communes distinctes mais proches : les deux produisent le même
    // symptôme (distance reconstituée quasi nulle) sans être la même
    // situation — voir CIRCUIT_SAME_POINT_M ci-dessus (issue #189).
    const first = (waypointsOnTrack || [])[0];
    const last = (waypointsOnTrack || [])[(waypointsOnTrack || []).length - 1];
    const bothGeocoded =
      first && last && first.lat != null && first.lon != null && last.lat != null && last.lon != null;
    const straightM = bothGeocoded ? haversine(first, last) : null;
    const distinctCloseCities = straightM != null && straightM > CIRCUIT_SAME_POINT_M;
    items.push({
      id: 'distance',
      label: 'Distance reconstituée vs cible',
      status: ok ? 'ok' : 'fail',
      detail: !nearZero
        ? `officielle ${target} km / reconstitution ${kmGen.toFixed(1)} km ` +
          `(écart ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)} %, tolérance ±${DIST_TOLERANCE_PCT} %)`
        : distinctCloseCities
        ? `reconstitution quasi nulle (${kmGen.toFixed(1)} km pour ${target} km officiels) — ` +
          `${first.label} et ${last.label} sont deux communes distinctes mais proches ` +
          `(${(straightM / 1000).toFixed(1)} km à vol d'oiseau), pas un circuit : sans point de passage ` +
          `intermédiaire curé, le routeur trace un aller direct au lieu du tracé réel — vérifier s'il ` +
          `manque des points de passage, voir pipeline/data/historic_routes.json`
        : `reconstitution quasi nulle (${kmGen.toFixed(1)} km pour ${target} km officiels) — ` +
          `probablement une étape en circuit (départ = arrivée) sans aucun point de passage curé : ` +
          `impossible de reconstruire un tracé réel sans via, voir pipeline/data/historic_routes.json`,
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
    if (measured == null) {
      // Aucun échantillon exploitable autour du sommet (trou de couverture
      // altimétrique, voir le check « Échantillons altimétriques » ci-dessous)
      // — un `continue` silencieux ici laissait ce col sans item du tout,
      // indiscernable d'un col jamais vérifié. Le badge de confiance ne doit
      // jamais reposer sur une case cochée par défaut faute de donnée.
      items.push({
        id: `alt-${c.label}`,
        label: `Altitude du sommet : ${c.label}`,
        status: 'warn',
        detail: 'non vérifiable : aucun échantillon altimétrique autour du sommet (trou de couverture)',
      });
      continue;
    }
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
    const holeRatio = holes / samples.length;
    items.push({
      id: 'profil',
      label: 'Échantillons altimétriques',
      status: holeRatio > PROFIL_HOLE_FAIL_RATIO ? 'fail' : holes ? 'warn' : 'ok',
      detail:
        `${samples.length} points${holes ? `, ${holes} manquants (${Math.round(holeRatio * 100)} %)` : ''}` +
        (holeRatio > PROFIL_HOLE_FAIL_RATIO
          ? ' — D+ et côtes détectées non fiables sur cette étape'
          : ''),
    });
  }

  // 6) Rebroussement du tracé : le routeur repasse sur lui-même en sens
  // inverse (voir detectBacktrackZones, pipeline/climbs.js — proximité
  // géographique + altitude quasi identique + cap inversé, pour écarter les
  // lacets de montagne et les circuits répétés dans le même sens). Trouvaille
  // concrète Tour 1992 étape 10 : le point de passage curé « Côte de
  // Buckwald » force un aller-retour de ~4-5 km sur la même route, qui gonfle
  // la distance ET fait apparaître une côte fantôme juste après le point de
  // rebroussement (« Côte de Ferme Saint-Henri, Denting ») pendant que la
  // vraie côte de Buckwald n'est classée nulle part.
  //
  // Message volontairement formulé en hypothèse (« peut signaler »), pas en
  // fait établi (relecture adverse du 04/09/2026) : un vrai aller-retour
  // existe aussi dans certains parcours réels (ex. un contre-la-montre qui
  // repart en sens inverse depuis un rond-point de retournement) — le check
  // ne peut pas distinguer ce cas légitime d'un point de passage mal placé,
  // seulement signaler la géométrie observée.
  for (const z of backtrackZones || []) {
    const nearbyClimbs = (climbs || []).filter((c) => c.startM <= z.endM + 2000 && c.endM >= z.startM - 2000);
    items.push({
      id: `backtrack-${z.startM}-${z.endM}`,
      label: `Aller-retour détecté : km ${(z.startM / 1000).toFixed(1)}–${(z.endM / 1000).toFixed(1)}`,
      status: 'warn',
      detail:
        `le tracé repasse sur lui-même en sens inverse sur cette portion — peut signaler un point de passage ` +
        `qui force un détour plutôt qu'un vrai passage (trouvaille Tour 1992 étape 10, Côte de Buckwald), ou un ` +
        `aller-retour réel du parcours (ex. contre-la-montre avec demi-tour) — à vérifier au cas par cas. Si ` +
        `c'est un artefact, la distance est gonflée d'autant, et une côte détectée juste après peut être un ` +
        `artefact du rebroussement plutôt qu'un vrai relief` +
        (nearbyClimbs.length
          ? ` : ${nearbyClimbs.map((c) => c.name || `côte du km ${(c.endM / 1000).toFixed(0)}`).join(', ')}.`
          : '.'),
    });
  }

  const ok = !items.some((i) => i.status === 'fail');
  return { ok, items };
}

module.exports = { runChecks, ALT_TOLERANCE_M, DIST_TOLERANCE_PCT, VIA_GAP_WARN_M };
