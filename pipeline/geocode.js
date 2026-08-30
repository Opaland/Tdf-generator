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

function isCommuneFeat(f) {
  return f.type === 'municipality' || f.type === 'city';
}

function normLabel(s) {
  return String(s || '').trim().toLowerCase();
}

// Index POI de la Géoplateforme (sommets, communes atteintes sans numéro de
// voie) : pas de `properties.label` (un tableau `name` à la place) —
// schéma différent de l'index adresse. Partagé entre geopfSearch() (via
// geocode()) et geocodeSuggest() — même endpoint, même `index=address,poi`,
// même risque de label resté un tableau JS brut plutôt qu'une chaîne
// (trouvaille de relecture adverse, 28/08/2026 : le correctif POI initial
// de ce fichier n'avait normalisé que l'appelant geocode(), pas
// geocodeSuggest(), qui interroge pourtant le même endpoint).
function geopfLabel(props, fallback) {
  const name = Array.isArray(props.name) ? props.name[0] : props.name;
  return props.label || name || fallback;
}

/**
 * Choisit le meilleur résultat de géocodage : pour une ville/lieu de passage,
 * une commune bat une rue ou un département homonyme (« Vienne » ne doit pas
 * résoudre sur le département de la Vienne quand on trace Lyon → Marseille).
 *
 * Deux communes homonymes peuvent partager un score Géoplateforme strictement
 * identique (ex. « Moûtiers », Savoie, vs son homonyme sans accent de
 * Meurthe-et-Moselle) — l'ordre de l'API sur une égalité de score n'est pas
 * garanti stable. Parmi les communes candidates, on préfère celle dont le
 * libellé correspond EXACTEMENT (accent compris) à la requête, plutôt que de
 * s'en remettre à cet ordre — trouvaille en vérifiant ce correctif contre les
 * vraies données après régénération complète (28/08/2026) : la commune
 * savoyarde, portée par l'étape réelle (Tour 1994, étape 18), perdait contre
 * son homonyme lorrain sur cette seule ambiguïté d'ordre.
 *
 * `near`, quand fourni, décide par distance réelle plutôt que par le
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
 * Restriction ajoutée au même correctif (28/08/2026) : la distance réelle ne
 * départage plus TOUS les candidats sans distinction dès qu'une commune
 * candidate existe — sinon une rue homonyme plus proche du waypoint précédent
 * bat la vraie ville (ex. « Impasse Strasbourg », 40 km, bat la vraie
 * Strasbourg, 180 km, pourtant la bonne réponse pour un enchaînement Tour
 * 1992 Luxembourg City → Strasbourg). Sans commune candidate (ex. « Butte
 * Montmartre », un POI, jamais une commune), comportement inchangé : la plus
 * proche parmi TOUS les candidats l'emporte toujours, ce qui préserve le
 * correctif Montmartre ci-dessus.
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
 * lointaine sur le point de départ si aucune des communes candidates ne
 * correspond EXACTEMENT à la requête (accent inclus).
 *
 * La préférence « correspondance exacte » retient TOUS les candidats à
 * égalité, jamais un seul via `.find()` — trouvaille de relecture adverse
 * (28/08/2026) sur une version antérieure de ce correctif : la France a de
 * vrais homonymes de communes strictement distinctes qui matchent TOUTES LES
 * DEUX exactement la requête (ex. « Neuville », Dordogne et Puy-de-Dôme,
 * vérifié en direct sur data.geopf.fr) — s'arrêter au premier via `.find()`
 * empêchait `near` de départager ensuite ces deux candidats par distance
 * réelle, rouvrant une couche plus loin exactement le bug que ce correctif
 * ferme pour Moûtiers.
 */
