'use strict';
// Sélection du bon résultat de géocodage (bugs vus lors de la première
// génération en ligne : « Vienne » résolu sur le département de la Vienne,
// adresses préférées aux communes) + chemins réseau non couverts jusqu'ici
// (backlog issue #10, section F) : repli Géoplateforme → Nominatim, aucun
// résultat nulle part. pipeline/geocode.js n'expose pas d'URL de base
// substituable (contrairement à backend/suunto.js) : on mocke global.fetch
// par hôte, en délégant tout appel non prévu à une erreur explicite plutôt
// que de le laisser passer en silence (voir CLAUDE.md, règle 6 — un mock
// global doit distinguer ce qu'il simule de ce qu'il laisse passer).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-geocode-test-${process.pid}`);
// Pas de ETAPEFORGE_OFFLINE=1 ici : ces tests couvrent justement le chemin
// réseau réel (mocké), pas le repli simulateur hors-ligne.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { geocode, reverseGeocode, pickFeature, pickNominatimFeature, isColQuery, geocodeSuggest } = require('../pipeline/geocode');
const { setOffline } = require('../pipeline/http');

let realFetch;
let mock; // { geopf?: (url) => Response, nominatim?: (url) => Response }

before(() => {
  realFetch = global.fetch;
  global.fetch = async (url) => {
    const host = new URL(String(url)).hostname;
    if (host === 'data.geopf.fr' && mock.geopf) return mock.geopf(String(url));
    if (host === 'nominatim.openstreetmap.org' && mock.nominatim) return mock.nominatim(String(url));
    throw new Error(`appel réseau non simulé par ce test : ${url}`);
  };
});

