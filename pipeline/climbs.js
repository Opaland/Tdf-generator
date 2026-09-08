'use strict';
// Détection des côtes sur le profil lissé : segment continu ≥ 1,5 km à ≥ 3 % de
// moyenne, fusion de deux montées séparées par un replat/descente < 500 m.
// Catégorisation approx ASO : score = longueur_km × pente_moyenne_%.
//   > 80 → HC ; > 32 → cat.1 ; > 16 → cat.2 ; > 6 → cat.3 ; sinon cat.4.

const { haversine, bearing, bearingDiff } = require('./geo');

const MIN_LENGTH_M = 1500;
const MIN_AVG_GRADIENT = 3; // %
const MERGE_GAP_M = 500;

// Détection des allers-retours du tracé (03-09/2026, suite signalement
// utilisateur Tour 1992 étape 10 : le point de passage curé « Côte de
// Buckwald » force un aller-retour réel sur ~4-5 km — vérifié en traçant les
// coordonnées échantillon par échantillon, la portion de retour recopie
// quasi exactement (à quelques dizaines de mètres près) la portion aller, en
// sens inverse). Un aller-retour de ce type fausse le détecteur de côtes :
// la montée de retour, séparée de la vraie montée par une descente qui
// « efface » le profil net, se recompose parfois en une côte fantôme sur un
// segment déjà grimpé (trouvaille concrète : « Côte de Ferme Saint-Henri,
// Denting », immédiatement après le point de rebroussement).
//
// Trois conditions cumulatives pour retenir un couple de points comme
// rebroussement (pas juste « proche à vol d'oiseau ») :
// 1) proximité géographique (< BACKTRACK_PROXIMITY_M) ;
// 2) altitude quasi identique (< BACKTRACK_ELEVATION_TOLERANCE_M) — écarte
//    les lacets de montagne (Alpe d'Huez, Tourmalet…), où deux virages en
//    épingle peuvent être géographiquement proches en plan mais à des
//    altitudes différentes puisque la route continue de grimper ;
// 3) cap inversé (> BACKTRACK_BEARING_REVERSAL_MIN°) — écarte un circuit
//    répété dans le même sens (ex. les 3 boucles de Nice 2020) : deux
//    passages au même endroit, dans le même sens, ne sont pas un
//    rebroussement.
// Séparation minimale en distance parcourue (BACKTRACK_MIN_SEPARATION_M)
// pour ignorer les échantillons simplement adjacents.
//
// BACKTRACK_ELEVATION_TOLERANCE_M resserré de 20 à 10 m (relecture adverse
// du 04/09/2026) : un replat local sur un lacet de montagne (un col a
// souvent un court palier à chaque épingle) peut suffire à passer sous 20 m
// alors que la route continue bel et bien de grimper — le garde-fou de
// l'altitude visait à écarter CE cas précisément, mais 20 m laissait passer
// un replat plausible. Vérifié sur les 3 jeux de données réels déjà
// utilisés pour calibrer ce détecteur (Tour 1992 étape 10, Tour 2021 étape
// 11, Tour 2020 étape 1) : toutes les zones connues survivent à 10 m avec
// une marge large (la plus petite passe de 1,0 à 1,0 km, aucune ne
// disparaît) — l'écart d'altitude réel entre les deux bras d'un aller-retour
// authentique (même route parcourue deux fois) est bien plus resserré qu'un
// simple replat de lacet.
const BACKTRACK_PROXIMITY_M = 150;
const BACKTRACK_ELEVATION_TOLERANCE_M = 10;
const BACKTRACK_BEARING_REVERSAL_MIN = 140;
const BACKTRACK_MIN_SEPARATION_M = 1000;
// Taille de cellule de la grille spatiale : évite une comparaison O(n²) de
// tous les échantillons entre eux sur une étape à profil long (jusqu'à
// quelques milliers de points) — seuls les échantillons proches en plan
// (même cellule ou voisine) sont comparés entre eux.
//
// Trouvaille de relecture adverse (04/09/2026) : la valeur initiale
// (0,0013°, ≈145 m en latitude mais seulement 93-107 m en longitude aux
// latitudes françaises, cos(lat) oblige) était PLUS PETITE que
// BACKTRACK_PROXIMITY_M — avec une marge de recherche de ±1 cellule
// seulement, deux points à moins de 150 m réels pouvaient tomber dans des
// cellules distantes de 2 crans et être totalement ratés (reproduit : deux
// points à 149 m réels, zéro zone détectée). Sur une étape à pas
// d'échantillonnage large (250 m, pipeline/elevation.js) et un aller-retour
// court, cette perte n'est pas rattrapée par la fusion de zones adjacentes
// — un vrai aller-retour peut disparaître entièrement plutôt que d'être
// simplement filtré par BACKTRACK_MIN_ZONE_LENGTH_M.
//
// Corrigé sur les deux axes : la cellule fait maintenant ≥150 m même dans
// le pire cas (longitude à 51°N, latitude la plus haute du corpus TdF ;
// cos(51°) ≈ 0,629) ET la marge de recherche passe de ±1 à ±2 cellules —
// double garde-fou plutôt qu'un seul calcul à la limite exacte.
const BACKTRACK_CELL_DEG = 0.0022;
const BACKTRACK_CELL_MARGIN = 2;
// Longueur minimale d'une zone retenue (04/09/2026, vérifié en direct sur le
// Tour 2021 étape 11, double ascension du Ventoux — la SEULE double ascension
// intentionnelle déjà présente dans le corpus) : les deux passages au vrai
// sommet (même point géographique, sens de progression opposé après chacun)
// déclenchent chacun une correspondance isolée, sur un seul échantillon
// (zone de longueur ~0 m) — le sommet est un point unique, pas une route
// repassant sur elle-même. Un vrai aller-retour (point de passage forçant un
// détour, trouvaille Tour 1992 étape 10) couvre au contraire plusieurs
// centaines de mètres à plusieurs km d'échantillons consécutifs (vérifié :
// 3-3,5 km sur le Tour 1992 étape 10 ET sur un aller-retour non documenté
// jusqu'ici trouvé sur le Tour 2021 étape 11, ~km 61-70, sans rapport avec le
// Ventoux). Ce seuil élimine la coïncidence géographique ponctuelle d'un
// sommet visité deux fois sans toucher aux vrais aller-retours.
//
// Relevé de 300 à 600 m (relecture adverse du 04/09/2026, en défense
// supplémentaire du resserrement de BACKTRACK_ELEVATION_TOLERANCE_M
// ci-dessus) : un faux positif ponctuel (replat de lacet, coïncidence de
// cap) est nettement moins probable sur 600 m consécutifs que sur 300 m.
// Toutes les zones réelles connues restent trouvées à 600 m (la plus courte
// des 10 zones observées sur les 3 étapes de calibrage fait 1,0 km) — cette
// marge reste large.
const BACKTRACK_MIN_ZONE_LENGTH_M = 600;

