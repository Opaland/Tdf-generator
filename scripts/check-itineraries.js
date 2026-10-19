'use strict';
// Contrôle des itinéraires détaillés (Epic 33) contre la tolérance du projet
// (DIST_TOLERANCE_PCT, ±5 %, pipeline/checks.js) : l'itinéraire transcrit,
// routé point par point, doit retrouver le kilométrage du profil officiel.
// Le géocodage (scripts/geocode-itineraries.js) ne vérifie que la ligne
// droite (une route n'est jamais plus courte) ; ce contrôle vérifie l'autre
// sens — un point mal placé allonge la route, une ville omise aussi.
//
// Usage : node scripts/check-itineraries.js [--write] [--legs] [année | année/étape …]   (réseau requis)
// --legs : pour chaque étape, liste les tronçons suspects (isSuspectLeg) et
// les allers-retours (isBacktrack).
// --write : enregistre route_check {routed_km, profile_km, delta_pct,
// tolerance_pct, coverage_pct, car_legs, legs, suspect_legs, backtracks,
// backtracks_uncertain} dans pipeline/data/stage_itineraries.json — l'écart
// est affiché par la recherche par lieu, jamais masqué (décision du
// 18/10/2026 : mesurer et afficher, corriger les vraies erreurs une à une) ;
// les décomptes de tronçons suspects et d'allers-retours restent dans le
// fichier, pour la curation.

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.ETAPEFORGE_DATA_DIR = process.env.ETAPEFORGE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-itincheck-'));

const { routeLeg } = require('../pipeline/routing');
const { DIST_TOLERANCE_PCT } = require('../pipeline/checks');
const { buildItinerary } = require('../pipeline/placeSearch');
const { haversine } = require('../pipeline/geo');

const FILE = path.join(__dirname, '..', 'pipeline', 'data', 'stage_itineraries.json');
const TOWNS_FILE = path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json');
const round1 = (v) => Math.round(v * 10) / 10;

/** Longueur officielle de l'étape : length_km du profil, sinon la distance
 * de stage_towns (Wikipédia), sinon le dernier km transcrit d'une
 * transcription complète. Partielle sans longueur connue → null : la part
 * contrôlée de l'étape serait inconnue (relecture adverse). */
function officialKm(st, townsStage) {
  if (Number.isFinite(st.length_km)) return st.length_km;
  if (townsStage && Number.isFinite(townsStage.distanceKm)) return townsStage.distanceKm;
  if (!st.partial && st.towns.length) return st.towns[st.towns.length - 1].km;
  return null;
}

/** Points mesurés d'une étape : tout le profil, sauf un circuit final
 * (`circuit_km`, km de l'entrée sur le circuit lu sur le profil) — les tours
 * des Champs-Élysées ne se routent pas d'un point au suivant, ils
 * fausseraient l'écart (1990/21 : −36 % avec 60 km de circuit). La part
 * mesurée baisse d'autant, et se publie (coverage_pct). */
function measuredTowns(st) {
  return Number.isFinite(st.circuit_km) ? st.towns.filter((t) => t.km <= st.circuit_km) : st.towns;
}

/** Points routables d'une étape : ceux que la recherche utilise (une côte ou
 * un lieu-dit placé au centre de sa commune n'est pas sur la route). */
function routablePoints(towns) {
  return buildItinerary(towns).points;
}

/**
 * Écart entre la distance routée et le kilométrage du profil, du premier au
 * dernier point routable. `legRouter(a, b)` → distance en mètres (injectable).
 * Retourne null s'il y a moins de deux points, ou moins de 50 % du profil
 * couvert (le contrôle ne dirait rien de l'étape).
 */
async function checkStage(towns, legRouter, totalKm) {
  // Le km 0 d'un profil est le départ réel, souvent hors de la ville de
  // départ (zone neutralisée : 1992/14, km 0 « Sestrières » mais Montgenèvre
  // au km 7,5, soit Cesana ; 1992/10, Hesperange). Le premier tronçon n'est
  // donc pas mesurable — même raison que START_SLACK_M au géocodage.
  const { points, segments } = buildItinerary(towns);
  const pts = points.filter((p, i) => !(i === 0 && p.km === 0));
  // Points atteints sans sauter de point retiré (même règle que les segments
  // tracés) : un tronçon qui en saute un n'est pas la vraie route.
  const contiguous = new Set(segments.map(([, b]) => b));
  if (pts.length < 2 || !Number.isFinite(totalKm) || !(totalKm > 0)) return null;
  const profileKm = pts[pts.length - 1].km - pts[0].km;
  if (!(profileKm > 0) || profileKm < totalKm * 0.5) return null;
  const r = await measure(pts, profileKm, legRouter, contiguous);
  // Part de l'étape réellement contrôlée : publiée avec l'écart, pour qu'une
  // mesure sur 60 % du parcours ne se lise jamais comme celle de l'étape.
  return { ...r, coveragePct: Math.min(100, Math.round((profileKm / totalKm) * 100)) };
}