after(() => {
  global.fetch = realFetch;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function neverCalled(nom) {
  return async () => { throw new Error(`${nom} ne devait pas être appelé sur ce chemin`); };
}

test('une commune bat un homonyme mieux classé (département, rue…)', () => {
  const feats = [
    { label: 'Vienne (département)', type: 'department', score: 0.95 },
    { label: 'Rue de Vienne 75008 Paris', type: 'street', score: 0.93 },
    { label: 'Vienne (38200)', type: 'municipality', score: 0.9 },
  ];
  assert.strictEqual(pickFeature(feats, 'Vienne').type, 'municipality');
});

test('pour un col SANS near, on garde le classement du géocodeur (index POI)', () => {
  const feats = [
    { label: 'Col du Soulor', type: undefined, score: 0.9 },
    { label: 'Arbéost (65560)', type: 'municipality', score: 0.7 },
  ];
  assert.strictEqual(pickFeature(feats, 'Col du Soulor').label, 'Col du Soulor');
});

// Choix délibéré (relecture adverse, 26/08/2026) : AVEC near, la distance
// réelle prime aussi pour un col — même mécanisme que « Butte Montmartre »
// ci-dessous, observé en direct sur de vrais cols cette session (« Col du
// Télégraphe », « Col de Toses » résolus à des centaines de km du bon
// massif). pipeline/generate.js passe systématiquement near: prevPos pour
// TOUS les waypoints, y compris kind: 'col' — cette combinaison doit être
// testée explicitement, pas seulement supposée fonctionner par ricochet.
test('pour un col AVEC near, la distance réelle prime sur le classement du géocodeur', () => {
  const nearArbeost = { lat: 42.98, lon: -0.34 }; // waypoint précédent, juste à côté d'Arbéost
  const feats = [
    { label: 'Col du Soulor (homonyme lointain)', type: undefined, score: 0.9, lat: 45.5, lon: 3.0 },
    { label: 'Arbéost (65560)', type: 'municipality', score: 0.7, lat: 42.981, lon: -0.339 },
  ];
  assert.strictEqual(pickFeature(feats, 'Col du Soulor', nearArbeost).label, 'Arbéost (65560)');
});

// Relecture adverse, 26/08/2026 : haversine(near, f) avec f.lat/f.lon non
// finis vaut NaN, et toute comparaison impliquant NaN est fausse — sans ce
// garde, feats.reduce() garderait systématiquement feats[0] s'il est
// malformé, quels que soient les candidats valides suivants (jamais
// rencontré sur l'API Géoplateforme en pratique, mais un garde-fou peu
// coûteux contre une réponse dégradée).
test('near : un candidat sans coordonnées exploitables ne l\'emporte jamais sur un candidat valide', () => {
  const near = { lat: 45.0, lon: 5.0 };
  const feats = [
    { label: 'malformé (pas de coordonnées)', score: 0.99 },
    { label: 'valide mais loin', lat: 50, lon: 10 },
    { label: 'valide et proche (bonne réponse)', lat: 45.01, lon: 5.01 },
  ];
  assert.strictEqual(pickFeature(feats, 'X', near).label, 'valide et proche (bonne réponse)');
});

test('sans commune candidate, le premier résultat est conservé', () => {
  const feats = [{ label: 'Lieu-dit X', type: 'locality', score: 0.5 }];
  assert.strictEqual(pickFeature(feats, 'X').label, 'Lieu-dit X');
  assert.strictEqual(pickFeature([], 'X'), null);
});

// Trouvaille en générant en masse avec un vrai accès réseau (26/08/2026) :
// géocoder "Butte Montmartre" biaisé près de Mantes-la-Ville (near envoyé à
// l'API en lat/lon) renvoyait la vraie colline parisienne en DERNIÈRE
// position — candidats et scores reproduits ici tels qu'observés en direct
// sur https://data.geopf.fr/geocodage/search. Résultat concret sans ce
// correctif : une étape Mantes-la-Ville → Paris reconstituée à 1580 km via
// un aller-retour fantôme vers Marseille.
test('near départage par distance réelle, pas par le score texte de l\'API (homonymie « Butte Montmartre »)', () => {
  const nearMantesLaVille = { lat: 49.0, lon: 1.7 };
  const feats = [
    { label: 'Traverse butte montmartre 13015 Marseille', score: 0.636, lat: 43.372178, lon: 5.342956 },
    { label: 'Route de la Butte Montmartre 49390 Vernantes', score: 0.621, lat: 47.409756, lon: 0.061404 },
    { label: 'la Butte Montmartre 44460 Fégréac', score: 0.614, lat: 47.590035, lon: -1.998083 },
    { label: 'Place de la Butte Montmartre 77750 Saint-Cyr-sur-Morin', score: 0.613, lat: 48.906768, lon: 3.183067 },
    { label: undefined, score: 0.575, lat: 48.887019, lon: 2.341472 }, // la vraie Montmartre, sans label (POI sans adresse)
  ];
  const picked = pickFeature(feats, 'Butte Montmartre', nearMantesLaVille);
  assert.strictEqual(picked.lat, 48.887019, 'doit choisir le point le plus proche de near, pas le score texte le plus haut');
  assert.strictEqual(picked.lon, 2.341472);
});

test('sans near, le comportement existant (commune > score) reste inchangé', () => {
  const feats = [
    { label: 'Vienne (département)', type: 'department', score: 0.95 },
    { label: 'Vienne (38200)', type: 'municipality', score: 0.9 },
  ];
  assert.strictEqual(pickFeature(feats, 'Vienne', null).type, 'municipality', 'near=null ne doit rien changer au comportement déjà testé');
});

test('isColQuery reconnaît les libellés de sommets', () => {
  assert.ok(isColQuery('Col du Tourmalet'));
  assert.ok(isColQuery('Mont Ventoux'));
  assert.ok(!isColQuery('Pau'));
});

// pickNominatimFeature() : trouvaille en vérifiant le correctif geocode.js
// (bugs #150/#153) contre les vraies données après régénération complète
// du 28/08/2026 — « Luxembourg City » routé vers Nominatim (countryHint
// hors France) renvoyait l'AMBASSADE du Luxembourg à Londres (51.50, -0.15),
// premier résultat brut du classement textuel de l'API, jamais un lieu
// administratif.
//
// pickNominatimFeature() FILTRE seulement (jamais ne réordonne) : deux
// tentatives de réordonnancement (préférer le plus spécifique ; puis,
// après une relecture adverse, seulement s'il est géographiquement imbriqué
// dans le premier) ont chacune été cassées par une relecture adverse
// suivante avec des données Nominatim réelles — la première plaçait « San
// Marino, Californie » devant la République homonyme ; la seconde plaçait
// ensuite « Orange, Comté d'Orange, Californie » devant la vraie Orange
// (Vaucluse, France) dès que ce comté californien arrivait en PREMIER dans
// le classement Nominatim (l'ancrage sur le premier candidat ne se corrige
// jamais s'il est déjà le mauvais homonyme). Les tests ci-dessous verrouillent
// donc explicitement : filtrer ne remplace jamais le classement de Nominatim.
test('pickNominatimFeature : préfère un lieu administratif à une ambassade/rue/restaurant homonyme', () => {
  const results = [
    { addresstype: 'office', display_name: 'Ambassade du Luxembourg, Londres' },
    { addresstype: 'road', display_name: 'Luxembourg Avenue, Las Vegas' },
    { addresstype: 'country', display_name: 'Luxembourg' },
  ];
  assert.strictEqual(pickNominatimFeature(results).addresstype, 'country');
});

test('pickNominatimFeature : garde le PREMIER candidat administratif dans l\'ordre Nominatim, ne le réordonne jamais par spécificité', () => {
  // Le pays (moins spécifique) est ici en tête, comme le renvoie réellement
  // Nominatim pour la requête « Luxembourg » — doit rester le choix, la
  // ville plus spécifique qui suit ne doit jamais le détrôner.
  const results = [
    { addresstype: 'country', display_name: 'Luxembourg' },
    { addresstype: 'city', display_name: 'Luxembourg, Canton Luxembourg, Luxembourg' },
    { addresstype: 'state', display_name: 'Luxembourg, Wallonie, Belgique' },
  ];
  assert.strictEqual(pickNominatimFeature(results).display_name, 'Luxembourg');
});

// Trouvaille de relecture adverse (28/08/2026) sur une version antérieure de
// ce correctif (spécificité brute, puis imbrication géographique) : « San
// Marino » (countryHint hors France, KNOWN_COUNTRIES) cassait dans les deux
// cas — le pays (Saint-Marin, Europe), déjà bien classé en tête par
// Nominatim, se faisait détrôner par un homonyme sans rapport (San Marino,
// Californie). Données réelles (API Nominatim) : le pays est bien EN TÊTE
// dans la vraie réponse — ce test verrouille qu'il le reste.
test('pickNominatimFeature : ne détrône JAMAIS le premier résultat administratif par un homonyme plus "spécifique" (San Marino, pays vs. Californie)', () => {
  const results = [
    { addresstype: 'country', display_name: 'Saint-Marin' },
    { addresstype: 'town', display_name: 'San Marino, Los Angeles County, Californie, États-Unis d\'Amérique' },
  ];
  assert.strictEqual(pickNominatimFeature(results).addresstype, 'country');
});

// Trouvaille de relecture adverse (28/08/2026) sur la version « imbrication
// géographique » : quand le PREMIER candidat administratif de Nominatim
// est LUI-MÊME le mauvais homonyme (ex. « Orange, Comté d'Orange,
// Californie » pour la requête « Orange », avant la vraie Orange, Vaucluse,
// France, plus bas dans la liste), aucune heuristique de ce fichier ne
// tente de « corriger » ce choix — on fait confiance au classement de
// Nominatim. Documente une limite connue et acceptée (voir le commentaire
// de pickNominatimFeature) plutôt que de la cacher derrière une heuristique
// qui casserait un autre cas réel.
test('pickNominatimFeature : limite connue et acceptée — ne corrige pas un premier candidat administratif qui est un mauvais homonyme', () => {
  const results = [
    { addresstype: 'county', display_name: 'Orange, Orange County, Californie, États-Unis d\'Amérique' },
    { addresstype: 'town', display_name: 'Orange, Carpentras, Vaucluse, France' },
  ];
  assert.strictEqual(pickNominatimFeature(results).display_name, 'Orange, Orange County, Californie, États-Unis d\'Amérique');
});

test('pickNominatimFeature : aucun candidat administratif → null (repli sur le comportement historique)', () => {
  const results = [
    { addresstype: 'office', display_name: 'Ambassade du Luxembourg, Londres' },
    { addresstype: 'road', display_name: 'Luxembourg Avenue, Las Vegas' },
  ];
  assert.strictEqual(pickNominatimFeature(results), null);
  assert.strictEqual(pickNominatimFeature([]), null);
  assert.strictEqual(pickNominatimFeature(undefined), null);
});

// ---------------------------------------------------------------- geocode()

test('Géoplateforme trouve directement : Nominatim jamais appelé', async () => {
  mock = {
    geopf: async () => jsonResponse({
      features: [{ properties: { label: 'Pau (64000)', type: 'municipality' }, geometry: { coordinates: [-0.37, 43.3] } }],
    }),
    nominatim: neverCalled('Nominatim'),
  };
  const r = await geocode('Pau-test-geopf-direct');
  assert.strictEqual(r.provider, 'geopf');
  assert.strictEqual(r.label, 'Pau (64000)');
});

test('repli Géoplateforme → Nominatim quand la Géoplateforme ne trouve rien', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [] }),
    nominatim: async () => jsonResponse([
      { display_name: 'Quelque part, Ailleurs, France', lat: '45.0', lon: '3.0', type: 'village' },
    ]),
  };
  const r = await geocode('LieuIntrouvableGeopf-test-repli');
  assert.strictEqual(r.provider, 'nominatim');
  assert.strictEqual(r.lat, 45.0);
});

