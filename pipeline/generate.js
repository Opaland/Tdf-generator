'use strict';
// Orchestrateur du pipeline de génération — identique pour une étape créée dans
// l'éditeur ou une étape historique importée :
// 1. géocodage des waypoints  2. routage  3. altimétrie  4. détection des côtes
// 5. analyse km par km  6. audits qualité — le tout persisté en SQLite.

const { getDb } = require('../backend/db');
const { geocode, geocodeCol, reverseGeocode, isColQuery } = require('./geocode');
const { routeStage } = require('./routing');
const { buildProfile } = require('./elevation');
const { detectClimbs, nameClimbs } = require('./climbs');
const { detectDescents, nameDescents, reconcileDescentSummits } = require('./descents');
const { analyzeByKm, detectFauxPlats } = require('./kmanalysis');
const { runChecks } = require('./checks');
const { isOffline } = require('./http');
const { stageConfidence } = require('./wikipedia');
const { consecutiveMountainDays, painIndex } = require('./pain');

/**
 * Options de géocodage pour un waypoint : `near` (biais de proximité, point
 * précédent), `countryHint` seulement si `wp.country_hint` (colonne DB,
 * indice de pays hors France extrait d'une annotation Wikipédia entre
 * parenthèses côté import — pipeline/wikipedia.js) est renseigné, et
 * `regionHint` de la même façon depuis `wp.region_hint` (colonne DB, nom de
 * département français extrait d'un qualificatif Wikipédia « Ville,
 * Département » — voir extractDepartment(), pipeline/wikipedia.js).
 *
 * `countryHint` n'est ajouté à `opts` QUE quand il est vrai (jamais posé à
 * `null` explicitement) : geocode() (pipeline/geocode.js) déstructure
 * `{ countryHint = 'fr' }` — cette valeur par défaut ne s'applique qu'à
 * `undefined`, jamais à `null`. Passer `country_hint: null` (le cas de
 * loin le plus fréquent, toute étape sans indice de pays) ferait donc
 * sauter la Géoplateforme pour aller direct à Nominatim sur CHAQUE
 * étape existante — régression massive, trouvaille en écrivant ce
 * correctif, jamais rencontrée en pratique puisque aucun appelant ne le
 * faisait avant l'ajout de ce champ. `regionHint` n'a pas cette régression
 * possible (sa valeur par défaut dans geocode() est déjà `null`), mais le
 * même garde-fou (n'ajouter la clé que si vraie) reste appliqué par
 * cohérence.
 */
function geocodeOptsFor(wp, prevPos) {
  const opts = { near: prevPos };
  if (wp.country_hint) opts.countryHint = wp.country_hint;
  if (wp.region_hint) opts.regionHint = wp.region_hint;
  return opts;
}

function setProgress(stageId, progress) {
  const db = getDb();
  db.prepare(`UPDATE stages SET progress = ?, updated_at = datetime('now') WHERE id = ?`).run(
    JSON.stringify(progress),
    stageId
  );
}

/**
 * Génère (ou régénère) une étape complète.
 * @param stageId id dans la table stages (les waypoints doivent exister)
 * @param onProgress callback optionnel {step, detail, percent}
 * @returns l'étape complète (voir loadStageFull)
 */
