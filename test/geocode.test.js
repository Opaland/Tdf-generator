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
const { geocode, reverseGeocode, pickFeature, isColQuery, geocodeSuggest } = require('../pipeline/geocode');
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

test('pour un col, on garde le classement du géocodeur (index POI)', () => {
  const feats = [
    { label: 'Col du Soulor', type: undefined, score: 0.9 },
    { label: 'Arbéost (65560)', type: 'municipality', score: 0.7 },
  ];
  assert.strictEqual(pickFeature(feats, 'Col du Soulor').label, 'Col du Soulor');
});

test('sans commune candidate, le premier résultat est conservé', () => {
  const feats = [{ label: 'Lieu-dit X', type: 'locality', score: 0.5 }];
  assert.strictEqual(pickFeature(feats, 'X').label, 'Lieu-dit X');
  assert.strictEqual(pickFeature([], 'X'), null);
});

test('isColQuery reconnaît les libellés de sommets', () => {
  assert.ok(isColQuery('Col du Tourmalet'));
  assert.ok(isColQuery('Mont Ventoux'));
  assert.ok(!isColQuery('Pau'));
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
