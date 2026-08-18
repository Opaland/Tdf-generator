'use strict';
// Écran 2 : fiche d'étape — profil SVG style ASO, côte par côte, km par km,
// mini-carte (IGN PLANIGNV2 en France / OSM sinon), exports JSON/GPX/PNG/CSV.

const stageId = EF.qs('id');
let FULL = null;
let kmSortKey = 'km';
let kmSortAsc = true;

const decimate = (arr, n) => EFProfile.decimate(arr, n);

function toPayload(full) {
  return {
    stage: full.stage,
    waypoints: full.waypoints,
    climbs: full.climbs,
    profile: decimate(full.samples, 900).map((s) => ({
      d: s.dist_m, e: s.ele_smooth_m, r: s.ele_raw_m, lat: s.lat, lon: s.lon,
    })),
  };
}

async function poll() {
  const full = await EF.api(`/api/stages/${stageId}`);
  const st = full.stage;
  if (st.state === 'done') { FULL = full; renderFiche(); return; }
  if (st.state === 'error') {
    document.getElementById('pg-title').textContent = 'Échec de la génération';
    document.getElementById('pg-detail').textContent = st.error || 'erreur inconnue';
    return;
  }
  if (st.state === 'draft' && !poll.started) {
    // fiche ouverte sur un brouillon : lancer la génération
    poll.started = true;
    await EF.api(`/api/stages/${stageId}/generate`, { method: 'POST' });
  }
  const p = st.progress || {};
  document.getElementById('pg-title').textContent = `Génération : ${st.name}`;
  document.getElementById('pg-detail').textContent = `${p.step || ''} — ${p.detail || ''}`;
  document.getElementById('pg-bar').style.width = (p.percent || 0) + '%';
  setTimeout(poll, 900);
}

function sampleAt(m) {
  const s = FULL.samples;
  let best = s[0];
  for (const p of s) if (Math.abs(p.dist_m - m) < Math.abs(best.dist_m - m)) best = p;
  return best;
}

