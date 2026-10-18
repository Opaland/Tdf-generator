'use strict';
// Fréquence cardiaque des traces importées (issue #228, phase 5, Epic 30) :
// pipeline/heartRate.js, lecture GPX/FIT, import de bout en bout, exports.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-hr-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { plausibleHr, hrSummary, hrAtSamples } = require('../pipeline/heartRate');
const { parseGpx, pointsFromFitRecords } = require('../pipeline/importTrack');

test('plausibleHr : 25–250 bpm, tout le reste null (jamais 0)', () => {
  assert.strictEqual(plausibleHr(140), 140);
  assert.strictEqual(plausibleHr('140'), 140);
  for (const bad of [0, 24, 251, 255, -1, NaN, Infinity, null, undefined, 'x', {}]) assert.strictEqual(plausibleHr(bad), null, String(bad));
});

test('hrSummary : moyenne/max sur les points valides ; null sous 50 % de couverture', () => {
  assert.deepStrictEqual(hrSummary([{ hr: 100 }, { hr: 150 }, { hr: null }]), { avgHrBpm: 125, maxHrBpm: 150, coverage: 2 / 3 });
  // Un 0 « ceinture absente » ne fait pas chuter la moyenne (règle 10).
  assert.strictEqual(hrSummary([{ hr: 100 }, { hr: 0 }, { hr: 120 }]).avgHrBpm, 110);
  const low = hrSummary([{ hr: 150 }, { hr: null }, { hr: null }]);
  assert.strictEqual(low.avgHrBpm, null);
  assert.strictEqual(low.maxHrBpm, null);
  assert.strictEqual(hrSummary([]).avgHrBpm, null);
});

test('hrAtSamples : point brut le plus proche, jamais interpolé ; tout null sous le seuil', () => {
  const points = [{ hr: 100 }, { hr: 200 }, { hr: null }, { hr: 120 }];
  const cum = [0, 100, 200, 300];
  const samples = [0, 40, 60, 100, 190, 260, 300].map((dist) => ({ dist }));
  assert.deepStrictEqual(hrAtSamples(points, cum, samples), [100, 100, 200, 200, null, 120, 120]);
  assert.deepStrictEqual(hrAtSamples([{ hr: 100 }, { hr: null }, { hr: null }], [0, 1, 2], [{ dist: 0 }]), [null]);
});

