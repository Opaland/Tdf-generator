'use strict';
// Tests unitaires directs de backend/exports.js — jusqu'ici seule une
// couverture indirecte existait (routes HTTP dans test/serverFuzz.test.js,
// centrée sur les régressions XSS ; test/leafletTooltipEscaping.test.js,
// centré sur l'échappement DOM). Score de mutation mesuré à 20.66 % sur ce
// fichier (backlog #64, suivi de session) : les fonctions pures qui
// construisent GPX/TCX/KML/le payload allégé n'avaient aucun test qui
// vérifie une valeur exacte (arrondi, troncature, filtre, ordre) — de quoi
// laisser survivre silencieusement une inversion de condition ou une
// constante changée. Ces fonctions ne dépendent d'aucune DB (elles prennent
// directement un objet `full` synthétique), donc testables sans passer par
// le serveur HTTP ni par pipeline/generate.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  stageToGpx, stageToTcx, stageToKml, stagePayload, ATTRIBUTIONS,
} = require('../backend/exports');

// nearestSampleDist et esc/formatElapsed/tcxToken ne sont pas exportées —
// exercées indirectement via les fonctions publiques ci-dessus, chacune
// avec un cas qui les distingue (voir commentaires par test).

function makeFull(overrides = {}) {
  return {
    stage: {
      id: 1, name: 'Étape test', date: '2024-07-14', stage_type: 'montagne',
      status: 'brouillon', stage_order: 1, official_distance_km: 100,
      generated_distance_km: 98.4, total_ascent_m: 1500, state: 'done',
      checks: null, source: null, is_transfer: 0,
    },
    waypoints: [
      { label: 'Départ', kind: 'start', lat: 43.1, lon: 1.1, bonus_sec: null, altitude_hint_m: 200 },
      { label: 'Arrivée', kind: 'finish', lat: 43.5, lon: 1.5, bonus_sec: null, altitude_hint_m: 800 },
    ],
    track: {
      geojson: { geometry: { coordinates: [[1.1, 43.1], [1.3, 43.3], [1.5, 43.5]] } },
      distance_m: 98400, router: 'osrm', approx_segments: [],
    },
    samples: [
      { lat: 43.1, lon: 1.1, dist_m: 0, ele_raw_m: 200, ele_smooth_m: 202 },
      { lat: 43.3, lon: 1.3, dist_m: 49200, ele_raw_m: 900, ele_smooth_m: 895 },
      { lat: 43.5, lon: 1.5, dist_m: 98400, ele_raw_m: 800, ele_smooth_m: 798 },
    ],
    climbs: [
      {
        name: 'Col test', category: '1', score: 42, start_km: 40, end_km: 49.2,
        length_km: 9.2, start_ele_m: 300, summit_ele_m: 900, avg_gradient: 6.5,
        max_gradient: 11.2, km_blocks: [{ fromM: 40000, toM: 49200, gradient: 6.5, ele0: 300, ele1: 900 }],
      },
    ],
    kmAnalysis: [{ km: 1, avg_gradient: 2.1 }, { km: 2, avg_gradient: -1.4 }],
    ...overrides,
  };
}

// --- stageToGpx --------------------------------------------------------

test('stageToGpx : trkpt un par sample, lat/lon arrondis à 6 décimales, ele via ?? (pas ||, 0 doit rester 0)', () => {
  const full = makeFull({
    samples: [{ lat: 43.123456789, lon: 1.987654321, dist_m: 0, ele_raw_m: 0 }],
  });
  const gpx = stageToGpx(full);
  assert.strictEqual((gpx.match(/<trkpt/g) || []).length, 1);
  assert.match(gpx, /lat="43\.123457"/, 'latitude arrondie à 6 décimales (toFixed(6))');
  assert.match(gpx, /lon="1\.987654"/, 'longitude arrondie à 6 décimales (toFixed(6))');
  assert.match(gpx, /<ele>0<\/ele>/, 'ele_raw_m=0 doit rester 0 (?? et pas ||, qui remplacerait 0 par le fallback)');
});