function renderFiche() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('fiche').style.display = 'block';
  const st = FULL.stage;
  document.title = `ÉtapeForge — ${st.name}`;
  document.getElementById('st-name').textContent = st.name;

  const meta = [
    st.date, st.stage_type, st.status,
    `${st.generated_distance_km} km`, `D+ ${st.total_ascent_m} m`,
    FULL.edition ? FULL.edition.name : null,
    FULL.track ? `routage : ${FULL.track.router}` : null,
  ].filter(Boolean).join(' · ');
  document.getElementById('st-meta').textContent = meta;

  // Bandeau reconstruction historique.
  if (st.official_distance_km) {
    const delta = ((st.generated_distance_km - st.official_distance_km) / st.official_distance_km) * 100;
    document.getElementById('st-reconstruction').innerHTML =
      `<div class="reconstruction">Tracé <b>reconstitué sur le réseau routier actuel</b> — ` +
      `distance officielle ${FULL.edition && FULL.edition.year ? FULL.edition.year : ''} : ` +
      `<b>${st.official_distance_km} km</b> / reconstitution : <b>${st.generated_distance_km} km</b> ` +
      `(écart ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)</div>`;
  }

  // Profil 2D + profil 3D interactif (rotation à la souris, relief étirable —
  // visualisation inspirée des profils 3D VeloViewer).
  const payload = toPayload(FULL);
  document.getElementById('profile-box').innerHTML = EFProfile.renderProfileSVG(payload, { width: 1080, height: 300 });
  setup3D(payload);

  // Checks.
  const ul = document.getElementById('checks');
  ul.innerHTML = '';
  const checks = st.checks || { items: [] };
  for (const item of checks.items) {
    const li = document.createElement('li');
    li.className = item.status;
    li.innerHTML = `<span class="st">${item.status === 'ok' ? '✓' : item.status === 'warn' ? '⚠' : '✗'}</span>` +
      `<b>${EF.esc(item.label)}</b> — ${EF.esc(item.detail)}`;
    ul.appendChild(li);
  }
  if (checks.offline) {
    const li = document.createElement('li');
    li.className = 'warn';
    li.innerHTML = `<span class="st">⚠</span><b>Mode hors-ligne</b> — étape générée avec le simulateur (données synthétiques).`;
    ul.appendChild(li);
  }

  // Côte par côte.
  const climbsBox = document.getElementById('climbs');
  climbsBox.innerHTML = FULL.climbs.length ? '' : '<p class="meta-line">Aucune côte détectée (seuil : ≥ 1,5 km à ≥ 3 %).</p>';
  for (const c of FULL.climbs) {
    const div = document.createElement('div');
    div.className = 'card climb-card';
    div.innerHTML =
      EFProfile.renderClimbSVG({ ...c }, { width: 1040, height: 300 }) +
      `<p class="meta-line">km ${c.start_km} → ${c.end_km} · du pied (${c.start_ele_m} m) au sommet (${c.summit_ele_m} m) · ` +
      `score ${c.score} → catégorie ${c.category} · nom : ${EF.esc(c.name_source === 'waypoint' ? 'waypoint' : 'toponyme géocodé inverse')}</p>`;
    climbsBox.appendChild(div);
  }

  renderKmTable();

  // Carte.
  const track = FULL.track;
  if (track) {
    const coords = track.geojson.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const mid = coords[Math.floor(coords.length / 2)];
    const map = L.map('map');
    EF.baseLayerFor(mid[0], mid[1]).addTo(map);
    // Tracé coloré par pente locale (lisible d'un coup d'œil, façon VeloViewer) :
    // halo sombre + segments entre échantillons successifs, teintés par gradient.
    L.polyline(coords, { color: '#3a3a3a', weight: 6, opacity: 0.5 }).addTo(map);
    const segs = decimate(FULL.samples, 700);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1];
      const b = segs[i];
      const dd = b.dist_m - a.dist_m;
      const g = dd > 0 ? ((b.ele_smooth_m - a.ele_smooth_m) / dd) * 100 : 0;
      const color = g < 1 ? '#3fa34d' : EFProfile.gradStyle(g).color;
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 4, opacity: 0.95 })
        .bindTooltip(`km ${(b.dist_m / 1000).toFixed(1)} · ${Math.round(b.ele_smooth_m)} m · ${g.toFixed(1)} %`)
        .addTo(map);
    }
    // segments approximés en surimpression
    for (const seg of track.approx_segments || []) {
      const sub = FULL.samples.filter((s) => s.dist_m >= seg.fromM && s.dist_m <= seg.toM).map((s) => [s.lat, s.lon]);
      if (sub.length > 1) L.polyline(sub, { color: '#f08c00', weight: 4, dashArray: '6 6' }).addTo(map).bindTooltip('segment approximé : ' + seg.reason);
    }
    map.fitBounds(coords, { padding: [30, 30] });

    const totalM = track.distance_m;
    const icon = (html, cls) => L.divIcon({ html, className: 'ef-marker ' + (cls || ''), iconSize: [26, 26], iconAnchor: [13, 13] });
    // bornes 20/10/5 km
    for (const kmLeft of [20, 10, 5]) {
      const m = totalM - kmLeft * 1000;
      if (m <= 0) continue;
      const s = sampleAt(m);
      L.marker([s.lat, s.lon], { icon: icon(`<div style="background:#fff;border:2px solid #c0392b;border-radius:4px;font-size:10px;font-weight:700;text-align:center;line-height:20px;color:#c0392b">${kmLeft}</div>`) })
        .bindTooltip(`${kmLeft} km de l'arrivée`).addTo(map);
    }
    // flamme rouge
    const fr = sampleAt(totalM - 1000);
    L.marker([fr.lat, fr.lon], { icon: icon('<div style="font-size:20px;line-height:22px">🚩</div>') })
      .bindTooltip('Flamme rouge — dernier kilomètre').addTo(map);
    // damier arrivée
    const fin = sampleAt(totalM);
    L.marker([fin.lat, fin.lon], { icon: icon('<div style="font-size:20px;line-height:22px">🏁</div>') })
      .bindTooltip('Arrivée').addTo(map);
    // départ
    const dep = sampleAt(0);
    L.marker([dep.lat, dep.lon], { icon: icon('<div style="font-size:18px;line-height:22px">🟢</div>') })
      .bindTooltip('Départ').addTo(map);
    // sommets
    for (const c of FULL.climbs) {
      const s = sampleAt(c.end_km * 1000);
      const cc = EFProfile.CAT_COLORS[c.category] || '#999';
      L.marker([s.lat, s.lon], { icon: icon(`<div style="background:${cc};color:#fff;border-radius:50%;width:22px;height:22px;font-size:10px;font-weight:700;text-align:center;line-height:22px;border:2px solid #fff">${c.category}</div>`) })
        .bindTooltip(`${c.name} — ${c.summit_ele_m} m`).addTo(map);
    }
  }

  // Exports.
  document.getElementById('exp-json').href = `/api/stages/${stageId}/export.json`;
  document.getElementById('exp-gpx').href = `/api/stages/${stageId}/export.gpx`;
  document.getElementById('exp-png').addEventListener('click', () => {
    const svg = document.querySelector('#profile-box svg');
    if (svg) EF.svgToPng(svg, `profil-etape-${stageId}.png`, 2);
  });
  document.getElementById('btn-regen').addEventListener('click', async () => {
    await EF.api(`/api/stages/${stageId}/generate`, { method: 'POST' });
    location.reload();
  });
}