function pickFeature(feats, query, near, { summit = false } = {}) {
  if (!feats.length) return null;
  const communes = !isColQuery(query) ? feats.filter(isCommuneFeat) : [];
  const exactMatches = communes.filter((f) => normLabel(f.label) === normLabel(query));
  let preferred = exactMatches.length ? exactMatches : communes;
  // Recherche de sommet (geocodeCol(), index POI) sans commune candidate :
  // un candidat de catégorie « sommet » doit battre tout candidat d'une
  // autre catégorie, même plus proche du waypoint précédent — la proximité
  // ne doit jamais l'emporter sur « être effectivement le sommet demandé ».
  // Trouvaille en régénérant en ligne (30/08/2026, mission tracés
  // historiques) : « Hautacam » (Tour, démo Pau→Hautacam) renvoyait un
  // camping homonyme (« le Hautacam »), plus proche du waypoint précédent
  // (Argelès-Gazost) que le vrai sommet (« Hautacam ou Soum de Dabant
  // Aygue », catégorie POI « sommet ») — vérifié en direct sur
  // data.geopf.fr (5 candidats réels, mécanisme near déjà en place
  // choisissait le camping, à 442 m d'altitude, quasi identique à
  // Argelès-Gazost, 440 m). Le tracé jusqu'à ce point n'avait presque
  // aucun dénivelé (routé + RGE ALTI réels : ~2,5 m sur 3,3 km), donc
  // aucune côte détectée du tout — pas seulement mal nommée.
  if (summit && !preferred.length) {
    const summits = feats.filter((f) => f.type === 'summit');
    if (summits.length) preferred = summits;
  }
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
      const preferredWithCoords = preferred.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon));
      const pool = preferredWithCoords.length ? preferredWithCoords : withCoords;
      return pool.reduce((best, f) => (haversine(near, f) < haversine(near, best) ? f : best));
    }
  }
  if (preferred.length) return preferred[0];
  // Aucune commune candidate ET le meilleur résultat brut est une rue (jamais
  // une commune, jamais même un lieu-dit) : signal fort que le lieu cherché
  // n'est pas un lieu français répertorié, plutôt qu'une vraie ville qui
  // manquerait juste de numéro de voie. Vérifié en direct sur data.geopf.fr
  // (29/08/2026) pour « Cambridge » (Royaume-Uni) et « Granollers »
  // (Espagne) — chacun ne renvoie QUE des rues homonymes françaises
  // (« Rue de Cambridge », Montpellier ; « Rue de Granollers », Perpignan),
  // menant à un aller-retour France↔pays réel de plusieurs centaines/milliers
  // de km sur l'étape reconstituée. `null` fait retomber geocode() sur
  // Nominatim (repli déjà en place, testé), au lieu d'ancrer le waypoint sur
  // une rue homonyme sans rapport. Restreint à `type === 'street'` seul (pas
  // `locality`, un hameau français réel étant une réponse légitime — test
  // « sans commune candidate, le premier résultat est conservé ») et à
  // `!near` (avec near, le mécanisme de distance réelle ci-dessus reste seul
  // juge, comme pour Montmartre) et pas un col (jamais de country_hint pour
  // un col, l'index POI reste la seule source).
  if (!near && !isColQuery(query) && feats[0].type === 'street') return null;
  return feats[0];
}

// Types d'adresse Nominatim correspondant à un vrai lieu administratif
// (commune, région, pays…) — jamais une ambassade, une rue ou un
// restaurant homonyme, qui peuvent pourtant arriver en tête du classement
// textuel brut de l'API (trouvaille en vérifiant ce correctif contre les
// vraies données après régénération complète, 28/08/2026 : « Luxembourg
// City » renvoyait l'ambassade du Luxembourg à Londres, premier résultat
// du classement textuel, jamais un lieu administratif).
const NOMINATIM_PLACE_TYPES = new Set([
  'country', 'state', 'region', 'county', 'city', 'town', 'village',
  'municipality', 'suburb', 'city_district', 'borough',
]);