test('stageToGpx : waypoints sans lat (approximés) exclus des <wpt>', () => {
  const full = makeFull({
    waypoints: [
      { label: 'Avec coordonnées', kind: 'via', lat: 43.2, lon: 1.2 },
      { label: 'Sans coordonnées', kind: 'via', lat: null, lon: null },
    ],
  });
  const gpx = stageToGpx(full);
  assert.match(gpx, /Avec coordonnées/);
  assert.doesNotMatch(gpx, /Sans coordonnées/);
});

test('stageToGpx : sommet de côte ajouté comme <wpt> avec catégorie et échantillon le plus proche', () => {
  const full = makeFull();
  const gpx = stageToGpx(full);
  assert.match(gpx, /<name>Col test \(cat\. 1\)<\/name>/);
  assert.match(gpx, /<desc>9\.2 km à 6\.5 % \(max 11\.2 %\)<\/desc>/);
  // Le sample le plus proche du sommet (end_km=49.2 -> 49200 m) est samples[1] (49200 m exact).
  assert.match(gpx, /<ele>900<\/ele>/);
});

test('stageToGpx : aucune côte -> pas de bloc waypoint de sommet, GPX toujours bien formé', () => {
  const full = makeFull({ climbs: [] });
  const gpx = stageToGpx(full);
  assert.doesNotMatch(gpx, /cat\./);
  assert.match(gpx, /<\/gpx>$/);
});

test('stageToGpx : nom d\'étape avec caractères spéciaux échappé (esc) dans metadata et trk', () => {
  const full = makeFull({ stage: { ...makeFull().stage, name: 'A & B <C> "D"' } });
  const gpx = stageToGpx(full);
  assert.ok(!gpx.includes('A & B <C> "D"'), 'le nom brut ne doit jamais apparaître tel quel');
  const occurrences = (gpx.match(/A &amp; B &lt;C&gt; &quot;D&quot;/g) || []).length;
  assert.strictEqual(occurrences, 2, 'le nom échappé doit apparaître dans <metadata><name> et <trk><name>');
});

// --- stageToTcx ----------------------------------------------------------

test('stageToTcx : tcxToken tronque strictement à la limite (Course=15, CoursePoint=10), jamais un caractère de plus', () => {
  const full = makeFull({
    stage: { ...makeFull().stage, name: 'Un nom de dix-neuf ca' }, // 21 caractères
    waypoints: [{ label: 'Un_label_de_15_caracteres_ou_plus', kind: 'via', lat: 43.2, lon: 1.2 }],
  });
  const tcx = stageToTcx(full);
  const courseName = tcx.match(/<Name>([^<]*)<\/Name>/)[1];
  assert.strictEqual(courseName.length, 15, 'Name du Course (RestrictedToken_t) doit être tronqué à exactement 15 caractères');
  assert.strictEqual(courseName, 'Un nom de dix-n');
  const cpName = tcx.match(/<CoursePoint>[\s\S]*?<Name>([^<]*)<\/Name>/)[1];
  assert.strictEqual(cpName.length, 10, 'Name du CoursePoint (CoursePointName_t) doit être tronqué à exactement 10 caractères');
});

test('stageToTcx : tcxToken ne tronque PAS une chaîne plus courte que la limite (pas de padding, pas de troncature inutile)', () => {
  const full = makeFull({ stage: { ...makeFull().stage, name: 'Court' } });
  const tcx = stageToTcx(full);
  const courseName = tcx.match(/<Name>([^<]*)<\/Name>/)[1];
  assert.strictEqual(courseName, 'Court');
});

test('stageToTcx : PointType "Summit" pour un waypoint kind=col, "Generic" sinon', () => {
  const full = makeFull({
    waypoints: [
      { label: 'Col', kind: 'col', lat: 43.2, lon: 1.2 },
      { label: 'Ville', kind: 'via', lat: 43.3, lon: 1.3 },
    ],
    climbs: [],
  });
  const tcx = stageToTcx(full);
  const types = [...tcx.matchAll(/<PointType>([^<]*)<\/PointType>/g)].map((m) => m[1]);
  assert.deepStrictEqual(types, ['Summit', 'Generic']);
});