test('Géoplateforme et Nominatim sans résultat : rejette avec un message clair', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [] }),
    nominatim: async () => jsonResponse([]),
  };
  await assert.rejects(() => geocode('IntrouvablePartout-test-echec'), /Géocodage sans résultat/);
});

// Trouvaille en générant en masse avec un vrai accès réseau (27/08/2026,
// Tour 1996 étape 2, « 's-Hertogenbosch ») : la Géoplateforme rejette
// carrément certaines requêtes en HTTP 400 (« must ... start with a
// number or a letter », vérifié contre l'API réelle) plutôt que de
// répondre 0 résultat — httpJson() marque ce 4xx `nonRetryable` et le
// laisse remonter tel quel. Sans garde-fou, cette exception plantait toute
// la génération de l'étape au lieu de retomber sur Nominatim comme le fait
// déjà le cas « 0 résultat » ci-dessus.
test('repli Géoplateforme → Nominatim quand la Géoplateforme REJETTE la requête (400), pas seulement quand elle ne trouve rien', async () => {
  mock = {
    geopf: async () => jsonResponse(
      { code: 400, message: 'Failed parsing query', detail: ['q: must contain between 3 and 200 chars and start with a number or a letter'] },
      400
    ),
    nominatim: async () => jsonResponse([
      { display_name: "'s-Hertogenbosch, Noord-Brabant, Netherlands", lat: '51.69', lon: '5.30', type: 'city' },
    ]),
  };
  const r = await geocode("'s-Hertogenbosch-test-400");
  assert.strictEqual(r.provider, 'nominatim');
  assert.strictEqual(r.lat, 51.69);
});

