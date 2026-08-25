'use strict';
// Connecteur Suunto Cloud API (apizone.suunto.com) — OAuth2 authorization code.
// Nécessite d'enregistrer une application sur https://apizone.suunto.com
// (client id + client secret + clé d'abonnement « Ocp-Apim-Subscription-Key »).
// Les identifiants sont saisis dans l'UI (stockés en base locale) ou fournis via
// SUUNTO_CLIENT_ID / SUUNTO_CLIENT_SECRET / SUUNTO_SUBSCRIPTION_KEY.
//
// Flux : /api/suunto/connect → cloudapi-oauth.suunto.com/oauth/authorize
//        → callback /api/suunto/callback (échange code → JWT + refresh token)
//        → /api/suunto/workouts (GET cloudapi.suunto.com/v2/workouts)
//        → /api/suunto/import (export FIT du workout → pipeline d'import de trace).

const express = require('express');
const { getDb } = require('./db');
const { importTrackAsStage, pointsFromFitRecords } = require('../pipeline/importTrack');
const { fetchWithTimeout } = require('../pipeline/http');

// Surchargeables pour les tests d'intégration (serveur Suunto simulé en local).
const OAUTH_BASE = process.env.SUUNTO_OAUTH_BASE || 'https://cloudapi-oauth.suunto.com';
const API_BASE = process.env.SUUNTO_API_BASE || 'https://cloudapi.suunto.com';
// oauthToken()/apiGet() sont attendues directement par une requête utilisateur
// (routes /api/suunto/*) — sans timeout, un fetch() qui pend laissait cette
// requête sans réponse indéfiniment (trouvaille de sprint dédié).
// Surchageable comme OAUTH_BASE/API_BASE ci-dessus, pour un test qui vérifie
// l'abandon réel sans attendre 15 s.
const SUUNTO_TIMEOUT_MS = parseInt(process.env.SUUNTO_TIMEOUT_MS || '15000', 10);

// --- petit stockage clé/valeur local -------------------------------------------
function ensureSettings(db) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
}
function getSetting(key) {
  const db = getDb();
  ensureSettings(db);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  const db = getDb();
  ensureSettings(db);
  if (value == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// Contrairement aux routes d'écriture de backend/server.js (requireString/
// optionalString), POST /config n'appliquait aucune validation de type :
// setSetting() fait String(value) avant l'écriture SQL, donc un objet/
// tableau envoyé par erreur ne plante pas (pas de 500) mais est stocké
// silencieusement comme la chaîne littérale "[object Object]" — la config
// Suunto paraît enregistrée (200 { ok: true }) alors qu'elle est
// inutilisable, découverte seulement à la connexion (trouvaille de sprint
// dédié). .status : propagé par Express (throw synchrone dans un handler
// de route) jusqu'au middleware d'erreur global de backend/server.js, qui
// renvoie ce code plutôt que 500.
function optionalString(v, field) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw Object.assign(new Error(`${field} doit être une chaîne (ou absent)`), { status: 400 });
  return v;
}

function config() {
  return {
    clientId: process.env.SUUNTO_CLIENT_ID || getSetting('suunto_client_id'),
    clientSecret: process.env.SUUNTO_CLIENT_SECRET || getSetting('suunto_client_secret'),
    subscriptionKey: process.env.SUUNTO_SUBSCRIPTION_KEY || getSetting('suunto_subscription_key'),
  };
}

function tokens() {
  return {
    access: getSetting('suunto_access_token'),
    refresh: getSetting('suunto_refresh_token'),
    expiresAt: parseInt(getSetting('suunto_expires_at') || '0', 10),
    user: getSetting('suunto_user'),
  };
}

function storeTokens(json) {
  setSetting('suunto_access_token', json.access_token);
  if (json.refresh_token) setSetting('suunto_refresh_token', json.refresh_token);
  setSetting('suunto_expires_at', String(Date.now() + (json.expires_in || 86400) * 1000));
  if (json.user) setSetting('suunto_user', json.user);
}

async function oauthToken(params) {
  const { clientId, clientSecret } = config();
  let res;
  try {
    res = await fetchWithTimeout(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams(params).toString(),
    }, SUUNTO_TIMEOUT_MS);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`OAuth Suunto : délai de ${SUUNTO_TIMEOUT_MS} ms dépassé`, { cause: err });
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth Suunto : HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

/** Jeton d'accès valide (rafraîchi au besoin). */
async function accessToken() {
  const t = tokens();
  if (!t.access) throw new Error('Non connecté à Suunto (utilisez « Se connecter »)');
  if (Date.now() < t.expiresAt - 60000) return t.access;
  if (!t.refresh) throw new Error('Session Suunto expirée : reconnectez-vous');
  const json = await oauthToken({ grant_type: 'refresh_token', refresh_token: t.refresh });
  storeTokens(json);
  return json.access_token;
}

async function apiGet(path, { binary = false } = {}) {
  const { subscriptionKey } = config();
  const token = await accessToken();
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        Accept: binary ? 'application/octet-stream' : 'application/json',
      },
    }, SUUNTO_TIMEOUT_MS);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Suunto API ${path} : délai de ${SUUNTO_TIMEOUT_MS} ms dépassé`, { cause: err });
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Suunto API ${path} : HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/suunto/callback`;
}

