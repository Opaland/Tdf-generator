'use strict';
// Exports : GPX du tracé, JSON complet, page HTML autonome par tour (mini-site).

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { loadStageFull } = require('../pipeline/generate');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** GPX 1.1 du tracé (points d'altimétrie : lat/lon/ele brute). */
function stageToGpx(full) {
  const { stage, samples, waypoints, climbs } = full;
  // Sommets des côtes détectées inclus comme waypoints nommés (catégorie + pente).
  const climbWpts = (climbs || [])
    .map((c) => {
      let best = samples[0];
      for (const s of samples) {
        if (Math.abs(s.dist_m - c.end_km * 1000) < Math.abs(best.dist_m - c.end_km * 1000)) best = s;
      }
      return best
        ? `  <wpt lat="${best.lat.toFixed(6)}" lon="${best.lon.toFixed(6)}">\n` +
          `    <ele>${c.summit_ele_m}</ele>\n` +
          `    <name>${esc(c.name)} (cat. ${esc(c.category)})</name>\n` +
          `    <desc>${c.length_km} km à ${c.avg_gradient} % (max ${c.max_gradient} %)</desc>\n` +
          `    <type>climb</type>\n  </wpt>`
        : '';
    })
    .filter(Boolean)
    .join('\n');
  const wpts = waypoints
    .filter((w) => w.lat != null)
    .map(
      (w) =>
        `  <wpt lat="${w.lat}" lon="${w.lon}">\n    <name>${esc(w.label)}</name>\n    <type>${esc(w.kind)}</type>\n  </wpt>`
    )
    .concat(climbWpts ? [climbWpts] : [])
    .join('\n');
  const pts = samples
    .map(
      (s) =>
        `      <trkpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><ele>${s.ele_raw_m ?? 0}</ele></trkpt>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ÉtapeForge" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(stage.name)}</name>
    <desc>Généré par ÉtapeForge — tracé © OpenStreetMap contributors (routage OSRM), altimétrie IGN/Géoplateforme &amp; opentopodata.</desc>
  </metadata>
${wpts}
  <trk>
    <name>${esc(stage.name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

// Décimation partagée avec le frontend (profile.js expose aussi module.exports).
const { decimate } = require('../frontend/profile');

/** Données allégées d'une étape pour la page HTML autonome et les popups carte. */
function stagePayload(full, { maxSamples = 600, maxTrack = 900 } = {}) {
  const { stage, waypoints, track, samples, climbs } = full;
  return {
    stage: {
      id: stage.id,
      name: stage.name,
      date: stage.date,
      stage_type: stage.stage_type,
      status: stage.status,
      stage_order: stage.stage_order,
      official_distance_km: stage.official_distance_km,
      generated_distance_km: stage.generated_distance_km,
      total_ascent_m: stage.total_ascent_m,
      state: stage.state,
      checks: stage.checks,
      source: stage.source,
      is_transfer: stage.is_transfer,
    },
    waypoints: waypoints.map((w) => ({
      label: w.label, kind: w.kind, lat: w.lat, lon: w.lon, approximated: !!w.approximated,
    })),
    track: track
      ? {
          coords: decimate(track.geojson.geometry.coordinates, maxTrack),
          distance_m: track.distance_m,
          router: track.router,
          approx_segments: track.approx_segments,
        }
      : null,
    profile: decimate(samples, maxSamples).map((s) => ({
      d: Math.round(s.dist_m), e: s.ele_smooth_m, r: s.ele_raw_m, lat: s.lat, lon: s.lon,
    })),
    climbs: climbs.map((c) => ({
      name: c.name, category: c.category, score: c.score,
      start_km: c.start_km, end_km: c.end_km, length_km: c.length_km,
      start_ele_m: c.start_ele_m, summit_ele_m: c.summit_ele_m,
      avg_gradient: c.avg_gradient, max_gradient: c.max_gradient,
      km_blocks: c.km_blocks,
    })),
  };
}

const ATTRIBUTIONS =
  'Données : © IGN/Géoplateforme (géocodage, altimétrie RGE ALTI, fonds PLANIGNV2) · ' +
  '© OpenStreetMap contributors · Routage OSRM (router.project-osrm.org) · ' +
  'Altimétrie hors France : opentopodata.org (EU-DEM) · ' +
  'Données historiques : Wikipédia (CC BY-SA), recoupées avec bikeraceinfo.com';

/** Page HTML autonome d'un tour : profils SVG inline + carte Leaflet (CDN) + données embarquées. */
function tourToStandaloneHtml(editionId) {
  const db = getDb();
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(editionId);
  if (!edition) throw new Error(`Édition ${editionId} introuvable`);
  const stageRows = db
    .prepare(`SELECT id FROM stages WHERE edition_id = ? ORDER BY stage_order, id`)
    .all(editionId);
  const payloads = stageRows.map((r) => stagePayload(loadStageFull(r.id)));

  const profileJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'profile.js'), 'utf8');
  const title = edition.name;
  const sourceInfo = edition.source ? JSON.parse(edition.source) : null;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ÉtapeForge</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
  :root { --sable:#ede3cc; --trait:#8a6d3b; --jaune:#ffd320; }
  body { font-family: system-ui, sans-serif; margin: 0; background:#faf7f0; color:#222; }
  header { background:#111; color:var(--jaune); padding:14px 20px; }
  header h1 { margin:0; font-size:1.3em; }
  main { max-width: 1080px; margin: 0 auto; padding: 16px; }
  .stagecard { background:#fff; border:1px solid #ddd; border-radius:8px; margin:18px 0; padding:14px; }
  .stagecard h2 { margin:2px 0 8px; font-size:1.05em; }
  .meta { color:#666; font-size:0.85em; margin-bottom:8px; }
  #map { height: 440px; border-radius:8px; border:1px solid #ccc; }
  footer { font-size: 0.75em; color:#666; padding: 18px; text-align:center; }
  svg { max-width: 100%; height: auto; }
  .note { background:#fdf6dd; border:1px solid #e8d48a; border-radius:6px; padding:8px 12px; font-size:0.85em; }
</style>
</head>
<body>
<header><h1>${esc(title)} — mini-site généré par ÉtapeForge</h1></header>
<main>
  ${sourceInfo && sourceInfo.notes ? `<p class="note">${esc(sourceInfo.notes)}</p>` : ''}
  <div id="map"></div>
  <div id="stages"></div>
</main>
<footer>${esc(ATTRIBUTIONS)}</footer>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>${profileJs}</script>
<script>
const TOUR = ${JSON.stringify({ edition: { id: edition.id, name: edition.name, year: edition.year }, stages: payloads })};
const TYPE_COLORS = { plaine:'#2e8b57', 'accidentée':'#e67e22', montagne:'#c0392b', clm:'#2980b9', 'clm par équipes':'#8e44ad' };
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
document.addEventListener('DOMContentLoaded', () => {
  const map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
  const bounds = [];
  let prevEnd = null;
  for (const st of TOUR.stages) {
    if (!st.track) continue;
    const latlngs = st.track.coords.map(c => [c[1], c[0]]);
    latlngs.forEach(ll => bounds.push(ll));
    if (prevEnd) L.polyline([prevEnd, latlngs[0]], { color:'#888', dashArray:'6 8', weight:2 }).addTo(map);
    const color = TYPE_COLORS[st.stage.stage_type] || '#c0392b';
    L.polyline(latlngs, { color, weight: 3.5 }).addTo(map)
      .bindPopup('<b>' + escHtml(st.stage.name) + '</b><br>' + (st.stage.generated_distance_km || '?') + ' km — D+ ' + (st.stage.total_ascent_m || '?') + ' m');
    prevEnd = latlngs[latlngs.length - 1];
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });

  const cont = document.getElementById('stages');
  for (const st of TOUR.stages) {
    const card = document.createElement('div');
    card.className = 'stagecard';
    const delta = st.stage.official_distance_km && st.stage.generated_distance_km
      ? ((st.stage.generated_distance_km - st.stage.official_distance_km) / st.stage.official_distance_km * 100)
      : null;
    card.innerHTML = '<h2>' + escHtml(st.stage.name) + '</h2>' +
      '<div class="meta">' + [escHtml(st.stage.date), escHtml(st.stage.stage_type),
        (st.stage.generated_distance_km || '?') + ' km', 'D+ ' + (st.stage.total_ascent_m || '?') + ' m',
        delta != null ? 'tracé reconstitué sur le réseau routier actuel — distance officielle : ' + st.stage.official_distance_km + ' km / reconstitution : ' + st.stage.generated_distance_km + ' km (écart ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' %)' : null
      ].filter(Boolean).join(' · ') + '</div>' +
      (st.profile.length ? EFProfile.renderProfileSVG(st, { width: 1000, height: 260 }) : '<em>non générée</em>');
    cont.appendChild(card);
  }
});
</script>
</body>
</html>`;
}

module.exports = { stageToGpx, stagePayload, tourToStandaloneHtml, decimate, ATTRIBUTIONS };
