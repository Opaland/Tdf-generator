'use strict';
// Écran 3 : carte globale interactive — tous les tracés d'un tour, couleur par
// type d'étape, transferts en pointillés, popup par étape avec profil miniature,
// filtre par édition/année, animation optionnelle étape par étape.

let map;
let layers = [];
let TOURDATA = null;

function clearLayers() {
  for (const l of layers) map.removeLayer(l);
  layers = [];
}

function stagePopupHtml(st) {
  const s = st.stage;
  const delta = s.official_distance_km && s.generated_distance_km
    ? ((s.generated_distance_km - s.official_distance_km) / s.official_distance_km) * 100
    : null;
  return (
    `<div style="min-width:340px"><b><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a></b><br>` +
    `<span style="color:#666;font-size:0.85em">${[s.date, s.stage_type, (s.generated_distance_km || '?') + ' km', 'D+ ' + (s.total_ascent_m || '?') + ' m'].filter(Boolean).join(' · ')}</span>` +
    (delta != null ? `<br><span style="font-size:0.8em">officielle ${s.official_distance_km} km / reconstituée ${s.generated_distance_km} km (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)</span>` : '') +
    (st.profile && st.profile.length ? EFProfile.renderProfileSVG(st, { width: 340, height: 90, mini: true }) : '<em>non générée</em>') +
    `</div>`
  );
}

function drawTour(data, upTo) {
  clearLayers();
  const bounds = [];
  let prevEnd = null;
  data.stages.forEach((st, i) => {
    if (upTo != null && i > upTo) return;
    if (!st.track || !st.track.coords.length) return;
    const latlngs = st.track.coords.map((c) => [c[1], c[0]]);
    latlngs.forEach((ll) => bounds.push(ll));
    // transfert (pointillés) entre l'arrivée précédente et ce départ
    if (prevEnd) {
      const gap = map.distance(prevEnd, latlngs[0]);
      if (gap > 2000) {
        const t = L.polyline([prevEnd, latlngs[0]], { color: '#777', dashArray: '5 9', weight: 2 });
        t.bindTooltip('transfert');
        t.addTo(map);
        layers.push(t);
      }
    }
    const color = EF.typeColor(st.stage.stage_type);
    const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.9 });
    line.bindPopup(stagePopupHtml(st), { maxWidth: 380 });
    line.addTo(map);
    layers.push(line);
    prevEnd = latlngs[latlngs.length - 1];
  });
  if (bounds.length && upTo == null) map.fitBounds(bounds, { padding: [30, 30] });
}

function renderLegend() {
  document.getElementById('legend').innerHTML = Object.entries(EF.typeColors)
    .map(([t, c]) => `<span><span class="sw" style="background:${c}"></span>${t}</span>`)
    .join('') + `<span><span class="sw" style="background:#777;border:1px dashed #333"></span>transfert</span>`;
}

function renderStageList(data) {
  const tbody = document.querySelector('#tour-stages tbody');
  tbody.innerHTML = data.stages
    .map((st) => {
      const s = st.stage;
      return `<tr><td><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a></td>
        <td>${EF.esc(s.date || '')}</td>
        <td><span style="color:${EF.typeColor(s.stage_type)}">${EF.esc(s.stage_type || '—')}</span></td>
        <td>${s.generated_distance_km != null ? s.generated_distance_km + ' km' : '—'}</td>
        <td>${EF.stateBadge(s.state)}</td></tr>`;
    })
    .join('');
}

async function loadEdition(id) {
  TOURDATA = await EF.api(`/api/editions/${id}/mapdata`);
  drawTour(TOURDATA);
  renderStageList(TOURDATA);
  document.getElementById('exp-site').href = `/api/editions/${id}/site`;
  const note = document.getElementById('tour-note');
  const src = TOURDATA.edition.source;
  note.innerHTML = src && src.notes ? `<div class="note">${EF.esc(src.notes)}</div>` : '';
}

async function animate() {
  if (!TOURDATA) return;
  const btn = document.getElementById('btn-anim');
  btn.disabled = true;
  const n = TOURDATA.stages.length;
  const all = TOURDATA.stages.flatMap((st) => (st.track ? st.track.coords.map((c) => [c[1], c[0]]) : []));
  if (all.length) map.fitBounds(all, { padding: [30, 30] });
  for (let i = 0; i < n; i++) {
    drawTour(TOURDATA, i);
    await new Promise((r) => setTimeout(r, 900));
  }
  btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('tour');
  map = L.map('map').setView([46.6, 2.6], 6);
  EF.osmLayer().addTo(map);
  renderLegend();

  const editions = await EF.api('/api/editions');
  const sel = document.getElementById('sel-edition');
  sel.innerHTML = editions.length
    ? editions.map((e) => `<option value="${e.id}">${EF.esc(e.name)} (${e.done_count || 0}/${e.stage_count} générées)</option>`).join('')
    : '<option value="">— aucun tour : importez une édition dans Archives —</option>';
  sel.addEventListener('change', () => sel.value && loadEdition(sel.value));
  document.getElementById('btn-anim').addEventListener('click', animate);

  const wanted = EF.qs('edition');
  if (wanted && editions.some((e) => String(e.id) === wanted)) sel.value = wanted;
  if (sel.value) loadEdition(sel.value);
});
