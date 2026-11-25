'use strict';
// Page de diagnostic : script sorti de diag.html pour la CSP sans 'unsafe-inline' (story 42.2, issue #566).
async function loadQuota() {
  const tbody = document.querySelector('#quota-table tbody');
  const since = document.getElementById('quota-since');
  try {
    const d = await EF.api('/api/quota');
    since.textContent = d.since ? `Depuis le démarrage du serveur (${new Date(d.since).toLocaleString('fr-FR')}).` : '';
    tbody.innerHTML = d.usage.length
      ? d.usage.map((u) =>
          `<tr><td>${EF.esc(u.host)}</td><td>${u.count}</td>` +
          `<td>${new Date(u.firstAt).toLocaleString('fr-FR')}</td><td>${new Date(u.lastAt).toLocaleString('fr-FR')}</td></tr>`
        ).join('')
      : '<tr><td colspan="4" class="meta-line">Aucune requête réseau réelle depuis le démarrage (mode hors-ligne, ou aucune génération lancée).</td></tr>';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="meta-line">Erreur : ${EF.esc(err.message)}</td></tr>`;
  }
}

async function loadSecrets() {
  const ul = document.getElementById('secrets-list');
  const NAMES = { client_secret: 'secret client', subscription_key: 'clé d\'abonnement' };
  const WHERE = { env: 'variable d\'environnement', db: 'base SQLite, en clair', 'db-chiffre': 'base SQLite, chiffré (ETAPEFORGE_SECRET_KEY)',
    'db-illisible': 'base SQLite, chiffré mais ILLISIBLE (clé absente ou changée) — reconfigurer ce connecteur', absent: 'non configuré' };
  try {
    const d = await EF.api('/api/secrets/status');
    const items = [];
    items.push(d.encryptionKey
      ? '<li class="ok"><span class="st">✓</span>Chiffrement au repos actif (ETAPEFORGE_SECRET_KEY)</li>'
      : '<li class="warn"><span class="st">⚠</span>Chiffrement au repos inactif : définir ETAPEFORGE_SECRET_KEY (16 caractères au moins)</li>');
    for (const [service, st] of Object.entries(d)) {
      if (service === 'encryptionKey') continue;
      for (const [name, where] of Object.entries(st.secrets)) {
        const cls = where === 'db-illisible' ? 'fail' : where === 'db' ? 'warn' : 'ok';
        items.push(`<li class="${cls}"><span class="st">${{ fail: '✗', warn: '⚠', ok: '✓' }[cls]}</span>` +
          `<b>${EF.esc(service)}</b> — ${EF.esc(NAMES[name] || name)} : ${EF.esc(WHERE[where] || where)}</li>`);
      }
      if (st.tokensInDb) {
        items.push(st.tokensUnreadable
          ? `<li class="fail"><span class="st">✗</span><b>${EF.esc(service)}</b> — jetons de connexion chiffrés mais illisibles (clé absente ou changée) : déconnecter puis reconnecter le compte</li>`
          : st.tokensEncrypted
          ? `<li class="ok"><span class="st">✓</span><b>${EF.esc(service)}</b> — jetons de connexion : base SQLite, chiffrés</li>`
          : `<li class="warn"><span class="st">⚠</span><b>${EF.esc(service)}</b> — jetons de connexion : base SQLite, en clair ` +
            '(définir ETAPEFORGE_SECRET_KEY, ou protéger le fichier de base et les sauvegardes)</li>');
      }
    }
    ul.innerHTML = items.join('');
  } catch (err) {
    ul.innerHTML = `<li class="fail"><span class="st">✗</span>Erreur : ${EF.esc(err.message)}</li>`;
  }
}

async function run() {
  const btn = document.getElementById('btn-run');
  const msg = document.getElementById('diag-msg');
  const ul = document.getElementById('diag-list');
  btn.disabled = true;
  msg.textContent = 'test en cours (quelques secondes)…';
  ul.innerHTML = '';
  try {
    // Sonde 6 services externes en séquence côté serveur, 8 s de délai chacun
    // (backend/server.js) — pire cas ~48 s, largement au-delà du délai par
    // défaut d'EF.api() pensé pour un appel local (trouvaille de relecture
    // adverse, reproduite empiriquement).
    const d = await EF.api('/api/diagnostic', { timeoutMs: 60000 });
    ul.innerHTML = d.results.map((r) =>
      `<li class="${r.ok ? 'ok' : 'fail'}"><span class="st">${r.ok ? '✓' : '✗'}</span>` +
      `<b>${EF.esc(r.name)}</b> — ${EF.esc(r.detail)} (${r.ms} ms)</li>`).join('');
    msg.textContent = d.allOk
      ? 'Tous les services répondent : le mode réel est pleinement fonctionnel.'
      : d.offline
        ? 'Mode hors-ligne actif : le simulateur est utilisé, les échecs ci-dessus sont attendus.'
        : 'Certains services sont injoignables — voir ci-dessus.';
  } catch (err) {
    msg.textContent = 'Erreur : ' + err.message;
  } finally {
    btn.disabled = false;
  }
}
async function doRestore() {
  const msg = document.getElementById('backup-msg');
  const fileInput = document.getElementById('backup-file');
  const file = fileInput.files[0];
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (err) {
    msg.textContent = 'Fichier JSON invalide : ' + err.message;
    return;
  }
  msg.textContent = 'Réimport en cours…';
  try {
    const res = await EF.api('/api/backup/import', { method: 'POST', body: { ...parsed, confirm: true } });
    const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
    msg.textContent = `✔ Réimport terminé : ${total} ligne(s) réparties sur ${Object.keys(res.counts).length} tables. Rechargez les autres pages pour voir les nouvelles données.`;
  } catch (err) {
    msg.textContent = 'Erreur : ' + err.message;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('');
  document.getElementById('btn-run').addEventListener('click', run);
  run();
  loadQuota();
  loadSecrets();

  const fileInput = document.getElementById('backup-file');
  const restoreBtn = document.getElementById('btn-restore');
  fileInput.addEventListener('change', () => { restoreBtn.disabled = !fileInput.files.length; });
  restoreBtn.addEventListener('click', EF.confirmClick(restoreBtn, {
    confirmText: 'confirmer le remplacement',
    confirmTitle: 'Cliquer à nouveau pour confirmer — remplace toutes les données produit existantes',
    onConfirm: doRestore,
  }));
});
