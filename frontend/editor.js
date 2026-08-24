'use strict';
// Écran 1 : éditeur d'étape — formulaire + waypoints ordonnés avec autocomplétion
// géocodage + carte Leaflet de prévisualisation (ajout de waypoint par clic).
// Avec ?id=<n> : mode édition d'une étape existante (mise à jour + regénération).

let map;
let markersLayer;
let waypoints = []; // {label, kind, lat, lon}
let editingId = null; // id de l'étape en cours de modification (mode édition)

/**
 * Défi du jour (backlog #10, section D) : suggère une édition mythique au
 * chargement de l'écran d'accueil, pour donner une raison de revenir
 * régulièrement — réutilise historicHighlights() (déjà la source des
 * vignettes Archives, backlog #10 section D antérieur), pas une nouvelle
 * notion de donnée. Index dérivé de la date du jour (pas Math.random()) :
 * le même défi toute la journée pour tout le monde, change le lendemain.
 * Absent en mode EF_STATIC (démo GitHub Pages en lecture seule) — l'endpoint
 * /api/editions/highlights n'a pas d'équivalent statique pré-généré, et une
 * incitation « revenez demain » n'a pas de sens sur une démo figée.
 */
/** Index stable pour une date donnée (même jour → même index, partout, sans Math.random()). */
function challengeIndexForDate(date, length) {
  const seed = date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate();
  return ((seed % length) + length) % length;
}

async function loadChallengeOfTheDay() {
  if (window.EF_STATIC) return;
  const box = document.getElementById('challenge-box');
  try {
    const highlights = await EF.api('/api/editions/highlights');
    if (!highlights.length) return;
    const pick = highlights[challengeIndexForDate(new Date(), highlights.length)];
    document.getElementById('challenge-text').textContent = `${pick.year} — ${pick.highlight}`;
    document.getElementById('challenge-link').href = `/archives.html?year=${pick.year}&auto=1`;
    box.style.display = '';
  } catch {
    // Pas de backend joignable, ou highlights indisponible : la suggestion
    // n'est pas essentielle, l'éditeur reste utilisable sans elle.
  }
}

function wpRow(wp, i) {
  const li = document.createElement('li');
  // Réordonnancement par glisser-déposer via la poignée ⠿ (en plus des boutons ↑/↓).
  li.addEventListener('dragover', (e) => e.preventDefault());
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isInteger(from) && from !== i) {
      const [moved] = waypoints.splice(from, 1);
      waypoints.splice(i, 0, moved);
      render();
    }
  });
  li.innerHTML = `
    <span class="idx" title="glisser pour réordonner" style="cursor:grab">⠿ ${i + 1}</span>
    <input class="label" value="${EF.esc(wp.label || '')}" placeholder="Ville, col, lieu-dit…">
    <select class="kind">
      <option value="start"${wp.kind === 'start' ? ' selected' : ''}>départ</option>
      <option value="via"${wp.kind === 'via' ? ' selected' : ''}>passage</option>
      <option value="col"${wp.kind === 'col' ? ' selected' : ''}>col / sommet</option>
      <option value="finish"${wp.kind === 'finish' ? ' selected' : ''}>arrivée</option>
    </select>
    <span class="coords">${wp.lat != null ? wp.lat.toFixed(4) + ', ' + wp.lon.toFixed(4) : 'à géocoder'}</span>
    <button class="secondary up" title="monter" aria-label="Monter le waypoint ${i + 1}">↑</button>
    <button class="secondary down" title="descendre" aria-label="Descendre le waypoint ${i + 1}">↓</button>
    <button class="danger del" title="supprimer" aria-label="Supprimer le waypoint ${i + 1}">✕</button>
  `;
  const handle = li.querySelector('.idx');
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(i)));

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
      <td><a class="btn secondary" href="/?id=${s.id}" title="modifier" aria-label="Modifier l'étape ${EF.esc(s.name)}">✎</a>
          ${s.state === 'done' ? `<a class="btn secondary" href="/compare.html?a=${s.id}" title="comparer avec une autre étape" aria-label="Comparer l'étape ${EF.esc(s.name)}">⇄</a>` : ''}
          <button class="danger" data-del="${s.id}" aria-label="Supprimer l'étape ${EF.esc(s.name)}">✕</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', EF.confirmClick(b, {
      confirmText: 'confirmer ✕',
      confirmTitle: 'Cliquer à nouveau pour confirmer la suppression',
      onConfirm: async () => {
        b.disabled = true;
        await EF.api(`/api/stages/${b.dataset.del}`, { method: 'DELETE' });
        loadStages();
      },
    }))
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
  msg.textContent = editingId ? 'Mise à jour…' : 'Création…';
  const body = {
    name,
    date: document.getElementById('f-date').value || null,
    stage_type: document.getElementById('f-type').value,
    status: document.getElementById('f-status').value || null,
    edition_id: document.getElementById('f-edition').value || null,
    waypoints: valid,
  };
  try {
    let id = editingId;
    if (editingId) {
      await EF.api(`/api/stages/${editingId}`, { method: 'PUT', body });
    } else {
      id = (await EF.api('/api/stages', { method: 'POST', body })).id;
    }
    await EF.api(`/api/stages/${id}/generate`, { method: 'POST' });
    location.href = `/stage.html?id=${id}`;
  } catch (err) {
    msg.textContent = 'Erreur : ' + err.message;
    btn.disabled = false;
  }
}

