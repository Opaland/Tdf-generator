'use strict';
// backend/db.js, migrate() (Epic 27.1) : schéma versionné par PRAGMA
// user_version. Chaque test ouvre sa propre base temporaire et appelle
// migrate() directement — jamais getDb(), singleton figé au premier require
// (CLAUDE.md règle 4).

const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, after } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { migrate, MIGRATIONS, SCHEMA_VERSION } = require('../backend/db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-migrations-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const open = () => new Database(path.join(dir, `b${n++}.sqlite`));
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('migrate : base neuve → toutes les migrations, user_version = dernière', () => {
  const db = open();
  assert.deepStrictEqual(migrate(db), MIGRATIONS.map((m) => m.version));
  assert.strictEqual(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(cols(db, 'editions').includes('category'));
  assert.ok(cols(db, 'settings').includes('value'));
  db.close();
});

test('migrate : idempotent — second appel sans effet', () => {
  const db = open();
  migrate(db);
  assert.deepStrictEqual(migrate(db), []);
  db.close();
});

test('migrate : base antérieure au versionnement (user_version 0, colonnes manquantes) → données conservées, colonnes ajoutées', () => {
  const db = open();
  // État réaliste d'une vieille installation : tables sans les colonnes
  // ajoutées plus tard par ensureColumn, une édition et une étape déjà là.
  db.exec(`
    CREATE TABLE editions (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER, name TEXT NOT NULL,
      source TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE stages (id INTEGER PRIMARY KEY AUTOINCREMENT, edition_id INTEGER REFERENCES editions(id) ON DELETE CASCADE,
      stage_order INTEGER, name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft');
    INSERT INTO editions (year, name) VALUES (1903, 'Tour de France 1903');
    INSERT INTO stages (edition_id, stage_order, name, state) VALUES (1, 1, 'Paris → Lyon', 'done');
  `);
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);
  migrate(db);
  assert.strictEqual(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepStrictEqual(db.prepare('SELECT year, name, category FROM editions').get(), { year: 1903, name: 'Tour de France 1903', category: 'hommes' });
  assert.deepStrictEqual(db.prepare('SELECT name, state, avg_speed_kmh FROM stages').get(), { name: 'Paris → Lyon', state: 'done', avg_speed_kmh: null });
  db.close();
});

test('migrate : une migration qui échoue est annulée en entier, user_version inchangé', () => {
  const db = open();
  migrate(db);
  const before = db.pragma('user_version', { simple: true });
  MIGRATIONS.push({ version: SCHEMA_VERSION + 1, up(d) { d.exec('CREATE TABLE tmp_x (a)'); throw new Error('panne'); } });
  try {
    assert.throws(() => migrate(db), /panne/);
  } finally {
    MIGRATIONS.pop();
  }
  assert.strictEqual(db.pragma('user_version', { simple: true }), before);
  assert.strictEqual(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tmp_x'").get(), undefined);
  db.close();
});

test('migrate : base plus récente que le code → rien n\'est touché', () => {
  const db = open();
  db.pragma(`user_version = ${SCHEMA_VERSION + 5}`);
  const warn = console.warn;
  let warned = '';
  console.warn = (m) => { warned = m; };
  try {
    assert.deepStrictEqual(migrate(db), []);
  } finally {
    console.warn = warn;
  }
  assert.match(warned, /plus récent/);
  assert.strictEqual(db.prepare("SELECT count(*) c FROM sqlite_master WHERE type = 'table'").get().c, 0);
  db.close();
});
