'use strict';
// Administration : mode hors-ligne, diagnostic, quotas d'API, sauvegarde portable.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { getDb, SCHEMA_VERSION } = require('../db');
const { isOffline, setOffline } = require('../../pipeline/http');
const { getUsageStats: getApiUsageStats } = require('../../pipeline/apiUsage');
const { wrap } = require('../apiHelpers');
const SERVER_START_TIME = new Date().toISOString();
module.exports = function register(app) {
  app.post('/api/offline', (req, res) => {
    setOffline(!!req.body.offline);
    res.json({ offline: isOffline() });
  });

  // Diagnostic de connectivité vers chaque API externe (une micro-requête par
  // service, timeout 8 s, sans cache) — pour vérifier le mode « live » chez soi.
  // Sondes extraites dans pipeline/diagnostic.js (réutilisées par
  // scripts/demo.js --online, Chantier L "CI de vérification croisée périodique").
  app.get('/api/diagnostic', wrap(async (req, res) => {
    const { runDiagnostic } = require('../../pipeline/diagnostic');
    const { allOk, results } = await runDiagnostic();
    res.json({ allOk, offline: isOffline(), results });
  }));

  // Compteur de requêtes envoyées à chaque hôte externe depuis le démarrage du
  // process (backlog issue #10, section E, « dashboard de consommation des
  // quotas API ») — en mémoire, pas d'historique persistant (voir
  // pipeline/apiUsage.js).
  app.get('/api/quota', (req, res) => {
    res.json({ since: SERVER_START_TIME, usage: getApiUsageStats() });
  });

  // ------------------------------------------------- sauvegarde portable (export/import)
  // Complète (ne remplace pas) la sauvegarde automatique de fichier .sqlite
  // (backend/backup.js, ETAPEFORGE_BACKUP_DIR) : celle-ci sert la reprise
  // après sinistre sur la même installation ; ceci sert la portabilité —
  // déplacer ses données vers une autre instance, ou en garder une copie
  // hors rotation. Format JSON lisible plutôt qu'un dump binaire, pour rester
  // inspectable/diffable. Périmètre volontairement limité aux tables de
  // données produit : ni users/sessions (jamais exporter un hash de mot de
  // passe ou un identifiant de session, même haché), ni les caches d'appels
  // externes (geocode_cache/elevation_cache/api_cache — régénérables, pas des
  // données produit).
  const BACKUP_TABLES = ['editions', 'stages', 'waypoints', 'tracks', 'elevation_samples', 'climbs', 'descents', 'km_analysis'];

  // Number.isFinite, pas juste typeof === 'number' : better-sqlite3 accepte
  // NaN/Infinity comme paramètre lié sans se plaindre (vérifié directement),
  // contrairement à optionalNumber() plus haut qui les rejette déjà pour les
  // routes /api/stages. Un fichier de sauvegarde forgé (ou corrompu) avec
  // `1e999` sur un champ numérique — JSON.parse('1e999') === Infinity, valeur
  // JSON syntaxiquement valide — passait cette garde et empoisonnait
  // silencieusement une colonne (distance, D+, altitude) avec Infinity/NaN
  // (trouvaille de sprint dédié).
  function isBindable(v) {
    return v === null || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'bigint';
  }

  function tableColumns(db, table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  }

  // isBindable() ne vérifie que le type *bindable* par better-sqlite3
  // (string | number | bigint | null), jamais le type *sémantique* attendu par
  // la colonne SQLite elle-même. Une chaîne HTML dans une colonne REAL/INTEGER
  // (ex. climbs.summit_ele_m, climbs.length_km) passait donc cette garde et
  // s'écrivait telle quelle, ressortant non échappée dans les exports GPX/TCX/
  // KML/HTML et plusieurs sinks DOM frontend (trouvaille de revue adverse,
  // reproduite par exploitation réelle — voir CLAUDE.md règle 1 : fermer le
  // vecteur trouvé ne suffit pas, toute colonne numérique de toutes les tables
  // de sauvegarde est concernée, pas seulement climbs).
  function tableColumnTypes(db, table) {
    return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => [c.name, c.type]));
  }

  app.get('/api/backup/export', (req, res) => {
    const db = getDb();
    const tables = {};
    for (const t of BACKUP_TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="etapeforge-sauvegarde-${stamp}.json"`);
    // `version` = format du fichier de sauvegarde (inchangé) ; `schema_version`
    // = migration SQLite de la base source (backend/db.js), pour diagnostiquer
    // une restauration entre deux versions du code.
    res.json({ version: 1, schema_version: SCHEMA_VERSION, exported_at: db.prepare(`SELECT datetime('now') d`).get().d, tables });
  });

  /**
   * Réimport complet : REMPLACE le contenu des tables de données produit par
   * celui du fichier fourni — pas de fusion, pas de synchronisation
   * multi-instance. Toute donnée produit absente du fichier est perdue.
   * `confirm: true` explicite requis pour qu'un appel accidentel ne vide pas
   * la base. Chaque colonne est validée (nom connu du schéma réel, valeur
   * d'un type accepté par better-sqlite3) avant toute écriture — CLAUDE.md
   * règle 8 — et l'ensemble tourne dans une transaction : un fichier
   * incompatible laisse la base inchangée, jamais à moitié vidée.
   */
  app.post('/api/backup/import', (req, res) => {
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({ error: 'confirm: true requis — cette opération remplace toutes les données produit existantes.' });
    }
    if (!body.tables || typeof body.tables !== 'object' || Array.isArray(body.tables)) {
      return res.status(400).json({ error: 'tables (objet) requis' });
    }
    const db = getDb();
    const perTable = {};
    for (const t of BACKUP_TABLES) {
      const rows = Array.isArray(body.tables[t]) ? body.tables[t] : [];
      if (!rows.length) { perTable[t] = { cols: [], rows: [] }; continue; }
      const allowed = new Set(tableColumns(db, t));
      const colTypes = tableColumnTypes(db, t);
      const cols = Object.keys(rows[0]);
      for (const c of cols) {
        if (!allowed.has(c)) return res.status(400).json({ error: `${t}.${c} : colonne inconnue, fichier incompatible avec ce schéma` });
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowCols = Object.keys(row);
        if (rowCols.length !== cols.length || !rowCols.every((c) => cols.includes(c))) {
          return res.status(400).json({ error: `${t}[${i}] : colonnes incohérentes avec les autres lignes de cette table` });
        }
        for (const c of cols) {
          const v = row[c];
          if (!isBindable(v)) return res.status(400).json({ error: `${t}[${i}].${c} : type non pris en charge (${typeof v})` });
          const declared = colTypes.get(c);
          if (v !== null && (declared === 'REAL' || declared === 'INTEGER') && typeof v !== 'number' && typeof v !== 'bigint') {
            return res.status(400).json({ error: `${t}[${i}].${c} : colonne numérique (${declared}), valeur reçue de type ${typeof v}` });
          }
        }
      }
      perTable[t] = { cols, rows };
    }
    const run = db.transaction(() => {
      for (const t of [...BACKUP_TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
      for (const t of BACKUP_TABLES) {
        const { cols, rows } = perTable[t];
        if (!rows.length) continue;
        const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        for (const row of rows) stmt.run(cols.map((c) => row[c]));
      }
    });
    try {
      run();
    } catch (err) {
      return res.status(400).json({ error: `Réimport échoué, base inchangée (transaction annulée) : ${err.message}` });
    }
    res.json({ ok: true, counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, perTable[t].rows.length])) });
  });
};
