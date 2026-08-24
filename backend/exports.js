'use strict';
// Exports : GPX du tracé, JSON complet, page HTML autonome par tour (mini-site).

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');
const { loadStageFull } = require('../pipeline/generate');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Vitesse conventionnelle utilisée partout où ÉtapeForge synthétise un temps
// (TCX, roadbook) faute de données de sortie réellement enregistrée — à ne
// jamais présenter comme un horaire réel (voir CLAUDE.md règle 9).
const AVG_SPEED_MPS = 25000 / 3600;

function formatElapsed(distM) {
  const totalMin = Math.round((distM / AVG_SPEED_MPS) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
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

// Catégorie de côte → PointType_t du schéma TCX (garmin-dev/tcx.xsd) : cette
// énumération porte directement les catégories ASO (4th/3rd/2nd/1st/Hors
// Category), pas besoin d'inventer un mapping.
const TCX_CLIMB_POINT_TYPE = {
  HC: 'Hors Category', 1: '1st Category', 2: '2nd Category', 3: '3rd Category', 4: '4th Category',
};

/** Tronque à `n` caractères — CoursePointName_t (10) et le nom de Course
 * (RestrictedToken_t, 15) sont strictement bornés par le schéma TCX ;
 * le libellé complet reste toujours disponible dans Notes (non borné). */
function tcxToken(s, n) {
  const str = String(s ?? '').trim();
  return str.length > n ? str.slice(0, n) : str;
}

/** TCX 2 (Course) du tracé — Trackpoint/CoursePoint exigent un `Time`
 * (xsd:dateTime) même pour un parcours planifié sans données de sortie
 * réelle ; synthétisé à une vitesse moyenne conventionnelle (25 km/h) à
 * partir de la date de l'étape (ou d'une date arbitraire si absente),
 * pour rester croissant et proportionnel à la distance plutôt qu'une
 * valeur figée qui casserait l'ordre attendu par certains lecteurs. */
function stageToTcx(full) {
  const { stage, samples, waypoints, climbs, track } = full;
  const baseTime = new Date(`${stage.date || '2024-01-01'}T08:00:00Z`).getTime();
  const timeAt = (distM) => new Date(baseTime + (distM / AVG_SPEED_MPS) * 1000).toISOString();

  const coursePoints = waypoints
    .filter((w) => w.lat != null)
    .map((w) => {
      const pointType = w.kind === 'col' ? 'Summit' : 'Generic';
      return `    <CoursePoint>\n` +
        `      <Name>${esc(tcxToken(w.label, 10))}</Name>\n` +
        `      <Time>${timeAt(0)}</Time>\n` +
        `      <Position><LatitudeDegrees>${w.lat}</LatitudeDegrees><LongitudeDegrees>${w.lon}</LongitudeDegrees></Position>\n` +
        `      <PointType>${pointType}</PointType>\n` +
        `      <Notes>${esc(w.label)}</Notes>\n` +
        `    </CoursePoint>`;
    })
    .concat(
      (climbs || []).map((c) => {
        let best = samples[0];
        for (const s of samples) {
          if (Math.abs(s.dist_m - c.end_km * 1000) < Math.abs(best.dist_m - c.end_km * 1000)) best = s;
        }
        if (!best) return '';
        const pointType = TCX_CLIMB_POINT_TYPE[c.category] || 'Summit';
        return `    <CoursePoint>\n` +
          `      <Name>${esc(tcxToken(c.name, 10))}</Name>\n` +
          `      <Time>${timeAt(best.dist_m)}</Time>\n` +
          `      <Position><LatitudeDegrees>${best.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${best.lon.toFixed(6)}</LongitudeDegrees></Position>\n` +
          `      <AltitudeMeters>${c.summit_ele_m}</AltitudeMeters>\n` +
          `      <PointType>${pointType}</PointType>\n` +
          `      <Notes>${esc(c.name)} — cat. ${esc(c.category)}, ${c.length_km} km à ${c.avg_gradient} % (max ${c.max_gradient} %)</Notes>\n` +
          `    </CoursePoint>`;
      })
    )
    .filter(Boolean)
    .join('\n');

  const trackpoints = samples
    .map(
      (s) =>
        `      <Trackpoint>\n` +
        `        <Time>${timeAt(s.dist_m)}</Time>\n` +
        `        <Position><LatitudeDegrees>${s.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${s.lon.toFixed(6)}</LongitudeDegrees></Position>\n` +
        `        <AltitudeMeters>${s.ele_raw_m ?? 0}</AltitudeMeters>\n` +
        `        <DistanceMeters>${s.dist_m.toFixed(1)}</DistanceMeters>\n` +
        `      </Trackpoint>`
    )
    .join('\n');

  const totalDistM = track ? track.distance_m : (samples[samples.length - 1]?.dist_m || 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Courses>
    <Course>
      <Name>${esc(tcxToken(stage.name, 15))}</Name>
      <Lap>
        <TotalTimeSeconds>${(totalDistM / AVG_SPEED_MPS).toFixed(0)}</TotalTimeSeconds>
        <DistanceMeters>${totalDistM.toFixed(1)}</DistanceMeters>
        <Intensity>Active</Intensity>
      </Lap>
      <Track>
${trackpoints}
      </Track>
${coursePoints}
      <Notes>${esc(stage.name)} — Généré par ÉtapeForge. Horaires synthétiques (vitesse moyenne conventionnelle 25 km/h), pas une sortie réellement enregistrée.</Notes>
    </Course>
  </Courses>
</TrainingCenterDatabase>`;
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
      bonus_sec: w.bonus_sec || null,
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

function nearestSampleDist(w, samples) {
  let best = null;
  let bd = Infinity;
  for (const s of samples) {
    const d2 = (s.lat - w.lat) ** 2 + (s.lon - w.lon) ** 2;
    if (d2 < bd) { bd = d2; best = s; }
  }
  return best;
}

/**
 * Feuille de route imprimable d'une étape (backlog issue #14, "roadbook
 * exportable") : villes/points de passage avec km et temps écoulé indicatif,
 * côtes avec catégorie/pente, en une page HTML autonome pensée pour
 * l'impression (Ctrl+P / imprimer en PDF) plutôt que pour le partage à
 * l'écran — format différent de stageToStandaloneHtml (PR #54), qui reste la
 * page interactive avec carte Leaflet. Aucune dépendance PDF ajoutée : la
 * mise en page `@media print` fait le travail, cohérent avec le choix du
 * projet de rester à 4 dépendances directes (docs/BRIEF.md).
 */
function stageToRoadbookHtml(stageId) {
  const full = loadStageFull(stageId);
  if (!full) throw new Error(`Étape ${stageId} introuvable`);
  const { stage, edition, waypoints, climbs, samples } = full;

  const points = waypoints
    .filter((w) => w.lat != null)
    .map((w) => {
      const s = nearestSampleDist(w, samples);
      return {
        distM: s ? s.dist_m : 0,
        ele: s ? Math.round(s.ele_smooth_m) : null,
        label: w.label,
        kind: w.kind,
        bonus_sec: w.bonus_sec || null,
      };
    })
    .sort((a, b) => a.distM - b.distM);

  const KIND_LABELS = { start: 'Départ', finish: 'Arrivée', col: 'Col', sprint: 'Sprint intermédiaire', via: 'Passage' };

  const rowsHtml = points
    .map((p) => {
      const bonusTxt = p.bonus_sec ? ` — bonif. ${p.bonus_sec.join('/')}″` : '';
      return `<tr><td>${(p.distM / 1000).toFixed(1)}</td><td>${formatElapsed(p.distM)}</td>` +
        `<td>${esc(KIND_LABELS[p.kind] || 'Passage')}</td>` +
        `<td>${esc(p.label)}${esc(bonusTxt)}</td>` +
        `<td>${p.ele != null ? `${p.ele} m` : '—'}</td></tr>`;
    })
    .join('\n');

  const climbsHtml = climbs.length
    ? climbs
        .map(
          (c) =>
            `<tr><td>${c.start_km} → ${c.end_km}</td><td>${esc(c.name)}</td><td>${esc(c.category)}</td>` +
            `<td>${c.length_km} km</td><td>${c.avg_gradient} %</td><td>${c.max_gradient} %</td><td>${c.summit_ele_m} m</td></tr>`
        )
        .join('\n')
    : '<tr><td colspan="7">Aucune côte détectée (seuil : ≥ 1,5 km à ≥ 3 %).</td></tr>';

  const dist = stage.generated_distance_km != null ? `${stage.generated_distance_km} km` : '?';
  const editionLine = edition ? `${esc(edition.name)} — ` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roadbook — ${esc(stage.name)}</title>
<style>
  @page { size: A4 portrait; margin: 1.5cm; }
  :root { --jaune:#ffd320; --trait:#8a6d3b; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; color: #111; }
  h1 { font-size: 1.4em; margin: 0 0 4px; }
  .meta { color: #444; font-size: 0.9em; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 0.9em; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: var(--jaune); }
  h2 { font-size: 1.1em; border-bottom: 2px solid var(--jaune); padding-bottom: 2px; }
  .note { font-size: 0.8em; color: #555; margin-top: 6px; }
  tr { break-inside: avoid; }
  .no-print { margin-bottom: 16px; }
  footer { font-size: 0.7em; color: #666; margin-top: 24px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">Imprimer / enregistrer en PDF</button>
<h1>${esc(stage.name)}</h1>
<p class="meta">${editionLine}${stage.date ? `${esc(stage.date)} · ` : ''}${dist}${stage.total_ascent_m != null ? ` · D+ ${stage.total_ascent_m} m` : ''}</p>

<h2>Villes et points de passage</h2>
<table>
<thead><tr><th>Km</th><th>Temps écoulé (indicatif)</th><th>Type</th><th>Lieu</th><th>Altitude</th></tr></thead>
<tbody>
${rowsHtml}
</tbody>
</table>
<p class="note">Temps écoulé calculé à une vitesse conventionnelle de 25 km/h depuis le départ — un repère indicatif, pas un horaire officiel.</p>

<h2>Côtes</h2>
<table>
<thead><tr><th>Km</th><th>Nom</th><th>Cat.</th><th>Longueur</th><th>Pente moy.</th><th>Pente max</th><th>Sommet</th></tr></thead>
<tbody>
${climbsHtml}
</tbody>
</table>

<p class="note">Ravitaillements : non représentés — ÉtapeForge ne dispose d'aucune source sur l'emplacement réel des zones de ravitaillement d'une étape reconstituée (donnée non publiée par ASO).</p>

<footer>${esc(ATTRIBUTIONS)} — Généré par ÉtapeForge.</footer>
</body>
</html>`;
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
const TOUR = ${JSON.stringify({ edition: { id: edition.id, name: edition.name, year: edition.year }, stages: payloads }).replace(/</g, '\\u003c')};
const TYPE_COLORS = { plaine:'#2e8b57', 'accidentée':'#e67e22', montagne:'#c0392b', clm:'#2980b9', 'clm par équipes':'#8e44ad' };
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
document.addEventListener('DOMContentLoaded', () => {
  // La carte dépend d'un CDN externe (unpkg.com) : si Leaflet ne charge pas
  // (réseau restreint, CDN indisponible), on ne veut pas perdre le profil et
  // les côtes en aval pour autant — try/catch pour isoler l'échec de la
  // carte du reste du rendu, plutôt que de laisser une exception non
  // interceptée ("L is not defined") interrompre tout le script.
  try {
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
  } catch (e) {
    document.getElementById('map').outerHTML = '<p class="note">Carte indisponible (Leaflet n\\'a pas pu charger depuis unpkg.com).</p>';
    console.warn('Carte non affichée :', e);
  }

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

/**
 * Page HTML autonome d'une seule étape (backlog issue #10, section D,
 * "partage d'une fiche d'étape individuelle") : jusqu'ici l'export HTML
 * autonome n'existait qu'au niveau d'un tour entier (tourToStandaloneHtml
 * ci-dessus). Même structure/même style visuel, même garde-fous — voir
 * CLAUDE.md règle 1 : une XSS stockée a déjà été trouvée puis corrigée deux
 * fois dans ce fichier (sink DOM `innerHTML`/`bindPopup` non échappé, puis
 * évasion de la balise `<script>` embarquant les données JSON via un
 * `</script>` dans une donnée utilisateur) — les deux mêmes protections
 * (escHtml sur chaque insertion innerHTML, `<` → `<` sur le JSON
 * embarqué) sont reprises ici à l'identique, pas réinventées.
 */
function stageToStandaloneHtml(stageId) {
  const full = loadStageFull(stageId);
  if (!full) throw new Error(`Étape ${stageId} introuvable`);
  const payload = stagePayload(full, { maxSamples: 900, maxTrack: 1200 });
  const profileJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'profile.js'), 'utf8');
  const title = full.stage.name;
  const edition = full.edition;

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
  .meta { color:#666; font-size:0.9em; margin-bottom:8px; }
  #map { height: 440px; border-radius:8px; border:1px solid #ccc; margin-bottom:18px; }
  footer { font-size: 0.75em; color:#666; padding: 18px; text-align:center; }
  svg { max-width: 100%; height: auto; }
  .note { background:#fdf6dd; border:1px solid #e8d48a; border-radius:6px; padding:8px 12px; font-size:0.85em; }
  .climb { border-top:1px dashed #ddd; padding-top:8px; margin-top:8px; font-size:0.9em; }
</style>
</head>
<body>
<header><h1>${esc(title)} — fiche générée par ÉtapeForge</h1></header>
<main>
  ${edition && edition.source ? (() => {
    const src = JSON.parse(edition.source);
    return src.notes ? `<p class="note">${esc(src.notes)}</p>` : '';
  })() : ''}
  <div id="map"></div>
  <div id="stagecard"></div>
</main>
<footer>${esc(ATTRIBUTIONS)}</footer>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>${profileJs}</script>
<script>
const STAGE = ${JSON.stringify(payload).replace(/</g, '\\u003c')};
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
document.addEventListener('DOMContentLoaded', () => {
  // Voir le try/catch équivalent dans tourToStandaloneHtml : ne pas laisser
  // un échec de chargement de Leaflet (CDN externe) empêcher le rendu du
  // profil/des côtes en aval.
  try {
    const map = L.map('map');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    if (STAGE.track) {
      const latlngs = STAGE.track.coords.map(c => [c[1], c[0]]);
      L.polyline(latlngs, { color: '#c0392b', weight: 4 }).addTo(map);
      map.fitBounds(latlngs, { padding: [24, 24] });
    } else {
      map.setView([46.6, 2.5], 5); // France entière, en dernier recours (étape non générée)
    }
  } catch (e) {
    document.getElementById('map').outerHTML = '<p class="note">Carte indisponible (Leaflet n\\'a pas pu charger depuis unpkg.com).</p>';
    console.warn('Carte non affichée :', e);
  }

  const delta = STAGE.stage.official_distance_km && STAGE.stage.generated_distance_km
    ? ((STAGE.stage.generated_distance_km - STAGE.stage.official_distance_km) / STAGE.stage.official_distance_km * 100)
    : null;
  const card = document.getElementById('stagecard');
  card.className = 'stagecard';
  card.innerHTML = '<div class="meta">' + [escHtml(STAGE.stage.date), escHtml(STAGE.stage.stage_type),
      (STAGE.stage.generated_distance_km || '?') + ' km', 'D+ ' + (STAGE.stage.total_ascent_m || '?') + ' m',
      delta != null ? 'tracé reconstitué sur le réseau routier actuel — distance officielle : ' + STAGE.stage.official_distance_km + ' km / reconstitution : ' + STAGE.stage.generated_distance_km + ' km (écart ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' %)' : null
    ].filter(Boolean).join(' · ') + '</div>' +
    (STAGE.profile.length ? EFProfile.renderProfileSVG(STAGE, { width: 1000, height: 260 }) : '<em>non générée</em>') +
    STAGE.climbs.map(c => '<div class="climb"><b>' + escHtml(c.name) + '</b> — cat. ' + escHtml(c.category) +
      ' · ' + c.length_km + ' km à ' + c.avg_gradient + ' % (max ' + c.max_gradient + ' %) · sommet ' + c.summit_ele_m + ' m</div>').join('');
});
</script>
</body>
</html>`;
}

module.exports = { stageToGpx, stageToTcx, stagePayload, tourToStandaloneHtml, stageToStandaloneHtml, stageToRoadbookHtml, decimate, ATTRIBUTIONS };
