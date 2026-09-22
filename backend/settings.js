'use strict';
// Petit stockage clé/valeur local, partagé par les connecteurs OAuth
// (Suunto, Strava…) pour leurs identifiants d'application et jetons —
// sorti de backend/suunto.js au moment d'ajouter Strava plutôt que
// recopié une seconde fois.

const { getDb } = require('./db');

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

module.exports = { getSetting, setSetting };