function setup3D(payload) {
  const box2d = document.getElementById('profile-box');
  const box3d = document.getElementById('ribbon-box');
  const ctl = document.getElementById('ctl-3d');
  const tab2d = document.getElementById('tab-2d');
  const tab3d = document.getElementById('tab-3d');
  let rotation = 0;
  let stretch = parseFloat(document.getElementById('stretch').value);

  const draw = () => {
    box3d.innerHTML = EFProfile.renderRibbon3D(payload, { width: 1080, height: 440, rotation, stretch });
  };
  const show = (three) => {
    box2d.style.display = three ? 'none' : 'block';
    box3d.style.display = three ? 'block' : 'none';
    ctl.style.display = three ? 'inline' : 'none';
    tab2d.className = three ? 'tab secondary' : 'tab active';
    tab3d.className = three ? 'tab active' : 'tab secondary';
    if (three) draw();
  };
  tab2d.addEventListener('click', () => show(false));
  tab3d.addEventListener('click', () => show(true));
  document.getElementById('stretch').addEventListener('input', (e) => {
    stretch = parseFloat(e.target.value);
    draw();
  });
  let dragging = false;
  let lastX = 0;
  box3d.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; box3d.style.cursor = 'grabbing'; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotation += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
    draw();
  });
  window.addEventListener('pointerup', () => { dragging = false; box3d.style.cursor = 'grab'; });
}

function renderKmTable() {
  const rows = [...FULL.kmAnalysis].sort((a, b) => {
    const va = a[kmSortKey];
    const vb = b[kmSortKey];
    return kmSortAsc ? va - vb : vb - va;
  });
  const tbody = document.querySelector('#kmtable tbody');
  tbody.innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${r.km}</td><td>${r.ele_end_m}</td><td>${r.avg_gradient.toFixed(1)}</td>` +
        `<td>${r.max_gradient_100m.toFixed(1)}</td><td>${r.ascent_m}</td><td>${r.cum_ascent_m}</td></tr>`
    )
    .join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('editeur');
  if (!stageId) { location.href = '/'; return; }
  document.querySelectorAll('#kmtable th').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (kmSortKey === k) kmSortAsc = !kmSortAsc;
      else { kmSortKey = k; kmSortAsc = true; }
      renderKmTable();
    })
  );
  document.getElementById('exp-csv').addEventListener('click', () => {
    const head = 'km;alt_fin_m;pente_moy_pct;pente_max_pct;d_plus_km_m;d_plus_cumule_m';
    const lines = FULL.kmAnalysis.map((r) =>
      [r.km, r.ele_end_m, r.avg_gradient, r.max_gradient_100m, r.ascent_m, r.cum_ascent_m].join(';')
    );
    EF.downloadText(`etape-${stageId}-km-par-km.csv`, [head, ...lines].join('\n'), 'text/csv');
  });
  poll();
});
