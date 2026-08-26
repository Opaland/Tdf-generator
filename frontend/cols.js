'use strict';
// Catalogue des cols : liste dense, triable et filtrable de toutes les côtes
// détectées (façon liste de sommets VeloViewer), profil déroulable par ligne.

let ALL = [];
let sort = { k: 'summit_ele_m', asc: false };
const CAT_ORDER = { HC: 5, 1: 4, 2: 3, 3: 2, 4: 1 };

function filtered() {
  const cat = document.getElementById('f-cat').value;
  const ed = document.getElementById('f-edition').value;
  const q = document.getElementById('f-search').value.trim().toLowerCase();
  return ALL.filter(
    (c) =>
      (!cat || c.category === cat) &&
      (!ed || String(c.edition_id) === ed) &&
      (!q || (c.name || '').toLowerCase().includes(q))
  );
}

function renderStats(rows) {
  const byCat = {};
  for (const c of rows) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const highest = rows[0] ? rows.reduce((a, c) => (c.summit_ele_m > a.summit_ele_m ? c : a)) : null;
  const steepest = rows[0] ? rows.reduce((a, c) => (c.avg_gradient > a.avg_gradient ? c : a)) : null;
  const longest = rows[0] ? rows.reduce((a, c) => (c.length_km > a.length_km ? c : a)) : null;
  const tiles = [
    { v: rows.length, l: 'côtes détectées' },
    {
      v: ['HC', '1', '2', '3', '4'].filter((k) => byCat[k]).map((k) => `${byCat[k]}×${k === 'HC' ? 'HC' : 'c' + k}`).join(' ') || '—',
      l: 'par catégorie',
    },
    { v: highest ? highest.summit_ele_m + ' m' : '—', l: highest ? `plus haut (${highest.name})` : 'plus haut sommet' },
    { v: longest ? longest.length_km + ' km' : '—', l: longest ? `plus long (${longest.name})` : 'plus longue montée' },
    { v: steepest ? steepest.avg_gradient + ' %' : '—', l: steepest ? `plus pentu (${steepest.name})` : 'plus forte pente moy.' },
  ];
  document.getElementById('cols-stats').innerHTML = tiles
    .map((t) => `<div class="stat"><div class="v">${t.v}</div><div class="l">${EF.esc(t.l)}</div></div>`)
    .join('');
}

function render() {
  const rows = filtered().sort((a, b) => {
    let va = a[sort.k];
    let vb = b[sort.k];
    if (sort.k === 'category') { va = CAT_ORDER[va] || 0; vb = CAT_ORDER[vb] || 0; }
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : va - vb;
    return sort.asc ? cmp : -cmp;
  });
  renderStats(rows);
  const tbody = document.querySelector('#cols-table tbody');
  tbody.innerHTML = rows
    .map(
      (c, i) => `<tr data-i="${i}" style="cursor:pointer">
        <td>${EF.esc(c.name || '—')}${c.simulated ? '<span class="badge partial-badge" title="étape générée en mode hors-ligne : profil d\'altitude synthétique (simulateur), pas une mesure réelle — pentes affichées possiblement irréalistes">simulé</span>' : ''}</td>
        <td><span class="pill" style="background:${EFProfile.CAT_COLORS[c.category]};color:${EFProfile.CAT_TEXT[c.category]}">${c.category}</span></td>
        <td>${c.summit_ele_m}</td><td>${c.length_km}</td><td>${c.avg_gradient}</td>
        <td>${c.max_gradient}</td><td>${c.score}</td>
        <td><a href="/stage.html?id=${c.stage_id}">${EF.esc(c.stage_name)}</a></td>
        <td>${EF.esc(c.edition_name || '—')}</td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('tr[data-i]').forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // laisser le lien vers l'étape agir
      const existing = tr.nextElementSibling;
      if (existing && existing.classList.contains('climb-expand')) { existing.remove(); return; }
      document.querySelectorAll('.climb-expand').forEach((x) => x.remove());
      const c = rows[parseInt(tr.dataset.i, 10)];
      if (!c.km_blocks || !c.km_blocks.length) return;
      const exp = document.createElement('tr');
      exp.className = 'climb-expand';
      exp.innerHTML = `<td colspan="9">${EFProfile.renderClimbSVG(c, { width: 1000, height: 260 })}</td>`;
      tr.after(exp);
    })
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('cols');
  const [climbs, editions] = await Promise.all([EF.api('/api/climbs'), EF.api('/api/editions')]);
  ALL = climbs;
  const sel = document.getElementById('f-edition');
  for (const e of editions) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    sel.appendChild(o);
  }
  for (const id of ['f-cat', 'f-edition', 'f-search']) {
    document.getElementById(id).addEventListener('input', render);
  }
  document.querySelectorAll('#cols-table th').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (sort.k === k) sort.asc = !sort.asc;
      else sort = { k, asc: k === 'name' || k === 'stage_name' || k === 'edition_name' };
      render();
    })
  );
  render();
});
