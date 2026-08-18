'use strict';
// Import de traces réelles (GPX, FIT Suunto…) : la trace remplace le routage —
// le reste du pipeline (ré-échantillonnage, lissage, détection des côtes,
// analyse km par km, checks) est identique à une étape générée.

const { getDb } = require('../backend/db');
const { resamplePolyline, movingAverageByDistance } = require('./geo');
const { sampleElevations } = require('./elevation');
const { detectClimbs, nameClimbs } = require('./climbs');
const { analyzeByKm } = require('./kmanalysis');
const { runChecks } = require('./checks');
const { reverseGeocode } = require('./geocode');
const { isOffline } = require('./http');

/** Parse un GPX (texte) → [{lat, lon, ele?}] (trkpt, ou rtept à défaut). */
function parseGpx(text) {
  const points = [];
  const re = /<(trkpt|rtept)\b[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*>([\s\S]*?)<\/\1>|<(trkpt|rtept)\b[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(text))) {
    const lat = parseFloat(m[2] ?? m[6]);
    const lon = parseFloat(m[3] ?? m[7]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let ele = null;
    if (m[4]) {
      const em = m[4].match(/<ele>\s*(-?[\d.]+)\s*<\/ele>/);
      if (em) ele = parseFloat(em[1]);
    }
    points.push({ lat, lon, ele });
  }
  const nameM = text.match(/<name>([\s\S]*?)<\/name>/);
  return { points, name: nameM ? nameM[1].trim().slice(0, 120) : null };
}

/** Points FIT (fit-file-parser) → [{lat, lon, ele?}]. */
function pointsFromFitRecords(records) {
  const points = [];
  for (const r of records || []) {
    const lat = r.position_lat;
    const lon = r.position_long;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const ele = typeof r.enhanced_altitude === 'number' ? r.enhanced_altitude
      : typeof r.altitude === 'number' ? r.altitude : null;
    points.push({ lat, lon, ele });
  }
  return points;
}

/**
 * Crée une étape depuis une trace et exécute le pipeline aval.
 * @param points [{lat, lon, ele?}] bruts (≥ 2)
 * @param meta { name, source, date?, stage_type?, status? }
 * @returns stageId
 */
async function importTrackAsStage(points, meta = {}) {
  if (!points || points.length < 2) throw new Error('Trace vide ou illisible (aucun point)');
  const db = getDb();

  const r = db
    .prepare(
      `INSERT INTO stages (name, date, stage_type, status, state, source)
       VALUES (?, ?, ?, ?, 'generating', ?)`
    )
    .run(
      meta.name || 'Trace importée',
      meta.date || null,
      meta.stage_type || 'trace',
      meta.status || 'importée',
      JSON.stringify({ trace: meta.source || 'import', points_bruts: points.length })
    );
  const stageId = r.lastInsertRowid;

  try {
    // Ré-échantillonnage à pas constant (même règle que le pipeline standard).
    const rough = resamplePolyline(points, 100);
    const totalM = rough.length ? rough[rough.length - 1].dist : 0;
    const stepM = totalM < 60000 ? 100 : 250;
    const resampled = stepM === 100 ? rough : resamplePolyline(points, stepM);

    // Altitudes : celles de la trace si suffisamment présentes (interpolation
    // par ré-échantillonnage), sinon échantillonnage par les fournisseurs.
    const withEle = points.filter((p) => p.ele != null).length;
    let raw;
    if (withEle >= points.length * 0.8) {
      // Ré-interpolation des altitudes de la trace par abscisse curviligne.
      const { cumulativeDistances } = require('./geo');
      const { cum } = cumulativeDistances(points);
      const eles = points.map((p) => p.ele);
      // comble les trous d'altitude par le voisin le plus proche
      for (let i = 0; i < eles.length; i++) {
        if (eles[i] == null) {
          let a = i; let b = i;
          while (a > 0 && eles[a] == null) a--;
          while (b < eles.length - 1 && eles[b] == null) b++;
          eles[i] = eles[a] ?? eles[b] ?? 0;
        }
      }
      let si = 0;
      raw = resampled.map((q) => {
        while (si < points.length - 2 && cum[si + 1] < q.dist) si++;
        const d0 = cum[si];
        const d1 = cum[si + 1];
        const t = d1 > d0 ? Math.max(0, Math.min(1, (q.dist - d0) / (d1 - d0))) : 0;
        return eles[si] + t * (eles[si + 1] - eles[si]);
      });
    } else {
      raw = await sampleElevations(resampled);
    }

    const samples = resampled.map((p, i) => ({ idx: i, dist: p.dist, lat: p.lat, lon: p.lon, ele: raw[i] }));
    const smooth = movingAverageByDistance(samples, 1500);
    const full = samples.map((s, i) => ({
      idx: i, dist: s.dist, lat: s.lat, lon: s.lon,
      eleRaw: Math.round(s.ele * 10) / 10,
      eleSmooth: Math.round(smooth[i] * 10) / 10,
    }));

    let ascent = 0;
    for (let i = 1; i < full.length; i++) {
      const d = full[i].eleSmooth - full[i - 1].eleSmooth;
      if (d > 0) ascent += d;
    }

    const climbs = detectClimbs(full.map((s) => ({ dist: s.dist, eleRaw: s.eleRaw, eleSmooth: s.eleSmooth })));
    await nameClimbs(climbs, [], full, reverseGeocode);
    const kmRows = analyzeByKm(full.map((s) => ({ dist: s.dist, eleRaw: s.eleRaw, eleSmooth: s.eleSmooth })));
    const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
    const checks = runChecks({ stage, distanceM: totalM, waypointsOnTrack: [], approxSegments: [], climbs, samples: full });

    const geojson = {
      type: 'Feature',
      properties: { name: stage.name, router: 'trace importée' },
      geometry: { type: 'LineString', coordinates: resampled.map((p) => [p.lon, p.lat]) },
    };

    db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO tracks (stage_id, geojson, distance_m, approx_segments, router) VALUES (?, ?, ?, '[]', 'trace')`)
        .run(stageId, JSON.stringify(geojson), totalM);
      const insSample = db.prepare(
        `INSERT INTO elevation_samples (stage_id, idx, dist_m, lat, lon, ele_raw_m, ele_smooth_m) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of full) insSample.run(stageId, s.idx, s.dist, s.lat, s.lon, s.eleRaw, s.eleSmooth);
      const insClimb = db.prepare(
        `INSERT INTO climbs (stage_id, name, category, score, start_km, end_km, length_km,
           start_ele_m, summit_ele_m, avg_gradient, max_gradient, km_blocks, name_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of climbs) {
        insClimb.run(stageId, c.name, c.category, c.score,
          Math.round((c.startM / 1000) * 100) / 100, Math.round((c.endM / 1000) * 100) / 100,
          c.lengthKm, c.startEle, c.summitEle, c.avgGradient, c.maxGradient,
          JSON.stringify(c.kmBlocks), c.nameSource);
      }
      const insKm = db.prepare(
        `INSERT INTO km_analysis (stage_id, km, ele_start_m, ele_end_m, avg_gradient, max_gradient_100m, ascent_m, cum_ascent_m)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of kmRows) insKm.run(stageId, row.km, row.eleStart, row.eleEnd, row.avgGradient, row.maxGradient100, row.ascent, row.cumAscent);
      db.prepare(
        `UPDATE stages SET state = 'done', generated_distance_km = ?, total_ascent_m = ?, checks = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(Math.round((totalM / 1000) * 10) / 10, Math.round(ascent), JSON.stringify({ ...checks, offline: isOffline(), imported: true }), stageId);
    })();

    return stageId;
  } catch (err) {
    db.prepare(`UPDATE stages SET state = 'error', error = ? WHERE id = ?`).run(String(err.message || err), stageId);
    throw err;
  }
}

module.exports = { parseGpx, pointsFromFitRecords, importTrackAsStage };
