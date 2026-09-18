'use strict';
// Import de traces réelles (GPX, FIT Suunto…) : la trace remplace le routage —
// le reste du pipeline (ré-échantillonnage, lissage, détection des côtes,
// analyse km par km, checks) est identique à une étape générée.

const { getDb } = require('../backend/db');
const { resamplePolyline, movingAverageByDistance } = require('./geo');
const { sampleElevations, fillNearestValid, plausibleEle } = require('./elevation');
const { detectClimbs, nameClimbs, detectBacktrackZones } = require('./climbs');
const { analyzeByKm } = require('./kmanalysis');
const { runChecks } = require('./checks');
const { reverseGeocode } = require('./geocode');
const { isOffline } = require('./http');
const { computeRideStats } = require('./rideStats');

/** Parse un GPX (texte) → [{lat, lon, ele?, time?}] (trkpt, ou rtept à défaut). */
function parseGpx(text) {
  const points = [];
  const re = /<(trkpt|rtept)\b[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*>([\s\S]*?)<\/\1>|<(trkpt|rtept)\b[^>]*\blat="(-?[\d.]+)"[^>]*\blon="(-?[\d.]+)"[^>]*\/>/g;
  let m;
  while ((m = re.exec(text))) {
    const lat = parseFloat(m[2] ?? m[6]);
    const lon = parseFloat(m[3] ?? m[7]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let ele = null;
    let time = null;
    if (m[4]) {
      const em = m[4].match(/<ele>\s*(-?[\d.]+)\s*<\/ele>/);
      if (em) ele = parseFloat(em[1]);
      // <time> (trkpt, format ISO 8601 UTC standard GPX) : absent d'un
      // rtept ou d'un export minimal — jamais supposé présent (voir
      // computeRideStats() dans pipeline/rideStats.js, qui tolère son
      // absence sur tout ou partie des points, plutôt que de planter
      // l'import entier).
      const tm = m[4].match(/<time>\s*([^<\s][^<]*?)\s*<\/time>/);
      if (tm) {
        const d = new Date(tm[1]);
        if (!Number.isNaN(d.getTime())) time = d;
      }
    }
    points.push({ lat, lon, ele, time });
  }
  const nameM = text.match(/<name>([\s\S]*?)<\/name>/);
  return { points, name: nameM ? nameM[1].trim().slice(0, 120) : null };
}

/** Points FIT (fit-file-parser) → [{lat, lon, ele?, time?}]. */
function pointsFromFitRecords(records) {
  const points = [];
  for (const r of records || []) {
    const lat = r.position_lat;
    const lon = r.position_long;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const ele = typeof r.enhanced_altitude === 'number' ? r.enhanced_altitude
      : typeof r.altitude === 'number' ? r.altitude : null;
    // fit-file-parser rend `timestamp` comme un objet Date déjà résolu
    // (epoch FIT 1989-12-31 déjà reconverti vers l'epoch Unix) — jamais une
    // chaîne à reparser, contrairement au <time> du GPX ci-dessus.
    const time = r.timestamp instanceof Date && !Number.isNaN(r.timestamp.getTime()) ? r.timestamp : null;
    points.push({ lat, lon, ele, time });
  }
  return points;
}

/**
 * Parse un fichier FIT (Buffer) → [{lat, lon, ele?}]. Partagé entre l'import
 * direct (POST /api/import/fit) et le connecteur Suunto (backend/suunto.js,
 * qui télécharge le FIT depuis cloudapi.suunto.com) — même logique
 * d'instanciation de FitParser dans les deux cas, pour ne pas la dupliquer.
 */
async function parseFit(buffer) {
  const FitParser = require('fit-file-parser').default || require('fit-file-parser');
  const parser = new FitParser({ force: true, elapsedRecordField: true, mode: 'list' });
  const data = await new Promise((resolve, reject) =>
    parser.parse(buffer, (err, d) => (err ? reject(new Error(String(err))) : resolve(d)))
  );
  return pointsFromFitRecords(data.records);
}

/**
 * Crée une étape depuis une trace et exécute le pipeline aval.
 * @param points [{lat, lon, ele?, time?}] bruts (≥ 2)
 * @param meta { name, source, date?, stage_type?, status? }
 * @returns stageId
 */
async function importTrackAsStage(points, meta = {}) {
  if (!points || points.length < 2) throw new Error('Trace vide ou illisible (aucun point)');
  const db = getDb();

  // meta.date (rare, fourni explicitement par un appelant) prévaut toujours
  // sur celle déduite des points — computeRideStats() ne sert que de repli
  // quand la trace elle-même porte des timestamps exploitables. Sur les
  // points bruts, pas le ré-échantillonnage à pas constant plus bas
  // (`resampled`) : ce dernier sert le profil altimétrique et n'a pas de
  // raison de porter le temps, or interpoler un horodatage entre deux points
  // recomposerait un rythme qui n'a jamais existé.
  const rideStats = computeRideStats(points);

  const r = db
    .prepare(
      `INSERT INTO stages (name, date, stage_type, status, state, source, elapsed_time_s, avg_speed_kmh, max_speed_kmh)
       VALUES (?, ?, ?, ?, 'generating', ?, ?, ?, ?)`
    )
    .run(
      meta.name || 'Trace importée',
      meta.date || (rideStats ? rideStats.date : null),
      meta.stage_type || 'trace',
      meta.status || 'importée',
      JSON.stringify({ trace: meta.source || 'import', points_bruts: points.length }),
      rideStats ? rideStats.elapsedTimeS : null,
      rideStats ? Math.round(rideStats.avgSpeedKmh * 10) / 10 : null,
      rideStats ? Math.round(rideStats.maxSpeedKmh * 10) / 10 : null
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
      // comble les trous d'altitude par le voisin le plus proche (fonction
      // partagée avec pipeline/elevation.js — même idiome que
      // fillInvalidElevations, pipeline/climbs.js). plausibleEle() d'abord :
      // un capteur GPS/FIT peut écrire un sentinel « pas de fix » hors de
      // toute plage physique (ex. -32768) directement dans le fichier
      // importé — même classe de bug que le sentinel -99999 du Géoplateforme
      // (relecture adverse, 26/08/2026), mais côté import de trace plutôt
      // que côté API : sans ce filtre, une seule valeur aberrante dans un
      // GPX/FIT réinterpolait un D+ fantôme de plusieurs milliers de mètres
      // sur les points voisins.
      const eles = fillNearestValid(points.map((p) => plausibleEle(p.ele)));
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
    // Le repli réseau ci-dessus (sampleElevations) peut renvoyer `null` sur
    // un trou de couverture altimétrique (pipeline/elevation.js) — comblé
    // par le voisin valide le plus proche avant le lissage pour la même
    // raison que buildProfile() : movingAverageByDistance additionne `.ele`
    // directement, un `null` non comblé y serait coercé en 0 (trouvaille de
    // relecture adverse sur ce même correctif, ce fichier n'avait pas reçu
    // le traitement appliqué à pipeline/elevation.js). eleRaw, lui, garde le
    // vrai trou (détectable par pipeline/checks.js).
    const filledEles = fillNearestValid(samples.map((s) => s.ele));
    const smooth = movingAverageByDistance(samples.map((s, i) => ({ dist: s.dist, ele: filledEles[i] })), 1500);
    const full = samples.map((s, i) => ({
      idx: i, dist: s.dist, lat: s.lat, lon: s.lon,
      eleRaw: Number.isFinite(s.ele) ? Math.round(s.ele * 10) / 10 : null,
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
    // detectBacktrackZones() a besoin de lat/lon (contrairement à
    // detectClimbs/analyzeByKm ci-dessus) : `full` les porte déjà, même
    // branchement que generate.js (trouvaille de relecture adverse, ce
    // fichier avait été oublié lors de l'ajout du check).
    const backtrackZones = detectBacktrackZones(full);

    // Ville/région/pays de départ (bilan personnel, backlog #228,
    // « Exploration ») : un seul géocodage inverse sur le premier point de
    // la trace, jamais bloquant — un import réussit même si ce géocodage
    // échoue (panne réseau transitoire), mêmes principes que nameClimbs()
    // ci-dessus, qui tolère déjà l'échec de reverseGeocodeFn par côte.
    let locationHints = { city: null, region: null, country: null };
    try {
      const r = await reverseGeocode(full[0].lat, full[0].lon);
      // Un label de repli « coordonnées brutes » (jamais une vraie ville)
      // prend deux formes selon le chemin qui l'a produit : reverseGeocode()
      // en mode réseau (`(lat, lon)`, provider 'aucun') ou
      // simReverseGeocode() en mode hors-ligne (`Lieu (lat, lon)`, provider
      // 'simulateur' — LE MÊME provider que pour un vrai lieu du gazetier
      // trouvé, donc `provider` seul ne suffit pas à distinguer les deux).
      // Trouvaille de relecture adverse (18/09/2026) : une première version
      // de ce garde ne testait que `provider !== 'aucun'`, couvrant le
      // repli réseau mais pas le repli hors-ligne (pourtant un chemin de
      // production réel et documenté, README.md — pas qu'un artefact de
      // test) — reproduit en direct (ETAPEFORGE_OFFLINE=1, point hors du
      // corridor du gazetier simulé) : city_hint stockait littéralement
      // "Lieu (0.000, 0.000)".
      const isCoordinateLabel = /^(Lieu )?\(-?\d+\.\d+, -?\d+\.\d+\)$/.test(r.label || '');
      if (r.provider !== 'aucun' && !isCoordinateLabel) {
        locationHints = { city: r.label || null, region: r.department || null, country: r.country || null };
      }
    } catch {
      // dégradation silencieuse : les tuiles/compteurs d'exploration
      // ignoreront simplement cette trace, jamais de fausse localisation.
    }

    const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
    const checks = runChecks({
      stage, distanceM: totalM, waypointsOnTrack: [], approxSegments: [], climbs, samples: full, backtrackZones,
    });

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
           start_ele_m, summit_ele_m, avg_gradient, max_gradient, irregularity_index, km_blocks, name_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of climbs) {
        insClimb.run(stageId, c.name, c.category, c.score,
          Math.round((c.startM / 1000) * 100) / 100, Math.round((c.endM / 1000) * 100) / 100,
          c.lengthKm, c.startEle, c.summitEle, c.avgGradient, c.maxGradient, c.irregularityIndex,
          JSON.stringify(c.kmBlocks), c.nameSource);
      }
      const insKm = db.prepare(
        `INSERT INTO km_analysis (stage_id, km, ele_start_m, ele_end_m, avg_gradient, max_gradient_100m, ascent_m, cum_ascent_m)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of kmRows) insKm.run(stageId, row.km, row.eleStart, row.eleEnd, row.avgGradient, row.maxGradient100, row.ascent, row.cumAscent);
      db.prepare(
        `UPDATE stages SET state = 'done', generated_distance_km = ?, total_ascent_m = ?, checks = ?,
           city_hint = ?, region_hint = ?, country_hint = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(Math.round((totalM / 1000) * 10) / 10, Math.round(ascent), JSON.stringify({ ...checks, offline: isOffline(), imported: true }),
        locationHints.city, locationHints.region, locationHints.country, stageId);
    })();

    return stageId;
  } catch (err) {
    db.prepare(`UPDATE stages SET state = 'error', error = ? WHERE id = ?`).run(String(err.message || err), stageId);
    throw err;
  }
}

module.exports = { parseGpx, pointsFromFitRecords, parseFit, importTrackAsStage };
