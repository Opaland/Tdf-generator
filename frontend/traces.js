'use strict';
// Écran « Mes traces » : import GPX/FIT universel + connecteur Suunto Cloud API.

async function importTraceFiles(files) {
  const msg = document.getElementById('gpx-msg');
  if (window.EF_STATIC) { msg.textContent = EF.STATIC_MSG; return; }
  if (!files.length) {
    msg.textContent = 'Aucun fichier reconnu — formats acceptés : .gpx et .fit.';
    return;
  }
  // Bilan rafraîchi après coup, même si un fichier suivant échoue (revue
  // globale du 19/10/2026 : il restait à l'état d'avant l'import).
  let imported = 0;
  await importEach(files, msg, () => imported++);
  if (imported) loadSummary();
}

async function importEach(files, msg, onImported) {
  for (const file of files) {
    const isFit = /\.fit$/i.test(file.name);
    const isGpx = /\.gpx$/i.test(file.name);
    if (!isFit && !isGpx) {
      msg.textContent = `${file.name} ignoré : formats acceptés .gpx et .fit.`;
      continue;
    }
    msg.textContent = `Import de ${file.name}…`;
    try {
      let res;
      if (isFit) {
        const buf = await file.arrayBuffer();
        res = await fetch(`/api/import/fit?name=${encodeURIComponent(file.name.replace(/\.fit$/i, ''))}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
      } else {
        const text = await file.text();
        res = await fetch(`/api/import/gpx?name=${encodeURIComponent(file.name.replace(/\.gpx$/i, ''))}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/gpx+xml' },
          body: text,
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      msg.innerHTML = `✔ ${EF.esc(file.name)} importé (${json.points} points) — ` +
        `<a href="/stage.html?id=${json.id}">ouvrir la fiche</a> · ` +
        `<a href="/compare.html?a=${json.id}">⇄ comparer avec une étape officielle</a>`;
      onImported();
    } catch (err) {
      msg.textContent = `Erreur sur ${file.name} : ${err.message}`;
      return;
    }
  }
}

async function importFromLink() {
  const input = document.getElementById('link-url');
  const msg = document.getElementById('link-msg');
  if (window.EF_STATIC) { msg.textContent = EF.STATIC_MSG; return; }
  const url = input.value.trim();
  if (!url) { msg.textContent = 'Collez un lien d\'export.'; return; }
  msg.textContent = 'Import en cours…';
  try {
    // Aller-retour réseau externe (sports-tracker.com) côté serveur en plus
    // du nôtre — le délai par défaut d'EF.api() serait trop court ici.
    const json = await EF.api('/api/import/link', { method: 'POST', body: { url }, timeoutMs: 60000 });
    msg.innerHTML = `✔ Trace importée (${json.points} points) — ` +
      `<a href="/stage.html?id=${json.id}">ouvrir la fiche</a> · ` +
      `<a href="/compare.html?a=${json.id}">⇄ comparer avec une étape officielle</a>`;
    input.value = '';
    loadSummary();
  } catch (err) {
    msg.textContent = `Erreur : ${err.message}`;
  }
}

/**
 * En mode public, connecter le compte Suunto/Strava partagé est réservé aux
 * administrateurs (backend/server.js, ADMIN_ROUTES) : un membre ne voit pas
 * le lien (qui menait sinon à une page d'erreur JSON brute — relecture
 * adverse). Hors mode public, user = null : lien affiché comme avant. Sert
 * aussi au bouton « Supprimer » du matériel (DELETE /api/gear/:id, même
 * réserve admin).
 */
async function canConnectAccount() {
  const user = await EF.requireAuthOrRedirect();
  return !user || user.admin === true;
}

/**
 * Exécute l'action d'un bouton et affiche son erreur en ligne, juste après
 * lui (textContent, jamais innerHTML) — sans quoi un refus du serveur (403
 * « réservé aux administrateurs » en mode public, par exemple) restait un
 * rejet non géré, sans aucun message (relecture adverse, Epic 27.4).
 */
async function withInlineError(btn, fn) {
  btn.parentElement?.querySelector('.inline-error')?.remove();
  try {
    await fn();
  } catch (err) {
    const msg = document.createElement('span');
    msg.className = 'meta-line inline-error';
    msg.textContent = ` Erreur : ${err.message}`;
    btn.after(msg);
  }
}

async function renderSuunto() {
  const box = document.getElementById('suunto-box');
  let st;
  try {
    st = await EF.api('/api/suunto/status');
  } catch (err) {
    box.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
    return;
  }

  if (!st.configured) {
    box.innerHTML = `
      <p class="meta-line"><b>Pas indispensable :</b> l'export GPX ci-dessus donne le même résultat
        sans aucune configuration. La connexion directe ajoute seulement la liste automatique
        de vos sorties.</p>
      <p>L'API Suunto nécessite une application (gratuite) enregistrée sur
        <a href="https://apizone.suunto.com" target="_blank" rel="noopener">apizone.suunto.com</a> :
        créez un compte, enregistrez une app avec l'URL de redirection ci-dessous, souscrivez au
        produit API pour obtenir la clé d'abonnement, puis saisissez les trois valeurs ici
        (stockées uniquement dans votre base locale).
        <a href="https://github.com/Opaland/Tdf-generator/blob/main/docs/SUUNTO.md" target="_blank" rel="noopener">Guide pas-à-pas détaillé</a>.</p>
      <p class="meta-line">URL de redirection à déclarer : <code>${EF.esc(st.redirect_uri)}</code></p>
      <div class="row">
        <label class="field">Client ID<input id="su-id" autocomplete="off"></label>
        <label class="field">Client secret<input id="su-secret" type="password" autocomplete="off"></label>
        <label class="field">Clé d'abonnement (Ocp-Apim-Subscription-Key)<input id="su-key" type="password" autocomplete="off"></label>
      </div>
      <button id="su-save">Enregistrer la configuration</button>`;
    const suSave = document.getElementById('su-save');
    suSave.addEventListener('click', () => withInlineError(suSave, async () => {
      await EF.api('/api/suunto/config', {
        method: 'POST',
        body: {
          client_id: document.getElementById('su-id').value.trim(),
          client_secret: document.getElementById('su-secret').value.trim(),
          subscription_key: document.getElementById('su-key').value.trim(),
        },
      });
      renderSuunto();
    }));
    return;
  }

  if (!st.connected) {
    box.innerHTML = `
      <p class="meta-line">Application configurée. Connectez votre compte Suunto pour lister vos sorties.</p>
      ${(await canConnectAccount())
        ? '<a class="btn" href="/api/suunto/connect">Se connecter à Suunto</a>'
        : '<span class="meta-line">Connexion du compte Suunto réservée à un administrateur de cette instance.</span>'}`;
    return;
  }

  box.innerHTML = `
    <p class="meta-line">Connecté${st.user ? ` en tant que <b>${EF.esc(st.user)}</b>` : ''}.
      <button id="su-refresh" class="secondary">↻ Rafraîchir</button>
      <button id="su-disconnect" class="secondary">Déconnecter</button></p>
    <div id="su-list"><p class="meta-line">chargement des sorties…</p></div>`;
  const suDisc = document.getElementById('su-disconnect');
  suDisc.addEventListener('click', () => withInlineError(suDisc, async () => {
    await EF.api('/api/suunto/disconnect', { method: 'POST' });
    renderSuunto();
  }));
  document.getElementById('su-refresh').addEventListener('click', renderSuunto);

  const list = document.getElementById('su-list');
  try {
    const workouts = await EF.api('/api/suunto/workouts?limit=50');
    if (!workouts.length) {
      list.innerHTML = '<p class="meta-line">Aucune sortie trouvée.</p>';
      return;
    }
    list.innerHTML = `<table class="stats"><thead><tr>
        <th>Date</th><th>Nom</th><th>Distance</th><th>D+</th><th></th>
      </tr></thead><tbody>` +
      workouts.map((w, i) => `<tr>
        <td>${w.startTime ? new Date(w.startTime).toLocaleDateString('fr-FR') : '—'}</td>
        <td>${EF.esc(w.name || 'Sortie ' + (i + 1))}</td>
        <td>${w.distance_m ? (w.distance_m / 1000).toFixed(1) + ' km' : '—'}</td>
        <td>${w.ascent_m ? Math.round(w.ascent_m) + ' m' : '—'}</td>
        <td><button data-key="${EF.esc(String(w.key))}" data-name="${EF.esc(w.name || '')}">Importer</button></td>
      </tr>`).join('') + '</tbody></table>';
    list.querySelectorAll('button[data-key]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'import…';
        try {
          // Même famille que l'import par lien ci-dessus (aller-retour
          // réseau externe côté serveur — rafraîchissement de jeton OAuth
          // puis téléchargement du fichier FIT depuis cloudapi.suunto.com) :
          // même délai étendu (trouvaille de relecture adverse).
          const r = await EF.api('/api/suunto/import', {
            method: 'POST',
            body: { key: b.dataset.key, name: b.dataset.name || undefined },
            timeoutMs: 60000,
          });
          location.href = `/stage.html?id=${r.id}`;
        } catch (err) {
          // Message affiché en ligne (pas d'alert() natif) : sous le bouton
          // de la sortie concernée, cohérent avec le reste de l'écran.
          b.textContent = 'échec';
          b.title = err.message;
          b.disabled = false;
          let msg = b.nextElementSibling;
          if (!msg || !msg.classList.contains('err-msg')) {
            msg = document.createElement('span');
            msg.className = 'err-msg meta-line';
            msg.style.cssText = 'display:block;margin:4px 0 0';
            b.after(msg);
          }
          msg.textContent = 'Erreur : ' + err.message;
        }
      })
    );
  } catch (err) {
    list.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
  }
}

