'use strict';
// Sauvegarde automatique de la base SQLite (backlog issue #10, section E) —
// désactivée par défaut (ETAPEFORGE_BACKUP_DIR non défini = comportement
// inchangé). Utilise l'API de sauvegarde native de better-sqlite3 (copie
// cohérente même pendant des écritures concurrentes, contrairement à une
// copie de fichier brute en mode WAL — voir docs/SYNOLOGY.md, section
// « Sauvegarde », qui recommandait jusqu'ici d'arrêter le conteneur pour une
// copie garantie cohérente).

const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

const BACKUP_DIR = process.env.ETAPEFORGE_BACKUP_DIR || null;
const BACKUP_INTERVAL_HOURS = Number(process.env.ETAPEFORGE_BACKUP_INTERVAL_HOURS) || 24;
const BACKUP_KEEP = Number(process.env.ETAPEFORGE_BACKUP_KEEP) || 7;
const NAME_RE = /^etapeforge-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/;

function backupFileName(date) {
  return `etapeforge-${date.toISOString().replace(/[:.]/g, '-')}.sqlite`;
}

/** Supprime les sauvegardes les plus anciennes au-delà de `keep` (noms ISO : tri alphabétique = tri chronologique). */
function pruneOldBackups(destDir, keep = BACKUP_KEEP) {
  const files = fs.readdirSync(destDir).filter((f) => NAME_RE.test(f)).sort();
  const excess = files.length - keep;
  for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(destDir, files[i]));
  return excess > 0 ? excess : 0;
}

/** Sauvegarde immédiate vers `destDir` (par défaut ETAPEFORGE_BACKUP_DIR). Renvoie le chemin créé, ou null si aucun répertoire n'est configuré. */
async function runBackup(destDir = BACKUP_DIR, date = new Date()) {
  if (!destDir) return null;
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, backupFileName(date));
  await getDb().backup(dest);
  pruneOldBackups(destDir);
  return dest;
}

let timer = null;

/** Démarre la sauvegarde périodique si ETAPEFORGE_BACKUP_DIR est défini — no-op sinon. */
function startScheduledBackups() {
  if (!BACKUP_DIR || timer) return;
  runBackup().catch((err) => console.error('Sauvegarde automatique échouée :', err.message));
  timer = setInterval(
    () => runBackup().catch((err) => console.error('Sauvegarde automatique échouée :', err.message)),
    BACKUP_INTERVAL_HOURS * 3600 * 1000
  );
  timer.unref(); // ne doit jamais empêcher le process de s'arrêter proprement
}

function stopScheduledBackups() {
  clearInterval(timer);
  timer = null;
}

/** État exposé par GET /api/status — pour vérifier que la sauvegarde est bien active, pas juste configurée. */
function getBackupStatus(destDir = BACKUP_DIR) {
  if (!destDir) return { enabled: false };
  let files = [];
  try {
    files = fs.readdirSync(destDir).filter((f) => NAME_RE.test(f)).sort();
  } catch { /* pas encore créé — première sauvegarde pas encore passée */ }
  return {
    enabled: true,
    dir: destDir,
    intervalHours: BACKUP_INTERVAL_HOURS,
    keep: BACKUP_KEEP,
    count: files.length,
    lastBackupFile: files.length ? files[files.length - 1] : null,
  };
}

module.exports = {
  runBackup, pruneOldBackups, backupFileName, getBackupStatus,
  startScheduledBackups, stopScheduledBackups,
  BACKUP_DIR, BACKUP_INTERVAL_HOURS, BACKUP_KEEP,
};
