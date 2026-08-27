'use strict';
// Géocodage : France → Géoplateforme (data.geopf.fr), hors France → Nominatim
// (User-Agent dédié, max 1 req/s). Tout passe par le cache SQLite geocode_cache.
// En mode hors-ligne : simulateur déterministe (fournisseur 'simulateur').

const { httpJson, isOffline } = require('./http');
const { cached, cachePut } = require('./cache');
const { simGeocode, simReverseGeocode, simElevation } = require('./simulator');
const { haversine } = require('./geo');

const FRANCE_BBOX = { latMin: 41.0, latMax: 51.5, lonMin: -5.5, lonMax: 10.0 };

function looksLikeFrance(lat, lon) {
  return (
    lat >= FRANCE_BBOX.latMin && lat <= FRANCE_BBOX.latMax &&
    lon >= FRANCE_BBOX.lonMin && lon <= FRANCE_BBOX.lonMax
  );
}

function isColQuery(q) {
  return /\b(col|cote|côte|montee|montée|pic|puy|mont|alpe|plateau|station)\b/i.test(q);
}

/**
 * Choisit le meilleur résultat de géocodage : pour une ville/lieu de passage,
 * une commune bat une rue ou un département homonyme (« Vienne » ne doit pas
 * résoudre sur le département de la Vienne quand on trace Lyon → Marseille).
 *
 * `near`, quand fourni, décide seul par distance réelle plutôt que par le
 * classement de l'API — trouvaille en générant en masse avec un vrai accès
 * réseau (26/08/2026) : géocoder « Butte Montmartre » biaisé près de
 * Mantes-la-Ville (lat/lon envoyés à l'API) renvoyait la vraie colline
 * parisienne en DERNIÈRE position (score texte le plus faible), classée
 * derrière trois rues homonymes sans rapport — dont une à Marseille,
 * à 700 km — parce que le paramètre lat/lon de la Géoplateforme n'est
 * qu'une préférence pour son propre classement, jamais un filtre garanti.
 * Résultat concret avant ce correctif : une étape à 1580 km reconstituée
 * pour un aller-retour Paris-Marseille inexistant sur le vrai parcours.
 *
 * Choix délibéré (relecture adverse, 26/08/2026) : `near`, quand fourni,
 * prime aussi sur la règle « pour un col, on garde le classement POI »
 * ci-dessous — les mêmes homonymies lointaines existent pour les cols
 * (« Col du Télégraphe », « Col de Toses » résolus à des centaines de km
 * du bon massif dans des étapes réelles générées cette session) et le
 * proche du waypoint précédent reste le signal le plus fiable, même pour
 * un sommet. Testé explicitement (contrairement à avant ce correctif, où
 * cette interaction n'était exercée par aucun test alors que
 * pipeline/generate.js l'exerce systématiquement en production).
 *
 * Limite connue, non corrigeable par ce même mécanisme : le tout premier
 * waypoint d'une étape (kind: 'start') n'a jamais de `near` — aucun
 * waypoint précédent pour l'ancrer — donc reste exposé à une homonymie
 * lointaine sur le point de départ, exactement le type de requête le plus
 * exposé (une ville, cherchée sans aucun contexte géographique).
 */
function pickFeature(feats, query, near) {
  if (!feats.length) return null;
  if (near) {
    // Ignore les candidats sans coordonnées exploitables : une comparaison
    // haversine impliquant NaN est toujours fausse, donc feats.reduce()
    // sans ce filtre garderait le tout premier candidat malformé quels que
    // soient les suivants, même valides et proches (relecture adverse,
    // 26/08/2026) — jamais rencontré en pratique sur l'API Géoplateforme
    // (coordinates toujours deux nombres finis dans les réponses observées),
    // mais un garde-fou peu coûteux contre une réponse dégradée.
    const withCoords = feats.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon));
    if (withCoords.length) {
      return withCoords.reduce((best, f) => (haversine(near, f) < haversine(near, best) ? f : best));
    }
  }
  if (!isColQuery(query)) {
    const commune = feats.find((f) => f.type === 'municipality' || f.type === 'city');
    if (commune) return commune;
  }
  return feats[0];
}

