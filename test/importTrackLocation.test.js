'use strict';
// Ville/région/pays de départ capturés à l'import d'une trace (backend/db.js
// stages.city_hint/region_hint/country_hint, pipeline/importTrack.js) —
// fondation du bilan « Exploration » (backlog #228). Mocke global.fetch par
// hôte, même schéma que test/geocode.test.js (pas de ETAPEFORGE_OFFLINE ici :
// on veut exercer le vrai chemin réseau de reverseGeocode(), pas le repli
// simulateur, qui ne renvoie jamais de département/pays).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-import-location-test-${process.pid}`);

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { parseGpx, importTrackAsStage } = require('../pipeline/importTrack');
const { loadStageFull } = require('../pipeline/generate');
const { setOffline } = require('../pipeline/http');

let realFetch;
let mock; // { geopf?, nominatim? }

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

/** GPX plat (pas de côte détectée → un seul appel reverseGeocode, celui du
 * point de départ, jamais un appel supplémentaire de nameClimbs()). */
function flatGpx(lat0, lon0) {
  const pts = [];
  const mPerDegLat = 110540;
  for (let m = 0; m <= 8000; m += 200) {
    const lat = lat0 + m / mPerDegLat;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>350</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie plate</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('importTrackAsStage : capture ville/département/pays du point de départ (France, Géoplateforme)', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [{ properties: { city: 'Pau', context: '64, Pyrénées-Atlantiques, Nouvelle-Aquitaine' } }] }),
    nominatim: async () => { throw new Error('Nominatim ne devait pas être appelé'); },
  };
  const { points } = parseGpx(flatGpx(43.3, -0.37));
  const id = await importTrackAsStage(points, { name: 'Sortie Pau', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.city_hint, 'Pau');
  assert.strictEqual(full.stage.region_hint, 'Pyrénées-Atlantiques');
  assert.strictEqual(full.stage.country_hint, 'France');
});

test('importTrackAsStage : hors France, country_hint vient de address.country (Nominatim)', async () => {
  mock = {
    geopf: async () => { throw new Error('la Géoplateforme ne devait pas être appelée (hors bbox France)'); },
    nominatim: async () => jsonResponse({
      display_name: 'Old Town, Édimbourg, Écosse, Royaume-Uni',
      address: { city: 'Édimbourg', state: 'Écosse', country: 'Royaume-Uni' },
    }),
  };
  const { points } = parseGpx(flatGpx(55.95, -3.19));
  const id = await importTrackAsStage(points, { name: 'Sortie Édimbourg', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.country_hint, 'Royaume-Uni');
});

// reverseGeocode() ne rejette jamais sur « aucun résultat nulle part » — son
// repli est un label de coordonnées brutes (provider 'aucun'), jamais une
// vraie ville. Vérifie que ce repli reste hors des hints (pas de pollution
// de la future liste de villes visitées avec des coordonnées).
test('importTrackAsStage : aucun résultat de géocodage inverse nulle part → hints null, jamais les coordonnées brutes comme "ville"', async () => {
  mock = {
    geopf: async () => jsonResponse({ features: [] }),
    nominatim: async () => jsonResponse({}), // pas de display_name
  };
  const { points } = parseGpx(flatGpx(43.302, -0.372));
  const id = await importTrackAsStage(points, { name: 'Sortie sans résultat', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.state, 'done');
  assert.strictEqual(full.stage.city_hint, null);
  assert.strictEqual(full.stage.region_hint, null);
  assert.strictEqual(full.stage.country_hint, null);
});

// Trouvaille anticipée (même principe que nameClimbs, qui tolère déjà
// l'échec de reverseGeocodeFn par côte, pipeline/climbs.js) : un import ne
// doit jamais échouer entièrement juste parce que le géocodage inverse du
// point de départ échoue (panne réseau transitoire, cette fois une vraie
// exception plutôt qu'un « aucun résultat » propre — passe par les 3
// tentatives + backoff de httpJson, donc plus lent que les autres tests de
// ce fichier, gardé unique pour ne pas alourdir la suite).
test('importTrackAsStage : le géocodage inverse du point de départ échoue (vraie panne réseau) → import quand même réussi, hints null', async () => {
  mock = {
    geopf: async () => { throw new Error('panne réseau simulée'); },
    nominatim: async () => { throw new Error('panne réseau simulée'); },
  };
  const { points } = parseGpx(flatGpx(43.301, -0.371));
  const id = await importTrackAsStage(points, { name: 'Sortie panne réseau', source: 'test' });
  const full = loadStageFull(id);
  assert.strictEqual(full.stage.state, 'done', 'l\'import aboutit malgré la panne de géocodage inverse');
  assert.strictEqual(full.stage.city_hint, null);
  assert.strictEqual(full.stage.region_hint, null);
  assert.strictEqual(full.stage.country_hint, null);
});

// Trouvaille de relecture adverse (18/09/2026) : en mode hors-ligne
// (ETAPEFORGE_OFFLINE=1 — chemin de production réel et documenté, README.md,
// pas seulement un artefact de test), reverseGeocode() bascule sur
// simReverseGeocode() (pipeline/simulator.js), dont le repli « aucun lieu du
// gazetier à moins de 25 km » renvoie `provider: 'simulateur'` — LE MÊME
// provider qu'un vrai lieu trouvé — avec un label « Lieu (lat, lon) ». Une
// première version du garde de importTrackAsStage() (`provider !== 'aucun'`
// seul) ne couvrait que le repli réseau de reverseGeocode(), jamais celui-ci
// : reproduit en direct avant correctif, city_hint stockait littéralement
// "Lieu (0.000, 0.000)". Le gazetier simulé (135 entrées, pipeline/
// simulator.js) ne couvre que des lieux français : un point en plein
// Atlantique Nord en est à coup sûr à plus de 25 km de chacune.
test('importTrackAsStage : hors-ligne, point hors du gazetier simulé → hints null, jamais "Lieu (lat, lon)" comme ville', async () => {
  setOffline(true);
  try {
    const { points } = parseGpx(flatGpx(55.0, -20.0)); // Atlantique Nord, loin de tout le gazetier français
    const id = await importTrackAsStage(points, { name: 'Sortie hors-ligne Atlantique', source: 'test' });
    const full = loadStageFull(id);
    assert.strictEqual(full.stage.state, 'done');
    assert.strictEqual(full.stage.city_hint, null, `ne doit jamais contenir un label de repli en coordonnées : ${full.stage.city_hint}`);
    assert.strictEqual(full.stage.region_hint, null);
    assert.strictEqual(full.stage.country_hint, null);
  } finally {
    setOffline(false);
  }
});
