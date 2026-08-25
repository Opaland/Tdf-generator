'use strict';
// Écran de connexion (actif seulement quand le serveur tourne en ETAPEFORGE_PUBLIC=1).

let mode = 'login'; // 'login' | 'register'

// EF.requireAuthOrRedirect() (common.js) ne génère jamais que des chemins
// relatifs same-origin (`location.pathname + location.search`) — mais rien
// n'empêche un lien fabriqué à la main (phishing : "session expirée,
// reconnectez-vous") de poser un `next` absolu vers un autre domaine.
//
// Une regex sur le préfixe (ex. rejeter `//`/`/\`) ferme certains vecteurs
// mais pas la classe entière : le parseur d'URL du navigateur (WHATWG URL
// Standard, utilisé pour toute navigation via `location.href =`) supprime
// tabulations/CR/LF n'importe où dans la chaîne AVANT de la parser — une
// regex qui ne connaît pas cette normalisation laisse passer `/\t/evil.com`,
// qui redevient `//evil.com` (protocol-relatif) une fois assigné à
// `location.href` (trouvaille de relecture adverse, vérifiée en navigateur
// réel via Playwright — vraie requête HTTP émise vers l'hôte évadé).
// CLAUDE.md règle 1 : corriger le vecteur trouvé (`//`, `/\`) ne ferme pas
// la classe de bug (n'importe quelle autre normalisation du parseur). Fixé
// en utilisant CE MÊME parseur pour la vérification — `new URL()` applique
// exactement la normalisation que la navigation appliquera ensuite, donc
// aucun vecteur qui passe par cette normalisation ne peut être manqué.
function safeNext(raw) {
  if (typeof raw !== 'string' || !raw) return '/';
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

function setMode(next) {
  mode = next;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('f-submit').textContent = mode === 'login' ? 'Se connecter' : 'Créer le compte';
  document.getElementById('f-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.getElementById('auth-msg').textContent = '';
}

document.getElementById('tab-login').addEventListener('click', () => setMode('login'));
document.getElementById('tab-register').addEventListener('click', () => setMode('register'));

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('auth-msg');
  const email = document.getElementById('f-email').value.trim();
  const password = document.getElementById('f-password').value;
  msg.textContent = mode === 'login' ? 'Connexion…' : 'Création du compte…';
  try {
    const res = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const params = new URLSearchParams(location.search);
    location.href = safeNext(params.get('next'));
  } catch (err) {
    msg.textContent = err.message;
  }
});
