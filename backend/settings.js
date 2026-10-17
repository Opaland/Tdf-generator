'use strict';
// Petit stockage clé/valeur local, partagé par les connecteurs OAuth
// (Suunto, Strava…) pour leurs identifiants d'application et jetons —
// sorti de backend/suunto.js au moment d'ajouter Strava plutôt que
// recopié une seconde fois.

const crypto = require('crypto');
const { getDb } = require('./db');

// Chiffrement au repos des valeurs sensibles (Epic 13, issue #379, option B) :
// AES-256-GCM, clé dérivée de ETAPEFORGE_SECRET_KEY (au moins 16 caractères).
// Sans clé : stockage en clair, comportement historique (avertissement sur
// /diag.html). Une valeur déjà en clair reste lisible ; elle est chiffrée à
// sa prochaine écriture, ou au démarrage par encryptStoredSecrets().
// Protège une copie du fichier SQLite ou d'une sauvegarde automatique — PAS
// un serveur compromis en marche, où la clé est dans l'environnement.
const ENC_PREFIX = 'enc:v1:';
const MIN_KEY_LEN = 16;
const SENSITIVE_KEYS = new Set([
  'suunto_client_secret', 'suunto_subscription_key', 'suunto_access_token', 'suunto_refresh_token',
  'strava_client_secret', 'strava_access_token', 'strava_refresh_token',
]);

function encryptionKey() {
  const raw = String(process.env.ETAPEFORGE_SECRET_KEY || '').trim();
  if (raw.length < MIN_KEY_LEN) return null;
  return crypto.createHash('sha256').update(`etapeforge-settings-v1:${raw}`).digest();
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decrypt(stored, key) {
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

function rawSetting(key) {
  // Table créée par la migration 2 de backend/db.js.
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

const warned = new Set();
function getSetting(key) {
  const value = rawSetting(key);
  if (value == null || !value.startsWith(ENC_PREFIX)) return value;
  const k = encryptionKey();
  try {
    if (!k) throw new Error('ETAPEFORGE_SECRET_KEY absente ou trop courte');
    return decrypt(value, k);
  } catch (err) {
    // Clé absente ou différente : le connecteur se comporte comme non
    // configuré plutôt que de planter ou d'utiliser un secret corrompu.
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[settings] « ${key} » chiffré mais illisible (${err.message}) — reconfigurer le connecteur ou rétablir la clé`);
    }
    return null;
  }
}

function setSetting(key, value) {
  const db = getDb();
  if (value == null) return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  const k = SENSITIVE_KEYS.has(key) ? encryptionKey() : null;
  const stored = k ? encrypt(String(value), k) : String(value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored);
}

/** Au démarrage : chiffre les valeurs sensibles encore en clair si une clé est configurée. Renvoie le nombre chiffré. */
function encryptStoredSecrets() {
  const k = encryptionKey();
  if (!k) return 0;
  let n = 0;
  for (const key of SENSITIVE_KEYS) {
    const v = rawSetting(key);
    if (v != null && !v.startsWith(ENC_PREFIX)) {
      setSetting(key, v);
      n++;
    }
  }
  return n;
}

// Où se trouvent les secrets des connecteurs (Epic 13, issue #379, option A) :
// variable d'environnement, base SQLite (chiffré ou en clair), ou absent. Ne
// renvoie JAMAIS une valeur, seulement sa provenance — un secret en clair dans
// la base est lisible par quiconque copie le fichier ou une sauvegarde
// automatique (backend/backup.js).
const SECRET_SOURCES = {
  suunto: { client_secret: ['SUUNTO_CLIENT_SECRET', 'suunto_client_secret'], subscription_key: ['SUUNTO_SUBSCRIPTION_KEY', 'suunto_subscription_key'] },
  strava: { client_secret: ['STRAVA_CLIENT_SECRET', 'strava_client_secret'] },
};
const TOKEN_KEYS = { suunto: ['suunto_access_token', 'suunto_refresh_token'], strava: ['strava_access_token', 'strava_refresh_token'] };

function secretsStatus() {
  const out = {};
  for (const [service, secrets] of Object.entries(SECRET_SOURCES)) {
    const tokens = TOKEN_KEYS[service].map(rawSetting).filter((v) => v != null);
    const s = {
      secrets: {},
      tokensInDb: tokens.length > 0,
      tokensEncrypted: tokens.length > 0 && tokens.every((v) => v.startsWith(ENC_PREFIX)),
    };
    for (const [name, [envVar, key]] of Object.entries(secrets)) {
      const stored = rawSetting(key);
      s.secrets[name] = process.env[envVar] ? 'env' : stored == null ? 'absent' : stored.startsWith(ENC_PREFIX) ? 'db-chiffre' : 'db';
    }
    out[service] = s;
  }
  out.encryptionKey = !!encryptionKey();
  return out;
}

module.exports = { getSetting, setSetting, secretsStatus, encryptStoredSecrets, ENC_PREFIX };