/**
 * Choisit, parmi les résultats Nominatim, le premier candidat de type
 * administratif reconnu, DANS L'ORDRE DÉJÀ FOURNI PAR L'API — jamais une
 * ambassade, une rue ou un restaurant homonyme. `null` si aucun candidat
 * n'est de type administratif (l'appelant retombe alors sur le premier
 * résultat brut, comportement historique).
 *
 * Ne réordonne JAMAIS les candidats entre eux — seule opération : un
 * filtre, jamais un tri. Deux tentatives précédentes de « mieux classer »
 * les candidats administratifs entre eux (préférer le plus spécifique ;
 * puis, après une première relecture adverse, préférer le plus spécifique
 * seulement s'il est géographiquement imbriqué dans le premier) ont chacune
 * été cassées par une relecture adverse suivante avec des données réelles :
 * la préférence de spécificité brute plaçait « San Marino, Californie »
 * devant la République de Saint-Marin ; la version « imbriquée » plaçait
 * ensuite « Orange, Comté d'Orange, Californie » devant la vraie Orange
 * (Vaucluse, France) dès que ce comté californien — lui-même un faux
 * homonyme — arrivait en PREMIER dans le classement Nominatim : l'ancrage
 * sur le premier candidat ne se corrige jamais s'il est déjà le mauvais
 * homonyme, un résultat dépendant de l'ordre de l'API plutôt que du lieu
 * réel. Se contenter de FILTRER les types non pertinents, sans jamais
 * réordonner les candidats retenus, ferme la seule classe de bug vérifiée
 * (une ambassade/rue/restaurant en tête de liste) sans en rouvrir une
 * autre : on fait confiance au classement de pertinence de Nominatim
 * lui-même dès qu'il s'agit de départager deux lieux administratifs.
 */
