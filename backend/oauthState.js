'use strict';
// Paramètre `state` des connexions OAuth (Strava, Suunto) : sans lui, un lien
// piégé `/api/strava/callback?code=<code de l'attaquant>` ouvert par
// l'utilisateur liait le compte de l'attaquant à l'instance (CSRF de
// connexion, revue globale du 19/10/2026).
//
// Le state est lié au NAVIGATEUR qui a lancé /connect, par un cookie
// HttpOnly : un state seulement mémorisé côté serveur ne suffit pas, car
// l'attaquant peut appeler /connect lui-même, obtenir un state valide et le
// glisser dans son lien piégé. Au callback, il faut à la fois le cookie
// posé chez la victime et le même state dans l'URL. SameSite=Lax : le
// cookie accompagne bien la redirection de premier niveau depuis le
// fournisseur. En mémoire en plus (expiration, usage unique) : un seul
// process, et un redémarrage entre les deux étapes demande de recommencer.

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const SECURE_COOKIE = process.env.ETAPEFORGE_PUBLIC === '1'; // même règle que backend/auth.js
const pending = new Map(); // state -> { provider, expiresAt }

const cookieName = (provider) => `ef_oauth_${provider}`;

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function setCookie(res, name, value, maxAgeS) {
  const parts = [`${name}=${value}`, 'Path=/api', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeS}`];
  if (SECURE_COOKIE) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

/** Émet un state pour ce fournisseur et le lie au navigateur (cookie). */
function issueState(res, provider) {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { provider, expiresAt: now + TTL_MS });
  setCookie(res, cookieName(provider), state, TTL_MS / 1000);
  return state;
}

/** true si le state de l'URL est celui du cookie de CE navigateur, émis pour
 * ce fournisseur et non expiré. Usage unique ; le cookie est effacé. */
function consumeState(req, res, provider) {
  const state = req.query.state;
  const fromCookie = cookieValue(req, cookieName(provider));
  setCookie(res, cookieName(provider), '', 0);
  if (typeof state !== 'string' || !fromCookie || !pending.has(state)) return false;
  const a = Buffer.from(state);
  const b = Buffer.from(fromCookie);
  const sameBrowser = a.length === b.length && crypto.timingSafeEqual(a, b);
  const entry = pending.get(state);
  pending.delete(state);
  return sameBrowser && entry.provider === provider && entry.expiresAt >= Date.now();
}

module.exports = { issueState, consumeState };