/** Mode édition : précharge une étape existante dans le formulaire. */
async function loadForEdit(id) {
  const full = await EF.api(`/api/stages/${id}`);
  editingId = id;
  const st = full.stage;
  document.getElementById('f-name').value = st.name || '';
  if (st.date && /^\d{4}-\d{2}-\d{2}$/.test(st.date)) document.getElementById('f-date').value = st.date;
  if (st.stage_type) document.getElementById('f-type').value = st.stage_type;
  document.getElementById('f-status').value = st.status || '';
  if (st.edition_id) document.getElementById('f-edition').value = st.edition_id;
  waypoints = full.waypoints.map((w) => ({ label: w.label, kind: w.kind, lat: w.lat, lon: w.lon }));
  document.querySelector('main h1').textContent = `Modifier : ${st.name}`;
  document.getElementById('btn-generate').textContent = 'Mettre à jour et régénérer ▶';
  render();
}

// Garde typeof : challengeIndexForDate est une fonction pure, testée
// directement (voir test/editor.test.js) sans DOM.
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('editeur');
  loadChallengeOfTheDay();
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
  if (window.EF_STATIC) {
    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.title = EF.STATIC_MSG;
    document.getElementById('gen-msg').textContent = EF.STATIC_MSG;
  }
  loadStages();
  await loadEditions();

  // « + nouveau tour… » : crée un tour personnalisé (groupe d'étapes) à la volée.
  const sel = document.getElementById('f-edition');
  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ nouveau tour…';
  sel.appendChild(optNew);
  // Saisie du nom inline (au lieu d'un prompt()/alert() natifs) : un petit
  // encart apparaît sous le sélecteur plutôt qu'une boîte de dialogue système.
  const newBox = document.getElementById('new-tour-box');
  const newName = document.getElementById('new-tour-name');
  const newMsg = document.getElementById('new-tour-msg');
  async function createTour() {
    const name = newName.value.trim();
    if (!name) { newMsg.textContent = 'Donnez un nom au tour.'; return; }
    newMsg.textContent = 'Création…';
    try {
      const { id } = await EF.api('/api/editions', { method: 'POST', body: { name, is_custom: 1 } });
      const o = document.createElement('option');
      o.value = id;
      o.textContent = name;
      sel.insertBefore(o, optNew);
      sel.value = id;
      newBox.style.display = 'none';
    } catch (err) {
      newMsg.textContent = 'Erreur : ' + err.message;
    }
  }
  sel.addEventListener('change', () => {
    if (sel.value !== '__new__') return;
    newBox.style.display = '';
    newMsg.textContent = '';
    newName.value = '';
    newName.focus();
  });
  document.getElementById('new-tour-cancel').addEventListener('click', () => {
    newBox.style.display = 'none';
    sel.value = '';
  });
  document.getElementById('new-tour-ok').addEventListener('click', createTour);
  newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createTour(); }
  });

  const editId = EF.qs('id');
  if (editId) {
    try {
      await loadForEdit(parseInt(editId, 10));
    } catch (err) {
      document.getElementById('gen-msg').textContent = 'Erreur de chargement : ' + err.message;
    }
  }
});
}

if (typeof module !== 'undefined' && module.exports) module.exports = { challengeIndexForDate };
