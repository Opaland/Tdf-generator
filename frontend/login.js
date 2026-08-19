'use strict';
// Écran de connexion (actif seulement quand le serveur tourne en ETAPEFORGE_PUBLIC=1).

let mode = 'login'; // 'login' | 'register'

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
    location.href = params.get('next') || '/';
  } catch (err) {
    msg.textContent = err.message;
  }
});
