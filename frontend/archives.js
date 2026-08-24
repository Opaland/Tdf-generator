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

// « Éditions explorées » (backlog #10 section D, gamification inspirée
// d'Explorer Tiles de VeloViewer) — cadrage volontaire, pas une simple
// copie : ÉtapeForge n'a aucune notion géographique de tuile (contrairement
// à VeloViewer, qui suit une grille de tuiles de carte réellement roulées),
// et le modèle de données n'a aucune notion d'utilisateur avant une future
// authentification multi-compte — donc pas de « mes » tuiles explorées,
// une seule vue globale à l'instance. La « tuile » ici est une édition déjà
// importée, colorée selon combien de ses étapes ont été générées. Dérivé
// entièrement des données déjà chargées par loadEditions() — aucune
// nouvelle route ni persistance, /api/editions donne déjà stage_count et
// done_count par édition.
function renderExplorerGrid(editions) {
  const box = document.getElementById('explorer-box');
  const grid = document.getElementById('explorer-grid');
  const known = editions.filter((x) => !x.is_custom && x.year).sort((a, b) => a.year - b.year);
  if (!known.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  grid.innerHTML = known.map((e) => {
    const status = e.done_count >= e.stage_count && e.stage_count > 0
      ? 'complete'
      : e.done_count > 0 ? 'partial' : 'unexplored';
    const title = status === 'complete'
      ? `${e.year} : toutes les étapes générées (${e.done_count}/${e.stage_count})`
      : status === 'partial'
        ? `${e.year} : ${e.done_count}/${e.stage_count} étapes générées`
        : `${e.year} : importée, aucune étape générée`;
    // Le statut ne doit pas reposer sur la seule couleur (daltonisme, ou
    // survol au clavier/tactile qui n'affiche pas le title) — glyphe
    // visible directement sur la tuile, même esprit que ✓/⚠/✗ sur
    // .checks .st ailleurs dans l'app. Trouvaille de revue-personas.
    const glyph = status === 'complete' ? '✓' : status === 'partial' ? '½' : '';
    return `<button type="button" class="explorer-tile explorer-tile-${status}" data-explorer-year="${e.year}" title="${EF.esc(title)}">${glyph ? `<span class="explorer-tile-glyph">${glyph}</span> ` : ''}${e.year}</button>`;
  }).join('');
  grid.querySelectorAll('[data-explorer-year]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const edition = known.find((e) => String(e.year) === btn.dataset.explorerYear);
      if (!edition) return;
      // Le filtre « entièrement sourcé » peut avoir retiré le <details> de
      // cette édition du DOM alors que sa tuile reste affichée (la grille
      // liste toutes les éditions importées, indépendamment du filtre) —
      // trouvaille de relecture adverse : le clic ne faisait alors
      // silencieusement rien. Décocher le filtre et recharger si besoin
      // avant de chercher la cible.
      const sourcedOnlyBox = document.getElementById('f-sourced-only');
      if (sourcedOnlyBox.checked) {
        sourcedOnlyBox.checked = false;
        await loadEditions(); // sérialisé (voir loadEditions) — jamais deux rechargements concurrents
      }
      // La cible peut ne pas encore exister au moment précis où ce clic
      // s'exécute (rechargement d'une autre origine encore en cours,
      // désormais sérialisé mais pas instantané) — quelques tentatives
      // courtes plutôt qu'un clic mort au premier essai raté (trouvaille
      // de relecture adverse, 3e tour : la fenêtre existe même sans
      // action de ce clic-ci, dès que #editions est en cours de
      // reconstruction par un autre appelant de loadEditions()).
      for (let i = 0; i < 10; i++) {
        const target = document.querySelector(`#editions details[data-ed="${edition.id}"]`);
        if (target) {
          target.open = true;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    })
  );
}

// loadEditions() a plusieurs points d'entrée indépendants qui ne se
// coordonnaient pas (chargement initial, sondage de progression, filtre
// sourced-only, clic sur une tuile explorateur, génération en lot) —
// chacun fait son propre `#editions.innerHTML = ''` puis reconstruit par
// appendChild : deux exécutions concurrentes se marchent dessus et
// produisent un DOM incohérent (éditions dupliquées ou manquantes),
// trouvaille de relecture adverse (3e tour, reproduit deux fois avec des
// résultats différents). Une chaîne de promesses sérialise tous les
// appels — chacun attend son tour puis s'exécute avec les données/coches
// à jour au moment où il démarre, jamais en parallèle d'un autre.
let editionsLoadChain = Promise.resolve();
function loadEditions() {
  editionsLoadChain = editionsLoadChain.then(runLoadEditions, runLoadEditions);
  return editionsLoadChain;
}

async function runLoadEditions() {
  const editions = await EF.api('/api/editions');
  const box = document.getElementById('editions');
  const sourcedOnly = document.getElementById('f-sourced-only').checked;
  const openStates = {};
  box.querySelectorAll('details').forEach((d) => (openStates[d.dataset.ed] = d.open));
  box.innerHTML = '';
  renderExplorerGrid(editions);
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
        <div class="scrollx">
          <table class="stage-list">
            <thead><tr><th>Étape</th><th>Date</th><th>Type</th><th>Dist. officielle</th><th>Reconstitution</th><th>État</th><th></th></tr></thead>
            <tbody>${full.stages.map(stageRow).join('')}</tbody>
          </table>
        </div>
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
  // Pas de .catch() ici plantait silencieusement (rejet de promesse non
  // géré) en mode EF_STATIC, où /api/editions/highlights n'a pas
  // d'équivalent statique — la grille de vignettes restait juste vide,
  // jamais visible en pratique donc jamais remarqué jusqu'ici.
  loadMythicGrid().catch(() => {});
  const editions = await loadEditions();
  // Première visite : proposer la démo 1903 automatiquement.
  if (!editions.some((e) => e.year === 1903)) {
    document.getElementById('import-msg').textContent =
      '1903 pas encore importé — cliquez « Importer l\'année » pour charger la démo.';
  }
  pollWhileGenerating();

  // Défi du jour (backlog #10, section D) : lien /archives.html?year=X&auto=1
  // depuis l'écran d'accueil — présélectionne et importe directement l'année
  // suggérée, même geste qu'un clic sur une vignette mythique.
  const qsYear = EF.qs('year');
  if (qsYear && EF.qs('auto') === '1') {
    document.getElementById('f-year').value = qsYear;
    importYear();
  }
});