function categorize(score) {
  if (score > 80) return 'HC';
  if (score > 32) return '1';
  if (score > 16) return '2';
  if (score > 6) return '3';
  return '4';
}

// Indice d'irrégularité (backlog issue #10, section C) : la catégorisation
// ASO approchée (longueur × pente moyenne) noie un mur irrégulier — un
// tronçon à 13 % sur 1,5 km peut se fondre dans une moyenne à 6 % sur toute
// la montée. L'écart-type des pentes par bloc de 1 km (déjà produits pour la
// fiche « côte par côte ») donne une mesure complémentaire, quasi gratuite à
// calculer, sans toucher au score/à la catégorie eux-mêmes (qui restent
// l'approximation ASO telle quelle).
function irregularityIndex(kmBlocks) {
  if (!kmBlocks.length) return 0;
  const mean = kmBlocks.reduce((a, b) => a + b.gradient, 0) / kmBlocks.length;
  const variance = kmBlocks.reduce((a, b) => a + (b.gradient - mean) ** 2, 0) / kmBlocks.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

// Comble les altitudes lissées absentes/invalides (null, undefined, NaN) par le
// voisin valide le plus proche — même idiome que `importTrack.js` pour les trous
// d'altitude bruts. Sans ça, un seul échantillon invalide au milieu d'un profil
// (trou de couverture d'un fournisseur d'altitude, bruit GPS ponctuel) propage
// un NaN silencieux dans maxGradient/kmBlocks jusqu'à l'API et le frontend.
function fillInvalidElevations(samples) {
  const filled = samples.map((s) => {
    const v = s.eleSmooth != null ? s.eleSmooth : s.ele;
    return Number.isFinite(v) ? v : null;
  });
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] == null) {
      let a = i;
      let b = i;
      while (a > 0 && filled[a] == null) a--;
      while (b < filled.length - 1 && filled[b] == null) b++;
      filled[i] = filled[a] ?? filled[b] ?? 0;
    }
  }
  return samples.map((s, i) => ({ ...s, eleSmooth: filled[i] }));
}

