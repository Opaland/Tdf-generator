'use strict';
// Test de backend/backup.js — sauvegarde automatique de la base SQLite
// (backlog issue #10, section E : « script cron dans le kit Docker/Synology
// pour dump régulier de data/etapeforge.db vers un second volume »).
// Désactivée par défaut (ETAPEFORGE_BACKUP_DIR non défini) — vérifié en
// premier, avant tout le reste.

const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backup-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const {
  runBackup, pruneOldBackups, backupFileName, getBackupStatus,
  startScheduledBackups, stopScheduledBackups,
} = require('../backend/backup');
const { getDb } = require('../backend/db');

before(() => {
  const db = getDb();
  db.prepare(`INSERT INTO editions (name, is_custom) VALUES ('Test backup', 1)`).run();
});

after(() => {
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('runBackup() sans répertoire configuré : no-op, renvoie null', async () => {
  assert.strictEqual(await runBackup(undefined), null, 'sans destDir explicite ni ETAPEFORGE_BACKUP_DIR : pas de sauvegarde');
});

test('backupFileName() : nom horodaté ISO, triable chronologiquement', () => {
  const a = backupFileName(new Date('2026-08-23T14:00:00.000Z'));
  const b = backupFileName(new Date('2026-08-23T15:00:00.000Z'));
  assert.strictEqual(a, 'etapeforge-2026-08-23T14-00-00-000Z.sqlite');
  assert.ok(a < b, 'tri alphabétique des noms = tri chronologique');
});

test('runBackup(destDir) : produit une base SQLite valide avec les mêmes données', async () => {
  const destDir = path.join(os.tmpdir(), `etapeforge-backup-dest-${process.pid}-${Date.now()}`);
  try {
    const dest = await runBackup(destDir);
    assert.ok(dest, 'chemin de sauvegarde renvoyé');
    assert.ok(fs.existsSync(dest));
    const copy = new Database(dest, { readonly: true });
    const row = copy.prepare(`SELECT name FROM editions WHERE name = 'Test backup'`).get();
    assert.ok(row, 'la sauvegarde contient bien les données de la base source');
    copy.close();
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
});

test('pruneOldBackups() : ne garde que les `keep` sauvegardes les plus récentes', async () => {
  const destDir = path.join(os.tmpdir(), `etapeforge-backup-prune-${process.pid}-${Date.now()}`);
  fs.mkdirSync(destDir, { recursive: true });
  try {
    const names = [
      'etapeforge-2026-08-20T00-00-00-000Z.sqlite',
      'etapeforge-2026-08-21T00-00-00-000Z.sqlite',
      'etapeforge-2026-08-22T00-00-00-000Z.sqlite',
      'etapeforge-2026-08-23T00-00-00-000Z.sqlite',
      'ignore-moi.txt', // ne matche pas le motif de nom — jamais supprimé, jamais compté
    ];
    for (const n of names) fs.writeFileSync(path.join(destDir, n), 'x');
    const removed = pruneOldBackups(destDir, 2);
    assert.strictEqual(removed, 2);
    const remaining = fs.readdirSync(destDir).sort();
    assert.deepStrictEqual(remaining, [
      'etapeforge-2026-08-22T00-00-00-000Z.sqlite',
      'etapeforge-2026-08-23T00-00-00-000Z.sqlite',
      'ignore-moi.txt',
    ], 'garde les 2 plus récentes + le fichier hors-motif, jamais touché');
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
});

test('getBackupStatus() : enabled=false sans répertoire, reflète les fichiers présents sinon', async () => {
  assert.deepStrictEqual(getBackupStatus(undefined), { enabled: false });

  const destDir = path.join(os.tmpdir(), `etapeforge-backup-status-${process.pid}-${Date.now()}`);
  try {
    await runBackup(destDir);
    const status = getBackupStatus(destDir);
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.dir, destDir);
    assert.strictEqual(status.count, 1);
    assert.ok(status.lastBackupFile);
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
});

test('startScheduledBackups() : sans ETAPEFORGE_BACKUP_DIR, ne crée aucun fichier (module chargé sans la variable)', () => {
  // Le module a été chargé au tout début de ce fichier, sans ETAPEFORGE_BACKUP_DIR
  // dans l'environnement — startScheduledBackups() doit donc être un no-op.
  assert.doesNotThrow(() => startScheduledBackups());
  stopScheduledBackups(); // no-op ici aussi, mais vérifie que ça ne plante pas
});

test('startScheduledBackups() avec ETAPEFORGE_BACKUP_DIR : sauvegarde immédiate au démarrage (pas d\'attente du premier intervalle)', async (t) => {
  const destDir = path.join(os.tmpdir(), `etapeforge-backup-sched-${process.pid}-${Date.now()}`);
  process.env.ETAPEFORGE_BACKUP_DIR = destDir;
  // 1h : largement au-delà de la durée de ce test (jamais un 2e tick), et
  // reste dans la plage 32 bits attendue par setInterval — une valeur trop
  // grande (ex. 999h) fait taire silencieusement Node.js et retomber
  // l'intervalle à ~1 ms (TimeoutOverflowWarning), ce qui aurait fait
  // déclencher la sauvegarde en boucle serrée pendant et après ce test.
  process.env.ETAPEFORGE_BACKUP_INTERVAL_HOURS = '1';
  delete require.cache[require.resolve('../backend/backup')];
  const fresh = require('../backend/backup');
  t.after(() => {
    fresh.stopScheduledBackups();
    delete process.env.ETAPEFORGE_BACKUP_DIR;
    delete process.env.ETAPEFORGE_BACKUP_INTERVAL_HOURS;
    delete require.cache[require.resolve('../backend/backup')];
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  fresh.startScheduledBackups();
  // La sauvegarde immédiate est asynchrone (fire-and-forget) — attendre le
  // fichier lui-même, pas juste le répertoire (créé de façon synchrone dès
  // l'appel, avant même que la copie asynchrone n'ait écrit quoi que ce soit).
  let files = [];
  for (let i = 0; i < 50 && files.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 20));
    files = fs.existsSync(destDir) ? fs.readdirSync(destDir) : [];
  }
  assert.strictEqual(files.length, 1, 'une sauvegarde immédiate au démarrage, sans attendre l\'intervalle');
});
