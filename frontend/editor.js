'use strict';
// Écran 1 : éditeur d'étape — formulaire + waypoints ordonnés avec autocomplétion
// géocodage + carte Leaflet de prévisualisation (ajout de waypoint par clic).

let map;
let markersLayer;
let waypoints = []; // {label, kind, lat, lon}

function wpRow(wp, i) {
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="idx">${i + 1}</span>
    <input class="label" value="${EF.esc(wp.label || '')}" placeholder="Ville, col, lieu-dit…">
    <select class="kind">
      <option value="start"${wp.kind === 'start' ? ' selected' : ''}>départ</option>
      <option value="via"${wp.kind === 'via' ? ' selected' : ''}>passage</option>
      <option value="col"${wp.kind === 'col' ? ' selected' : ''}>col / sommet</option>
      <option value="finish"${wp.kind === 'finish' ? ' selected' : ''}>arrivée</option>
    </select>
    <span class="coords">${wp.lat != null ? wp.lat.toFixed(4) + ', ' + wp.lon.toFixed(4) : 'à géocoder'}</span>
    <button class="secondary up" title="monter">↑</button>
    <button class="secondary down" title="descendre">↓</button>
    <button class="danger del" title="supprimer">✕</button>
  `;
  const input = li.querySelector('input.label');
  const suggestBox = document.createElement('div');
  suggestBox.className = 'suggest';
  suggestBox.style.display = 'none';
  li.appendChild(suggestBox);

  let debounce;
  input.addEventListener('input', () => {
    wp.label = input.value;
    wp.lat = null;
    wp.lon = null;
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (input.value.trim().length < 2) { suggestBox.style.display = 'none'; return; }
      try {
        const hits = await EF.api(`/api/geocode?q=${encodeURIComponent(input.value)}`);
        suggestBox.innerHTML = '';
        for (const h of hits) {
          const d = document.createElement('div');
          d.textContent = h.label + (h.kind === 'col' ? ' ⛰' : '');
          d.addEventListener('mousedown', () => {
            wp.label = h.label;
            wp.lat = h.lat;
            wp.lon = h.lon;
            if (h.kind === 'col' && wp.kind === 'via') wp.kind = 'col';
            render();
          });
          suggestBox.appendChild(d);
        }
        suggestBox.style.display = hits.length ? 'block' : 'none';
      } catch { suggestBox.style.display = 'none'; }
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(() => (suggestBox.style.display = 'none'), 200));
  li.querySelector('select.kind').addEventListener('change', (e) => { wp.kind = e.target.value; });
  li.querySelector('.up').addEventListener('click', () => { if (i > 0) { [waypoints[i - 1], waypoints[i]] = [waypoints[i], waypoints[i - 1]]; render(); } });
  li.querySelector('.down').addEventListener('click', () => { if (i < waypoints.length - 1) { [waypoints[i + 1], waypoints[i]] = [waypoints[i], waypoints[i + 1]]; render(); } });
  li.querySelector('.del').addEventListener('click', () => { waypoints.splice(i, 1); render(); });
  return li;
}

function render() {
  const ul = document.getElementById('wp-list');
  ul.innerHTML = '';
  waypoints.forEach((wp, i) => ul.appendChild(wpRow(wp, i)));

  markersLayer.clearLayers();
  const pts = waypoints.filter((w) => w.lat != null);
  pts.forEach((w, i) => {
    L.marker([w.lat, w.lon])
      .bindTooltip(`${i + 1}. ${w.label}`)
      .addTo(markersLayer);
  });
  if (pts.length >= 2) {
    L.polyline(pts.map((w) => [w.lat, w.lon]), { color: '#c0392b', dashArray: '4 8', weight: 2 }).addTo(markersLayer);
  }
  if (pts.length) map.fitBounds(pts.map((w) => [w.lat, w.lon]), { padding: [40, 40], maxZoom: 11 });
}

async function loadStages() {
  const rows = await EF.api('/api/stages');
  const tbody = document.querySelector('#stage-table tbody');
  tbody.innerHTML = '';
  for (const s of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a></td>
      <td>${EF.esc(s.edition_name || '—')}</td>
      <td><span style="color:${EF.typeColor(s.stage_type)}">${EF.esc(s.stage_type || '—')}</span></td>
      <td>${s.generated_distance_km != null ? s.generated_distance_km + ' km' : s.official_distance_km ? s.official_distance_km + ' km (off.)' : '—'}</td>
      <td>${s.total_ascent_m != null ? 'D+ ' + s.total_ascent_m + ' m' : '—'}</td>
      <td>${EF.stateBadge(s.state)}</td>
      <td><button class="danger" data-del="${s.id}">✕</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Supprimer cette étape ?')) return;
      await EF.api(`/api/stages/${b.dataset.del}`, { method: 'DELETE' });
      loadStages();
    })
  );
}

async function loadEditions() {
  const editions = await EF.api('/api/editions');
  const sel = document.getElementById('f-edition');
  for (const e of editions) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    sel.appendChild(o);
  }
}

async function generate() {
  const msg = document.getElementById('gen-msg');
  const btn = document.getElementById('btn-generate');
  const name = document.getElementById('f-name').value.trim() ||
    (waypoints.length >= 2 ? `${waypoints[0].label} → ${waypoints[waypoints.length - 1].label}` : '');
  const valid = waypoints.filter((w) => (w.label || '').trim());
  if (valid.length < 2) { msg.textContent = 'Il faut au moins un départ et une arrivée.'; return; }
  valid[0].kind = 'start';
  if (valid[valid.length - 1].kind !== 'col') valid[valid.length - 1].kind = 'finish';
  btn.disabled = true;
  msg.textContent = 'Création…';
  try {
    const { id } = await EF.api('/api/stages', {
      method: 'POST',
      body: {
        name,
        date: document.getElementById('f-date').value || null,
        stage_type: document.getElementById('f-type').value,
        status: document.getElementById('f-status').value || null,
        edition_id: document.getElementById('f-edition').value || null,
        waypoints: valid,
      },
    });
    await EF.api(`/api/stages/${id}/generate`, { method: 'POST' });
    location.href = `/stage.html?id=${id}`;
  } catch (err) {
    msg.textContent = 'Erreur : ' + err.message;
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('editeur');
  map = L.map('map').setView([46.6, 2.6], 6);
  EF.ignLayer().addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    let label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try {
      const r = await EF.api(`/api/reverse?lat=${lat}&lon=${lng}`);
      if (r && r.label) label = r.label;
    } catch { /* libellé par défaut */ }
    waypoints.push({ label, kind: waypoints.length === 0 ? 'start' : 'via', lat, lon: lng });
    render();
  });

  waypoints = [
    { label: '', kind: 'start', lat: null, lon: null },
    { label: '', kind: 'finish', lat: null, lon: null },
  ];
  render();
  document.getElementById('wp-add').addEventListener('click', () => {
    waypoints.splice(waypoints.length - 1, 0, { label: '', kind: 'via', lat: null, lon: null });
    render();
  });
  document.getElementById('btn-generate').addEventListener('click', generate);
  loadStages();
  loadEditions();
});
