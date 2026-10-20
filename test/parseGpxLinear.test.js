'use strict';
// Epic 35.2 (revue globale du 19/10/2026) : parseGpx en temps linéaire, et
// attributs lat/lon dans n'importe quel ordre et avec guillemets simples.

const { test } = require('node:test');
const assert = require('node:assert');
const { parseGpx } = require('../pipeline/importTrack');

test('des <trkpt> jamais fermés ne rendent pas le parseur quadratique', () => {
  // ~1,8 Mo : l'ancienne regex paresseuse y mettait plusieurs dizaines de
  // secondes (920 Ko mesurés à 8,2 s).
  const text = '<gpx><trk><trkseg>' + '<trkpt lat="1" lon="1"><ele>5'.repeat(60000) + '</trkseg></trk></gpx>';
  const t0 = Date.now();
  const { points } = parseGpx(text);
  const ms = Date.now() - t0;
  assert.strictEqual(points.length, 60000);
  assert.ok(ms < 2000, `parseGpx a pris ${ms} ms`);
});

test('des <name> jamais fermés ne rendent pas la lecture du nom quadratique', () => {
  const text = '<gpx>' + '<name>x'.repeat(200000) + '<trkpt lat="1" lon="2"/></gpx>';
  const t0 = Date.now();
  const { name, points } = parseGpx(text);
  assert.ok(Date.now() - t0 < 2000);
  assert.strictEqual(name, null);
  assert.strictEqual(points.length, 1);
});

test('lon avant lat, guillemets simples, espaces autour de =', () => {
  const text = `<gpx><trk><name> Ma sortie </name><trkseg>
    <trkpt lon="2.35" lat="48.85"><ele>35</ele><time>2026-07-01T08:00:00Z</time></trkpt>
    <trkpt lat='48.86' lon='2.36'><ele>36</ele></trkpt>
    <trkpt lon = "2.37" lat = "48.87" />
  </trkseg></trk></gpx>`;
  const { points, name } = parseGpx(text);
  assert.strictEqual(name, 'Ma sortie');
  assert.deepStrictEqual(points.map((p) => [p.lat, p.lon, p.ele]), [[48.85, 2.35, 35], [48.86, 2.36, 36], [48.87, 2.37, null]]);
  assert.strictEqual(points[0].time.toISOString(), '2026-07-01T08:00:00.000Z');
});

test("la balise fermante d'un point n'est jamais cherchée au-delà du point suivant", () => {
  // Point 1 non fermé : son <ele> ne doit pas être pris dans le corps du point 2.
  const text = '<trkpt lat="1" lon="1"><trkpt lat="2" lon="2"><ele>900</ele></trkpt>';
  const { points } = parseGpx(text);
  assert.deepStrictEqual(points.map((p) => p.ele), [null, 900]);
});

// Relecture adverse : deux autres chemins quadratiques, absents du premier
// correctif (et déjà présents dans l'ancien parseur).
test('entrées hostiles restantes : temps linéaire', () => {
  const cases = {
    "'<trkpt ' sans '>'": '<trkpt '.repeat(150000), // ~1 Mo ; avant : 53 s à 910 Ko
    'attributs sans >': '<trkpt lat="1" lon="2" '.repeat(40000),
    '<time> non fermé + espaces': '<trkpt lat="1" lon="2"><time>a' + ' '.repeat(1000000) + '</trkpt>',
    'mot long dans <extensions>': '<trkpt lat="1" lon="2"><extensions>' + 'a'.repeat(1000000) + '</extensions></trkpt>',
    'commentaires non fermés': '<!-- '.repeat(100000) + '<trkpt lat="1" lon="2"/>',
  };
  for (const [label, text] of Object.entries(cases)) {
    const t0 = Date.now();
    parseGpx(text);
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `${label} : ${ms} ms`);
  }
});

test('attributs : data-lat n\'est pas lat, valeurs non décimales refusées', () => {
  const { points } = parseGpx('<trkpt data-lat="7" lat="3" lon="4"/><trkpt lat="1e1" lon="2"/><trkpt lat="+1" lon="2"/><trkpt lat="1" lon="2.5abc"/><trkpt lat="1,5" lon="2"/><trkpt lat=".5" lon="-0.25"/>');
  assert.deepStrictEqual(points.map((p) => [p.lat, p.lon]), [[3, 4], [0.5, -0.25]]);
});

test('un point commenté ou en CDATA n\'est pas un point', () => {
  const { points } = parseGpx('<!-- <trkpt lat="9" lon="9"> --><![CDATA[<trkpt lat="8" lon="8"/>]]><trkpt lat="1" lon="2"><ele>10</ele></trkpt>');
  assert.deepStrictEqual(points.map((p) => [p.lat, p.lon, p.ele]), [[1, 2, 10]]);
});
