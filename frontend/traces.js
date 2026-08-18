'use strict';
// Écran « Mes traces » : import GPX universel + connecteur Suunto Cloud API.

async function importGpxFiles(files) {
  const msg = document.getElementById('gpx-msg');
  if (window.EF_STATIC) { msg.textContent = EF.STATIC_MSG; return; }
  for (const file of files) {
    msg.textContent = `Import de ${file.name}…`;
    try {
      const text = await file.text();
      const res = await fetch(`/api/import/gpx?name=${encodeURIComponent(file.name.replace(/\.gpx$/i, ''))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/gpx+xml' },
        body: text,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      msg.innerHTML = `✔ ${EF.esc(file.name)} importé (${json.points} points) — <a href="/stage.html?id=${json.id}">ouvrir la fiche</a>`;
    } catch (err) {
      msg.textContent = `Erreur sur ${file.name} : ${err.message}`;
      return;
    }
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
    document.getElementById('su-save').addEventListener('click', async () => {
      await EF.api('/api/suunto/config', {
        method: 'POST',
        body: {
          client_id: document.getElementById('su-id').value.trim(),
          client_secret: document.getElementById('su-secret').value.trim(),
          subscription_key: document.getElementById('su-key').value.trim(),
        },
      });
      renderSuunto();
    });
    return;
  }

  if (!st.connected) {
    box.innerHTML = `
      <p class="meta-line">Application configurée. Connectez votre compte Suunto pour lister vos sorties.</p>
      <a class="btn" href="/api/suunto/connect">Se connecter à Suunto</a>`;
    return;
  }

  box.innerHTML = `
    <p class="meta-line">Connecté${st.user ? ` en tant que <b>${EF.esc(st.user)}</b>` : ''}.
      <button id="su-refresh" class="secondary">↻ Rafraîchir</button>
      <button id="su-disconnect" class="secondary">Déconnecter</button></p>
    <div id="su-list"><p class="meta-line">chargement des sorties…</p></div>`;
  document.getElementById('su-disconnect').addEventListener('click', async () => {
    await EF.api('/api/suunto/disconnect', { method: 'POST' });
    renderSuunto();
  });
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
          const r = await EF.api('/api/suunto/import', {
            method: 'POST',
            body: { key: b.dataset.key, name: b.dataset.name || undefined },
          });
          location.href = `/stage.html?id=${r.id}`;
        } catch (err) {
          b.textContent = 'échec';
          b.title = err.message;
          alert('Import Suunto : ' + err.message);
          b.disabled = false;
        }
      })
    );
  } catch (err) {
    list.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('traces');
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('gpx-file');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => importGpxFiles([...input.files]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.background = '#f3ecd9'; });
  dz.addEventListener('dragleave', () => { dz.style.background = ''; });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.style.background = '';
    importGpxFiles([...e.dataTransfer.files].filter((f) => /\.gpx$/i.test(f.name)));
  });

  const flag = EF.qs('suunto');
  if (flag && flag !== 'ok') {
    document.getElementById('suunto-box').innerHTML = `<p class="meta-line">Connexion échouée : ${EF.esc(flag)}</p>`;
    setTimeout(renderSuunto, 2500);
  } else {
    renderSuunto();
  }
});