/** '2026-03-09' → lundi de sa semaine ISO, même format — clé de regroupement. */
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dowMonday0 = (d.getUTCDay() + 6) % 7; // getUTCDay() : 0=dimanche → ramené à 0=lundi
  d.setUTCDate(d.getUTCDate() - dowMonday0);
  return d.toISOString().slice(0, 10);
}

function formatPeriodLabel(period, key) {
  if (period === 'day') return new Date(key + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  if (period === 'week') return `sem. du ${new Date(key + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`;
  if (period === 'month') {
    const [y, m] = key.split('-');
    return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return key;
}

function formatDuration(s) {
  if (s == null) return null;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/**
 * Records personnels (jour/semaine/mois/année) façon VeloViewer, calculés
 * côté client à partir de `daily` ({date, distanceKm, ascentM, elapsedTimeS})
 * — le backend fournit l'agrégat brut par jour, jamais les records eux-mêmes
 * (logique d'affichage, pas de donnée nouvelle à cacher côté serveur).
 * Le temps n'est agrégé qu'à partir des jours où il est connu (elapsedTimeS
 * != null) : un bucket sans aucune trace horodatée reste `null`, jamais 0.
 */
function computeAwards(daily) {
  const periods = ['day', 'week', 'month', 'year'];
  const buckets = { day: new Map(), week: new Map(), month: new Map(), year: new Map() };
  for (const d of daily) {
    const keys = { day: d.date, week: isoWeekKey(d.date), month: d.date.slice(0, 7), year: d.date.slice(0, 4) };
    for (const period of periods) {
      const key = keys[period];
      const b = buckets[period].get(key) || { key, distanceKm: 0, ascentM: 0, elapsedTimeS: null };
      b.distanceKm += d.distanceKm;
      b.ascentM += d.ascentM;
      if (d.elapsedTimeS != null) b.elapsedTimeS = (b.elapsedTimeS || 0) + d.elapsedTimeS;
      buckets[period].set(key, b);
    }
  }
  const best = {};
  for (const period of periods) {
    const vals = [...buckets[period].values()];
    best[period] = {
      distance: vals.reduce((m, b) => (!m || b.distanceKm > m.distanceKm ? b : m), null),
      ascent: vals.reduce((m, b) => (!m || b.ascentM > m.ascentM ? b : m), null),
      time: vals.filter((b) => b.elapsedTimeS != null).reduce((m, b) => (!m || b.elapsedTimeS > m.elapsedTimeS ? b : m), null),
    };
  }
  return best;
}

function renderAwards(daily) {
  const tbody = document.querySelector('#summary-awards tbody');
  if (!daily.length) { tbody.innerHTML = ''; return; }
  const best = computeAwards(daily);
  const periods = ['day', 'week', 'month', 'year'];
  const rows = [
    { label: 'Distance', metric: 'distance', fmt: (b) => `${Math.round(b.distanceKm * 10) / 10} km` },
    { label: 'D+', metric: 'ascent', fmt: (b) => `${Math.round(b.ascentM)} m` },
    { label: 'Temps', metric: 'time', fmt: (b) => formatDuration(b.elapsedTimeS) },
  ];
  tbody.innerHTML = rows.map((row) => {
    const cells = periods.map((period) => {
      const b = best[period][row.metric];
      if (!b) return '<td class="meta-line">—</td>';
      const val = row.fmt(b);
      if (val == null) return '<td class="meta-line">n/d</td>';
      return `<td>${EF.esc(val)}<br><span class="meta-line">${EF.esc(formatPeriodLabel(period, b.key))}</span></td>`;
    }).join('');
    return `<tr><td>${row.label}</td>${cells}</tr>`;
  }).join('');
}

/** Graphique en aire : distance cumulée jour après jour (une seule série de
 * magnitude → même paire silhouette/trait que le profil altimétrique,
 * frontend/profile.js, pour rester cohérent avec la palette déjà en place). */
function buildCumulativeChart(daily, W, H) {
  if (daily.length < 2) return '<p class="meta-line">Pas assez de sorties datées pour un graphique.</p>';
  const M = { l: 44, r: 12, t: 10, b: 22 };
  let cum = 0;
  const pts = daily.map((d) => { cum += d.distanceKm; return { date: d.date, cum }; });
  const total = pts[pts.length - 1].cum;
  // Trouvaille de relecture adverse (18/09/2026) : sans ce garde, un total
  // cumulé nul (traces dégénérées arrondies à 0,0 km) divise par zéro dans
  // y(v) ci-dessous — v/0 vaut NaN, injecté tel quel dans les coordonnées
  // du path SVG (silencieux, aucune exception JS). Même risque que maxV
  // dans buildWeeklyBarChart, gardé juste en dessous par Math.max(…, 1).
  if (total <= 0) return '<p class="meta-line">Distance cumulée nulle sur la période — rien à représenter.</p>';
  const x = (i) => M.l + (i / (pts.length - 1)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - v / total) * (H - M.t - M.b);
  let path = `M ${x(0).toFixed(1)} ${y(pts[0].cum).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) path += ` L ${x(i).toFixed(1)} ${y(pts[i].cum).toFixed(1)}`;
  const area = `${path} L ${x(pts.length - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  let grid = '';
  const step = total > 3000 ? 1000 : total > 600 ? 200 : 50;
  for (let v = 0; v <= total; v += step) {
    grid += `<line x1="${M.l}" y1="${y(v).toFixed(1)}" x2="${W - M.r}" y2="${y(v).toFixed(1)}" stroke="#d8cdb4" stroke-width="0.6" stroke-dasharray="3 4"/>` +
      `<text x="${M.l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7a58">${v}</text>`;
  }
  const startLabel = new Date(pts[0].date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  const endLabel = new Date(pts[pts.length - 1].date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distance cumulée du ${EF.esc(startLabel)} au ${EF.esc(endLabel)} : ${Math.round(total)} km">
    ${grid}
    <path d="${area}" fill="#ead9b0" stroke="none"/>
    <path d="${path}" fill="none" stroke="#7a5c2e" stroke-width="2"/>
    <text x="${M.l}" y="${H - 4}" font-size="10" fill="#8a7a58">${EF.esc(startLabel)}</text>
    <text x="${W - M.r}" y="${H - 4}" text-anchor="end" font-size="10" fill="#8a7a58">${EF.esc(endLabel)}</text>
  </svg>`;
}

/** Barres : distance par semaine ISO (semaines sans sortie incluses à 0,
 * pour que l'espacement horizontal reflète le temps réel écoulé). */
function buildWeeklyBarChart(daily, W, H) {
  if (!daily.length) return '<p class="meta-line">Aucune sortie datée.</p>';
  const byWeek = new Map();
  for (const d of daily) {
    const wk = isoWeekKey(d.date);
    byWeek.set(wk, (byWeek.get(wk) || 0) + d.distanceKm);
  }
  const weeks = [...byWeek.keys()].sort();
  const firstMs = new Date(weeks[0] + 'T00:00:00Z').getTime();
  const lastMs = new Date(weeks[weeks.length - 1] + 'T00:00:00Z').getTime();
  const weekMs = 7 * 86400000;
  const n = Math.round((lastMs - firstMs) / weekMs) + 1;
  const values = Array.from({ length: n }, (_, i) => {
    const key = new Date(firstMs + i * weekMs).toISOString().slice(0, 10);
    return { key, v: byWeek.get(key) || 0 };
  });
  const M = { l: 44, r: 12, t: 10, b: 22 };
  const maxV = Math.max(...values.map((v) => v.v), 1);
  const gap = 2;
  const slot = (W - M.l - M.r) / n;
  // Largeur plafonnée : une seule semaine remplissait tout le graphique d'un
  // rectangle plein (revue globale du 19/10/2026).
  const barW = Math.min(48, Math.max(2, slot - gap));
  const y0 = H - M.b;
  const y = (v) => M.t + (1 - v / maxV) * (y0 - M.t);
  let grid = '';
  const step = maxV > 300 ? 100 : maxV > 60 ? 20 : 5;
  for (let v = 0; v <= maxV; v += step) {
    grid += `<line x1="${M.l}" y1="${y(v).toFixed(1)}" x2="${W - M.r}" y2="${y(v).toFixed(1)}" stroke="#d8cdb4" stroke-width="0.6" stroke-dasharray="3 4"/>` +
      `<text x="${M.l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7a58">${Math.round(v)}</text>`;
  }
  let bars = '';
  values.forEach((w, i) => {
    if (w.v <= 0) return;
    const xx = M.l + i * slot + (slot - barW) / 2;
    const label = `sem. du ${new Date(w.key + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })} : ${Math.round(w.v * 10) / 10} km`;
    bars += `<rect x="${xx.toFixed(1)}" y="${y(w.v).toFixed(1)}" width="${barW.toFixed(1)}" height="${(y0 - y(w.v)).toFixed(1)}" rx="2" fill="#ead9b0" stroke="#7a5c2e" stroke-width="1"><title>${EF.esc(label)}</title></rect>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distance par semaine ISO, de ${values[0].key} à ${values[values.length - 1].key}">
    ${grid}${bars}
  </svg>`;
}

/** Couleur d'une case de la heatmap : même paire silhouette/trait que les
 * autres graphiques de ce fichier (#ead9b0 clair → #7a5c2e foncé),
 * interpolée sur 4 niveaux d'intensité (1 = faible, 4 = fort) — jamais un
 * nouvel indice de couleur pour rester cohérent avec la charte déjà en
 * place. Niveau 0 (aucune sortie) : un gris neutre clairement distinct des
 * niveaux actifs, pas juste le niveau 1 le plus pâle (GitHub distingue de
 * la même façon "aucune contribution" du niveau d'activité le plus bas). */
function heatmapColor(level) {
  if (level <= 0) return '#ece7d8';
  const light = [0xea, 0xd9, 0xb0];
  const dark = [0x7a, 0x5c, 0x2e];
  const t = Math.min(1, level / 4);
  const rgb = light.map((c, i) => Math.round(c + (dark[i] - c) * t));
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Heatmap calendaire façon GitHub (backlog #228, phase « Exploration ») :
 * une case par jour, semaines en colonnes (lundi en haut, dimanche en bas —
 * même convention ISO que isoWeekKey ci-dessus), intensité = distance du
 * jour relative au jour le plus actif de la période affichée (jamais une
 * échelle absolue en km, qui n'aurait aucun sens comparée d'un utilisateur
 * à l'autre). `today` injectable (tests) — par défaut la date réelle, pour
 * que la fenêtre affichée se termine toujours sur la semaine en cours,
 * comme GitHub.
 */
function buildCalendarHeatmap(daily, { weeks = 52, today = new Date() } = {}) {
  const byDate = new Map(daily.map((d) => [d.date, d.distanceKm]));
  const maxDistance = Math.max(0, ...daily.map((d) => d.distanceKm));
  const todayKey = today.toISOString().slice(0, 10);
  const mondayOfCurrentWeek = new Date(isoWeekKey(todayKey) + 'T00:00:00Z');
  const startMonday = new Date(mondayOfCurrentWeek.getTime() - (weeks - 1) * 7 * 86400000);

  const cell = 11;
  const gap = 3;
  const step = cell + gap;
  const M = { l: 4, t: 16, r: 4, b: 4 };
  const W = M.l + weeks * step - gap + M.r;
  const H = M.t + 7 * step - gap + M.b;

  let cells = '';
  let labels = '';
  let lastMonth = null;
  for (let w = 0; w < weeks; w++) {
    const colStart = new Date(startMonday.getTime() + w * 7 * 86400000);
    const month = colStart.getUTCMonth();
    if (month !== lastMonth) {
      labels += `<text x="${M.l + w * step}" y="${M.t - 5}" font-size="9" fill="#8a7a58">${EF.esc(colStart.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }))}</text>`;
      lastMonth = month;
    }
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart.getTime() + d * 86400000);
      const dateKey = day.toISOString().slice(0, 10);
      if (day > today) continue; // jamais de case pour un jour futur
      const distanceKm = byDate.get(dateKey) || 0;
      const level = distanceKm > 0 && maxDistance > 0 ? Math.max(1, Math.ceil((distanceKm / maxDistance) * 4)) : 0;
      const label = `${EF.esc(new Date(dateKey + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' }))} : ${distanceKm > 0 ? Math.round(distanceKm * 10) / 10 + ' km' : 'aucune sortie'}`;
      cells += `<rect x="${M.l + w * step}" y="${M.t + d * step}" width="${cell}" height="${cell}" rx="2" fill="${heatmapColor(level)}"><title>${label}</title></rect>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calendrier des sorties, ${weeks} dernières semaines">${labels}${cells}</svg>`;
}

// Bilan personnel façon VeloViewer (backlog #228, phase fondations) : agrège
// les traces déjà importées (GPX/lien/Suunto) — tuiles stats, records
// jour/semaine/mois/année, distance cumulée, distance/semaine, cols gravis,
// sorties récentes. Non essentiel : n'affiche rien si aucune trace n'est
// encore importée, plutôt qu'un bilan vide qui aurait l'air cassé.

async function renderStrava() {
  const box = document.getElementById('strava-box');
  let st;
  try {
    st = await EF.api('/api/strava/status');
  } catch (err) {
    box.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
    return;
  }

  if (!st.configured) {
    box.innerHTML = `
      <p class="meta-line"><b>Pas indispensable :</b> l'export GPX ci-dessus donne le même résultat
        sans aucune configuration. La connexion directe ajoute seulement la liste automatique
        de vos sorties.</p>
      <p>L'API Strava nécessite une application (gratuite) enregistrée sur
        <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> :
        déclarez l'URL de rappel ci-dessous, puis saisissez le Client ID et le Client Secret ici
        (stockés uniquement dans votre base locale).
        <a href="https://github.com/Opaland/Tdf-generator/blob/main/docs/STRAVA.md" target="_blank" rel="noopener">Guide pas-à-pas détaillé</a>.</p>
      <p class="meta-line">URL de rappel (« Authorization Callback Domain ») à déclarer : <code>${EF.esc(st.redirect_uri)}</code></p>
      <div class="row">
        <label class="field">Client ID<input id="st-id" autocomplete="off"></label>
        <label class="field">Client secret<input id="st-secret" type="password" autocomplete="off"></label>
      </div>
      <button id="st-save">Enregistrer la configuration</button>`;
    const stSave = document.getElementById('st-save');
    stSave.addEventListener('click', () => withInlineError(stSave, async () => {
      await EF.api('/api/strava/config', {
        method: 'POST',
        body: {
          client_id: document.getElementById('st-id').value.trim(),
          client_secret: document.getElementById('st-secret').value.trim(),
        },
      });
      renderStrava();
    }));
    return;
  }

  if (!st.connected) {
    box.innerHTML = `
      <p class="meta-line">Application configurée. Connectez votre compte Strava pour lister vos sorties.</p>
      ${(await canConnectAccount())
        ? '<a class="btn" href="/api/strava/connect">Se connecter à Strava</a>'
        : '<span class="meta-line">Connexion du compte Strava réservée à un administrateur de cette instance.</span>'}`;
    return;
  }

  box.innerHTML = `
    <p class="meta-line">Connecté${st.user ? ` en tant que <b>${EF.esc(st.user)}</b>` : ''}.
      <button id="st-refresh" class="secondary">↻ Rafraîchir</button>
      <button id="st-disconnect" class="secondary">Déconnecter</button></p>
    <div id="st-list"><p class="meta-line">chargement des sorties…</p></div>`;
  const stDisc = document.getElementById('st-disconnect');
  stDisc.addEventListener('click', () => withInlineError(stDisc, async () => {
    await EF.api('/api/strava/disconnect', { method: 'POST' });
    renderStrava();
  }));
  document.getElementById('st-refresh').addEventListener('click', renderStrava);

  const list = document.getElementById('st-list');
  try {
    const activities = await EF.api('/api/strava/activities?limit=50');
    if (!activities.length) {
      list.innerHTML = '<p class="meta-line">Aucune sortie trouvée.</p>';
      return;
    }
    list.innerHTML = `<table class="stats"><thead><tr>
        <th>Date</th><th>Nom</th><th>Distance</th><th>D+</th><th></th>
      </tr></thead><tbody>` +
      activities.map((a, i) => `<tr>
        <td>${a.startDate ? new Date(a.startDate).toLocaleDateString('fr-FR') : '—'}</td>
        <td>${EF.esc(a.name || 'Sortie ' + (i + 1))}</td>
        <td>${a.distance_m ? (a.distance_m / 1000).toFixed(1) + ' km' : '—'}</td>
        <td>${a.ascent_m ? Math.round(a.ascent_m) + ' m' : '—'}</td>
        <td><button data-id="${EF.esc(String(a.id))}" data-name="${EF.esc(a.name || '')}">Importer</button></td>
      </tr>`).join('') + '</tbody></table>';
    list.querySelectorAll('button[data-id]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'import…';
        try {
          // Même famille que l'import Suunto ci-dessus (aller-retour réseau
          // externe côté serveur — rafraîchissement de jeton OAuth puis
          // téléchargement des flux depuis l'API Strava) : même délai étendu.
          const r = await EF.api('/api/strava/import', {
            method: 'POST',
            body: { id: b.dataset.id, name: b.dataset.name || undefined },
            timeoutMs: 60000,
          });
          location.href = `/stage.html?id=${r.id}`;
        } catch (err) {
          b.textContent = 'échec';
          b.title = err.message;
          b.disabled = false;
          let msg = b.nextElementSibling;
          if (!msg || !msg.classList.contains('err-msg')) {
            msg = document.createElement('span');
            msg.className = 'err-msg meta-line';
            msg.style.cssText = 'display:block;margin:4px 0 0';
            b.after(msg);
          }
          msg.textContent = 'Erreur : ' + err.message;
        }
      })
    );
  } catch (err) {
    list.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- matériel (issue #228, phase 7)

const GEAR_KIND_LABELS = { velo: 'Vélo', chaussures: 'Chaussures', autre: 'Autre' };

/** Lignes du tableau Matériel. Tout texte venu de l'API passe par EF.esc ;
 * les identifiants sont des entiers (Number() avant interpolation). */
function buildGearRows(gear, { canDelete = false } = {}) {
  if (!gear.length) {
    return '<tr><td colspan="6" class="meta-line">Aucun matériel : ajoutez-en un ci-dessous, puis choisissez-le pour chaque sortie.</td></tr>';
  }
  return gear.map((g) => {
    const id = Number(g.id);
    const kind = GEAR_KIND_LABELS[g.kind] || g.kind;
    // Durée : null tant qu'aucune sortie n'est horodatée — « — », jamais 0 h.
    let duration = '—';
    if (g.elapsedTimeS != null) {
      duration = EF.esc(formatDuration(g.elapsedTimeS));
      if (g.timedCount < g.traceCount) duration += `<br><span class="meta-line">${g.timedCount} sur ${g.traceCount} horodatée${g.timedCount > 1 ? 's' : ''}</span>`;
    }
    return `<tr data-gear-id="${id}"${g.retired ? ' class="gear-retired"' : ''}>
        <td class="gear-name"><b>${EF.esc(g.name)}</b><br><span class="meta-line">${EF.esc(kind)}${g.retired ? ' · retiré' : ''}</span></td>
        <td>${Number(g.traceCount)}</td>
        <td>${Number(g.distanceKm)} km</td>
        <td>${Number(g.ascentM)} m</td>
        <td>${duration}</td>
        <td class="gear-actions">
          <button type="button" class="secondary" data-gear-action="rename">Renommer</button>
          <button type="button" class="secondary" data-gear-action="${g.retired ? 'unretire' : 'retire'}">${g.retired ? 'Remettre en service' : 'Retirer'}</button>
          ${canDelete ? '<button type="button" class="danger" data-gear-action="delete">Supprimer</button>' : ''}
        </td>
      </tr>`;
  }).join('');
}

/** Liste de choix du matériel d'une sortie : matériel en service, plus celui
 * déjà associé même s'il a été retiré depuis (sinon la sortie paraîtrait
 * sans matériel). */
function buildGearSelect(gear, traceId, selectedId) {
  const options = gear
    .filter((g) => !g.retired || g.id === selectedId)
    .map((g) => `<option value="${Number(g.id)}"${g.id === selectedId ? ' selected' : ''}>${EF.esc(g.name)}${g.retired ? ' (retiré)' : ''}</option>`)
    .join('');
  return `<select data-trace-id="${Number(traceId)}" aria-label="Matériel de la sortie"><option value=""${selectedId == null ? ' selected' : ''}>—</option>${options}</select>`;
}

let currentGear = [];

async function gearAction(btn) {
  const row = btn.closest('tr[data-gear-id]');
  const id = Number(row.dataset.gearId);
  const action = btn.dataset.gearAction;
  if (action === 'rename') {
    // Champ en place (pas de prompt() natif : test/noNativeDialogs.test.js).
    const cell = row.querySelector('.gear-name');
    const g = currentGear.find((x) => x.id === id);
    cell.innerHTML = '<input maxlength="80" aria-label="Nouveau nom"> <button type="button" data-gear-action="save">OK</button>';
    const input = cell.querySelector('input');
    input.value = g ? g.name : '';
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') cell.querySelector('button').click(); });
    return;
  }
  if (action === 'delete' && btn.dataset.confirm !== '1') {
    // Deux temps plutôt qu'un confirm() natif ; les sorties sont détachées, jamais supprimées.
    btn.dataset.confirm = '1';
    btn.textContent = 'Confirmer (les sorties sont conservées)';
    return;
  }
  await withInlineError(btn, async () => {
    if (action === 'save') {
      await EF.api(`/api/gear/${id}`, { method: 'PUT', body: { name: row.querySelector('.gear-name input').value } });
    } else if (action === 'retire' || action === 'unretire') {
      await EF.api(`/api/gear/${id}`, { method: 'PUT', body: { retired: action === 'retire' } });
    } else if (action === 'delete') {
      await EF.api(`/api/gear/${id}`, { method: 'DELETE' });
    }
    await loadSummary();
  });
}

async function addGear(e) {
  e.preventDefault();
  const msg = document.getElementById('gear-msg');
  msg.textContent = '';
  try {
    await EF.api('/api/gear', {
      method: 'POST',
      body: { name: document.getElementById('gear-name').value, kind: document.getElementById('gear-kind').value },
    });
    document.getElementById('gear-name').value = '';
    await loadSummary();
  } catch (err) {
    msg.textContent = `Erreur : ${err.message}`;
  }
}

async function setTraceGear(select) {
  select.parentElement.querySelector('.inline-error')?.remove();
  try {
    await EF.api(`/api/traces/${Number(select.dataset.traceId)}/gear`, {
      method: 'PUT',
      body: { gearId: select.value === '' ? null : Number(select.value) },
    });
    await loadSummary();
  } catch (err) {
    const m = document.createElement('span');
    m.className = 'meta-line inline-error';
    m.textContent = ` Erreur : ${err.message}`;
    select.after(m);
  }
}

/** Section Matériel : carte à part du bilan, visible même avant la première
 * trace importée (on déclare son vélo d'abord). `traces` = toutes les
 * traces terminées (GET /api/gear/traces), pas seulement les 20 récentes. */
function renderGear(g, all, canDelete) {
  document.getElementById('gear-section').style.display = 'block';
  const tbody = document.querySelector('#gear-table tbody');
  const form = document.getElementById('gear-add');
  if (!g) {
    tbody.innerHTML = '<tr><td colspan="6" class="meta-line">Matériel indisponible (erreur serveur) — rechargez la page.</td></tr>';
    form.style.display = 'none';
    document.getElementById('gear-all').style.display = 'none';
    return;
  }
  form.style.display = '';
  tbody.innerHTML = buildGearRows(currentGear, { canDelete });
  const details = document.getElementById('gear-all');
  if (!all || !all.traces.length || !currentGear.length) {
    details.style.display = 'none';
    return;
  }
  details.style.display = '';
  document.getElementById('gear-all-summary').textContent =
    `Toutes les sorties (${all.traces.length})${all.unassignedCount ? ` — ${all.unassignedCount} sans matériel, non comptée${all.unassignedCount > 1 ? 's' : ''} ci-dessus` : ''}`;
  document.querySelector('#gear-all-table tbody').innerHTML = all.traces.map((t) => `<tr>
      <td>${t.date ? EF.esc(new Date(t.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })) : '—'}</td>
      <td><a href="/stage.html?id=${Number(t.id)}">${EF.esc(t.name)}</a></td>
      <td>${Number(t.distanceKm)} km</td>
      <td>${buildGearSelect(currentGear, t.id, t.gearId ?? null)}</td>
    </tr>`).join('');
}

// Chaque action relance un rafraîchissement complet : seule la réponse du
// dernier lancé est rendue, sinon une réponse lente plus ancienne écrasait
// un état plus récent (relecture adverse, Epic 29).
let refreshSeq = 0;
// Droit de supprimer un matériel : calculé une fois, un échec vaut « non » —
// le bilan ne dépend plus de /api/auth/me (relecture adverse).
let canDeleteGearP = null;

// ---------------------------------------------------------------- temps par côte (Epic 31.3)

const EFFORT_REASONS = {
  pied: 'ne passe pas par le pied de référence, ou pas sur la même longueur (autre versant, départ plus haut)',
  sommet: 'sommet trop éloigné du sommet de référence',
  'sans-temps': 'trace sans horodatage exploitable — réimportez-la pour obtenir le temps',
};

/** Liste « Temps par côte » : un élément par côte, passages dans un
 * <details> (liste plutôt que tableau : lisible à 360 px). Tout texte venu de
 * l'API passe par EF.esc. */
function buildEffortRows(climbs) {
  return climbs.map((c) => {
    const title = `<b>${EF.esc(c.name || 'Côte sans nom')}</b><br><span class="meta-line">` +
      `${c.category ? `cat. ${EF.esc(c.category)} · ` : ''}${c.summitEleM != null ? `${Math.round(c.summitEleM)} m · ` : ''}réf. ${Number(c.refLengthKm)} km</span>`;
    const items = c.passages.map((p) => {
      const date = p.date ? EF.esc(new Date(p.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })) : 'date inconnue';
      const val = p.timeS != null
        ? `<b>${EF.esc(formatDuration(p.timeS))}</b>${p.timeS === c.bestTimeS ? ' ★' : ''}`
        : `<span class="meta-line">${EF.esc(EFFORT_REASONS[p.reason] || 'pas de temps')}</span>`;
      const nth = p.ascent > 1 ? ` (${Number(p.ascent)}ᵉ montée)` : '';
      return `<li>${date} — <a href="/stage.html?id=${Number(p.stageId)}">${EF.esc(p.stageName)}</a>${nth} : ${val}</li>`;
    }).join('');
    const label = `${c.count} passage${c.count > 1 ? 's' : ''}${c.timedCount < c.count ? ` (${c.timedCount} chronométré${c.timedCount > 1 ? 's' : ''})` : ''}`;
    const best = c.bestTimeS != null ? ` — meilleur temps <b>${EF.esc(formatDuration(c.bestTimeS))}</b>` : '';
    return `<li class="fauxplat-item">${title}${best}` +
      `<details><summary>${label}</summary><ul>${items}</ul></details></li>`;
  }).join('');
}

function renderEfforts(data) {
  const box = document.getElementById('efforts-box');
  if (!data || !data.climbs.length) { box.style.display = 'none'; return; }
  document.getElementById('efforts-list').innerHTML = buildEffortRows(data.climbs);
  box.style.display = '';
}

async function loadSummary() {
  if (window.EF_STATIC) return;
  const seq = ++refreshSeq;
  canDeleteGearP ??= canConnectAccount().catch(() => false);
  // Non bloquants entre eux : un échec n'empêche pas le reste de s'afficher.
  const [s, g, all, canDelete, efforts] = await Promise.all([
    EF.api('/api/traces/summary').catch(() => null),
    EF.api('/api/gear').catch(() => null),
    EF.api('/api/gear/traces').catch(() => null),
    canDeleteGearP,
    EF.api('/api/traces/climb-efforts').catch(() => null),
  ]);
  if (seq !== refreshSeq) return;
  currentGear = g ? g.gear : [];
  renderGear(g, all, canDelete);
  try {
    renderEfforts(efforts);
  } catch {
    document.getElementById('efforts-box').style.display = 'none'; // non essentiel
  }
  const box = document.getElementById('summary-box');
  try {
    if (!s || !s.traceCount) return;

    const tiles = [
      { v: s.traceCount, l: `sortie${s.traceCount > 1 ? 's' : ''} importée${s.traceCount > 1 ? 's' : ''}` },
      { v: `${s.totalDistanceKm} km`, l: 'distance totale' },
      { v: `${s.totalAscentM} m`, l: 'D+ cumulé' },
    ];
    if (s.tracesWithTimeCount > 0) {
      tiles.push({ v: formatDuration(s.totalElapsedTimeS), l: `temps cumulé (${s.tracesWithTimeCount} sortie${s.tracesWithTimeCount > 1 ? 's' : ''} horodatée${s.tracesWithTimeCount > 1 ? 's' : ''})` });
    }
    if (s.highestSummit) tiles.push({ v: `${s.highestSummit.summit_ele_m} m`, l: `plus haut sommet — ${s.highestSummit.name}` });
    document.getElementById('summary-tiles').innerHTML = tiles
      .map((t) => `<div class="stat"><div class="v">${EF.esc(String(t.v))}</div><div class="l">${EF.esc(t.l)}</div></div>`)
      .join('');

    renderAwards(s.daily);

    const chartW = Math.max(320, Math.min(900, (document.getElementById('summary-chart-cumul').clientWidth || 700)));
    document.getElementById('summary-chart-cumul').innerHTML = buildCumulativeChart(s.daily, chartW, 160);
    document.getElementById('summary-chart-weekly').innerHTML = buildWeeklyBarChart(s.daily, chartW, 160);

    const exploration = s.exploration || { countries: [], regions: [], cities: [] };
    const explorationTiles = [
      { v: exploration.countries.length, l: `pays visité${exploration.countries.length > 1 ? 's' : ''}` },
      { v: exploration.regions.length, l: `région${exploration.regions.length > 1 ? 's' : ''} visitée${exploration.regions.length > 1 ? 's' : ''}` },
      { v: exploration.cities.length, l: `ville${exploration.cities.length > 1 ? 's' : ''} visitée${exploration.cities.length > 1 ? 's' : ''}` },
    ];
    document.getElementById('summary-exploration-tiles').innerHTML = explorationTiles
      .map((t) => `<div class="stat"><div class="v">${EF.esc(String(t.v))}</div><div class="l">${EF.esc(t.l)}</div></div>`)
      .join('');
    document.getElementById('summary-heatmap').innerHTML = buildCalendarHeatmap(s.daily);
    const citiesList = document.getElementById('summary-cities');
    citiesList.innerHTML = exploration.cities
      .map((c) => `<li class="fauxplat-item">${EF.esc(c.name)}${c.count > 1 ? ` — ${c.count} sorties` : ''}</li>`)
      .join('') || '<li class="fauxplat-item meta-line">Aucune ville identifiée (géocodage indisponible au moment de l\'import).</li>';

    const list = document.getElementById('summary-climbs');
    list.innerHTML = s.climbs.map((c) => {
      const cat = c.bestCategory ? ` · cat. ${c.bestCategory}` : '';
      const times = c.count > 1 ? ` — gravi ${c.count} fois` : '';
      return `<li class="fauxplat-item">${EF.esc(c.name)} — ${c.maxSummitM} m${cat}${times}</li>`;
    }).join('') || '<li class="fauxplat-item meta-line">Aucun col détecté sur vos sorties importées.</li>';

    const recentBody = document.querySelector('#summary-recent tbody');
    recentBody.innerHTML = s.recent.map((t) => `<tr>
        <td>${t.date ? EF.esc(new Date(t.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })) : '—'}</td>
        <td><a href="/stage.html?id=${t.id}">${EF.esc(t.name)}</a></td>
        <td>${t.distanceKm} km</td>
        <td>${t.ascentM} m</td>
        <td>${t.elapsedTimeS != null ? EF.esc(formatDuration(t.elapsedTimeS)) : '—'}</td>
        <td>${g ? buildGearSelect(currentGear, t.id, t.gearId ?? null) : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="meta-line">Aucune sortie.</td></tr>';

    box.style.display = 'block';
  } catch {
    // Non essentiel : l'écran reste utilisable sans le bilan.
  }
}

// Garde typeof : les fonctions de calcul du bilan (computeAwards, buildCumulativeChart,
// buildWeeklyBarChart…) sont require()-ables côté test sans DOM — même schéma que
// archives.js/compare.js/editor.js/stage.js.
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('traces');
  loadSummary();
  document.getElementById('gear-add').addEventListener('submit', addGear);
  document.querySelector('#gear-table tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-gear-action]');
    if (btn) gearAction(btn);
  });
  for (const sel of ['#summary-recent tbody', '#gear-all-table tbody']) {
    document.querySelector(sel).addEventListener('change', (e) => {
      if (e.target.matches('select[data-trace-id]')) setTraceGear(e.target);
    });
  }
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('gpx-file');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    input.click();
  });
  input.addEventListener('change', () => importTraceFiles([...input.files]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.background = '#f3ecd9'; });
  dz.addEventListener('dragleave', () => { dz.style.background = ''; });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.style.background = '';
    importTraceFiles([...e.dataTransfer.files]);
  });

  document.getElementById('link-import').addEventListener('click', importFromLink);
  document.getElementById('link-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') importFromLink(); });

  const flag = EF.qs('suunto');
  if (flag && flag !== 'ok') {
    document.getElementById('suunto-box').innerHTML = `<p class="meta-line">Connexion échouée : ${EF.esc(flag)}</p>`;
    setTimeout(renderSuunto, 2500);
  } else {
    renderSuunto();
  }

  const stravaFlag = EF.qs('strava');
  if (stravaFlag && stravaFlag !== 'ok') {
    document.getElementById('strava-box').innerHTML = `<p class="meta-line">Connexion échouée : ${EF.esc(stravaFlag)}</p>`;
    setTimeout(renderStrava, 2500);
  } else {
    renderStrava();
  }
});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { importTraceFiles, importFromLink, isoWeekKey, formatPeriodLabel, formatDuration, computeAwards, buildCumulativeChart, buildWeeklyBarChart, buildCalendarHeatmap, heatmapColor, buildGearRows, buildGearSelect, buildEffortRows };
}