// La Géoplateforme rejette carrément certaines requêtes en HTTP 400 (ex. un
// nom de ville néerlandaise commençant par une apostrophe, "'s-Hertogen-
// bosch" — leur validation exige « must ... start with a number or a
// letter », vérifié en interrogeant l'API réelle, pas une supposition
// d'encodage) plutôt que de répondre 0 résultat comme pour toute requête
// simplement hors de son référentiel français. httpJson() marque un tel 4xx
// `nonRetryable` et le laisse remonter tel quel — sans ce filet, l'exception
// plantait toute la génération de l'étape (via geocode()) ou renvoyait un
// 500 générique sur les routes interactives (via reverseGeocode()/
// geocodeSuggest(), backend/server.js) au lieu de retomber sur le même
// repli « aucun résultat » déjà prévu partout ailleurs dans ce fichier
// (trouvaille en générant en masse avec un vrai accès réseau, 27/08/2026 —
// puis grep exhaustif sur `data.geopf.fr` via relecture adverse : les trois
// autres appels Géoplateforme du fichier avaient le même trou, pas
// seulement celui de `geocode()`, CLAUDE.md règle 1).
//
// Seule une erreur 4xx de la Géoplateforme elle-même est avalée ici — une
// vraie panne réseau/5xx (déjà épuisé ses retries dans httpJson) continue
// de remonter normalement. `cachePut` explicite sur le catch : `cached()`
// ne mémorise que le retour RÉUSSI de `fn()`, donc sans cette écriture
// manuelle un rejet 4xx permanent (ex. un nom de lieu que la Géoplateforme
// refusera toujours) redéclencherait un vrai appel réseau à chaque
// régénération future de la même étape, contrairement au cas « 0 résultat »
// qui reste en cache indéfiniment (trouvaille de relecture adverse). Le
// `console.warn` est le seul signal restant si un futur bug de construction
// de requête dans notre propre code (jamais rencontré à ce jour, vérifié
// par relecture adverse) se dégradait aussi silencieusement vers Nominatim.
async function geopfOrNull(kind, request, fn) {
  try {
    const { value } = await cached('geocode', kind, request, fn);
    return value;
  } catch (err) {
    if (err.nonRetryable) {
      console.warn(`[geocode] Géoplateforme a rejeté la requête (${kind}) : ${err.message}`);
      cachePut('geocode', kind, request, null);
      return null;
    }
    throw err;
  }
}

/**
 * Géocode un libellé. `countryHint` ('fr' par défaut) choisit le fournisseur.
 * `near` ({lat, lon}) biaise vers la proximité — indispensable pour lever les
 * homonymies quand on géocode les waypoints d'une étape de proche en proche.
 * Retourne { label, lat, lon, ele?, provider, raw? }.
 */
async function geocode(query, { countryHint = 'fr', near = null, summit = false } = {}) {
  if (isOffline()) {
    const { value } = await cached('geocode', 'simulateur', { q: query }, async () => simGeocode(query));
    return value;
  }
  const nearKey = near ? [Math.round(near.lat * 10) / 10, Math.round(near.lon * 10) / 10] : null;
  if (countryHint === 'fr') {
    const geopfSearch = async (index) => {
      let url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5&index=${index}`;
      if (near) url += `&lat=${near.lat.toFixed(4)}&lon=${near.lon.toFixed(4)}`;
      const json = await httpJson(url, { minDelayMs: 120 });
      const feats = (json.features || []).map((f) => ({
        label: f.properties.label || f.properties.name || query,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        type: f.properties.type,
        score: f.properties.score,
        provider: 'geopf',
      }));
      return pickFeature(feats, query, near);
    };
    // Un sommet déclaré (waypoint « col ») se cherche d'abord dans l'index POI
    // seul : « Hautacam » n'a aucun mot-clé de col et sinon une adresse
    // homonyme lointaine peut l'emporter. geopfOrNull() (voir plus haut) avale
    // un rejet 4xx de la Géoplateforme comme un « 0 résultat ».
    if (summit) {
      const value = await geopfOrNull('geopf-poi', { q: query, near: nearKey }, () => geopfSearch('poi'));
      if (value) return value;
    }
    const value = await geopfOrNull('geopf', { q: query, near: nearKey }, () => geopfSearch('address,poi'));
    if (value) return value;
    // Repli : Nominatim si la Géoplateforme ne trouve rien (ou rejette la requête).
  }
  const { value } = await cached('geocode', 'nominatim', { q: query }, async () => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&accept-language=fr`;
    const json = await httpJson(url, { minDelayMs: 1100 }); // max 1 req/s
    if (!json.length) return null;
    const r = json[0];
    return {
      label: r.display_name.split(',').slice(0, 2).join(','),
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      type: r.type,
      provider: 'nominatim',
    };
  });
  if (!value) throw new Error(`Géocodage sans résultat : « ${query} »`);
  return value;
}

