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

module.exports = { getSetting, setSetting };
