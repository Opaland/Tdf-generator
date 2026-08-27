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

// Trouvaille en relecture adverse du correctif plausibleEle (26/08/2026,
// pipeline/elevation.js) : ce filtre ne couvrait que les altitudes venant
// des fournisseurs API (Géoplateforme/opentopodata). Le CHEMIN OPPOSÉ —
// altitude déjà embarquée dans le fichier importé (≥ 80 % des points,
// branche qui n'appelle jamais sampleElevations) — réinterpolait les
// `<ele>` brutes sans aucun filtre de plausibilité. Un capteur GPS/FIT peut
// écrire un sentinel « pas de fix » hors de toute plage physique
// (ex. -32768) directement dans le fichier ; sans filtre, une seule valeur
// aberrante réinterpolait un D+ fantôme de plusieurs milliers de mètres sur
// les points voisins — même classe de bug que le sentinel -99999 du
// Géoplateforme, vecteur différent (import de trace, pas API).
function gpxAvecSentinelCapteur() {
  const pts = [];
  const lat0 = 43.0;
  const lon0 = 0.5;
  const mPerDegLat = 110540;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const m = i * 100;
    const lat = lat0 + m / mPerDegLat;
    // Montée régulière 800 -> ~995 m, un seul point capteur cassé au milieu.
    const ele = i === 20 ? -32768 : 800 + i * 5;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>${ele}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie capteur cassé</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

function gpxSansSentinel() {
  const pts = [];
  const lat0 = 43.0;
  const lon0 = 0.5;
  const mPerDegLat = 110540;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const m = i * 100;
    const lat = lat0 + m / mPerDegLat;
    const ele = 800 + i * 5;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon0}"><ele>${ele}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><name>Sortie propre</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

test('importTrackAsStage : un sentinel capteur (-32768) dans l\'altitude embarquée de la trace ne gonfle pas le D+', async () => {
  const { points: withSentinel } = parseGpx(gpxAvecSentinelCapteur());
  const idWith = await importTrackAsStage(withSentinel, { name: 'Trace capteur cassé', source: 'test' });
  const fullWith = loadStageFull(idWith);

  const { points: clean } = parseGpx(gpxSansSentinel());
  const idClean = await importTrackAsStage(clean, { name: 'Trace propre', source: 'test' });
  const fullClean = loadStageFull(idClean);

  assert.ok(
    Math.abs(fullWith.stage.total_ascent_m - fullClean.stage.total_ascent_m) <= 10,
    `D+ avec sentinel (${fullWith.stage.total_ascent_m} m) doit rester proche du D+ propre (${fullClean.stage.total_ascent_m} m), pas gonflé de plusieurs milliers de mètres`
  );
  const badSample = fullWith.samples.find((s) => s.ele_raw_m != null && (s.ele_raw_m < -500 || s.ele_raw_m > 6000));
  assert.strictEqual(badSample, undefined, 'aucun échantillon ne doit porter le sentinel ou une valeur interpolée aberrante');
});

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