// Trouvaille de relecture adverse sur le test précédent : cached() ne
// mémorise que le retour RÉUSSI de fn() — un rejet 400 n'était jamais mis
// en cache (contrairement à un vrai « 0 résultat »), donc chaque
// régénération future de la même étape recontactait inutilement la
// Géoplateforme pour un résultat déjà connu d'avance.
test('un rejet 400 de la Géoplateforme est mis en cache comme un « 0 résultat » (pas de rappel réseau au 2e géocodage identique)', async () => {
  let geopfCalls = 0;
  mock = {
    geopf: async () => { geopfCalls++; return jsonResponse({ code: 400, message: 'Failed parsing query' }, 400); },
    nominatim: async () => jsonResponse([
      { display_name: "'s-Hertogenbosch, Noord-Brabant, Netherlands", lat: '51.69', lon: '5.30', type: 'city' },
    ]),
  };
  await geocode("'s-Hertogenbosch-test-cache");
  await geocode("'s-Hertogenbosch-test-cache");
  assert.strictEqual(geopfCalls, 1, 'le 2e appel doit être servi par le cache, pas recontacter la Géoplateforme');
});

// Reproduction directe du bug trouvé après régénération complète (28/08/2026,
// PR de suivi #150/#153) : « Luxembourg City » (titre Wikipédia anglais) ne
// correspond à aucun lieu administratif chez Nominatim — seulement des
// homonymes sans rapport (ambassade, rues) — alors que « Luxembourg » seul
// (nom réel de la ville dans OpenStreetMap, partagé avec le pays) en trouve.
// Le repli renvoie ici le PAYS (premier candidat administratif dans l'ordre
// Nominatim), pas la ville — pickNominatimFeature() ne réordonne jamais les
// candidats entre eux (voir son commentaire) : le pays reste une bien
// meilleure approximation que Londres (~500 km d'écart avant ce correctif),
// à une vingtaine de km du centre-ville réel, pour un très petit pays.
test('geocode() : repli "Luxembourg City" → "Luxembourg" quand aucun lieu administratif ne correspond au nom complet', async () => {
  let nominatimCalls = [];
  mock = {
    geopf: neverCalled('la Géoplateforme'),
    nominatim: async (url) => {
      nominatimCalls.push(url);
      if (/q=Luxembourg%20City/.test(url)) {
        return jsonResponse([
          { display_name: 'Ambassade du Luxembourg, Londres', lat: '51.50', lon: '-0.15', type: 'diplomatic', addresstype: 'office' },
          { display_name: 'Luxembourg Avenue, Las Vegas', lat: '36.16', lon: '-115.32', type: 'residential', addresstype: 'road' },
        ]);
      }
      if (/q=Luxembourg(?!%20City)/.test(url)) {
        return jsonResponse([
          { display_name: 'Luxembourg', lat: '49.8158683', lon: '6.1296751', type: 'administrative', addresstype: 'country' },
          { display_name: 'Luxembourg, Canton Luxembourg, Luxembourg', lat: '49.6112768', lon: '6.1297990', type: 'administrative', addresstype: 'city' },
        ]);
      }
      throw new Error(`URL Nominatim inattendue dans ce test : ${url}`);
    },
  };
  // « Luxembourg City » (sans suffixe de test) : le repli teste précisément
  // le retrait du suffixe " City" en fin de chaîne (voir geocode.js) — un
  // suffixe de désambiguïsation de cache ajouté après « City » casserait
  // cette condition. Aucun autre test de ce fichier n'utilise cette requête
  // exacte, donc aucun risque de collision de cache SQLite entre tests.
  const r = await geocode('Luxembourg City', { countryHint: 'lu' });
  assert.strictEqual(nominatimCalls.length, 2, 'doit avoir tenté le nom complet, puis le repli sans "City"');
  assert.strictEqual(r.lat, 49.8158683, 'un lieu administratif du bon pays, pas l\'ambassade de Londres');
  assert.strictEqual(r.lon, 6.1296751);
});

