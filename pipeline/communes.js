'use strict';
// Communes traversées par le tracé reconstitué (Epic 12, option B de
// docs/PROPOSITION-VILLAGES-TRAVERSES.md) : calculées À LA DEMANDE depuis la
// fiche, jamais pendant la génération. Un point du tracé tous les
// STEP_M mètres, chacun situé par geo.api.gouv.fr (point dans polygone : la
// commune qui CONTIENT le point, pas l'adresse la plus proche — le reverse
// Géoplateforme renvoyait 40 % de réponses vides sur des points de route,
// mesuré le 17/10/2026). France seulement : hors du cadre français, rien
// n'est demandé et le résultat le dit, plutôt qu'un repli Nominatim lent.
//
// « Commune traversée » ne veut pas dire « bourg traversé » : le tracé peut
// couper un territoire communal sans passer par son village. Le libellé
// affiché le dit.

const { httpJson } = require('./http');
const { cached } = require('./cache');
const { looksLikeFrance } = require('./geocode');

const STEP_M = 1000;
const GEOAPI_BASE = process.env.ETAPEFORGE_GEOAPI || 'https://geo.api.gouv.fr';

function r5(x) {
  return Math.round(x * 1e5) / 1e5;
}

/** Commune contenant le point, ou null (point hors de toute commune, en mer…). */
async function communeAt(lat, lon) {
  const req = { lat: r5(lat), lon: r5(lon) };
  const { value } = await cached('api', 'geoapi-commune', req, async () => {
    const url = `${GEOAPI_BASE}/communes?lat=${req.lat}&lon=${req.lon}&fields=nom,code,codeDepartement&format=json`;
    // Pas de limite publiée (CGU consultées le 17/10/2026) : même courtoisie
    // que la Géoplateforme.
    const json = await httpJson(url, { minDelayMs: 120 });
    const c = Array.isArray(json) ? json[0] : null;
    if (!c || typeof c.nom !== 'string') return null;
    return { nom: c.nom, code: typeof c.code === 'string' ? c.code : null, departement: typeof c.codeDepartement === 'string' ? c.codeDepartement : null };
  });
  return value;
}

/**
 * Échantillonne `samples` (profil d'altitude : {dist_m, lat, lon}) tous les
 * `stepM` mètres et renvoie la suite des communes traversées, consécutives
 * dédoublonnées, avec le km d'entrée mesuré au pas près.
 * Retour : { stepM, points, pointsHorsFrance, pointsSansCommune, communes: [{ nom, code, departement, km }] }
 */
async function communesAlong(samples, { stepM = STEP_M, onProgress } = {}) {
  const pts = [];
  let next = 0;
  for (const s of samples || []) {
    if (s.lat == null || s.lon == null || !Number.isFinite(s.dist_m)) continue;
    if (s.dist_m >= next) {
      pts.push(s);
      next = s.dist_m + stepM;
    }
  }
  const communes = [];
  let horsFrance = 0;
  let sansCommune = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!looksLikeFrance(p.lat, p.lon)) {
      horsFrance++;
      continue;
    }
    const c = await communeAt(p.lat, p.lon);
    if (!c) sansCommune++;
    else if (communes.at(-1)?.code !== c.code || communes.at(-1)?.nom !== c.nom) {
      communes.push({ ...c, km: Math.round(p.dist_m / 100) / 10 });
    }
    if (onProgress && i % 20 === 0) onProgress({ done: i + 1, total: pts.length });
  }
  return { stepM, points: pts.length, pointsHorsFrance: horsFrance, pointsSansCommune: sansCommune, communes };
}

module.exports = { communesAlong, communeAt, STEP_M, GEOAPI_BASE };
