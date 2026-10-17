'use strict';
// Petit stockage clé/valeur local, partagé par les connecteurs OAuth
// (Suunto, Strava…) pour leurs identifiants d'application et jetons —
// sorti de backend/suunto.js au moment d'ajouter Strava plutôt que
// recopié une seconde fois.

const { getDb } = require('./db');

function getSetting(key) {
  // Table créée par la migration 2 de backend/db.js.
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  if (value == null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// Où se trouvent les secrets des connecteurs (Epic 13, issue #379, option A) :
// variable d'environnement, base SQLite (en clair), ou absent. Ne renvoie
// JAMAIS une valeur, seulement sa provenance — la base n'est pas chiffrée,
// donc un secret qui y vit est lisible par quiconque copie le fichier ou une
// sauvegarde automatique (backend/backup.js).
const SECRET_SOURCES = {
  suunto: { client_secret: ['SUUNTO_CLIENT_SECRET', 'suunto_client_secret'], subscription_key: ['SUUNTO_SUBSCRIPTION_KEY', 'suunto_subscription_key'] },
  strava: { client_secret: ['STRAVA_CLIENT_SECRET', 'strava_client_secret'] },
};
const TOKEN_KEYS = { suunto: ['suunto_access_token', 'suunto_refresh_token'], strava: ['strava_access_token', 'strava_refresh_token'] };

function secretsStatus() {
  const out = {};
  for (const [service, secrets] of Object.entries(SECRET_SOURCES)) {
    const s = { secrets: {}, tokensInDb: TOKEN_KEYS[service].some((k) => getSetting(k) != null) };
    for (const [name, [envVar, key]] of Object.entries(secrets)) {
      s.secrets[name] = process.env[envVar] ? 'env' : getSetting(key) != null ? 'db' : 'absent';
    }
    out[service] = s;
  }
  return out;
}

module.exports = { getSetting, setSetting, secretsStatus };