/**
 * Détecte les côtes.
 * @param samples [{dist, eleRaw?, eleSmooth}] triés par dist (m) — la détection
 *                utilise eleSmooth ; l'altitude de sommet rapportée utilise
 *                eleRaw si présent.
 * @returns [{ startM, endM, lengthKm, startEle, summitEle, avgGradient,
 *             maxGradient, score, category, kmBlocks }]
 */
function detectClimbs(rawSamples) {
  if (rawSamples.length < 3) return [];
  const samples = fillInvalidElevations(rawSamples);
  const ele = (s) => (s.eleSmooth != null ? s.eleSmooth : s.ele);

  // 1) Segments élémentaires en montée (pente > 0 entre échantillons consécutifs).
  //    On repère les portions montantes, puis on les fusionne si l'interruption
  //    (replat ou légère descente) fait moins de MERGE_GAP_M.
  const rises = [];
  let cur = null;
  for (let i = 1; i < samples.length; i++) {
    const dd = samples[i].dist - samples[i - 1].dist;
    if (dd <= 0) continue;
    const de = ele(samples[i]) - ele(samples[i - 1]);
    const g = (de / dd) * 100;
    if (g > 0.5) {
      if (!cur) cur = { startIdx: i - 1, endIdx: i };
      else cur.endIdx = i;
    } else if (cur) {
      rises.push(cur);
      cur = null;
    }
  }
  if (cur) rises.push(cur);

  // 2) Fusion des montées proches (< MERGE_GAP_M entre fin et début suivant).
  const merged = [];
  for (const r of rises) {
    const last = merged[merged.length - 1];
    if (last && samples[r.startIdx].dist - samples[last.endIdx].dist < MERGE_GAP_M) {
      last.endIdx = r.endIdx;
    } else {
      merged.push({ ...r });
    }
  }

  // 3) Ajustement des bornes : on rogne la tête/queue tant que la pente moyenne
  //    du candidat est < MIN_AVG_GRADIENT (replats de fusion en bordure).
  const climbs = [];
  for (const m of merged) {
    let s = m.startIdx;
    let e = m.endIdx;
    const avg = (i, j) =>
      ((ele(samples[j]) - ele(samples[i])) / Math.max(1, samples[j].dist - samples[i].dist)) * 100;
    while (e > s + 1 && avg(s, e) < MIN_AVG_GRADIENT) {
      // rogne le côté le moins pentu
      if (avg(s, s + 1) < avg(e - 1, e)) s++;
      else e--;
    }
    const lengthM = samples[e].dist - samples[s].dist;
    const avgGradient = avg(s, e);
    if (lengthM < MIN_LENGTH_M || avgGradient < MIN_AVG_GRADIENT) continue;

    // Pente max sur une fenêtre de 100 m (ou la résolution d'échantillonnage).
    let maxGradient = 0;
    for (let i = s + 1; i <= e; i++) {
      const dd = samples[i].dist - samples[i - 1].dist;
      if (dd > 0) maxGradient = Math.max(maxGradient, ((ele(samples[i]) - ele(samples[i - 1])) / dd) * 100);
    }

    // Altitude de sommet : max du brut sur la montée si disponible.
    // Vérifié par échantillon, pas seulement sur samples[0] : depuis que
    // pipeline/elevation.js préserve les trous de couverture altimétrique en
    // `null` (plutôt que de les coercer en 0 m), un profil peut avoir
    // samples[0].eleRaw renseigné tout en ayant un trou ailleurs sur la
    // montée — Math.max(summitEle, null) coercerait ce trou en 0 (même
    // mécanisme que movingAverageByDistance, trouvaille de relecture
    // adverse). detectClimbs() est réutilisée telle quelle par
    // pipeline/descents.js sur un profil inversé : ce garde-fou protège
    // aussi bottom_ele_m (point bas d'une descente), affiché tel quel côté
    // utilisateur (frontend/stage.js).
    let summitEle = ele(samples[e]);
    for (let i = s; i <= e; i++) {
      if (samples[i].eleRaw != null) summitEle = Math.max(summitEle, samples[i].eleRaw);
    }

    const lengthKm = lengthM / 1000;
    const score = lengthKm * avgGradient;

    // Blocs de 1 km pour la fiche « côte par côte » (profil type ASO).
    const kmBlocks = [];
    const startM = samples[s].dist;
    const nBlocks = Math.ceil(lengthM / 1000);
    for (let b = 0; b < nBlocks; b++) {
      const fromM = startM + b * 1000;
      const toM = Math.min(startM + (b + 1) * 1000, samples[e].dist);
      const eAt = (target) => {
        let i = s;
        while (i < e && samples[i + 1].dist <= target) i++;
        if (i >= e) return ele(samples[e]);
        const d0 = samples[i].dist;
        const d1 = samples[i + 1].dist;
        const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
        return ele(samples[i]) + t * (ele(samples[i + 1]) - ele(samples[i]));
      };
      const ele0 = eAt(fromM);
      const ele1 = eAt(toM);
      const len = toM - fromM;
      if (len < 50) continue;
      kmBlocks.push({
        fromM: Math.round(fromM),
        toM: Math.round(toM),
        ele0: Math.round(ele0),
        ele1: Math.round(ele1),
        gradient: Math.round(((ele1 - ele0) / len) * 1000) / 10,
      });
    }

    climbs.push({
      startM: Math.round(samples[s].dist),
      endM: Math.round(samples[e].dist),
      lengthKm: Math.round(lengthKm * 100) / 100,
      startEle: Math.round(ele(samples[s])),
      summitEle: Math.round(summitEle),
      avgGradient: Math.round(avgGradient * 10) / 10,
      maxGradient: Math.round(maxGradient * 10) / 10,
      score: Math.round(score * 10) / 10,
      category: categorize(score),
      irregularityIndex: irregularityIndex(kmBlocks),
      kmBlocks,
    });
  }
  return climbs;
}