// --- routes --------------------------------------------------------------------
const router = express.Router();

router.get('/status', (req, res) => {
  const c = config();
  const t = tokens();
  res.json({
    configured: !!(c.clientId && c.clientSecret && c.subscriptionKey),
    connected: !!t.access,
    user: t.user,
    redirect_uri: redirectUri(req),
  });
});

router.post('/config', (req, res) => {
  const body = req.body || {};
  const client_id = optionalString(body.client_id, 'client_id');
  const client_secret = optionalString(body.client_secret, 'client_secret');
  const subscription_key = optionalString(body.subscription_key, 'subscription_key');
  if (client_id) setSetting('suunto_client_id', client_id);
  if (client_secret) setSetting('suunto_client_secret', client_secret);
  if (subscription_key) setSetting('suunto_subscription_key', subscription_key);
  res.json({ ok: true });
});

router.post('/disconnect', (req, res) => {
  for (const k of ['suunto_access_token', 'suunto_refresh_token', 'suunto_expires_at', 'suunto_user']) setSetting(k, null);
  res.json({ ok: true });
});

router.get('/connect', (req, res) => {
  const { clientId } = config();
  if (!clientId) return res.status(400).send('Suunto non configuré (client id manquant)');
  const url =
    `${OAUTH_BASE}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri(req))}`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error(`Autorisation refusée (${req.query.error || 'pas de code'})`);
    const json = await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });
    storeTokens(json);
    res.redirect('/traces.html?suunto=ok');
  } catch (err) {
    res.redirect(`/traces.html?suunto=${encodeURIComponent(err.message)}`);
  }
});

router.get('/workouts', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const json = await apiGet(`/v2/workouts?limit=${limit}`);
    // Structure défensive : payload | workouts | tableau brut.
    const list = json.payload || json.workouts || (Array.isArray(json) ? json : []);
    res.json(
      list.map((w) => ({
        key: w.workoutKey || w.workoutId || w.key || w.id,
        name: w.workoutName || w.name || null,
        activityId: w.activityId ?? w.activityType ?? null,
        startTime: w.startTime ?? w.startTimestamp ?? null,
        distance_m: w.totalDistance ?? w.distance ?? null,
        ascent_m: w.totalAscent ?? w.ascent ?? null,
        duration_s: w.totalTime ?? w.duration ?? null,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { key, name } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key du workout requis' });
    const fit = await apiGet(`/v2/workout/exportFit/${encodeURIComponent(key)}`, { binary: true });

    const FitParser = require('fit-file-parser').default || require('fit-file-parser');
    const parser = new FitParser({ force: true, elapsedRecordField: true, mode: 'list' });
    const data = await new Promise((resolve, reject) =>
      parser.parse(fit, (err, d) => (err ? reject(new Error(String(err))) : resolve(d)))
    );
    const points = pointsFromFitRecords(data.records);
    const stageId = await importTrackAsStage(points, {
      name: name || `Sortie Suunto ${key}`,
      source: 'suunto',
      status: 'trace Suunto',
    });
    res.json({ id: stageId });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = { suuntoRouter: router };
