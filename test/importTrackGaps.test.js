'use strict';
// Trouvaille de relecture adverse (revue de code globale) : le correctif du
// trou d'altimétrie coercé en 0 m (pipeline/elevation.js, backlog session)
// n'avait pas touché pipeline/importTrack.js, qui réimplémentait la même
// logique en ligne pour son repli réseau (`sampleElevations()`, utilisé
// quand la trace importée n'a pas assez d'altitudes embarquées) — le même
// bug y survivait intact. Vérifie ici que le chemin d'import de trace
// bénéficie bien du même correctif (fillNearestValid partagée avec
// pipeline/elevation.js) une fois httpJson mocké pour simuler un vrai trou
// de couverture Géoplateforme.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-importtrack-gaps-test-${process.pid}`);
// Volontairement PAS ETAPEFORGE_OFFLINE=1 : ce test exerce le repli réseau
// (sampleElevations), jamais emprunté par les autres tests de ce fichier de
// trace (test/importTrack.test.js tourne hors-ligne, avec une trace dont
// l'altitude embarquée couvre déjà ≥ 80 % des points).

const { test, after } = require('node:test');
const assert = require('node:assert');

const http = require('../pipeline/http');
const originalHttpJson = http.httpJson;
let mockElevations = null;

http.httpJson = async (url) => {
  if (String(url).includes('data.geopf.fr/altimetrie')) {
    const lonsParam = String(url).match(/lon=([^&]*)/)[1];
    const count = lonsParam.split('|').length;
    if (!mockElevations || mockElevations.length !== count) {
      throw new Error(`mockElevations doit avoir exactement ${count} entrées (reçu ${mockElevations?.length})`);
    }
    return { elevations: mockElevations };
  }
  return originalHttpJson(url);
};

const { parseGpx, importTrackAsStage } = require('../pipeline/importTrack');
const { loadStageFull } = require('../pipeline/generate');

after(() => {
  http.httpJson = originalHttpJson;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

// Trace SANS altitude embarquée (aucun <ele>) : withEle = 0 < 80 % des
// points, force le repli réseau (sampleElevations) plutôt que
// l'interpolation par abscisse curviligne des altitudes de la trace.
function gpxWithoutElevation() {
  const pts = [];
  const lat0 = 43.30; // dans la bbox France, route vers geopfBatch
  const lon0 = -0.37;
  const mPerDegLon = 81000; // approx à cette latitude
  for (let m = 0; m <= 2000; m += 100) {
    const lon = lon0 + m / mPerDegLon;
    pts.push(`<trkpt lat="${lat0}" lon="${lon.toFixed(6)}"></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie sans altitude</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('importTrackAsStage : un trou d\'altimétrie du repli réseau reste null (pas coercé en 0 m)', async () => {
  const { points } = parseGpx(gpxWithoutElevation());
  const N_POINTS = 21; // vérifié empiriquement pour ce tracé de 2 km rééchantillonné tous les 100 m
  mockElevations = Array.from({ length: N_POINTS }, (_, i) => 300 + i * 3);
  mockElevations[10] = null; // trou au milieu

  const id = await importTrackAsStage(points, { name: 'Trace sans altitude', source: 'test' });
  const full = loadStageFull(id);

  const holeSample = full.samples.find((s) => s.ele_raw_m == null);
  assert.ok(holeSample, 'au moins un échantillon doit avoir ele_raw_m null (le trou simulé)');
  assert.ok(
    Number.isFinite(holeSample.ele_smooth_m),
    'ele_smooth_m au niveau du trou doit rester un nombre fini (comblé avant le lissage, pas de NaN)'
  );
  const neighbors = full.samples.filter((s) => s.ele_raw_m != null);
  assert.ok(neighbors.length >= N_POINTS - 2, 'seul le trou simulé doit être null, pas ses voisins');
});
