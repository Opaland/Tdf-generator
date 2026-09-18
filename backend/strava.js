'use strict';
// Connecteur Strava API v3 (developers.strava.com) — OAuth2 authorization code.
// Nécessite d'enregistrer une application sur https://www.strava.com/settings/api
// (client id + client secret). Les identifiants sont saisis dans l'UI (stockés en
// base locale) ou fournis via STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET.
//
// Flux : /api/strava/connect → www.strava.com/oauth/authorize
//        → callback /api/strava/callback (échange code → access + refresh token)
//        → /api/strava/activities (GET /athlete/activities)
//        → /api/strava/import (GET /activities/{id} pour la date de départ,
//          puis /activities/{id}/streams pour la géométrie → pipeline d'import
//          de trace, comme le FIT Suunto plus haut).
//
// Vérifié sur la documentation officielle le 18/09/2026
// (developers.strava.com/docs/authentication, /docs/reference,
// /docs/rate-limits) plutôt que supposé — deux différences avec le
// connecteur Suunto voisin :
// - l'échange de jeton envoie client_id/client_secret dans le CORPS de la
//   requête (form-urlencoded), pas dans un en-tête Basic ;
// - il n'y a pas de clé d'abonnement séparée à souscrire (un seul couple
//   client id/secret suffit).
//
// Streams et non export FIT : Strava n'offre pas de téléchargement de
// fichier natif par l'API — /activities/{id}/streams rend des tableaux
// parallèles (latlng, altitude, time) qu'il faut recomposer en points
// {lat, lon, ele, time}. Le `time` du flux Strava est un décalage en
// secondes depuis le départ de l'activité, pas un horodatage absolu : la
// date de départ (`start_date`, ISO) vient d'un appel séparé à
// /activities/{id}, jamais du client (name est la seule valeur que
// l'import Suunto voisin laisse le client fournir, et seulement pour
// l'affichage — la date, elle, détermine directement la vitesse calculée
// par rideStats.js). `point.time` reste un objet `Date`, comme celui que
// parseGpx()/pointsFromFitRecords() produisent (pipeline/importTrack.js) —
// une seule convention de représentation du temps pour tout le pipeline
// d'import, quelle que soit la source.

const express = require('express');
const { getSetting, setSetting } = require('./settings');
const { importTrackAsStage } = require('../pipeline/importTrack');
const { fetchWithTimeout } = require('../pipeline/http');

// Surchargeables pour les tests d'intégration (serveur Strava simulé en local).
const OAUTH_BASE = process.env.STRAVA_OAUTH_BASE || 'https://www.strava.com';
const API_BASE = process.env.STRAVA_API_BASE || 'https://www.strava.com/api/v3';
const STRAVA_TIMEOUT_MS = parseInt(process.env.STRAVA_TIMEOUT_MS || '15000', 10);

// activity:read seul laisse Strava filtrer silencieusement de la liste
// toute activité marquée « Uniquement moi » (documenté : "Only Me
// activities will be filtered out unless requested by a token with
// activity:read_all"). Beaucoup de sorties d'entraînement le sont par
// défaut chez de nombreux utilisateurs — les exclure romprait la promesse
// « vos sorties » pour une partie d'entre elles sans le dire.
const SCOPE = 'activity:read_all';

function optionalString(v, field) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw Object.assign(new Error(`${field} doit être une chaîne (ou absent)`), { status: 400 });
  return v;
}

function config() {
  return {
    clientId: process.env.STRAVA_CLIENT_ID || getSetting('strava_client_id'),
    clientSecret: process.env.STRAVA_CLIENT_SECRET || getSetting('strava_client_secret'),
  };
}

function tokens() {
  return {
    access: getSetting('strava_access_token'),
    refresh: getSetting('strava_refresh_token'),
    expiresAtMs: parseInt(getSetting('strava_expires_at_ms') || '0', 10),
    user: getSetting('strava_user'),
  };
}

function storeTokens(json) {
  setSetting('strava_access_token', json.access_token);
  if (json.refresh_token) setSetting('strava_refresh_token', json.refresh_token);
  // Strava rend expires_at en secondes depuis l'epoch (pas seulement une
  // durée relative comme expires_in) : le convertir une fois ici évite de
  // recalculer une expiration approximative à chaque lecture.
  if (typeof json.expires_at === 'number') setSetting('strava_expires_at_ms', String(json.expires_at * 1000));
  if (json.athlete) {
    const a = json.athlete;
    const name = [a.firstname, a.lastname].filter(Boolean).join(' ');
    if (name) setSetting('strava_user', name);
  }
}