function pickNominatimFeature(results) {
  return (results || []).find((r) => r && NOMINATIM_PLACE_TYPES.has(r.addresstype)) || null;
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
// Nom de pays annoté par Wikipédia (extractCountry(), pipeline/wikipedia.js,
// KNOWN_COUNTRIES) → code ISO 3166-1 alpha-2, pour restreindre la recherche
// Nominatim au bon pays. Sans cette restriction, Nominatim classe par pure
// pertinence textuelle mondiale : un nom de lieu court peut matcher un mot
// isolé dans un POI sans rapport à l'autre bout du monde — trouvaille en
// régénérant tout le catalogue en ligne (29/08/2026) : « El Pas de la Casa »
// (country_hint « Andorra ») renvoyait en tête un centre culturel de La Paz,
// Bolivie (aucun des 5 premiers résultats d'un type administratif reconnu
// par pickNominatimFeature(), donc repli sur le tout premier — un homonyme
// partiel de « Casa » à 10 000 km ; l'étape 2021/16 se reconstituait à
// 9953 km au lieu de 169). Couvre exactement les entrées de KNOWN_COUNTRIES
// — jamais 'fr' (valeur par défaut de countryHint, jamais un nom de pays
// annoté par Wikipédia), donc aucun risque de restreindre par erreur le
// repli Nominatim déjà utilisé pour une requête France sans résultat
// Géoplateforme (comportement inchangé pour ce chemin).
const COUNTRY_TO_ISO = {
  france: 'fr', belgium: 'be', netherlands: 'nl', luxembourg: 'lu',
  germany: 'de', switzerland: 'ch', italy: 'it', spain: 'es', monaco: 'mc',
  andorra: 'ad', 'united kingdom': 'gb', england: 'gb', scotland: 'gb',
  wales: 'gb', ireland: 'ie', 'northern ireland': 'gb', denmark: 'dk',
  'san marino': 'sm', portugal: 'pt', austria: 'at', liechtenstein: 'li',
  slovenia: 'si', 'czech republic': 'cz', poland: 'pl',
  'west germany': 'de', 'east germany': 'de',
};

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
      const feats = (json.features || []).map((f) => {
        const props = f.properties || {};
        // Index POI (sommets, communes atteintes sans numéro de voie) : pas
        // de `properties.label` (un tableau `name` à la place) ni de
        // `properties.type` (un tableau `category`, ex. ["administratif",
        // "commune"]) — schéma différent de l'index adresse. Sans cette
        // lecture, une commune trouvée seulement via l'index POI n'était
        // jamais reconnue comme telle par pickFeature() (ni `label` en
        // chaîne exploitable, ni `type` reconnu), qui retombait alors sur
        // l'ordre brut de l'API — non garanti en cas d'égalité de score
        // entre deux communes homonymes (trouvaille en vérifiant ce
        // correctif contre les vraies données après régénération complète,
        // 28/08/2026 : « Moûtiers », Savoie, battue par un homonyme de
        // Meurthe-et-Moselle, les deux exclusivement trouvés via l'index POI).
        const category = Array.isArray(props.category) ? props.category : [];
        const type = props.type
          || (category.includes('commune') ? 'municipality'
            : category.includes('sommet') ? 'summit'
              : undefined);
        return {
          label: geopfLabel(props, query),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          type,
          score: props.score,
          provider: 'geopf',
        };
      });
      return pickFeature(feats, query, near, { summit });
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
  const isoCode = COUNTRY_TO_ISO[String(countryHint).toLowerCase()];
  const { value } = await cached('geocode', 'nominatim', { q: query, isoCode: isoCode || null }, async () => {
    const search = async (q) => {
      let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&accept-language=fr`;
      if (isoCode) url += `&countrycodes=${isoCode}`;
      return httpJson(url, { minDelayMs: 1100 }); // max 1 req/s
    };
    const first = await search(query);
    let r = pickNominatimFeature(first);
    if (!r) {
      // Repli : le titre Wikipédia d'une ville peut porter un qualificatif
      // absent du nom réel dans OpenStreetMap — trouvaille en vérifiant ce
      // correctif contre les vraies données après régénération complète
      // (28/08/2026) : « Luxembourg City » (nom de l'article Wikipédia
      // anglais) ne renvoie AUCUN résultat administratif chez Nominatim,
      // seulement des homonymes sans rapport (une ambassade du Luxembourg à
      // Londres, en tête, des rues « Luxembourg » sur plusieurs continents)
      // — le vrai nom OSM de la ville est juste « Luxembourg », partagé
      // avec le pays. Sans ce repli, la ville de départ d'une étape se
      // retrouvait à Londres.
      const stripped = String(query).replace(/\s+city$/i, '').trim();
      if (stripped && stripped.toLowerCase() !== String(query).trim().toLowerCase()) {
        const retry = await search(stripped);
        r = pickNominatimFeature(retry) || retry[0];
      }
    }
    if (!r) r = first[0];
    if (!r) return null;
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
      if (!f) return null;
      // Commune de préférence : pour nommer une côte, « Aucun » vaut mieux
      // que « 16 Rue des Pyrénées 65400 Aucun ».
      //
      // Cette requête n'envoie aujourd'hui aucun paramètre `index` (contrairement
      // à geopfSearch()/geocodeSuggest() ci-dessus), donc l'API ne renvoie en
      // pratique que le schéma adresse (`city`/`label` en chaînes) — vérifié en
      // direct sur plusieurs points réels (sommets pyrénéens, zones rurales
      // isolées), jamais le schéma POI (`city`/`name` en tableaux). geopfLabel()
      // et la normalisation de `city` ci-dessous restent un garde-fou déjà en
      // place plutôt qu'à ajouter le jour où cette route demanderait aussi
      // l'index POI (ex. nommer un sommet cliqué sur la carte) — trouvaille de
      // relecture adverse (28/08/2026) : les trois autres appels Géoplateforme
      // de ce fichier avaient le même trou avant d'être corrigés.
      const city = Array.isArray(f.properties.city) ? f.properties.city[0] : f.properties.city;
      return { label: city || geopfLabel(f.properties, undefined), provider: 'geopf' };
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
    return (json.features || []).map((f) => {
      // Même repli que geopfSearch() (geocode()) ci-dessus : un résultat
      // trouvé uniquement via l'index POI a `properties.name` en tableau,
      // jamais `properties.label` — sans geopfLabel(), `label` restait un
      // tableau JS brut (assigné tel quel au waypoint côté éditeur) et
      // isColQuery() ne reconnaissait jamais un sommet POI-only comme un col
      // (trouvaille de relecture adverse, 28/08/2026).
      const label = geopfLabel(f.properties, '');
      return {
        label,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        kind: isColQuery(label) ? 'col' : 'via',
        provider: 'geopf',
      };
    });
  });
  // value peut être `null` (requête rejetée par geopfOrNull) autant que [],
  // jamais laissé remonter tel quel : le contrat de geocodeSuggest() est un
  // tableau, jamais null (autocomplétion — un null ferait planter le .map()
  // ou le rendu côté frontend, contrairement à geocode()/reverseGeocode()
  // qui ont chacun un repli explicite sur `null`).
  return value || [];
}

module.exports = { geocode, geocodeCol, reverseGeocode, geocodeSuggest, looksLikeFrance, isColQuery, pickFeature, pickNominatimFeature };
