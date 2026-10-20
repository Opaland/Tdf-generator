'use strict';
// Backlog 34.1 : recoupement des villes-étapes avec Wikidata (sans réseau).

const { test } = require('node:test');
const assert = require('node:assert');
const { parsePoint, stagesFromBindings, matchStages, compareEdition, editionQuery } = require('../pipeline/wikidataTowns');

const b = (s, d, start, sc, end, ec, dist) => ({
  s: { value: `http://www.wikidata.org/entity/${s}` }, d: { value: `${d}T00:00:00Z` },
  start: { value: `http://www.wikidata.org/entity/${start[0]}` }, startLabel: { value: start[1] }, sc: { value: sc },
  end: { value: `http://www.wikidata.org/entity/${end[0]}` }, endLabel: { value: end[1] }, ec: { value: ec },
  dist: { value: String(dist) },
});

test('parsePoint : « Point(lon lat) » → { lat, lon }', () => {
  assert.deepStrictEqual(parsePoint('Point(13.28 52.5)'), { lat: 52.5, lon: 13.28 });
  assert.strictEqual(parsePoint(''), null);
  assert.strictEqual(parsePoint(undefined), null);
});

test('editionQuery : libellé anglais exact, Hommes ou Femmes', () => {
  assert.match(editionQuery(1987, 'hommes'), /"1987 Tour de France"@en/);
  assert.match(editionQuery(2022, 'femmes'), /"2022 Tour de France Femmes"@en/);
});

test('matchStages : par date, puis par distance la plus proche pour deux demi-étapes le même jour', () => {
  const wd = stagesFromBindings([
    b('Q1', '1987-07-02', ['Q56036', 'Berlin-Ouest'], 'Point(13.28 52.5)', ['Q56036', 'Berlin-Ouest'], 'Point(13.28 52.5)', 105.5),
    b('Q2', '1987-07-02', ['Q56036', 'Berlin-Ouest'], 'Point(13.28 52.5)', ['Q56036', 'Berlin-Ouest'], 'Point(13.28 52.5)', 40.5),
  ]);
  const ours = [{ number: 2, date: '1987-07-02', distanceKm: 40.5 }, { number: 1, date: '1987-07-02', distanceKm: 105.5 }, { number: 3, date: '1987-07-04', distanceKm: 219 }];
  const m = matchStages(ours, wd);
  assert.deepStrictEqual(m.map((x) => x.wd && x.wd.qid), ['Q2', 'Q1', null]);
});

test('compareEdition : homonyme à plus de 10 km signalé, distance à plus de 5 %, rien sur une donnée absente', () => {
  const wd = stagesFromBindings([
    b('Q10', '1903-07-01', ['Q244241', 'Villeneuve-Saint-Georges'], 'Point(2.449 48.732)', ['Q456', 'Lyon'], 'Point(4.835 45.758)', 467),
    b('Q11', '1903-07-05', ['Q456', 'Lyon'], 'Point(4.835 45.758)', ['Q23482', 'Marseille'], 'Point(5.37 43.296)', 374),
  ]);
  const ours = [
    { number: 1, date: '1903-07-01', distanceKm: 467, start: { label: 'Paris', lat: 48.8535, lon: 2.34839, confidence: 'ok' }, finish: { label: 'Lyon', lat: 45.75781, lon: 4.83201 } },
    { number: 2, date: '1903-07-05', distanceKm: 420, start: { label: 'Lyon', lat: 45.75781, lon: 4.83201 }, finish: null },
    { number: 3, date: '1903-07-08', distanceKm: 423, start: null, finish: null },
  ];
  const f = compareEdition('1903', ours, wd);
  assert.deepStrictEqual(f.map((x) => `${x.where} ${x.kind}`), ['1903/1 départ', '1903/2 distance', '1903/3 absente']);
  assert.match(f[0].detail, /« Paris » placé à 15 km de « Villeneuve-Saint-Georges »/);
  assert.match(f[1].detail, /420 km ici, 374 km sur Wikidata \(\+12\.3 %\)/);
});

test('date décalée d\'un jour sur deux étapes consécutives : appariées par les villes, pas de faux homonyme', () => {
  // Cas réel 1905/10-11 : Rennes → Caen et Caen → Paris, un jour plus tard sur Wikidata.
  const wd = stagesFromBindings([
    b('Q28944178', '1905-07-29', ['Q647', 'Rennes'], 'Point(-1.68 48.11)', ['Q41185', 'Caen'], 'Point(-0.37 49.18)', 167),
    b('Q28944179', '1905-07-30', ['Q41185', 'Caen'], 'Point(-0.37 49.18)', ['Q90', 'Paris'], 'Point(2.35 48.86)', 253),
  ]);
  const ours = [
    { number: 10, date: '1905-07-28', distanceKm: 167, start: { label: 'Rennes', lat: 48.11, lon: -1.68 }, finish: { label: 'Caen', lat: 49.18, lon: -0.37 } },
    { number: 11, date: '1905-07-29', distanceKm: 253, start: { label: 'Caen', lat: 49.18, lon: -0.37 }, finish: { label: 'Paris', lat: 48.86, lon: 2.35 } },
  ];
  const f = compareEdition('1905', ours, wd);
  assert.deepStrictEqual(f.map((x) => `${x.where} ${x.kind}`), ['1905/10 date', '1905/11 date']);
  assert.match(f[1].detail, /le 1905-07-29 ici, le 1905-07-30 sur Wikidata/);
});

test('prologue de 4 km : un écart d\'arrondi (4 contre 4,3) n\'est pas signalé ; demi-étapes : clés distinctes', () => {
  const wd = stagesFromBindings([
    b('Q1', '1980-06-26', ['Q7', 'Francfort'], 'Point(8.68 50.11)', ['Q7', 'Francfort'], 'Point(8.68 50.11)', 4.3),
    b('Q2', '1977-07-12', ['Q8', 'A'], 'Point(5 45)', ['Q9', 'B'], 'Point(5.2 45.1)', 80),
    b('Q3', '1977-07-12', ['Q9', 'B'], 'Point(5.2 45.1)', ['Q10', 'C'], 'Point(5.5 45.3)', 120),
  ]);
  const pro = compareEdition('1980', [{ number: 0, prologue: true, date: '1980-06-26', distanceKm: 4, start: { lat: 50.11, lon: 8.68 }, finish: { lat: 50.11, lon: 8.68 } }], wd);
  assert.deepStrictEqual(pro, []);
  const halves = compareEdition('1977', [
    { number: 13, date: '1977-07-12', distanceKm: 95, start: { label: 'A', lat: 45, lon: 5 }, finish: { label: 'B', lat: 45.1, lon: 5.2 } },
    { number: 13, date: '1977-07-12', distanceKm: 140, start: { label: 'B', lat: 45.1, lon: 5.2 }, finish: { label: 'C', lat: 45.3, lon: 5.5 } },
  ], wd);
  assert.deepStrictEqual(halves.map((x) => x.where), ['1977/13a', '1977/13b']);
});