test('parseGpx : FC lue dans l\'extension Garmin, quel que soit le préfixe ; absente = null', () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lat="45" lon="5"><ele>200</ele><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>131</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="45.001" lon="5"><extensions><ns3:TrackPointExtension><ns3:hr>140</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
    <trkpt lat="45.002" lon="5"><extensions><hr>0</hr></extensions></trkpt>
    <trkpt lat="45.003" lon="5"><ele>210</ele></trkpt>
    <trkpt lat="45.004" lon="5"/>
  </trkseg></trk></gpx>`;
  assert.deepStrictEqual(parseGpx(gpx).points.map((p) => p.hr), [131, 140, null, null, null]);
});

test('pointsFromFitRecords : heart_rate lu, implausible → null', () => {
  const pts = pointsFromFitRecords([
    { position_lat: 45, position_long: 5, heart_rate: 150 },
    { position_lat: 45.001, position_long: 5, heart_rate: 255 },
    { position_lat: 45.002, position_long: 5 },
  ]);
  assert.deepStrictEqual(pts.map((p) => p.hr), [150, null, null]);
});

let appServer;
let base;
before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

function gpxWithHr(hrAt) {
  let pts = '';
  for (let i = 0; i <= 40; i++) {
    const hr = hrAt(i);
    const ext = hr == null ? '' : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
    pts += `<trkpt lat="${(45.3 + i * 0.001).toFixed(4)}" lon="5.7"><ele>${300 + i}</ele><time>${new Date(Date.UTC(2026, 5, 1, 8, 0, i * 20)).toISOString()}</time>${ext}</trkpt>`;
  }
  return `<gpx><trk><name>FC</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

async function importGpx(text) {
  const r = await fetch(`${base}/api/import/gpx`, { method: 'POST', body: text });
  assert.strictEqual(r.status, 200);
  return (await r.json()).id;
}

test('import GPX avec FC : moyenne/max sur la fiche, FC par échantillon ; exports partageables sans FC', async () => {
  const id = await importGpx(gpxWithHr((i) => 120 + i)); // 120 → 160
  const full = await (await fetch(`${base}/api/stages/${id}`)).json();
  assert.strictEqual(full.stage.avg_hr_bpm, 140);
  assert.strictEqual(full.stage.max_hr_bpm, 160);
  const hrs = full.samples.map((s) => s.hr_bpm);
  assert.ok(hrs.every((v) => Number.isInteger(v) && v >= 120 && v <= 160), JSON.stringify(hrs.slice(0, 5)));
  assert.strictEqual(hrs[0], 120);
  assert.strictEqual(hrs[hrs.length - 1], 160);

  // Export brut de ses propres données : FC présente.
  const json = await (await fetch(`${base}/api/stages/${id}/export.json`)).json();
  assert.strictEqual(json.stage.max_hr_bpm, 160);
  // Formats faits pour être partagés : aucune trace de la FC.
  for (const fmt of ['export.gpx', 'export.tcx', 'export.kml', 'export.html', 'roadbook.html']) {
    const body = await (await fetch(`${base}/api/stages/${id}/${fmt}`)).text();
    assert.ok(!/hr_bpm|HeartRate|<[\w:]*hr>|"hr"|elapsed_s/i.test(body), `${fmt} ne doit pas contenir de FC ni de temps par échantillon`);
  }
});

test('import GPX sans FC ou FC trop partielle : tout null, jamais 0', async () => {
  for (const hrAt of [() => null, (i) => (i < 10 ? 150 : null)]) {
    const id = await importGpx(gpxWithHr(hrAt));
    const full = await (await fetch(`${base}/api/stages/${id}`)).json();
    assert.strictEqual(full.stage.avg_hr_bpm, null);
    assert.strictEqual(full.stage.max_hr_bpm, null);
    assert.ok(full.samples.every((s) => s.hr_bpm === null));
  }
});

test('parseGpx : FC cherchée dans <extensions> seulement, première valeur plausible', () => {
  const pt = (inner) => `<gpx><trk><trkseg><trkpt lat="45" lon="5">${inner}</trkpt><trkpt lat="45.001" lon="5"/></trkseg></trk></gpx>`;
  assert.strictEqual(parseGpx(pt('<desc><hr>200</hr></desc>')).points[0].hr, null);
  assert.strictEqual(parseGpx(pt('<extensions><gpxtpx:hr>0</gpxtpx:hr><x:hr>150</x:hr></extensions>')).points[0].hr, 150);
  assert.strictEqual(parseGpx(pt('<extensions><a.b:hr>141</a.b:hr></extensions>')).points[0].hr, 141);
});

test('fullWithoutHr / stageWithoutHr : plus aucune trace de FC, le reste intact', () => {
  const { fullWithoutHr, stageWithoutHr } = require('../pipeline/heartRate');
  const full = { stage: { id: 1, name: 'x', avg_hr_bpm: 140, max_hr_bpm: 170 }, samples: [{ dist_m: 0, hr_bpm: 120, ele_raw_m: 3 }], climbs: [] };
  const out = fullWithoutHr(full);
  assert.ok(!/hr_bpm/.test(JSON.stringify(out)));
  assert.deepStrictEqual(out.samples, [{ dist_m: 0, ele_raw_m: 3 }]);
  assert.strictEqual(out.stage.name, 'x');
  assert.strictEqual(full.stage.avg_hr_bpm, 140, 'original non modifié');
  assert.deepStrictEqual(stageWithoutHr({ a: 1, avg_hr_bpm: 1 }), { a: 1 });
});