async function measure(pts, profileKm, legRouter, contiguous = null) {
  const legs = [];
  let routedM = 0;
  let prevPts = null;
  let prevContig = true;
  for (let i = 1; i < pts.length; i++) {
    const r = await legRouter(pts[i - 1], pts[i]);
    const m = typeof r === 'number' ? r : r.distanceM;
    const geom = typeof r === 'number' ? null : r.points;
    routedM += m;
    legs.push({ from: pts[i - 1].label, to: pts[i].label, profileKm: round1(pts[i].km - pts[i - 1].km), routedKm: m / 1000, crowKm: haversine(pts[i - 1], pts[i]) / 1000, router: typeof r === 'number' ? null : r.router,
      retracedKm: retracedKm(prevPts, geom) });
    // Aller-retour incertain si l'un des deux tronçons comparés saute un
    // point retiré : le routeur ne suit pas la vraie route (relecture 33.14).
    const contig = !contiguous || contiguous.has(pts[i]);
    legs[legs.length - 1].skipsPoint = !(contig && prevContig);
    prevContig = contig;
    prevPts = geom;
  }
  const routedKm = routedM / 1000;
  // Arrondi avant le verdict : c'est la valeur publiée qui doit le porter.
  const deltaPct = round1((routedKm / profileKm - 1) * 100);
  // Part des tronçons routés en voiture (repli OSRM quand BRouter refuse) :
  // la mesure en dépend, elle se publie avec elle.
  const carLegs = legs.filter((l) => l.router === 'osrm').length;
  return { routedKm, profileKm, deltaPct, ok: Math.abs(deltaPct) <= DIST_TOLERANCE_PCT, legs, carLegs, suspectLegs: legs.filter(isSuspectLeg).length,
    backtracks: legs.filter(isBacktrack).length, uncertainBacktracks: legs.filter(isUncertainBacktrack).length };
}

/** Distance (m) d'un point à une polyligne, projection locale équirectangulaire. */
function distToPolylineM(p, line) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i].lon - p.lon) * kx, ay = (line[i].lat - p.lat) * ky;
    if (i === 0) { best = Math.min(best, Math.hypot(ax, ay)); continue; }
    const bx = (line[i - 1].lon - p.lon) * kx, by = (line[i - 1].lat - p.lat) * ky;
    const dx = ax - bx, dy = ay - by;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(bx * dx + by * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(bx + t * dx, by + t * dy));
  }
  return best;
}

/**
 * Aller-retour (Epic 33.14) : un Tour ne rejoint jamais un point pour
 * revenir sur ses pas (demande utilisateur du 19/10/2026). Km du tracé
 * sortant d'un point qui reprennent la route du tracé entrant — à
 * BACKTRACK_TOL_M près. Un point posé à l'écart de la route
 * (centre de commune, homonyme) ou dans le mauvais ordre force ce
 * demi-tour ; un virage serré vers une autre vallée ne reprend aucune route.
 */
const BACKTRACK_TOL_M = 30;
const BACKTRACK_MIN_KM = 1;
function retracedKm(inPts, outPts, tolM = BACKTRACK_TOL_M) {
  if (!inPts?.length || !outPts?.length) return 0;
  // Tout segment sortant dont les deux bouts sont sur la route d'arrivée
  // compte, pas seulement le début : une petite boucle avant de reprendre la
  // même route reste un aller-retour. Hors de l'emprise du tracé entrant
  // (élargie de la tolérance), rien à chercher.
  const pad = tolM / 100000;
  const lat0 = Math.min(...inPts.map((p) => p.lat)) - pad, lat1 = Math.max(...inPts.map((p) => p.lat)) + pad;
  const lon0 = Math.min(...inPts.map((p) => p.lon)) - pad * 2, lon1 = Math.max(...inPts.map((p) => p.lon)) + pad * 2;
  const near = (p) => p.lat >= lat0 && p.lat <= lat1 && p.lon >= lon0 && p.lon <= lon1 && distToPolylineM(p, inPts) <= tolM;
  const onIn = outPts.map(near);
  let m = 0;
  for (let i = 1; i < outPts.length; i++) {
    // Milieu aussi sur la route : un segment long qui coupe en corde entre
    // deux points du tracé entrant ne reprend aucune route (relecture 33.14).
    const a = outPts[i - 1], b = outPts[i];
    if (onIn[i] && onIn[i - 1] && near({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 })) m += haversine(a, b);
  }
  return m / 1000; // non arrondi : le seuil porte sur la valeur exacte
}

function isBacktrack(l) {
  return l.retracedKm >= BACKTRACK_MIN_KM && !l.skipsPoint;
}

/** Aller-retour mesuré sur un tronçon qui saute un point retiré : signalé à
 * part, jamais compté comme certain (CLAUDE.md, règle 12). */