test('geocode() : pas de repli "City" quand le premier résultat Nominatim est déjà un lieu administratif', async () => {
  let nominatimCalls = 0;
  mock = {
    geopf: neverCalled('la Géoplateforme'),
    nominatim: async () => {
      nominatimCalls++;
      return jsonResponse([
        { display_name: 'Edinburgh, Scotland, UK', lat: '55.9', lon: '-3.2', type: 'city', addresstype: 'city' },
      ]);
    },
  };
  const r = await geocode('Edinburgh-test-pas-de-repli', { countryHint: 'uk' });
  assert.strictEqual(nominatimCalls, 1, 'un seul appel réseau : le premier résultat suffisait déjà');
  assert.strictEqual(r.lat, 55.9);
});

test('countryHint hors France : saute directement la Géoplateforme', async () => {
  mock = {
    geopf: neverCalled('la Géoplateforme'),
    nominatim: async () => jsonResponse([
      { display_name: 'Edinburgh, Scotland, UK', lat: '55.9', lon: '-3.2', type: 'city' },
    ]),
  };
  const r = await geocode('Edinburgh-test-hors-france', { countryHint: 'uk' });
  assert.strictEqual(r.provider, 'nominatim');
});

// ----------------------------------------------------------- reverseGeocode()

test('reverseGeocode en France : Géoplateforme trouve, Nominatim jamais appelé', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [{ properties: { city: 'Pau', label: 'Pau' } }] }),
    nominatim: neverCalled('Nominatim'),
  };
  const r = await reverseGeocode(43.31, -0.001);
  assert.strictEqual(r.provider, 'geopf');
  assert.strictEqual(r.label, 'Pau');
});

