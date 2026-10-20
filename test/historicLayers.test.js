'use strict';
// Backlog 34.2 : fonds IGN historiques (carte 1950, état-major, photos
// aériennes 1950-1965) dans l'éditeur et la fiche.

const { test } = require('node:test');
const assert = require('node:assert');

function setup() {
  const layers = [];
  const controls = [];
  global.window = {};
  global.L = {
    tileLayer: (url, opts) => { const l = { url, opts, addTo(m) { m.added.push(this); return this; } }; layers.push(l); return l; },
    control: { layers: (bases) => ({ addTo() { controls.push(bases); return this; } }) },
  };
  delete require.cache[require.resolve('../frontend/common.js')];
  return { EF: require('../frontend/common.js'), layers, controls };
}

test('fonds historiques : identifiants, matrices et formats du GetCapabilities, licence affichée', () => {
  const { EF } = setup();
  const h = EF.historicLayers();
  const urls = Object.values(h).map((l) => l.url);
  assert.ok(urls.some((u) => /LAYER=GEOGRAPHICALGRIDSYSTEMS\.MAPS\.SCAN50\.1950&.*TILEMATRIXSET=PM_3_15&FORMAT=image\/jpeg/.test(u)));
  assert.ok(urls.some((u) => /LAYER=GEOGRAPHICALGRIDSYSTEMS\.ETATMAJOR40&.*TILEMATRIXSET=PM_6_15&FORMAT=image\/jpeg/.test(u)));
  assert.ok(urls.some((u) => /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS\.1950-1965&.*TILEMATRIXSET=PM_0_18&FORMAT=image\/png/.test(u)));
  // minZoom = premier niveau de la matrice (PM_3_15, PM_6_15, PM_0_18).
  assert.deepStrictEqual(Object.values(h).map((l) => l.opts.minZoom), [3, 6, 0]);
  for (const l of Object.values(h)) {
    // Source en lien (Licence Ouverte : source et date, ou lien vers la source).
    assert.match(l.opts.attribution, /© IGN — <a href="https:\/\/cartes\.gouv\.fr\/catalogue\/dataset\/IGNF_[A-Z0-9-]+">[^<]+<\/a> — <a href="[^"]+">Licence Ouverte<\/a>/);
    assert.ok(l.opts.minZoom <= l.opts.maxNativeZoom && l.opts.maxNativeZoom <= l.opts.maxZoom);
  }
});

test('addBaseLayers : en France, plan IGN par défaut et cinq fonds ; ailleurs, OSM et pas de fond historique', () => {
  const { EF, controls } = setup();
  const fr = { added: [] };
  EF.addBaseLayers(fr, 45.1, 6.1);
  assert.match(fr.added[0].url, /PLANIGNV2/);
  assert.deepStrictEqual(Object.keys(controls[0]).length, 5);
  const de = { added: [] };
  EF.addBaseLayers(de, 52.5, 13.3);
  assert.match(de.added[0].url, /openstreetmap/);
  assert.deepStrictEqual(Object.keys(controls[1]), ['Plan IGN (actuel)', 'OpenStreetMap']);
});