async function generateStage(stageId, { onProgress } = {}) {
  const db = getDb();
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
  if (!stage) throw new Error(`Étape ${stageId} introuvable`);
  const waypoints = db.prepare('SELECT * FROM waypoints WHERE stage_id = ? ORDER BY idx').all(stageId);
  if (waypoints.length < 2) throw new Error('Il faut au moins deux waypoints (départ et arrivée).');

  const progress = (p) => {
    setProgress(stageId, p);
    if (onProgress) onProgress(p);
  };

  db.prepare(`UPDATE stages SET state = 'generating', error = NULL WHERE id = ?`).run(stageId);

  try {
    // --- 1. Géocodage -----------------------------------------------------
    progress({ step: 'géocodage', detail: `${waypoints.length} waypoints`, percent: 0 });
    let prevPos = null; // biais de proximité : chaque waypoint est cherché près du précédent
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      let kind = wp.kind;
      if (kind === 'via' && isColQuery(wp.label)) kind = 'col';
      if (i === 0) kind = 'start';
      if (i === waypoints.length - 1 && kind !== 'col') kind = 'finish';
      if (wp.lat == null || wp.lon == null) {
        const opts = geocodeOptsFor(wp, prevPos);
        const res = kind === 'col' ? await geocodeCol(wp.label, opts) : await geocode(wp.label, opts);
        // Le géocodeur sait parfois qu'un lieu est un sommet (ex. « Hautacam ») :
        // on le traite alors comme un col, même en position d'arrivée.
        if (res.kind === 'peak' && kind !== 'start') kind = 'col';
        wp.lat = res.lat;
        wp.lon = res.lon;
        wp.geocode = JSON.stringify(res);
        if (kind === 'col' && wp.altitude_hint_m == null && res.ele != null) {
          wp.altitude_hint_m = res.ele;
        }
      }
      wp.kind = kind;
      if (wp.lat != null) prevPos = { lat: wp.lat, lon: wp.lon };
      db.prepare(
        `UPDATE waypoints SET lat=?, lon=?, kind=?, altitude_hint_m=?, geocode=? WHERE id=?`
      ).run(wp.lat, wp.lon, wp.kind, wp.altitude_hint_m, wp.geocode || null, wp.id);
      progress({
        step: 'géocodage',
        detail: `${wp.label}`,
        percent: Math.round(((i + 1) / waypoints.length) * 100),
      });
    }

    // --- 2. Routage -------------------------------------------------------
    progress({ step: 'routage', detail: 'calcul du tracé', percent: 0 });
    const routed = await routeStage(waypoints, { onProgress: progress });

    // --- 3. Altimétrie ----------------------------------------------------
    progress({ step: 'altimétrie', detail: 'échantillonnage du profil', percent: 0 });
    const profile = await buildProfile(routed.points, { onProgress: progress });

    // --- 4. Détection des côtes ------------------------------------------
    progress({ step: 'côtes', detail: 'détection et catégorisation', percent: 50 });
    const climbs = detectClimbs(profile.samples.map((s) => ({ dist: s.dist, eleRaw: s.eleRaw, eleSmooth: s.eleSmooth })));
    await nameClimbs(climbs, routed.waypointsOnTrack, profile.samples, reverseGeocode);

    // --- 4b. Détection des descentes (symétrique, backlog #10) -----------
    const descents = detectDescents(profile.samples.map((s) => ({ dist: s.dist, eleRaw: s.eleRaw, eleSmooth: s.eleSmooth })));
    await nameDescents(descents, climbs, routed.waypointsOnTrack, profile.samples, reverseGeocode);
    // Aligne l'altitude de sommet des descentes sur celle de la côte
    // correspondante — sans ça, le même col peut afficher deux altitudes
    // différentes selon la fiche (côte vs descente), trouvaille de
    // revue-personas. Voir pipeline/descents.js pour le détail.
    reconcileDescentSummits(descents, climbs);

    // --- 5. Analyse km par km --------------------------------------------
    progress({ step: 'analyse', detail: 'analyse km par km', percent: 80 });
    const kmRows = analyzeByKm(profile.samples.map((s) => ({ dist: s.dist, eleRaw: s.eleRaw, eleSmooth: s.eleSmooth })));

    // --- 6. Audits qualité ------------------------------------------------
    const checks = runChecks({
      stage,
      distanceM: routed.distanceM,
      waypointsOnTrack: routed.waypointsOnTrack,
      approxSegments: routed.approxSegments,
      climbs,
      samples: profile.samples,
      legs: routed.legs,
    });

    // --- Persistance ------------------------------------------------------
    const geojson = {
      type: 'Feature',
      properties: { name: stage.name, router: routed.router },
      geometry: { type: 'LineString', coordinates: routed.points.map((p) => [p.lon, p.lat]) },
    };
    const save = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO tracks (stage_id, geojson, distance_m, approx_segments, router)
         VALUES (?, ?, ?, ?, ?)`
      ).run(stageId, JSON.stringify(geojson), routed.distanceM, JSON.stringify(routed.approxSegments), routed.router);

      db.prepare('DELETE FROM elevation_samples WHERE stage_id = ?').run(stageId);
      const insSample = db.prepare(
        `INSERT INTO elevation_samples (stage_id, idx, dist_m, lat, lon, ele_raw_m, ele_smooth_m)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of profile.samples) {
        insSample.run(stageId, s.idx, s.dist, s.lat, s.lon, s.eleRaw, s.eleSmooth);
      }

      db.prepare('DELETE FROM climbs WHERE stage_id = ?').run(stageId);
      const insClimb = db.prepare(
        `INSERT INTO climbs (stage_id, name, category, score, start_km, end_km, length_km,
           start_ele_m, summit_ele_m, avg_gradient, max_gradient, irregularity_index, km_blocks, name_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of climbs) {
        insClimb.run(
          stageId, c.name, c.category, c.score,
          Math.round((c.startM / 1000) * 100) / 100, Math.round((c.endM / 1000) * 100) / 100,
          c.lengthKm, c.startEle, c.summitEle, c.avgGradient, c.maxGradient, c.irregularityIndex,
          JSON.stringify(c.kmBlocks), c.nameSource
        );
      }

      db.prepare('DELETE FROM descents WHERE stage_id = ?').run(stageId);
      const insDescent = db.prepare(
        `INSERT INTO descents (stage_id, name, start_km, end_km, length_km,
           top_ele_m, bottom_ele_m, avg_gradient, max_gradient, irregularity_index, km_blocks, name_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const d of descents) {
        insDescent.run(
          stageId, d.name,
          Math.round((d.startM / 1000) * 100) / 100, Math.round((d.endM / 1000) * 100) / 100,
          d.lengthKm, d.topEle, d.bottomEle, d.avgGradient, d.maxGradient, d.irregularityIndex,
          JSON.stringify(d.kmBlocks), d.nameSource
        );
      }

      db.prepare('DELETE FROM km_analysis WHERE stage_id = ?').run(stageId);
      const insKm = db.prepare(
        `INSERT INTO km_analysis (stage_id, km, ele_start_m, ele_end_m, avg_gradient, max_gradient_100m, ascent_m, cum_ascent_m)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of kmRows) {
        insKm.run(stageId, r.km, r.eleStart, r.eleEnd, r.avgGradient, r.maxGradient100, r.ascent, r.cumAscent);
      }

      // Position des waypoints le long du tracé.
      const updWp = db.prepare('UPDATE waypoints SET approximated = ? WHERE id = ?');
      for (let i = 0; i < waypoints.length; i++) {
        const w = routed.waypointsOnTrack[i];
        if (w) updWp.run(w.approximated ? 1 : 0, waypoints[i].id);
      }

      db.prepare(
        `UPDATE stages SET state = 'done', generated_distance_km = ?, total_ascent_m = ?,
           checks = ?, progress = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        Math.round((routed.distanceM / 1000) * 10) / 10,
        profile.totalAscentM,
        JSON.stringify({ ...checks, offline: isOffline() }),
        JSON.stringify({ step: 'terminé', detail: '', percent: 100 }),
        stageId
      );
    });
    save();

    return loadStageFull(stageId);
  } catch (err) {
    db.prepare(`UPDATE stages SET state = 'error', error = ? WHERE id = ?`).run(String(err.message || err), stageId);
    throw err;
  }
}