test('stageToTcx : TCX_CLIMB_POINT_TYPE mappe chaque catégorie ASO, et retombe sur "Summit" pour une catégorie inconnue', () => {
  const cases = [['HC', 'Hors Category'], ['1', '1st Category'], ['2', '2nd Category'], ['3', '3rd Category'], ['4', '4th Category'], ['inconnue', 'Summit']];
  for (const [category, expected] of cases) {
    const full = makeFull({
      waypoints: [],
      climbs: [{ ...makeFull().climbs[0], category }],
    });
    const tcx = stageToTcx(full);
    const type = tcx.match(/<CoursePoint>[\s\S]*?<PointType>([^<]*)<\/PointType>/)[1];
    assert.strictEqual(type, expected, `catégorie ${category}`);
  }
});

test('stageToTcx : Time croissant et proportionnel à la distance (vitesse conventionnelle 25 km/h)', () => {
  const full = makeFull();
  const tcx = stageToTcx(full);
  const trackSection = tcx.match(/<Track>([\s\S]*?)<\/Track>/)[1];
  const trackTimes = [...trackSection.matchAll(/<Time>([^<]*)<\/Time>/g)].map((m) => new Date(m[1]).getTime());
  assert.strictEqual(trackTimes.length, 3);
  assert.ok(trackTimes[1] > trackTimes[0] && trackTimes[2] > trackTimes[1], 'le temps doit strictement croître avec la distance');
  const AVG_SPEED_MPS = 25000 / 3600;
  const expectedDeltaSec = (98400 - 0) / AVG_SPEED_MPS;
  const actualDeltaSec = (trackTimes[2] - trackTimes[0]) / 1000;
  assert.ok(Math.abs(actualDeltaSec - expectedDeltaSec) < 1, `écart attendu ~${expectedDeltaSec}s, obtenu ${actualDeltaSec}s`);
});

test('stageToTcx : date d\'étape absente -> date par défaut 2024-01-01, pas une exception', () => {
  const full = makeFull({ stage: { ...makeFull().stage, date: null } });
  assert.doesNotThrow(() => stageToTcx(full));
  const tcx = stageToTcx(full);
  assert.match(tcx, /<Time>2024-01-01T08:00:00\.000Z<\/Time>/);
});

test('stageToTcx : DistanceMeters/TotalTimeSeconds dérivés de track.distance_m quand présent', () => {
  const full = makeFull();
  const tcx = stageToTcx(full);
  assert.match(tcx, /<DistanceMeters>98400\.0<\/DistanceMeters>/);
  const AVG_SPEED_MPS = 25000 / 3600;
  const expectedTotalSec = Math.round(98400 / AVG_SPEED_MPS);
  assert.match(tcx, new RegExp(`<TotalTimeSeconds>${expectedTotalSec}<\\/TotalTimeSeconds>`));
});

test('stageToTcx : sans track, retombe sur la distance du dernier sample', () => {
  const full = makeFull({ track: null });
  const tcx = stageToTcx(full);
  assert.match(tcx, /<DistanceMeters>98400\.0<\/DistanceMeters>/);
});

// --- stageToKml ------------------------------------------------------------

test('stageToKml : coordinates au format "lon,lat,ele" (KML inverse lon/lat par rapport à GPX)', () => {
  const full = makeFull({
    waypoints: [{ label: 'Point', kind: 'via', lat: 43.25, lon: 1.35, altitude_hint_m: 555 }],
  });
  const kml = stageToKml(full);
  assert.match(kml, /<coordinates>1\.35,43\.25,555<\/coordinates>/);
});

test('stageToKml : altitude manquante (undefined) -> "0" via ??, jamais "undefined" ni NaN', () => {
  const full = makeFull({
    waypoints: [{ label: 'Sans altitude', kind: 'via', lat: 43.2, lon: 1.2, altitude_hint_m: undefined }],
  });
  const kml = stageToKml(full);
  assert.match(kml, /<coordinates>1\.2,43\.2,0<\/coordinates>/);
});

test('stageToKml : trackCoords un tuple par sample, joints par un espace', () => {
  const full = makeFull();
  const kml = stageToKml(full);
  const trackBlock = kml.match(/<altitudeMode>absolute<\/altitudeMode>\s*<coordinates>([^<]*)<\/coordinates>/)[1];
  const tuples = trackBlock.trim().split(' ');
  assert.strictEqual(tuples.length, 3, 'un tuple de coordonnées par sample');
  assert.strictEqual(tuples[0], '1.1,43.1,200');
});

