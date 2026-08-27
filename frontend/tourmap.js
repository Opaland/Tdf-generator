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
  const delta = EF.distanceDelta(s.official_distance_km, s.generated_distance_km);
  return (
    `<div style="min-width:340px"><b><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a></b><br>` +
    `<span style="color:#666;font-size:0.85em">${[EF.esc(s.date), EF.esc(s.stage_type), (s.generated_distance_km || '?') + ' km', 'D+ ' + (s.total_ascent_m || '?') + ' m'].filter(Boolean).join(' · ')}</span>` +
    (delta != null ? `<br><span style="font-size:0.8em">officielle ${s.official_distance_km} km / reconstituée ${s.generated_distance_km} km (${EF.formatDelta(delta)})</span>` : '') +
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

// Tableau de statistiques dense et triable (façon listes VeloViewer) + tuiles de totaux.
const CAT_ORDER = { HC: 5, 1: 4, 2: 3, 3: 2, 4: 1 };
let statRows = [];
let statSort = { k: 'order', asc: true };

function buildStatRows(data) {
  statRows = data.stages.map((st, i) => {
    const s = st.stage;
    const climbs = st.climbs || [];
    const maxCat = climbs.reduce((a, c) => (CAT_ORDER[c.category] > CAT_ORDER[a] ? c.category : a), '');
    const delta = EF.distanceDelta(s.official_distance_km, s.generated_distance_km);
    return {
      id: s.id,
      order: s.stage_order || i + 1,
      name: s.name,
      date: s.date || '',
      type: s.stage_type || '',
      off: s.official_distance_km || null,
      gen: s.generated_distance_km || null,
      delta,
      dplus: s.total_ascent_m || null,
      nclimbs: climbs.length,
      maxcat: maxCat,
      maxgrad: climbs.length ? Math.max(...climbs.map((c) => c.max_gradient)) : null,
      summit: climbs.length ? Math.max(...climbs.map((c) => c.summit_ele_m)) : null,
      state: s.state,
    };
  });
}

function renderStageList() {
  const rows = [...statRows].sort((a, b) => {
    let va = a[statSort.k];
    let vb = b[statSort.k];
    if (statSort.k === 'maxcat') { va = CAT_ORDER[va] || 0; vb = CAT_ORDER[vb] || 0; }
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
    return statSort.asc ? cmp : -cmp;
  });
  const fmt = (v, d) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d ?? 0) : v);
  document.querySelector('#tour-stages tbody').innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.order}</td>
        <td><a href="/stage.html?id=${r.id}">${EF.esc(r.name)}</a></td>
        <td>${EF.esc(r.date)}</td>
        <td><span style="color:${EF.typeColor(r.type)}">${EF.esc(r.type || '—')}</span></td>
        <td>${fmt(r.off)}</td><td>${fmt(r.gen, 1)}</td>
        <td>${r.delta == null ? '—' : (r.delta >= 0 ? '+' : '') + r.delta.toFixed(1)}</td>
        <td>${fmt(r.dplus)}</td><td>${r.nclimbs || '—'}</td>
        <td>${r.maxcat ? `<span class="pill" style="background:${EFProfile.CAT_COLORS[r.maxcat]};color:${EFProfile.CAT_TEXT[r.maxcat]}">${r.maxcat}</span>` : '—'}</td>
        <td>${fmt(r.maxgrad, 1)}</td><td>${fmt(r.summit)}</td>
        <td>${EF.stateBadge(r.state)}</td></tr>`
    )
    .join('');
  const tot = (k) => statRows.reduce((a, r) => a + (r[k] || 0), 0);
  document.querySelector('#tour-stages tfoot').innerHTML =
    `<tr><td></td><td>Total</td><td></td><td></td><td>${tot('off') || '—'}</td>` +
    `<td>${tot('gen').toFixed(1)}</td><td></td><td>${tot('dplus')}</td><td>${tot('nclimbs')}</td>` +
    `<td colspan="4"></td></tr>`;
}

function renderStatTiles(data) {
  const rows = statRows;
  const totalKm = rows.reduce((a, r) => a + (r.gen || 0), 0);
  const totalDplus = rows.reduce((a, r) => a + (r.dplus || 0), 0);
  const allClimbs = data.stages.flatMap((st) => st.climbs || []);
  const byCat = {};
  for (const c of allClimbs) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const highest = allClimbs.reduce((a, c) => (c.summit_ele_m > (a?.summit_ele_m || 0) ? c : a), null);
  const tiles = [
    { v: rows.length, l: 'étapes' },
    { v: totalKm.toFixed(0) + ' km', l: 'distance reconstituée' },
    { v: 'D+ ' + totalDplus.toLocaleString('fr-FR') + ' m', l: 'dénivelé total' },
    { v: allClimbs.length, l: 'côtes détectées' },
    {
      v: ['HC', '1', '2', '3', '4'].filter((k) => byCat[k]).map((k) => `${byCat[k]}×${k === 'HC' ? 'HC' : 'c' + k}`).join(' ') || '—',
      l: 'par catégorie',
    },
    { v: highest ? `${highest.summit_ele_m} m` : '—', l: highest ? `toit du tour (${highest.name})` : 'toit du tour' },
  ];
  document.getElementById('tour-stats').innerHTML = tiles
    .map((t) => `<div class="stat"><div class="v">${t.v}</div><div class="l">${EF.esc(t.l)}</div></div>`)
    .join('');
}

// Trouvaille de revue-personas (27/08/2026, persona utilisateur peu
// technophile) : "▶ Animation étape par étape" et "Mini-site HTML autonome"
// s'affichaient comme des contrôles pleinement actifs (mêmes styles, pas
// de disabled/aria-disabled) alors qu'ils étaient des no-op silencieux
// tant qu'aucune édition n'était chargée (animate() : `if (!TOURDATA)
// return`, exp-site : <a> sans href tant que loadEdition() n'a pas tourné).
//
// Trois tours de relecture adverse sur ce correctif, chacun a trouvé une
// trouvaille réelle :
//
// 1. Activer #btn-anim inconditionnellement dès que TOURDATA est
//    disponible réactivait le bouton natif PENDANT qu'une animation était
//    déjà en cours — avant ce chantier, `btn.disabled` restait vrai
//    jusqu'à la fin de l'animation, empêchant structurellement un second
//    animate() concurrent déclenché par un clic. `animating` empêche
//    désormais toute réactivation par enableAnimButton() tant qu'une
//    animation tourne.
// 2. Retirer aria-disabled/title de #exp-site avant que son href ne soit
//    effectivement posé réintroduisait le bug d'origine si le rendu
//    (drawTour/buildStatRows/etc.) levait une exception entre les deux.
//    Déplacé pour n'activer #exp-site qu'au moment exact où son href est
//    réellement assigné, dans chacune des deux branches.
// 3. animate() n'avait pas de garde de réentrance (rien n'empêchait un
//    second appel direct, hors clic) ni de `finally` — une exception en
//    cours de boucle (donnée corrompue) bloquait `animating`/le bouton
//    à `true` pour toujours, y compris après un rechargement d'édition
//    réussi. Et rien n'empêchait de changer d'édition via #sel-edition
//    PENDANT l'animation, qui relit TOURDATA (variable de module) à
//    chaque itération — un changement en cours de route faisait dessiner
//    la boucle de l'ancienne édition sur les données de la nouvelle.
//    Fermé par un garde de réentrance explicite, un try/finally, et la
//    désactivation de #sel-edition pendant l'animation.
let animating = false;

