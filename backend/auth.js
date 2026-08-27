'use strict';
// Mur d'accès pour une exposition publique (ETAPEFORGE_PUBLIC=1) : comptes
// email/mot de passe, sessions par cookie. Les données applicatives (étapes,
// éditions, traces…) restent PARTAGÉES entre tous les comptes — ceci n'est pas
// un système multi-utilisateur, seulement un contrôle d'accès. En usage local/
// Synology par défaut (ETAPEFORGE_PUBLIC non défini), rien de tout ceci n'est
// activé : le comportement historique « aucun compte » est inchangé.
//
// Hachage par crypto.scrypt (natif Node, aucune dépendance ajoutée). Le cookie
// de session ne contient qu'un jeton aléatoire ; seul son sha256 est stocké en
// base (table sessions) — une fuite de la base ne donne pas de session valide.

const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { getDb } = require('./db');

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

const SESSION_COOKIE = 'ef_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// Uniquement ETAPEFORGE_PUBLIC=1 — surtout PAS NODE_ENV=production : le
// Dockerfile fixe déjà NODE_ENV=production inconditionnellement (perf Express),
// y compris pour le kit Synology/LAN existant qui n'a jamais eu de compte et
// dont la base ne contient aucun utilisateur. Lier l'activation à NODE_ENV
// verrouillerait tout le monde hors de son propre serveur au premier déploiement.
const AUTH_REQUIRED = process.env.ETAPEFORGE_PUBLIC === '1';
const SECURE_COOKIE = process.env.ETAPEFORGE_PUBLIC === '1'; // suppose un reverse proxy HTTPS devant

// --- mots de passe ---------------------------------------------------------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// Hash « factice » précalculé : sert à faire tourner scrypt même quand l'email
// n'existe pas, pour que le temps de réponse du login ne révèle pas si un
// compte existe (résolu en arrière-plan au chargement du module).
let DUMMY_HASH = null;
hashPassword('mot-de-passe-factice-pour-le-timing').then((h) => { DUMMY_HASH = h; });

// --- sessions ----------------------------------------------------------------

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Trouvaille de revue-personas (27/08/2026, développeur performance/backend-
// données) : une session expirée n'était supprimée que si son token exact
// était re-présenté à verifySession() ci-dessous — une session jamais
// re-présentée (cookie effacé, changement d'appareil) restait en base
// indéfiniment. Même motif de croissance non bornée que la Map `attempts`
// du rate-limiter plus bas (purgeStaleAttempts()), purgé ici au même genre
// de moment naturel — chaque nouvelle connexion — plutôt que d'ajouter une
// dépendance dédiée (cron/setInterval) pour un besoin de maintenance mineur.
// `expires_at` est toujours écrit via toISOString() (jamais le
// datetime('now') par défaut de SQLite, réservé à created_at) : comparer à
// un autre toISOString() ici reste une comparaison ISO-avec-ISO, pas le
// piège de format de CLAUDE.md règle 3 (deux couches avec deux formats
// différents) — vérifié en relisant le schéma (backend/db.js) avant d'écrire
// cette requête.
function purgeExpiredSessions() {
  return getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()).changes;
}

function createSession(userId) {
  purgeExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  getDb().prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt);
  return token;
}

function verifySession(token) {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }
  return { id: row.id, email: row.email };
}

function deleteSession(token) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

// --- cookie --------------------------------------------------------------------

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (SECURE_COOKIE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (SECURE_COOKIE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// --- limiteur de tentatives (login/register), en mémoire, par IP ---------------

const attempts = new Map(); // ip -> timestamps[]
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;

// Chaque IP distincte qui appelle /register ou /login ajoute une entrée dans
// `attempts`, jamais retirée jusqu'ici (seulement filtrée à la lecture) —
// croissance non bornée sur un déploiement public longue durée avec
// beaucoup d'IP différentes (trouvaille de sprint dédié). `now` en
// paramètre plutôt que Date.now() interne : testable sans vrai cycle de
// 15 minutes.
function purgeStaleAttempts(map, now = Date.now()) {
  for (const [ip, timestamps] of map) {
    if (!timestamps.some((t) => now - t < RATE_WINDOW_MS)) map.delete(ip);
  }
}

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'inconnu';
  const now = Date.now();
  purgeStaleAttempts(attempts, now);
  const recent = (attempts.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Trop de tentatives — réessayez dans quelques minutes.' });
  }
  recent.push(now);
  attempts.set(ip, recent);
  next();
}

// --- middleware ------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!AUTH_REQUIRED) return next();
  const user = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'Authentification requise' });
  req.user = user;
  next();
}

// --- routes ------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const router = express.Router();

router.post('/register', rateLimit, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
  }
  const hash = await hashPassword(password);
  const r = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  setSessionCookie(res, createSession(r.lastInsertRowid));
  res.json({ email });
});

router.post('/login', rateLimit, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH || '');
  if (!user || !ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  setSessionCookie(res, createSession(user.id));
  res.json({ email: user.email });
});

router.post('/logout', (req, res) => {
  deleteSession(parseCookies(req)[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'Non connecté' });
  res.json({ email: user.email });
});

module.exports = {
  authRouter: router,
  requireAuth,
  AUTH_REQUIRED,
  // exportés pour les tests unitaires
  hashPassword,
  verifyPassword,
  createSession,
  verifySession,
  purgeExpiredSessions,
  purgeStaleAttempts,
  attempts,
  RATE_WINDOW_MS,
};
