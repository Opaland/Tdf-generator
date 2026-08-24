'use strict';
// Base SQLite unique (données + caches d'API). Créée à la volée dans data/.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.ETAPEFORGE_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.ETAPEFORGE_DB || path.join(DATA_DIR, 'etapeforge.sqlite');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER,                -- NULL pour un tour personnalisé
  name TEXT NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  source TEXT,                 -- JSON : provenance des champs (wikipedia, manuel…)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id INTEGER REFERENCES editions(id) ON DELETE SET NULL,
  stage_order INTEGER,         -- ordre dans l'édition / le tour
  name TEXT NOT NULL,
  date TEXT,
  stage_type TEXT,             -- plaine, accidentée, montagne, clm…
  status TEXT,                 -- champ libre (spec)
  official_distance_km REAL,   -- distance officielle (mode archives)
  generated_distance_km REAL,
  total_ascent_m REAL,
  state TEXT NOT NULL DEFAULT 'draft',  -- draft | generating | done | error
  progress TEXT,               -- JSON : {step, detail, percent}
  checks TEXT,                 -- JSON : bloc d'audits qualité
  source TEXT,                 -- JSON : provenance des champs
  error TEXT,
  is_transfer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waypoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'via',  -- start | via | col | sprint | finish
  lat REAL, lon REAL,
  altitude_hint_m REAL,        -- altitude attendue (cols)
  geocode TEXT,                -- JSON : réponse géocodeur retenue
  approximated INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  bonus_sec TEXT                -- JSON : bonifications en secondes à ce point (ex. "[3,2,1]")
);
CREATE INDEX IF NOT EXISTS idx_waypoints_stage ON waypoints(stage_id, idx);

CREATE TABLE IF NOT EXISTS tracks (
  stage_id INTEGER PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE,
  geojson TEXT NOT NULL,       -- Feature LineString (tracé complet)
  distance_m REAL NOT NULL,
  approx_segments TEXT,        -- JSON : [{fromM, toM, reason}] segments approximés
  router TEXT                  -- osrm | simulateur
);

CREATE TABLE IF NOT EXISTS elevation_samples (
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  dist_m REAL NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL,
  ele_raw_m REAL,
  ele_smooth_m REAL,
  PRIMARY KEY (stage_id, idx)
);

CREATE TABLE IF NOT EXISTS climbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  name TEXT,
  category TEXT,               -- HC | 1 | 2 | 3 | 4
  score REAL,
  start_km REAL, end_km REAL,
  length_km REAL,
  start_ele_m REAL, summit_ele_m REAL,
  avg_gradient REAL, max_gradient REAL,
  irregularity_index REAL,     -- écart-type des pentes par bloc de 1 km (indice de "mur")
  km_blocks TEXT,              -- JSON : blocs de 1 km [{fromKm,toKm,gradient,ele0,ele1}]
  name_source TEXT             -- waypoint | reverse-geocode
);
CREATE INDEX IF NOT EXISTS idx_climbs_stage ON climbs(stage_id);

CREATE TABLE IF NOT EXISTS km_analysis (
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  km INTEGER NOT NULL,
  ele_start_m REAL, ele_end_m REAL,
  avg_gradient REAL,           -- %
  max_gradient_100m REAL,      -- % (pente max sur 100 m dans le km)
  ascent_m REAL,               -- D+ du km
  cum_ascent_m REAL,           -- D+ cumulé
  PRIMARY KEY (stage_id, km)
);

-- Caches d'appels externes : clé = sha256 de la requête normalisée. On ne géocode
-- ni n'échantillonne jamais deux fois la même chose.
CREATE TABLE IF NOT EXISTS geocode_cache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS elevation_cache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_cache (   -- routage OSRM, Wikipédia…
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Authentification (mur d'accès en mode ETAPEFORGE_PUBLIC=1 — voir backend/auth.js).
-- Toutes les données ci-dessus restent partagées entre les comptes : ces deux
-- tables ne servent qu'à contrôler qui peut se connecter, pas à cloisonner les
-- données par utilisateur.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,   -- "salt_hex:hash_hex" (scrypt, voir backend/auth.js)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- sha256(token brut du cookie) — jamais le token en clair
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

// `CREATE TABLE IF NOT EXISTS` ne touche jamais une table déjà créée par une
// installation existante (Synology/LAN, base persistante) — pour ajouter une
// colonne à une table déjà en place sans casser ces bases, il faut un
// `ALTER TABLE ADD COLUMN` explicite, idempotent (SQLite n'a pas de
// `ADD COLUMN IF NOT EXISTS`, vérifié : erreur de syntaxe sur la version
// bundlée avec better-sqlite3).
function ensureColumn(database, table, column, ddl) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  ensureColumn(db, 'climbs', 'irregularity_index', 'irregularity_index REAL');
  ensureColumn(db, 'waypoints', 'bonus_sec', 'bonus_sec TEXT');
  return db;
}

module.exports = { getDb, DB_PATH, DATA_DIR, ensureColumn };
