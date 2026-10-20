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