function isUncertainBacktrack(l) {
  return l.retracedKm >= BACKTRACK_MIN_KM && !!l.skipsPoint;
}

/**
 * Tronçon suspect (Epic 33.11) : le total d'une étape compense les erreurs
 * d'un tronçon à l'autre — une trentaine de km décalés d'un cran en 1987
 * laissaient l'écart global inchangé. Suspect si le km du profil est plus
 * court que la ligne droite (impossible par la route, 1 km de marge pour les
 * centres de commune), ou si la route s'écarte du profil d'au moins 3 km et
 * d'un facteur 1,4 (point mal placé) ou 0,7 (ville omise, km décalé).
 */
function isSuspectLeg(l) {
  if (l.crowKm > l.profileKm + 1) return true;
  const ratio = l.profileKm > 0 ? l.routedKm / l.profileKm : Infinity;
  return Math.abs(l.routedKm - l.profileKm) >= 3 && (ratio >= 1.4 || ratio <= 0.7);
}

/** Contrôle d'une étape telle qu'elle est stockée : circuit final retiré,
 * longueur officielle (profil, sinon stage_towns). C'est ce que main() mesure. */
function checkStoredStage(st, legRouter, townsStage) {
  return checkStage(measuredTowns(st), legRouter, officialKm(st, townsStage));
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const showLegs = args.includes('--legs');
  const only = args.filter((a) => !a.startsWith('--'));
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let townsDoc = null;
  try { townsDoc = JSON.parse(fs.readFileSync(TOWNS_FILE, 'utf8')); } catch { /* longueurs facultatives */ }
  const townsStage = (edition, stage) => (townsDoc?.editions?.[edition]?.stages || []).find((x) => String(x.number) === String(stage).replace(/[a-z]$/, ''));
  const router = (a, b) => routeLeg(a, b);
  for (const [edition, ed] of Object.entries(doc.editions)) {
    for (const [stage, st] of Object.entries(ed.stages)) {
      // Filtre : une édition entière (« 1987 ») ou une étape (« 1987/14 »).
      if (only.length && !only.includes(edition) && !only.includes(`${edition}/${stage}`)) continue;
      let r;
      try {
        r = await checkStoredStage(st, router, townsStage(edition, stage));
      } catch (err) {
        console.log(`${edition}/${stage} : routage impossible (${err.message})`);
        if (write) delete st.route_check; // jamais une mesure périmée affichée
        continue;
      }
      if (!r) {
        console.log(`${edition}/${stage} : non contrôlable (points routables insuffisants ou longueur inconnue)`);
        if (write) delete st.route_check;
        continue;
      }
      const sign = r.deltaPct >= 0 ? '+' : '';
      const worst = [...r.legs].sort((a, b) => (b.routedKm - b.profileKm) - (a.routedKm - a.profileKm))[0];
      console.log(`${edition}/${stage} : ${r.ok ? 'ok  ' : 'HORS'} ${sign}${r.deltaPct.toFixed(1)} % (routé ${r.routedKm.toFixed(1)} km / profil ${r.profileKm.toFixed(1)} km, ${r.coveragePct} % de l'étape)` +
        (r.ok ? '' : ` — pire tronçon ${worst.from} → ${worst.to} : ${worst.routedKm.toFixed(1)} km routés pour ${worst.profileKm} km`));
      if (showLegs) {
        // Toutes les étapes, pas seulement celles hors tolérance : un km faux
        // au milieu ne change pas le total (relecture 1987).
        for (const l of r.legs.filter(isSuspectLeg)) {
          console.log(`    ${l.from} → ${l.to} : ${l.routedKm.toFixed(1)} km routés, ${l.crowKm.toFixed(1)} à vol d'oiseau, pour ${l.profileKm} km au profil (${l.router || '?'})`);
        }
        for (const l of r.legs.filter(isBacktrack)) {
          console.log(`    aller-retour à ${l.from} : ${l.retracedKm.toFixed(1)} km repris en sens inverse vers ${l.to} (${l.router || '?'})`);
        }
        for (const l of r.legs.filter(isUncertainBacktrack)) {
          console.log(`    aller-retour incertain à ${l.from} (point non placé sauté) : ${l.retracedKm.toFixed(1)} km repris vers ${l.to} (${l.router || '?'})`);
        }
      }
      if (write) {
        st.route_check = { routed_km: round1(r.routedKm), profile_km: r.profileKm, delta_pct: r.deltaPct,
          tolerance_pct: DIST_TOLERANCE_PCT, coverage_pct: r.coveragePct, car_legs: r.carLegs, legs: r.legs.length, suspect_legs: r.suspectLegs, backtracks: r.backtracks, backtracks_uncertain: r.uncertainBacktracks };
      }
    }
  }
  if (write) fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { checkStage, checkStoredStage, routablePoints, officialKm, measuredTowns, isSuspectLeg, isBacktrack, isUncertainBacktrack, retracedKm };
