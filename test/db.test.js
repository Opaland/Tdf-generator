'use strict';
// Test de la migration idempotente ensureColumn() (backend/db.js) — ajouter
// une colonne à une table déjà créée par une installation existante
// (Synology/LAN, base persistante) sans casser ces bases. `CREATE TABLE IF
// NOT EXISTS` ne touche jamais une table déjà présente, donc une nouvelle
// colonne sur une table existante (ex. climbs.irregularity_index, backlog
// issue #10 section C) a besoin d'un ALTER TABLE explicite et sûr à rejouer.

const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { test } = require('node:test');
const assert = require('node:assert');
const { ensureColumn } = require('../backend/db');

function tmpDb() {
  const file = path.join(os.tmpdir(), `etapeforge-db-migration-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`);
  return { db: new Database(file), file };
}

test('ensureColumn : ajoute une colonne manquante à une table existante', () => {
  const { db, file } = tmpDb();
  try {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    let cols = db.prepare('PRAGMA table_info(t)').all().map((c) => c.name);
    assert.deepStrictEqual(cols, ['id']);

    ensureColumn(db, 't', 'foo', 'foo REAL');
    cols = db.prepare('PRAGMA table_info(t)').all().map((c) => c.name);
    assert.deepStrictEqual(cols.sort(), ['foo', 'id']);
  } finally {
    db.close();
    fs.rmSync(file, { force: true });
  }
});

test('ensureColumn : idempotent, ne plante pas si la colonne existe déjà', () => {
  const { db, file } = tmpDb();
  try {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    ensureColumn(db, 't', 'foo', 'foo REAL');
    assert.doesNotThrow(() => ensureColumn(db, 't', 'foo', 'foo REAL'));
    const cols = db.prepare('PRAGMA table_info(t)').all().map((c) => c.name);
    assert.strictEqual(cols.filter((c) => c === 'foo').length, 1, 'une seule colonne foo, pas de doublon');
  } finally {
    db.close();
    fs.rmSync(file, { force: true });
  }
});

test('ensureColumn : préserve les données existantes de la table', () => {
  const { db, file } = tmpDb();
  try {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO t (id, name) VALUES (1, ?)').run('avant migration');
    ensureColumn(db, 't', 'foo', 'foo REAL');
    const row = db.prepare('SELECT * FROM t WHERE id = 1').get();
    assert.strictEqual(row.name, 'avant migration');
    assert.strictEqual(row.foo, null, 'nouvelle colonne : NULL sur les lignes existantes, pas d\'erreur');
  } finally {
    db.close();
    fs.rmSync(file, { force: true });
  }
});

test('getDb() : la table climbs porte bien irregularity_index (base fraîche)', () => {
  // Premier (et seul) appel à getDb() de ce fichier de test — le singleton
  // interne de backend/db.js n'a donc pas encore été initialisé, pas besoin
  // de invalider le cache require() (voir CLAUDE.md règle 4 : un état mis en
  // cache au premier require() n'est fiable qu'une fois par process — ici on
  // reste dans les clous, une seule initialisation).
  const dataDir = path.join(os.tmpdir(), `etapeforge-db-getdb-test-${process.pid}-${Date.now()}`);
  process.env.ETAPEFORGE_DATA_DIR = dataDir;
  try {
    const { getDb } = require('../backend/db');
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(climbs)').all().map((c) => c.name);
    assert.ok(cols.includes('irregularity_index'), `colonnes climbs : ${cols.join(', ')}`);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