/**
 * Géocode un col : localise le sommet (avec biais de proximité éventuel) puis
 * vérifie/complète l'altitude (échantillon d'altimétrie au point trouvé).
 */
async function geocodeCol(query, opts = {}) {
  const res = await geocode(query, { ...opts, summit: true });
  const { sampleElevations } = require('./elevation'); // import tardif (cycle)
  try {
    const eles = await sampleElevations([{ lat: res.lat, lon: res.lon }]);
    res.eleChecked = eles[0];
    if (res.ele == null) res.ele = eles[0];
  } catch {
    if (res.ele == null && isOffline()) res.ele = Math.round(simElevation(res.lat, res.lon));
  }
  return res;
}

/** Géocodage inverse (nommage des sommets, clic sur la carte). */
async function reverseGeocode(lat, lon) {
  lat = Math.round(lat * 1e5) / 1e5;
  lon = Math.round(lon * 1e5) / 1e5;
  if (isOffline()) {
    const { value } = await cached('geocode', 'simulateur-reverse', { lat, lon }, async () =>
      simReverseGeocode(lat, lon)
    );
    return value;
  }
  if (looksLikeFrance(lat, lon)) {
    const value = await geopfOrNull('geopf-reverse', { lat, lon }, async () => {
      const url = `https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=1`;
      const json = await httpJson(url, { minDelayMs: 120 });
      const f = (json.features || [])[0];
      // Commune de préférence : pour nommer une côte, « Aucun » vaut mieux
      // que « 16 Rue des Pyrénées 65400 Aucun ».
      return f
        ? { label: f.properties.city || f.properties.label || f.properties.name, provider: 'geopf' }
        : null;
    });
    if (value) return value;
  }
  const { value } = await cached('geocode', 'nominatim-reverse', { lat, lon }, async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=fr&zoom=14`;
    const json = await httpJson(url, { minDelayMs: 1100 });
    if (!json || !json.display_name) return null;
    return { label: json.display_name.split(',').slice(0, 2).join(','), provider: 'nominatim' };
  });
  return value || { label: `(${lat.toFixed(3)}, ${lon.toFixed(3)})`, provider: 'aucun' };
}

/** Suggestions pour l'autocomplétion de l'éditeur (jusqu'à 5 résultats). */
async function geocodeSuggest(query) {
  if (!query || query.trim().length < 2) return [];
  if (isOffline()) {
    const { GAZETTEER } = require('./simulator');
    const norm = (s) =>
      String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const q = norm(query);
    const hits = GAZETTEER.filter((g) => norm(g.name).includes(q)).slice(0, 5).map((g) => ({
      label: g.name,
      lat: g.lat,
      lon: g.lon,
      ele: g.ele,
      kind: g.kind === 'peak' ? 'col' : 'via',
      provider: 'simulateur',
    }));
    if (hits.length) return hits;
    const s = simGeocode(query);
    return [{ label: s.label, lat: s.lat, lon: s.lon, ele: s.ele, kind: 'via', provider: 'simulateur' }];
  }
  const value = await geopfOrNull('geopf-suggest', { q: query }, async () => {
    const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5&index=address,poi`;
    const json = await httpJson(url, { minDelayMs: 120 });
    return (json.features || []).map((f) => ({
      label: f.properties.label || f.properties.name,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      kind: isColQuery(f.properties.label || '') ? 'col' : 'via',
      provider: 'geopf',
    }));
  });
  // value peut être `null` (requête rejetée par geopfOrNull) autant que [],
  // jamais laissé remonter tel quel : le contrat de geocodeSuggest() est un
  // tableau, jamais null (autocomplétion — un null ferait planter le .map()
  // ou le rendu côté frontend, contrairement à geocode()/reverseGeocode()
  // qui ont chacun un repli explicite sur `null`).
  return value || [];
}

module.exports = { geocode, geocodeCol, reverseGeocode, geocodeSuggest, looksLikeFrance, isColQuery, pickFeature };
