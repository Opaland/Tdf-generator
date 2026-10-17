'use strict';
// Chiffrement au repos des secrets des connecteurs (Epic 13, issue #379,
// option B) : backend/settings.js, AES-256-GCM, clé ETAPEFORGE_SECRET_KEY.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-settings-enc-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_SECRET_KEY;

const { test, after } = require('node:test');
const assert = require('node:assert');
const { getSetting, setSetting, secretsStatus, encryptStoredSecrets, ENC_PREFIX } = require('../backend/settings');
const { getDb } = require('../backend/db');

const KEY = 'une-cle-de-test-suffisamment-longue';
const raw = (k) => getDb().prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null;

after(() => {
  delete process.env.ETAPEFORGE_SECRET_KEY;
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('sans clé : stockage en clair (comportement historique), statut « db »', () => {
  setSetting('strava_client_secret', 's3cret');
  assert.strictEqual(raw('strava_client_secret'), 's3cret');
  assert.strictEqual(getSetting('strava_client_secret'), 's3cret');
  assert.strictEqual(secretsStatus().strava.secrets.client_secret, 'db');
  assert.strictEqual(secretsStatus().encryptionKey, false);
});

test('clé trop courte = pas de clé', () => {
  process.env.ETAPEFORGE_SECRET_KEY = 'courte   ';
  setSetting('suunto_client_secret', 'x');
  assert.strictEqual(raw('suunto_client_secret'), 'x');
  delete process.env.ETAPEFORGE_SECRET_KEY;
});

test('avec clé : valeur sensible chiffrée en base, relue en clair, IV aléatoire ; clé non sensible jamais chiffrée', () => {
  process.env.ETAPEFORGE_SECRET_KEY = KEY;
  setSetting('suunto_refresh_token', 'jeton-tres-prive');
  const stored = raw('suunto_refresh_token');
  assert.ok(stored.startsWith(ENC_PREFIX));
  assert.ok(!stored.includes('jeton-tres-prive'));
  assert.strictEqual(getSetting('suunto_refresh_token'), 'jeton-tres-prive');
  setSetting('suunto_refresh_token', 'jeton-tres-prive');
  assert.notStrictEqual(raw('suunto_refresh_token'), stored, 'IV neuf à chaque écriture');
  setSetting('suunto_client_id', 'identifiant-public');
  assert.strictEqual(raw('suunto_client_id'), 'identifiant-public');
  assert.strictEqual(secretsStatus().suunto.tokensEncrypted, true);
});

test('démarrage avec clé : les secrets encore en clair sont chiffrés, une seule fois', () => {
  process.env.ETAPEFORGE_SECRET_KEY = KEY;
  assert.strictEqual(raw('strava_client_secret'), 's3cret'); // écrit en clair au 1er test
  const n = encryptStoredSecrets();
  assert.ok(n >= 1);
  assert.ok(raw('strava_client_secret').startsWith(ENC_PREFIX));
  assert.strictEqual(getSetting('strava_client_secret'), 's3cret');
  assert.strictEqual(secretsStatus().strava.secrets.client_secret, 'db-chiffre');
  assert.strictEqual(encryptStoredSecrets(), 0, 'idempotent');
});

test('clé absente ou différente : null (connecteur non configuré), jamais une exception ni le texte chiffré', () => {
  process.env.ETAPEFORGE_SECRET_KEY = KEY;
  setSetting('strava_access_token', 'acces');
  delete process.env.ETAPEFORGE_SECRET_KEY;
  assert.strictEqual(getSetting('strava_access_token'), null);
  process.env.ETAPEFORGE_SECRET_KEY = 'une-autre-cle-elle-aussi-longue';
  assert.strictEqual(getSetting('strava_access_token'), null);
  // Le statut reste vrai : le secret est bien là (chiffré), seulement illisible.
  assert.strictEqual(secretsStatus().strava.tokensInDb, true);
});

test('valeur chiffrée altérée (base modifiée) → null, l\'authentification GCM la rejette', () => {
  process.env.ETAPEFORGE_SECRET_KEY = KEY;
  setSetting('suunto_access_token', 'original');
  const v = raw('suunto_access_token');
  const tampered = v.slice(0, -4) + (v.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run(tampered, 'suunto_access_token');
  assert.strictEqual(getSetting('suunto_access_token'), null);
});
