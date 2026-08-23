'use strict';
// Écran 4 : mode archives — import Wikipédia d'une édition, reconstruction des
// étapes par le pipeline standard, affichage distance officielle vs reconstituée.

async function importYear() {
  const year = document.getElementById('f-year').value;
  const msg = document.getElementById('import-msg');
  const btn = document.getElementById('btn-import');
  btn.disabled = true;
  msg.textContent = `Import de l'édition ${year} depuis Wikipédia…`;
  try {
    const res = await EF.api('/api/editions/import', { method: 'POST', body: { year: Number(year) } });
    msg.textContent = `✔ ${res.stages.length} étapes importées.`;
    await loadEditions();
  } catch (err) {
    msg.textContent = 'Erreur : ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

function stageRow(s) {
  const delta = s.official_distance_km && s.generated_distance_km
    ? ((s.generated_distance_km - s.official_distance_km) / s.official_distance_km) * 100
    : null;
  return `<tr>
    <td><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a>
      ${s.is_curated ? '<span class="badge sourced-badge" title="points de passage vérifiés (historic_routes.json), pas seulement villes Wikipédia">sourcé</span>' : ''}</td>
    <td>${EF.esc(s.date || '')}</td>
    <td>${EF.esc(s.stage_type || '—')}</td>
    <td>${s.official_distance_km ? s.official_distance_km + ' km' : '—'}</td>
    <td>${s.generated_distance_km != null
      ? `${s.generated_distance_km} km <span class="meta-line">(${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)</span>`
      : '—'}</td>
    <td>${EF.stateBadge(s.state)} ${s.state === 'generating' && s.progress ? `<span class="meta-line">${EF.esc(s.progress.step || '')} ${s.progress.percent || 0}%</span>` : ''}</td>
    <td>${s.state !== 'generating' ? `<button class="secondary" data-gen="${s.id}">${s.state === 'done' ? '↻' : '▶ Générer'}</button>` : ''}</td>
  </tr>`;
}

async function generateAll(editionId, btn) {
  btn.disabled = true;
  try {
    const ed = await EF.api(`/api/editions/${editionId}`);
    for (const s of ed.stages) {
      if (s.state === 'done') continue;
      await EF.api(`/api/stages/${s.id}/generate`, { method: 'POST' });
      // attendre la fin de cette étape avant la suivante (respect des rate limits)
      let state = 'generating';
      while (state === 'generating' || state === 'draft') {
        await new Promise((r) => setTimeout(r, 1200));
        const cur = await EF.api(`/api/stages/${s.id}`);
        state = cur.stage.state;
        await loadEditions(); // rafraîchit la progression affichée
      }
    }
  } finally {
    btn.disabled = false;
    loadEditions();
  }
}

async function loadEditions() {
  const editions = await EF.api('/api/editions');
  const box = document.getElementById('editions');
  const sourcedOnly = document.getElementById('f-sourced-only').checked;
  const openStates = {};
  box.querySelectorAll('details').forEach((d) => (openStates[d.dataset.ed] = d.open));
  box.innerHTML = '';
  for (const e of editions.filter((x) => !x.is_custom && x.year)) {
    const fullySourced = e.stage_count > 0 && e.curated_stage_count === e.stage_count;
    if (sourcedOnly && !fullySourced) continue;
    const det = document.createElement('details');
    det.dataset.ed = e.id;
    det.open = openStates[e.id] !== undefined ? openStates[e.id] : String(e.year) === '1903';
    const full = await EF.api(`/api/editions/${e.id}`);
    const sourceBadge = fullySourced
      ? '<span class="badge sourced-badge">entièrement sourcé</span>'
      : `<span class="badge partial-badge">reconstruction partielle (${e.curated_stage_count || 0}/${e.stage_count} étapes sourcées)</span>`;
    det.innerHTML = `
      <summary style="cursor:pointer;font-weight:700;padding:8px 0">${EF.esc(e.name)} — ${e.stage_count} étapes
        (${e.done_count || 0} générées) ${sourceBadge}</summary>
      <div class="card">
        ${full.source && full.source.notes ? `<div class="note">${EF.esc(full.source.notes)}</div>` : ''}
        ${full.source ? `<p class="meta-line">Sources : liste des étapes — ${EF.esc(full.source.liste_etapes || '')} ; points de passage — ${EF.esc(full.source.points_de_passage || '')}</p>` : ''}
        <div class="toolbar">
          <button data-genall="${e.id}">▶ Générer toutes les étapes</button>
          <a class="btn secondary" href="/tour.html?edition=${e.id}">Carte globale</a>
          <a class="btn secondary" href="/api/editions/${e.id}/export.html">Mini-site HTML</a>
        </div>
        <table class="stage-list">
          <thead><tr><th>Étape</th><th>Date</th><th>Type</th><th>Dist. officielle</th><th>Reconstitution</th><th>État</th><th></th></tr></thead>
          <tbody>${full.stages.map(stageRow).join('')}</tbody>
        </table>
      </div>`;
    box.appendChild(det);
  }
  box.querySelectorAll('[data-gen]').forEach((b) =>
    b.addEventListener('click', async () => {
      await EF.api(`/api/stages/${b.dataset.gen}/generate`, { method: 'POST' });
      pollWhileGenerating();
    })
  );
  box.querySelectorAll('[data-genall]').forEach((b) =>
    b.addEventListener('click', () => generateAll(b.dataset.genall, b))
  );
  return editions;
}

let pollTimer = null;
async function pollWhileGenerating() {
  clearTimeout(pollTimer);
  const editions = await loadEditions();
  const anyRunning = document.body.innerHTML.includes('génération…');
  void editions;
  if (anyRunning) pollTimer = setTimeout(pollWhileGenerating, 1500);
}

async function loadMythicGrid() {
  const grid = document.getElementById('mythic-grid');
  const highlights = await EF.api('/api/editions/highlights');
  grid.innerHTML = highlights.map((h) => `
    <button type="button" class="mythic-card" data-mythic-year="${h.year}">
      <span class="year">${h.year}</span>
      <span class="highlight">${EF.esc(h.highlight)}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-mythic-year]').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.getElementById('f-year').value = btn.dataset.mythicYear;
      importYear();
    })
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('archives');
  document.getElementById('btn-import').addEventListener('click', importYear);
  document.getElementById('f-sourced-only').addEventListener('change', () => loadEditions());
  loadMythicGrid();
  const editions = await loadEditions();
  // Première visite : proposer la démo 1903 automatiquement.
  if (!editions.some((e) => e.year === 1903)) {
    document.getElementById('import-msg').textContent =
      '1903 pas encore importé — cliquez « Importer l\'année » pour charger la démo.';
  }
  pollWhileGenerating();
});