// Trouvaille de relecture adverse sur le correctif geocode() (400
// Géoplateforme) : le même grep exhaustif sur `data.geopf.fr` montre que
// reverseGeocode() (route /api/reverse, clic sur la carte) avait le même
// trou — non protégée, un 400 y remontait comme une exception non gérée
// par wrap() (backend/server.js), donc un 500 générique au lieu du repli
// Nominatim déjà prévu pour le cas « aucun résultat ».
test('reverseGeocode en France : repli Nominatim quand la Géoplateforme REJETTE la requête (400)', async () => {
  mock = {
    geopf: async () => jsonResponse({ code: 400, message: 'Failed parsing query' }, 400),
    nominatim: async () => jsonResponse({ display_name: 'Quelque part, France' }),
  };
  // Coordonnées distinctes de toute autre utilisée ailleurs dans ce fichier
  // — le cache SQLite persiste entre les tests (même fichier, même process),
  // réutiliser une paire (lat, lon) déjà géocodée avec succès plus haut
  // servirait ce résultat en cache sans jamais rappeler le mock ci-dessus.
  const r = await reverseGeocode(43.314159, -0.004);
  assert.strictEqual(r.provider, 'nominatim');
});

test('reverseGeocode hors bbox France : saute directement Nominatim', async () => {
  mock = {
    geopf: neverCalled('la Géoplateforme'),
    nominatim: async () => jsonResponse({ display_name: 'Edinburgh, Scotland' }),
  };
  const r = await reverseGeocode(55.95, -3.19);
  assert.strictEqual(r.provider, 'nominatim');
});

test('reverseGeocode : repli Géoplateforme → Nominatim si aucun résultat', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [] }),
    nominatim: async () => jsonResponse({ display_name: 'Quelque part, France' }),
  };
  const r = await reverseGeocode(43.32, -0.002);
  assert.strictEqual(r.provider, 'nominatim');
});

test('reverseGeocode : aucun résultat nulle part → repli sur les coordonnées, ne rejette jamais', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [] }),
    nominatim: async () => jsonResponse({}), // pas de display_name
  };
  const r = await reverseGeocode(43.33, -0.003);
  assert.strictEqual(r.provider, 'aucun');
  assert.strictEqual(r.label, '(43.330, -0.003)');
});

// ----------------------------------------------------------- geocodeSuggest()
// Autocomplétion de l'éditeur (GET /api/geocode) — zéro couverture jusqu'ici
// (trouvaille de sprint dédié, survivants de mutation testing sur les
// conditions/ternaires/regex ci-dessous).

test('geocodeSuggest : requête vide ou trop courte (< 2 caractères) → [] sans requête réseau', async () => {
  mock = { geopf: neverCalled('la Géoplateforme'), nominatim: neverCalled('Nominatim') };
  assert.deepStrictEqual(await geocodeSuggest(''), []);
  assert.deepStrictEqual(await geocodeSuggest('   '), []);
  assert.deepStrictEqual(await geocodeSuggest('a'), []);
});