/**
 * Détecte les zones où le tracé fait un aller-retour sur lui-même (voir
 * commentaire des constantes BACKTRACK_* ci-dessus). Grille spatiale pour
 * éviter une comparaison O(n²) : chaque échantillon n'est comparé qu'aux
 * échantillons tombant dans la même cellule ou une cellule adjacente.
 * @param samples [{dist, lat, lon, eleRaw?, eleSmooth?}] triés par dist (m)
 * @returns [{ startM, endM }] zones fusionnées (échantillons marqués à moins
 *          de 3 crans d'écart les uns des autres regroupés ensemble)
 */
function detectBacktrackZones(samples) {
  const pts = (samples || []).filter((s) => s.lat != null && s.lon != null);
  if (pts.length < 4) return [];
  const ele = (s) => (s.eleSmooth != null ? s.eleSmooth : s.eleRaw != null ? s.eleRaw : s.ele);

  // Cap local en chaque point : segment vers le point suivant (le dernier
  // point reprend le cap du segment précédent, faute de point suivant).
  const bearings = pts.map((p, i) => {
    const next = i < pts.length - 1 ? pts[i + 1] : pts[i - 1];
    const from = i < pts.length - 1 ? p : pts[i - 1];
    const to = i < pts.length - 1 ? next : p;
    return bearing(from, to);
  });

  const cellKey = (lat, lon) => `${Math.round(lat / BACKTRACK_CELL_DEG)}:${Math.round(lon / BACKTRACK_CELL_DEG)}`;
  const grid = new Map();
  pts.forEach((p, i) => {
    const latCell = Math.round(p.lat / BACKTRACK_CELL_DEG);
    const lonCell = Math.round(p.lon / BACKTRACK_CELL_DEG);
    for (let dlat = -BACKTRACK_CELL_MARGIN; dlat <= BACKTRACK_CELL_MARGIN; dlat++) {
      for (let dlon = -BACKTRACK_CELL_MARGIN; dlon <= BACKTRACK_CELL_MARGIN; dlon++) {
        const k = `${latCell + dlat}:${lonCell + dlon}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });

  const flagged = new Set();
  for (let i = 0; i < pts.length; i++) {
    const candidates = grid.get(cellKey(pts[i].lat, pts[i].lon)) || [];
    for (const j of candidates) {
      if (j <= i || flagged.has(i)) continue;
      if (pts[j].dist - pts[i].dist < BACKTRACK_MIN_SEPARATION_M) continue;
      if (haversine(pts[i], pts[j]) > BACKTRACK_PROXIMITY_M) continue;
      const ei = ele(pts[i]);
      const ej = ele(pts[j]);
      if (ei != null && ej != null && Math.abs(ei - ej) > BACKTRACK_ELEVATION_TOLERANCE_M) continue;
      if (bearingDiff(bearings[i], bearings[j]) < BACKTRACK_BEARING_REVERSAL_MIN) continue;
      flagged.add(i);
      flagged.add(j);
    }
  }
  if (!flagged.size) return [];

  const idxs = [...flagged].sort((a, b) => a - b);
  const zones = [];
  let zs = idxs[0];
  let ze = idxs[0];
  for (let k = 1; k < idxs.length; k++) {
    if (idxs[k] - ze <= 3) {
      ze = idxs[k];
    } else {
      zones.push({ startM: Math.round(pts[zs].dist), endM: Math.round(pts[ze].dist) });
      zs = idxs[k];
      ze = idxs[k];
    }
  }
  zones.push({ startM: Math.round(pts[zs].dist), endM: Math.round(pts[ze].dist) });
  return zones.filter((z) => z.endM - z.startM >= BACKTRACK_MIN_ZONE_LENGTH_M);
}

/**
 * Nomme chaque côte : waypoint de type col le plus proche du sommet (< 1 km le
 * long du tracé), sinon un col/sommet plus loin en avant sur le tracé dont
 * l'altitude connue correspond au sommet détecté (voir plus bas), sinon
 * géocodage inverse du point sommet.
 */
async function nameClimbs(climbs, waypointsOnTrack, samples, reverseGeocodeFn) {
  const ele = (s) => (s.eleSmooth != null ? s.eleSmooth : s.ele);
  for (const c of climbs) {
    let summitWp = (waypointsOnTrack || []).find(
      (w) => (w.kind === 'col' || w.kind === 'peak') && Math.abs(w.alongM - c.endM) < 1500
    );
    // Repli altitude (trouvaille en générant en ligne, 30/08/2026, Tour
    // 1903 étape 1) : un col réel peut avoir un faux-plat/plateau final sous
    // MIN_AVG_GRADIENT après la fin « officielle » (ASO) de la côte détectée
    // ci-dessus — vérifié en direct sur le vrai profil du Col du Pin-Bouchain
    // (Tarare → col, OSRM + RGE ALTI réels) : la côte catégorisée s'arrête à
    // 12,6 km (pente moyenne encore ≥ 3 % jusque-là), mais le point du col
    // lui-même n'est qu'à 14,6 km — 2,0 km plus loin, hors de la fenêtre de
    // 1500 m ci-dessus, alors que l'altitude mesurée au sommet de la côte
    // (761 m) correspond quasi exactement à l'altitude connue du col (759 m,
    // known_cols.json). Repli restreint : uniquement un waypoint PLUS LOIN
    // sur le tracé que la fin de la côte (jamais en arrière — un faux
    // rattachement à un col déjà dépassé serait pire que l'absence de nom),
    // à moins de 5 km (un faux-plat isolé, pas une étape entière), et dont
    // l'altitude connue (`altitude_hint_m`, curatée ou mesurée au
    // géocodage — voir generate.js) est à moins de 40 m de l'altitude
    // mesurée du sommet détecté (`c.summitEle`) — une tolérance resserrée
    // exprès pour rester discriminante en haute montagne, où plusieurs cols
    // peuvent partager une gamme d'altitude proche sur une même étape.
    if (!summitWp) {
      summitWp = (waypointsOnTrack || []).find(
        (w) =>
          (w.kind === 'col' || w.kind === 'peak') &&
          w.alongM > c.endM &&
          w.alongM - c.endM < 5000 &&
          w.altitude_hint_m != null &&
          Math.abs(w.altitude_hint_m - c.summitEle) < 40
      );
    }
    if (summitWp) {
      c.name = summitWp.label;
      c.nameSource = 'waypoint';
      // rawLabel : toponyme nu, sans le préfixe "Côte de" — pipeline/descents.js
      // s'en sert pour nommer la descente qui suit sans doubler un préfixe
      // ("Descente de Côte de X" serait grammaticalement faux).
      c.rawLabel = summitWp.label;
      continue;
    }
    // Point du sommet → géocodage inverse.
    let si = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i].dist - c.endM) < Math.abs(samples[si].dist - c.endM)) si = i;
    }
    try {
      const r = await reverseGeocodeFn(samples[si].lat, samples[si].lon);
      if (r && r.label) {
        c.name = `Côte de ${r.label}`;
        c.nameSource = 'reverse-geocode';
        c.rawLabel = r.label;
      } else {
        // Requête résolue sans exception, mais sans label exploitable (ex.
        // feature Géoplateforme sans city/label/name — pipeline/geocode.js
        // reverseGeocode() peut renvoyer ce cas sans passer par le repli
        // Nominatim, qui lui garantit toujours un label). Même repli
        // générique que l'échec réseau ci-dessous — même 'defaut' :
        // trouvaille de relecture adverse (27/08/2026) sur un correctif
        // frontend qui distinguait 'reverse-geocode' de 'defaut' pour
        // l'affichage : avant ce correctif, ce cas précis (résolution sans
        // label) portait à tort 'reverse-geocode', comme si un vrai
        // toponyme avait été trouvé.
        c.name = `Côte du km ${(c.endM / 1000).toFixed(0)}`;
        c.nameSource = 'defaut';
      }
    } catch {
      c.name = `Côte du km ${(c.endM / 1000).toFixed(0)}`;
      c.nameSource = 'defaut';
    }
    void ele;
  }
  return climbs;
}

module.exports = {
  detectClimbs, nameClimbs, categorize, irregularityIndex, detectBacktrackZones,
  MIN_LENGTH_M, MIN_AVG_GRADIENT, MERGE_GAP_M,
  BACKTRACK_PROXIMITY_M, BACKTRACK_ELEVATION_TOLERANCE_M, BACKTRACK_BEARING_REVERSAL_MIN, BACKTRACK_MIN_SEPARATION_M,
  BACKTRACK_MIN_ZONE_LENGTH_M,
};
