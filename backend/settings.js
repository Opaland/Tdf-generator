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

// Dérivation : scrypt (coûteux, comme il se doit contre une attaque hors
// ligne sur un fichier volé — un simple sha256 se casse vite sur GPU si la
// clé est une phrase de passe), sel aléatoire propre à l'installation stocké
// en clair dans settings. Clé dérivée gardée en mémoire (scrypt ~50 ms).
const SALT_KEY = 'settings_kdf_salt';
let derived = null; // { raw, salt, key }
function encryptionKey() {
  const raw = String(process.env.ETAPEFORGE_SECRET_KEY || '').trim();
  if (raw.length < MIN_KEY_LEN) return null;
  let salt = rawSetting(SALT_KEY);
  if (!salt) {
    salt = crypto.randomBytes(16).toString('base64');
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SALT_KEY, salt);
  }
  if (!derived || derived.raw !== raw || derived.salt !== salt) {
    derived = { raw, salt, key: crypto.scryptSync(raw, Buffer.from(salt, 'base64'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) };
  }
  return derived.key;
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

// Échappement : une valeur saisie qui commence par le préfixe de chiffrement
// (ou par celui d'échappement) est stockée préfixée de RAW_PREFIX — sans quoi
// elle serait prise pour une valeur chiffrée et relue `null` (relecture
// adverse). Seules les clés sensibles sont concernées.
const RAW_PREFIX = 'raw:';

function decodeValue(key, value) {
  if (value == null || !SENSITIVE_KEYS.has(key)) return { value };
  if (value.startsWith(RAW_PREFIX)) return { value: value.slice(RAW_PREFIX.length) };
  if (!value.startsWith(ENC_PREFIX)) return { value };
  const k = encryptionKey();
  try {
    if (!k) throw new Error('ETAPEFORGE_SECRET_KEY absente ou trop courte');
    return { value: decrypt(value, k), encrypted: true };
  } catch (err) {
    return { value: null, encrypted: true, unreadable: err.message };
  }
}

const warned = new Set();
function getSetting(key) {
  const d = decodeValue(key, rawSetting(key));
  if (d.unreadable && !warned.has(key)) {
    // Clé absente ou différente : le connecteur se comporte comme non
    // configuré plutôt que de planter ou d'utiliser un secret corrompu.
    warned.add(key);
    console.warn(`[settings] « ${key} » chiffré mais illisible (${d.unreadable}) — reconfigurer le connecteur ou rétablir la clé`);
  }
  return d.value;
}

function setSetting(key, value) {
  const db = getDb();
  if (value == null) return db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  let stored = String(value);
  if (SENSITIVE_KEYS.has(key)) {
    const k = encryptionKey();
    if (k) stored = encrypt(stored, k);
    else if (stored.startsWith(ENC_PREFIX) || stored.startsWith(RAW_PREFIX)) stored = RAW_PREFIX + stored;
    warned.delete(key);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored);
}

/** Au démarrage : chiffre les valeurs sensibles encore en clair si une clé est configurée. Renvoie le nombre chiffré. */
function encryptStoredSecrets() {
  const k = encryptionKey();
  if (!k) return 0;
  let n = 0;
  for (const key of SENSITIVE_KEYS) {
    const v = rawSetting(key);
    if (v == null || v.startsWith(ENC_PREFIX)) continue;
    setSetting(key, decodeValue(key, v).value);
    n++;
  }
  if (n) {
    // L'ancien clair survit sinon dans les pages libérées du fichier et dans
    // le WAL (relecture adverse, vérifié en lisant les octets du fichier) :
    // secure_delete (posé par getDb) efface les pages réécrites, VACUUM
    // reconstruit le fichier, le checkpoint TRUNCATE vide le WAL.
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
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
    const where = (key) => {
      const raw = rawSetting(key);
      if (raw == null) return 'absent';
      const d = decodeValue(key, raw);
      return d.unreadable ? 'db-illisible' : d.encrypted ? 'db-chiffre' : 'db';
    };
    const tokens = TOKEN_KEYS[service].map(where).filter((w) => w !== 'absent');
    const s = {
      secrets: {},
      tokensInDb: tokens.length > 0,
      tokensEncrypted: tokens.length > 0 && tokens.every((w) => w === 'db-chiffre'),
      tokensUnreadable: tokens.includes('db-illisible'),
    };
    for (const [name, [envVar, key]] of Object.entries(secrets)) {
      s.secrets[name] = process.env[envVar] ? 'env' : where(key);
    }
    out[service] = s;
  }
  out.encryptionKey = !!encryptionKey();
  return out;
}

module.exports = { getSetting, setSetting, secretsStatus, encryptStoredSecrets, ENC_PREFIX };
