'use strict';
// Contrôle des itinéraires détaillés (Epic 33) contre la tolérance du projet
// (DIST_TOLERANCE_PCT, ±5 %, pipeline/checks.js) : l'itinéraire transcrit,
// routé point par point, doit retrouver le kilométrage du profil officiel.
// Le géocodage (scripts/geocode-itineraries.js) ne vérifie que la ligne
// droite (une route n'est jamais plus courte) ; ce contrôle vérifie l'autre
// sens — un point mal placé allonge la route, une ville omise aussi.
//
// Usage : node scripts/check-itineraries.js [--write] [année …]   (réseau requis)
// --write : enregistre route_check {routed_km, profile_km, delta_pct,
// tolerance_pct, car_legs, legs} dans pipeline/data/stage_itineraries.json —
// affiché par la recherche par lieu, jamais masqué (décision du 18/10/2026 :
// mesurer et afficher, corriger les vraies erreurs une à une).

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.ETAPEFORGE_DATA_DIR = process.env.ETAPEFORGE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-itincheck-'));

const { routeLeg } = require('../pipeline/routing');
const { DIST_TOLERANCE_PCT } = require('../pipeline/checks');
const { buildItinerary } = require('../pipeline/placeSearch');

const FILE = path.join(__dirname, '..', 'pipeline', 'data', 'stage_itineraries.json');

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
  const pts = routablePoints(towns).filter((p, i) => !(i === 0 && p.km === 0));
  if (pts.length < 2) return null;
  const profileKm = pts[pts.length - 1].km - pts[0].km;
  const total = Number.isFinite(totalKm) ? totalKm : towns[towns.length - 1].km;
  if (!(profileKm > 0) || profileKm < total * 0.5) return null;
  return measure(pts, profileKm, legRouter);
}

async function measure(pts, profileKm, legRouter) {
  const legs = [];
  let routedM = 0;
  for (let i = 1; i < pts.length; i++) {
    const r = await legRouter(pts[i - 1], pts[i]);
    const m = typeof r === 'number' ? r : r.distanceM;
    routedM += m;
    legs.push({ from: pts[i - 1].label, to: pts[i].label, profileKm: pts[i].km - pts[i - 1].km, routedKm: m / 1000, router: typeof r === 'number' ? null : r.router });
  }
  const routedKm = routedM / 1000;
  const deltaPct = (routedKm / profileKm - 1) * 100;
  // Part des tronçons routés en voiture (repli OSRM quand BRouter refuse) :
  // la mesure en dépend, elle se publie avec elle.
  const carLegs = legs.filter((l) => l.router === 'osrm').length;
  return { routedKm, profileKm, deltaPct, ok: Math.abs(deltaPct) <= DIST_TOLERANCE_PCT, legs, carLegs };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const only = args.filter((a) => a !== '--write');
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const router = (a, b) => routeLeg(a, b);
  for (const [edition, ed] of Object.entries(doc.editions)) {
    if (only.length && !only.includes(edition)) continue;
    for (const [stage, st] of Object.entries(ed.stages)) {
      let r;
      try {
        r = await checkStage(st.towns, router, st.length_km);
      } catch (err) {
        console.log(`${edition}/${stage} : routage impossible (${err.message})`);
        continue;
      }
      if (!r) {
        console.log(`${edition}/${stage} : non contrôlable (points routables insuffisants)`);
        continue;
      }
      const sign = r.deltaPct >= 0 ? '+' : '';
      const worst = [...r.legs].sort((a, b) => (b.routedKm - b.profileKm) - (a.routedKm - a.profileKm))[0];
      console.log(`${edition}/${stage} : ${r.ok ? 'ok  ' : 'HORS'} ${sign}${r.deltaPct.toFixed(1)} % (routé ${r.routedKm.toFixed(1)} km / profil ${r.profileKm.toFixed(1)} km)` +
        (r.ok ? '' : ` — pire tronçon ${worst.from} → ${worst.to} : ${worst.routedKm.toFixed(1)} km routés pour ${worst.profileKm} km`));
      if (write) {
        st.route_check = { routed_km: Math.round(r.routedKm * 10) / 10, profile_km: r.profileKm, delta_pct: Math.round(r.deltaPct * 10) / 10,
          tolerance_pct: DIST_TOLERANCE_PCT, car_legs: r.carLegs, legs: r.legs.length };
      }
    }
  }
  if (write) fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { checkStage, routablePoints };
