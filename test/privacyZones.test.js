'use strict';
// Backlog 34.7 : zones de confidentialité autour du domicile, appliquées aux
// exports et mini-sites des traces importées et à la carte des traces.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-privacy-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { validateZones, inZone } = require('../pipeline/privacy');

let appServer;
let base;
let traceId;
const json = (p, method, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Trace de 45,000 à 45,100 de latitude (≈ 11 km), domicile au départ.
function gpx() {
  let pts = '';
  for (let i = 0; i <= 200; i++) pts += `<trkpt lat="${(45 + i * 0.0005).toFixed(6)}" lon="6.000000"><ele>${300 + i}</ele></trkpt>`;
  return `<?xml version="1.0"?><gpx version="1.1"><trk><name>t</name><trkseg>${pts}</trkseg></trk></gpx>`;
}
const HOME = { lat: 45.0, lon: 6.0, radiusM: 1000 };

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
  const r = await fetch(`${base}/api/import/gpx?name=Depuis%20chez%20moi`, { method: 'POST', headers: { 'Content-Type': 'application/gpx+xml' }, body: gpx() });
  traceId = (await r.json()).id;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('validateZones : bornes et types, rien d\'accepté à moitié', () => {
  assert.deepStrictEqual(validateZones([HOME]), [HOME]);
  for (const bad of [[{ lat: 95, lon: 6, radiusM: 500 }], [{ lat: 45, lon: 6, radiusM: 50 }], [{ lat: 45, lon: 6, radiusM: 9000 }], [{ lat: '45', lon: 6, radiusM: 500 }], [null], 'x', Array(6).fill(HOME)]) {
    assert.throws(() => validateZones(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  assert.ok(inZone({ lat: 45.005, lon: 6 }, [HOME]) && !inZone({ lat: 45.02, lon: 6 }, [HOME]));
});

test('PUT /api/profile : zones enregistrées sans toucher à la FC max, invalides refusées en 400', async () => {
  assert.strictEqual((await json('/api/profile', 'PUT', { hrMaxBpm: 185 })).status, 200);
  assert.strictEqual((await json('/api/profile', 'PUT', { privacyZones: [{ lat: 45, lon: 6, radiusM: 10 }] })).status, 400);
  const r = await (await json('/api/profile', 'PUT', { privacyZones: [HOME] })).json();
  assert.deepStrictEqual(r, { hrMaxBpm: 185, privacyZones: [HOME] });
  assert.strictEqual((await json('/api/profile', 'PUT', {})).status, 400);
});

test('exports d\'une trace : aucun point dans la zone (GPX, JSON, carte des traces) ; la fiche reste complète', async () => {
  const lat = (s) => [...s.matchAll(/lat="([\d.]+)"/g)].map((m) => Number(m[1]));
  const gpxOut = await (await fetch(`${base}/api/stages/${traceId}/export.gpx`)).text();
  const lats = lat(gpxOut);
  assert.ok(lats.length > 50, `${lats.length} points exportés`);
  assert.ok(lats.every((l) => !inZone({ lat: l, lon: 6 }, [HOME])), 'un point exporté tombe dans la zone');
  const full = await (await fetch(`${base}/api/stages/${traceId}/export.json`)).json();
  assert.ok(full.samples.every((s) => !inZone(s, [HOME])));
  assert.ok(full.track.geojson.geometry.coordinates.every((c) => !inZone({ lat: c[1], lon: c[0] }, [HOME])));
  const { lines } = await (await fetch(`${base}/api/traces/lines`)).json();
  assert.ok(lines[0].coords.every(([la, lo]) => !inZone({ lat: la, lon: lo }, [HOME])));
  const html = await (await fetch(`${base}/api/stages/${traceId}/export.html`)).text();
  assert.doesNotMatch(html, /"lat":45(\.000|,)/, 'le mini-site embarque un point de la zone');
  // Dans l'application, la trace n'est pas tronquée.
  const app = await (await fetch(`${base}/api/stages/${traceId}`)).json();
  assert.ok(app.samples.some((s) => inZone(s, [HOME])));
});

test('parseZones : une zone invalide est écartée seule ; un réglage illisible vaut « tout masquer »', () => {
  const { parseZones, maskStage } = require('../pipeline/privacy');
  assert.deepStrictEqual(parseZones(JSON.stringify([HOME, { lat: 10, lon: 10, radiusM: 99 }])), [HOME]);
  assert.strictEqual(parseZones('{cassé'), null);
  assert.strictEqual(parseZones('{"a":1}'), null);
  assert.deepStrictEqual(parseZones(null), []);
  // Toutes les zones enregistrées invalides : plus rien ne dit où est le lieu.
  assert.strictEqual(parseZones(JSON.stringify([{ lat: 45, lon: 6, radiusM: 50 }])), null);
  assert.deepStrictEqual(parseZones('[]'), []);
  const full = { stage: {}, track: { router: 'trace', geojson: { geometry: { coordinates: [[6, 45.5]] } } }, samples: [{ dist_m: 0, lat: 45.5, lon: 6 }] };
  const m = maskStage(full, null);
  assert.deepStrictEqual([m.samples.length, m.track.geojson.geometry.coordinates.length], [0, 0]);
});

test('trace masquée : côtes, km par km et commune de départ retirés ; export d\'édition masqué aussi', async () => {
  const { getDb } = require('../backend/db');
  const db = getDb();
  db.prepare(`INSERT INTO climbs (stage_id, name, category, score, start_km, end_km, length_km, start_ele_m, summit_ele_m, avg_gradient, max_gradient)
              VALUES (?, 'Côte de chez moi', '4', 10, 0, 1.5, 1.5, 300, 360, 4, 6), (?, 'Côte du bout', '4', 10, 9, 10.5, 1.5, 390, 450, 4, 6)`).run(traceId, traceId);
  db.prepare("UPDATE stages SET city_hint = 'Ma commune' WHERE id = ?").run(traceId);
  const full = await (await fetch(`${base}/api/stages/${traceId}/export.json`)).json();
  assert.deepStrictEqual(full.climbs.map((c) => c.name), ['Côte du bout']);
  assert.ok(full.kmAnalysis.every((r) => r.km > 1), `km par km : ${full.kmAnalysis.map((r) => r.km)}`);
  assert.strictEqual(full.stage.city_hint, null);
  // Trace rattachée à un tour : l'export d'édition et la carte d'édition la masquent aussi.
  const ed = await (await json('/api/editions', 'POST', { name: 'Mon tour', year: 2026, is_custom: 1 })).json();
  db.prepare('UPDATE stages SET edition_id = ? WHERE id = ?').run(ed.id, traceId);
  const mapdata = await (await fetch(`${base}/api/editions/${ed.id}/mapdata`)).json();
  const st = mapdata.stages.find((x) => x.stage.id === traceId);
  assert.ok(st.profile.every((p) => !inZone(p, [HOME])));
  assert.ok(st.track.coords.every(([lo, la]) => !inZone({ lat: la, lon: lo }, [HOME])));
  const html = await (await fetch(`${base}/api/editions/${ed.id}/export.html`)).text();
  assert.doesNotMatch(html, /"lat":45(,|\.000)/);
  assert.doesNotMatch(html, /Côte de chez moi/);
});

test('trace masquée : communes traversées et pénibilité retirées, site statique masqué aussi', async () => {
  const { getDb } = require('../backend/db');
  const db = getDb();
  const communes = { stepM: 1000, points: 12, pointsHorsFrance: 0, pointsSansCommune: 0, communes: [
    { km: 0, nom: 'VilleDomicile', departement: 'Isère' }, { km: 6, nom: 'VilleDuMilieu', departement: 'Isère' }] };
  db.prepare('UPDATE tracks SET communes = ? WHERE stage_id = ?').run(JSON.stringify(communes), traceId);
  const full = await (await fetch(`${base}/api/stages/${traceId}/export.json`)).json();
  assert.deepStrictEqual(full.track.communes.communes.map((c) => c.nom), ['VilleDuMilieu']);
  assert.strictEqual(full.pain, null, 'la pénibilité trahirait la côte retirée');
  const roadbook = await (await fetch(`${base}/api/stages/${traceId}/roadbook.html`)).text();
  assert.doesNotMatch(roadbook, /VilleDomicile/);
  assert.match(roadbook, /VilleDuMilieu/);
  // Site statique : processus enfant (CLAUDE.md règle 4), même base.
  const dist = path.join(process.env.ETAPEFORGE_DATA_DIR, 'dist');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-site.js')], {
    env: { ...process.env, ETAPEFORGE_DIST_DIR: dist }, stdio: 'ignore',
  });
  const edFile = fs.readdirSync(path.join(dist, 'data')).find((f) => /^edition-\d+\.json$/.test(f));
  const ed = JSON.parse(fs.readFileSync(path.join(dist, 'data', edFile), 'utf8'));
  assert.strictEqual(ed.stages.find((x) => x.id === traceId).city_hint, null);
  const climbs = JSON.parse(fs.readFileSync(path.join(dist, 'data', 'climbs.json'), 'utf8'));
  assert.deepStrictEqual(climbs.filter((c) => c.stage_id === traceId).map((c) => c.name), ['Côte du bout']);
  for (const f of fs.readdirSync(path.join(dist, 'data'))) {
    const txt = fs.readFileSync(path.join(dist, 'data', f), 'utf8');
    assert.doesNotMatch(txt, /Côte de chez moi|Ma commune|VilleDomicile/, f);
  }
});

test('réglage illisible en base : la carte des traces est vide, les exports ne publient aucun point', async () => {
  const { setSetting } = require('../backend/settings');
  setSetting('privacy_zones', '{cassé');
  const prof = await (await fetch(`${base}/api/profile`)).json();
  assert.strictEqual(prof.privacyZonesUnreadable, true);
  assert.deepStrictEqual((await (await fetch(`${base}/api/traces/lines`)).json()).lines, []);
  const full = await (await fetch(`${base}/api/stages/${traceId}/export.json`)).json();
  assert.strictEqual(full.samples.length, 0);
  // GPX, TCX, KML : un refus qui dit pourquoi, pas « Étape non générée ».
  for (const ext of ['gpx', 'tcx', 'kml']) {
    const r = await fetch(`${base}/api/stages/${traceId}/export.${ext}`);
    assert.strictEqual(r.status, 409, ext);
    assert.match((await r.json()).error, /confidentialité illisibles/);
  }
  setSetting('privacy_zones', JSON.stringify([HOME]));
});
