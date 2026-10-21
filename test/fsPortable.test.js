'use strict';
// pipeline/fsPortable.js (Epic 36.1, 36.2) : sous Windows, dans un chemin non
// ASCII, fs.cpSync sort en code 127 sans message et fs.rmSync (Node 24) ne
// supprime rien sans rien lever. Les dossiers de test portent donc un « é » :
// sous Windows, revenir à fs.cpSync ou fs.rmSync fait tomber ces tests ;
// ailleurs, ils vérifient au moins que copie et suppression sont complètes.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { copyDir, removeSync } = require('../pipeline/fsPortable');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-fsportable-é-'));
after(() => removeSync(dir));

const tree = (root) => {
  fs.mkdirSync(path.join(root, 'icônes', 'vide'), { recursive: true });
  fs.writeFileSync(path.join(root, 'icônes', 'a.png'), Buffer.from([0, 255, 13, 10, 0x89, 0x50]));
  fs.writeFileSync(path.join(root, '.caché'), 'x');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
};

test('copyDir : copie récursive complète dans un chemin accentué', () => {
  const src = path.join(dir, 'sourcé');
  tree(src);
  const dest = path.join(dir, 'dist', 'copié');
  copyDir(src, dest);

  assert.deepStrictEqual(fs.readFileSync(path.join(dest, 'icônes', 'a.png')), Buffer.from([0, 255, 13, 10, 0x89, 0x50]));
  assert.strictEqual(fs.readFileSync(path.join(dest, '.caché'), 'utf8'), 'x');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'style.css'), 'utf8'), 'body{}');
  assert.ok(fs.statSync(path.join(dest, 'icônes', 'vide')).isDirectory());
});

test('removeSync : dossier accentué supprimé avec son contenu, fichier seul aussi, absent sans erreur', () => {
  const d = path.join(dir, 'à-supprimer');
  tree(d);
  removeSync(d);
  assert.strictEqual(fs.existsSync(d), false);

  const f = path.join(dir, 'fichier-é.txt');
  fs.writeFileSync(f, 'x');
  removeSync(f);
  assert.strictEqual(fs.existsSync(f), false);

  assert.doesNotThrow(() => removeSync(path.join(dir, 'absent-é')));
});

test('build-site vide dist/ avant de reconstruire, même dans un chemin accentué', () => {
  const dist = path.join(dir, 'dist-é');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'stage-999.json'), '{"périmé":true}');
  const env = { ...process.env, ETAPEFORGE_DATA_DIR: path.join(dir, 'data-é'), ETAPEFORGE_OFFLINE: '1', ETAPEFORGE_DIST_DIR: dist };
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.js')], { env, stdio: 'pipe', timeout: 120000 });
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'site reconstruit');
  assert.strictEqual(fs.existsSync(path.join(dist, 'stage-999.json')), false, 'un fichier d’une construction précédente reste publié');
});

test('aucun fs.rmSync ni fs.cpSync hors des tests : pipeline/fsPortable.js à la place', () => {
  const files = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.posix.join(d, e.name)) : e.name.endsWith('.js') ? [path.posix.join(d, e.name)] : []));
  const hits = ['backend', 'pipeline', 'scripts']
    .flatMap(files)
    .filter((f) => /\b(rmSync|cpSync)\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepStrictEqual(hits, []);
});