async function oauthToken(params) {
  const { clientId, clientSecret } = config();
  let res;
  try {
    res = await fetchWithTimeout(`${OAUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
    }, STRAVA_TIMEOUT_MS);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`OAuth Strava : délai de ${STRAVA_TIMEOUT_MS} ms dépassé`, { cause: err });
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth Strava : HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

/** Jeton d'accès valide (rafraîchi au besoin). */
async function accessToken() {
  const t = tokens();
  if (!t.access) throw new Error('Non connecté à Strava (utilisez « Se connecter »)');
  if (Date.now() < t.expiresAtMs - 60000) return t.access;
  if (!t.refresh) throw new Error('Session Strava expirée : reconnectez-vous');
  const json = await oauthToken({ grant_type: 'refresh_token', refresh_token: t.refresh });
  storeTokens(json);
  return json.access_token;
}

async function apiGet(path) {
  const token = await accessToken();
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, STRAVA_TIMEOUT_MS);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Strava API ${path} : délai de ${STRAVA_TIMEOUT_MS} ms dépassé`, { cause: err });
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Strava API ${path} : HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/api/strava/callback`;
}

/**
 * Reconstruit [{lat, lon, ele, time}] depuis la réponse de
 * /activities/{id}/streams (tableaux parallèles keyed by type) et la date
 * de départ ISO de l'activité. `latlng` est le seul flux indispensable —
 * sans lui, il n'y a pas de tracé à importer. `time` (sortie) est un objet
 * `Date`, même convention que parseGpx()/pointsFromFitRecords()
 * (pipeline/importTrack.js) — pas les secondes relatives du flux Strava.
 */
function pointsFromStreams(streams, startDateIso) {
  const latlng = streams.latlng?.data;
  if (!Array.isArray(latlng) || latlng.length < 2) {
    throw new Error("Cette activité n'a pas de tracé GPS exploitable (pas de flux latlng)");
  }
  const altitude = streams.altitude?.data;
  const timeOffsetsS = streams.time?.data;
  const startMs = Date.parse(startDateIso);
  const hasStart = Number.isFinite(startMs);
  return latlng.map((pair, i) => ({
    lat: pair[0],
    lon: pair[1],
    ele: Array.isArray(altitude) && typeof altitude[i] === 'number' ? altitude[i] : null,
    time: hasStart && Array.isArray(timeOffsetsS) && typeof timeOffsetsS[i] === 'number'
      ? new Date(startMs + timeOffsetsS[i] * 1000) : null,
  }));
}

// --- routes --------------------------------------------------------------------
const router = express.Router();

router.get('/status', (req, res) => {
  const c = config();
  const t = tokens();
  res.json({
    configured: !!(c.clientId && c.clientSecret),
    connected: !!t.access,
    user: t.user,
    redirect_uri: redirectUri(req),
  });
});

router.post('/config', (req, res) => {
  const body = req.body || {};
  const client_id = optionalString(body.client_id, 'client_id');
  const client_secret = optionalString(body.client_secret, 'client_secret');
  if (client_id) setSetting('strava_client_id', client_id);
  if (client_secret) setSetting('strava_client_secret', client_secret);
  res.json({ ok: true });
});

router.post('/disconnect', (req, res) => {
  for (const k of ['strava_access_token', 'strava_refresh_token', 'strava_expires_at_ms', 'strava_user']) setSetting(k, null);
  res.json({ ok: true });
});

router.get('/connect', (req, res) => {
  const { clientId } = config();
  if (!clientId) return res.status(400).send('Strava non configuré (client id manquant)');
  const url =
    `${OAUTH_BASE}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri(req))}` +
    `&approval_prompt=auto&scope=${encodeURIComponent(SCOPE)}`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) throw new Error(`Autorisation refusée (${req.query.error || 'pas de code'})`);
    const json = await oauthToken({ grant_type: 'authorization_code', code });
    storeTokens(json);
    res.redirect('/traces.html?strava=ok');
  } catch (err) {
    res.redirect(`/traces.html?strava=${encodeURIComponent(err.message)}`);
  }
});

router.get('/activities', async (req, res) => {
  try {
    const perPage = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const list = await apiGet(`/athlete/activities?per_page=${perPage}`);
    res.json(
      (Array.isArray(list) ? list : []).map((a) => ({
        id: a.id,
        name: a.name ?? null,
        type: a.sport_type ?? a.type ?? null,
        startDate: a.start_date ?? null,
        distance_m: a.distance ?? null,
        ascent_m: a.total_elevation_gain ?? null,
        duration_s: a.moving_time ?? a.elapsed_time ?? null,
      }))
    );
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/import', async (req, res) => {
  try {
    const { id, name } = req.body || {};
    if (id == null || (typeof id !== 'number' && typeof id !== 'string')) {
      return res.status(400).json({ error: "id de l'activité requis" });
    }
    const validName = optionalString(name, 'name');
    const activity = await apiGet(`/activities/${encodeURIComponent(id)}`);
    const streams = await apiGet(`/activities/${encodeURIComponent(id)}/streams?keys=latlng,altitude,time&key_by_type=true`);
    const points = pointsFromStreams(streams, activity.start_date);
    const stageId = await importTrackAsStage(points, {
      name: validName || activity.name || `Sortie Strava ${id}`,
      source: 'strava',
      status: 'trace Strava',
    });
    res.json({ id: stageId });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = { stravaRouter: router, pointsFromStreams };
