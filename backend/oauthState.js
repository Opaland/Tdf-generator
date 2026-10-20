'use strict';
// Paramètre `state` des connexions OAuth (Strava, Suunto) : sans lui, un lien
// piégé `/api/strava/callback?code=<code de l'attaquant>` ouvert par
// l'utilisateur liait le compte de l'attaquant à l'instance (CSRF de
// connexion, revue globale du 19/10/2026). Un état aléatoire est émis à
// /connect, vérifié et consommé au callback. En mémoire : un seul process,
// et un redémarrage entre les deux étapes demande simplement de recommencer.

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const pending = new Map(); // state -> { provider, expiresAt }

function issueState(provider) {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { provider, expiresAt: now + TTL_MS });
  return state;
}

/** true si `state` a été émis pour ce fournisseur et n'a pas expiré (usage unique). */
function consumeState(provider, state) {
  if (typeof state !== 'string' || !pending.has(state)) return false;
  const entry = pending.get(state);
  pending.delete(state);
  return entry.provider === provider && entry.expiresAt >= Date.now();
}

module.exports = { issueState, consumeState };