function enableAnimButton() {
  if (!animating) document.getElementById('btn-anim').disabled = false;
}

function enableSiteLink() {
  const site = document.getElementById('exp-site');
  site.removeAttribute('aria-disabled');
  site.removeAttribute('title');
}

async function loadEdition(id) {
  TOURDATA = await EF.api(`/api/editions/${id}/mapdata`);
  enableAnimButton();
  drawTour(TOURDATA);
  buildStatRows(TOURDATA);
  renderStatTiles(TOURDATA);
  renderStageList();
  if (window.EF_STATIC) {
    // Les mini-sites pré-construits sont référencés par data/sitelinks.json.
    const el = document.getElementById('exp-site');
    try {
      const links = await (await fetch('data/sitelinks.json')).json();
      if (links[id]) { el.href = links[id]; el.style.display = ''; enableSiteLink(); }
      else el.style.display = 'none';
    } catch { el.style.display = 'none'; }
  } else {
    document.getElementById('exp-site').href = `/api/editions/${id}/site`;
    enableSiteLink();
  }
  const note = document.getElementById('tour-note');
  const src = TOURDATA.edition.source;
  note.innerHTML = src && src.notes ? `<div class="note">${EF.esc(src.notes)}</div>` : '';
}

async function animate() {
  if (!TOURDATA || animating) return;
  const btn = document.getElementById('btn-anim');
  const sel = document.getElementById('sel-edition');
  animating = true;
  btn.disabled = true;
  sel.disabled = true; // empêche un changement d'édition de réassigner TOURDATA en cours de boucle
  try {
    const n = TOURDATA.stages.length;
    const all = TOURDATA.stages.flatMap((st) => (st.track ? st.track.coords.map((c) => [c[1], c[0]]) : []));
    if (all.length) map.fitBounds(all, { padding: [30, 30] });
    for (let i = 0; i < n; i++) {
      drawTour(TOURDATA, i);
      await new Promise((r) => setTimeout(r, 900));
    }
  } finally {
    // Toujours relâcher les deux contrôles, même si le rendu d'une frame a
    // levé une exception en cours de boucle — sinon animating reste bloqué
    // à true pour toujours et enableAnimButton() ne réactive plus jamais
    // le bouton, y compris après un rechargement d'édition réussi.
    animating = false;
    btn.disabled = false;
    sel.disabled = false;
  }
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
  EF.sortableHeaders(
    '#tour-stages th',
    () => statSort,
    (prev, k) => (prev.k === k ? { k, asc: !prev.asc } : { k, asc: true }),
    (next) => {
      statSort = next;
      renderStageList();
    }
  );

  const wanted = EF.qs('edition');
  if (wanted && editions.some((e) => String(e.id) === wanted)) sel.value = wanted;
  if (sel.value) loadEdition(sel.value);
});