/** Charge une étape complète (fiche) : métadonnées, waypoints, tracé, profil, côtes, km, checks. */
function loadStageFull(stageId) {
  const db = getDb();
  const stage = db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
  if (!stage) return null;
  const waypoints = db.prepare('SELECT * FROM waypoints WHERE stage_id = ? ORDER BY idx').all(stageId);
  const track = db.prepare('SELECT * FROM tracks WHERE stage_id = ?').get(stageId);
  const samples = db
    .prepare('SELECT idx, dist_m, lat, lon, ele_raw_m, ele_smooth_m FROM elevation_samples WHERE stage_id = ? ORDER BY idx')
    .all(stageId);
  const climbs = db.prepare('SELECT * FROM climbs WHERE stage_id = ? ORDER BY start_km').all(stageId);
  const descents = db.prepare('SELECT * FROM descents WHERE stage_id = ? ORDER BY start_km').all(stageId);
  const kmAnalysis = db.prepare('SELECT * FROM km_analysis WHERE stage_id = ? ORDER BY km').all(stageId);
  // Dérivé de kmAnalysis à la lecture, pas persisté : déterministe et bon marché
  // à recalculer, pas besoin d'une table dédiée ni de la resynchroniser (backlog
  // issue #10, section C, "faux-plats classés à part du plat").
  const fauxPlats = detectFauxPlats(kmAnalysis, samples);
  const edition = stage.edition_id
    ? db.prepare('SELECT * FROM editions WHERE id = ?').get(stage.edition_id)
    : null;
  // Réserves de confiance (backlog #10, section A/D) : rattachées à un couple
  // (année, numéro d'étape) dans historic_routes.json, pas à l'id de base — se
  // résout donc via l'édition importée, pas via une colonne dédiée sur `stages`.
  const confidence = edition && edition.year ? stageConfidence(edition.year, stage.stage_order, edition.category) : [];
  // Indice de pénibilité cumulée (backlog issue #10, section C) : dérivé à la
  // lecture comme fauxPlats ci-dessus, pas persisté (bon marché à recalculer,
  // dépend de l'état d'autres étapes de l'édition qui peut changer).
  const mountainStreak = stage.state === 'done'
    ? consecutiveMountainDays(db, stage.edition_id, stage.stage_order)
    : 0;
  const pain = painIndex({ totalAscentM: stage.total_ascent_m, climbs, mountainStreak });
  return {
    stage: {
      ...stage,
      checks: stage.checks ? JSON.parse(stage.checks) : null,
      progress: stage.progress ? JSON.parse(stage.progress) : null,
      source: stage.source ? JSON.parse(stage.source) : null,
    },
    edition,
    waypoints: waypoints.map((w) => ({
      ...w,
      geocode: w.geocode ? JSON.parse(w.geocode) : null,
      bonus_sec: w.bonus_sec ? JSON.parse(w.bonus_sec) : null,
    })),
    track: track
      ? { ...track, geojson: JSON.parse(track.geojson), approx_segments: track.approx_segments ? JSON.parse(track.approx_segments) : [] }
      : null,
    samples,
    climbs: climbs.map((c) => ({ ...c, km_blocks: c.km_blocks ? JSON.parse(c.km_blocks) : [] })),
    descents: descents.map((d) => ({ ...d, km_blocks: d.km_blocks ? JSON.parse(d.km_blocks) : [] })),
    kmAnalysis,
    fauxPlats,
    confidence,
    pain,
  };
}

module.exports = { generateStage, loadStageFull, setProgress, geocodeOptsFor };