test('geocodeSuggest (en ligne) : kind = col si le libellé matche isColQuery, via sinon', async () => {
  mock = {
    geopf: async () => jsonResponse({
      features: [
        { properties: { label: 'Col du Tourmalet' }, geometry: { coordinates: [0.15, 42.91] } },
        { properties: { label: 'Bagnères-de-Bigorre (65200)' }, geometry: { coordinates: [0.15, 43.06] } },
      ],
    }),
  };
  const suggestions = await geocodeSuggest('Tourmalet-test-suggest');
  assert.strictEqual(suggestions.length, 2);
  assert.strictEqual(suggestions[0].kind, 'col');
  assert.strictEqual(suggestions[0].provider, 'geopf');
  assert.strictEqual(suggestions[1].kind, 'via');
});

test('geocodeSuggest (en ligne) : aucun résultat → tableau vide, pas d\'exception', async () => {
  mock = { geopf: async () => jsonResponse({ features: [] }) };
  assert.deepStrictEqual(await geocodeSuggest('IntrouvableSuggest-test'), []);
});

// Trouvaille de relecture adverse sur le correctif geocode() (400
// Géoplateforme) : geocodeSuggest() (route GET /api/geocode, autocomplétion
// de l'éditeur) avait le même trou — un 400 y plantait avec un 500 générique
// (wrap(), backend/server.js, ne gère que err.status, pas err.nonRetryable)
// au lieu de renvoyer un tableau vide comme le cas « 0 résultat » ci-dessus.
// Reproduit exactement l'entrée qui a motivé ce correctif ('s-Hertogenbosch).
test('geocodeSuggest (en ligne) : la Géoplateforme REJETTE la requête (400) → tableau vide, pas d\'exception', async () => {
  mock = { geopf: async () => jsonResponse({ code: 400, message: 'Failed parsing query' }, 400) };
  assert.deepStrictEqual(await geocodeSuggest("'s-Hertogenbosch-test-suggest-400"), []);
});

test('geocodeSuggest (hors ligne) : trouve dans le gazetier — kind col pour un sommet, via pour une ville', async () => {
  setOffline(true);
  try {
    const cols = await geocodeSuggest('Col du Pin-Bouchain');
    assert.ok(cols.length >= 1);
    assert.strictEqual(cols[0].kind, 'col');
    assert.strictEqual(cols[0].provider, 'simulateur');
    const villes = await geocodeSuggest('Lyon');
    assert.ok(villes.length >= 1);
    assert.strictEqual(villes[0].kind, 'via');
  } finally {
    setOffline(false);
  }
});

test('geocodeSuggest (hors ligne) : insensible aux accents (norm() du gazetier)', async () => {
  setOffline(true);
  try {
    // « republique » sans accent doit matcher « Col de la République » (kind
    // 'peak' dans le gazetier) DIRECTEMENT via le filtre norm() de ce
    // fichier — pas seulement retomber sur le repli simGeocode() de
    // pipeline/simulator.js, qui a sa propre normalisation indépendante et
    // masquerait une régression de norm() ici : ce repli ne renvoie qu'un
    // seul résultat avec `kind` figé à 'via' (ligne 161), jamais 'col',
    // donc vérifier kind='col' distingue bien les deux chemins.
    const hits = await geocodeSuggest('republique');
    const hit = hits.find((h) => /République/i.test(h.label));
    assert.ok(hit, 'doit matcher malgré l\'accent absent de la requête');
    assert.strictEqual(hit.kind, 'col', 'un vrai hit direct du gazetier doit garder kind=col (sommet) — \'via\' trahirait le repli simGeocode()');
  } finally {
    setOffline(false);
  }
});

test('geocodeSuggest (hors ligne) : rien dans le gazetier → repli simulateur, un seul résultat', async () => {
  setOffline(true);
  try {
    const hits = await geocodeSuggest('VilleInexistanteXYZ123');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].provider, 'simulateur');
    assert.strictEqual(hits[0].kind, 'via');
  } finally {
    setOffline(false);
  }
});