test('stageToKml : description d\'une côte échappée (esc) même si elle contient des caractères réservés XML', () => {
  const full = makeFull({
    climbs: [{ ...makeFull().climbs[0], name: 'Col & <test>' }],
  });
  const kml = stageToKml(full);
  assert.ok(!kml.includes('Col & <test>'));
  assert.match(kml, /Col &amp; &lt;test&gt;/);
});

// --- stagePayload ------------------------------------------------------

test('stagePayload : ne renvoie que les champs de stage listés explicitement (pas de fuite d\'un champ interne ajouté par erreur)', () => {
  const full = makeFull({ stage: { ...makeFull().stage, secret_internal_field: 'ne doit jamais sortir' } });
  const payload = stagePayload(full);
  assert.strictEqual(payload.stage.secret_internal_field, undefined);
  assert.deepStrictEqual(Object.keys(payload.stage).sort(), [
    'checks', 'date', 'generated_distance_km', 'id', 'is_transfer', 'name',
    'official_distance_km', 'source', 'stage_order', 'stage_type', 'state', 'status', 'total_ascent_m',
  ].sort());
});

test('stagePayload : waypoints réduits aux champs attendus, approximated forcé en booléen', () => {
  const full = makeFull({
    waypoints: [{ label: 'W', kind: 'via', lat: 1, lon: 2, approximated: undefined, bonus_sec: undefined, extra: 'x' }],
  });
  const payload = stagePayload(full);
  assert.deepStrictEqual(payload.waypoints[0], { label: 'W', kind: 'via', lat: 1, lon: 2, approximated: false, bonus_sec: null });
});

test('stagePayload : track absent -> null (pas une exception sur track.geojson)', () => {
  const full = makeFull({ track: null });
  const payload = stagePayload(full);
  assert.strictEqual(payload.track, null);
});

test('stagePayload : profile utilise decimate() avec maxSamples par défaut (600), respecte un override explicite', () => {
  const manySamples = Array.from({ length: 1000 }, (_, i) => ({ dist_m: i * 10, ele_smooth_m: i, ele_raw_m: i, lat: 43, lon: 1 }));
  const full = makeFull({ samples: manySamples });
  const defaultPayload = stagePayload(full);
  assert.strictEqual(defaultPayload.profile.length, 600);
  const overridden = stagePayload(full, { maxSamples: 50, maxTrack: 50 });
  assert.strictEqual(overridden.profile.length, 50);
});

test('stagePayload : premier et dernier point du profil toujours conservés par decimate (bornes de l\'étape)', () => {
  const manySamples = Array.from({ length: 1000 }, (_, i) => ({ dist_m: i * 10, ele_smooth_m: i, ele_raw_m: i, lat: 43, lon: 1 }));
  const full = makeFull({ samples: manySamples });
  const payload = stagePayload(full, { maxSamples: 20, maxTrack: 20 });
  assert.strictEqual(payload.profile[0].d, 0);
  assert.strictEqual(payload.profile[payload.profile.length - 1].d, 9990);
});

test('stagePayload : climbs et kmAnalysis réduits aux champs attendus', () => {
  const full = makeFull();
  const payload = stagePayload(full);
  assert.deepStrictEqual(Object.keys(payload.climbs[0]).sort(), [
    'avg_gradient', 'end_km', 'km_blocks', 'length_km', 'max_gradient', 'name', 'score', 'start_ele_m', 'start_km', 'summit_ele_m', 'category',
  ].sort());
  assert.deepStrictEqual(payload.kmAnalysis, [{ km: 1, avg_gradient: 2.1 }, { km: 2, avg_gradient: -1.4 }]);
});

test('stagePayload : kmAnalysis absent (undefined) -> tableau vide, pas une exception', () => {
  const full = makeFull({ kmAnalysis: undefined });
  const payload = stagePayload(full);
  assert.deepStrictEqual(payload.kmAnalysis, []);
});

// --- ATTRIBUTIONS ------------------------------------------------------

test('ATTRIBUTIONS : chaîne non vide citant les sources de données réellement utilisées', () => {
  assert.match(ATTRIBUTIONS, /IGN/);
  assert.match(ATTRIBUTIONS, /OpenStreetMap/);
  assert.match(ATTRIBUTIONS, /OSRM/);
});
