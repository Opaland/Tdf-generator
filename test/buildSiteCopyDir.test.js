'use strict';
// copyDir (scripts/build-site.js) remplace fs.cpSync, qui sort en code 127
// sans message sous Windows dès que le chemin contient un caractère non
// ASCII (Epic 36.1). Le dossier de test porte donc un « é » : sous Windows,
// revenir à fs.cpSync fait tomber ce test ; ailleurs, il vérifie au moins
// que la copie est complète (sous-dossier, dossier vide, fichier caché,
// binaire intact).

const os = require('os');
const path = require('path');
const fs = require('fs');
const { test, after } = require('node:test');
const assert = require('node:assert');
const { copyDir } = require('../scripts/build-site');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-copydir-é-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('copyDir : copie récursive complète dans un chemin accentué', () => {
  const src = path.join(dir, 'sourcé');
  fs.mkdirSync(path.join(src, 'icônes', 'vide'), { recursive: true });
  const bin = Buffer.from([0, 255, 13, 10, 0x89, 0x50]);
  fs.writeFileSync(path.join(src, 'icônes', 'a.png'), bin);
  fs.writeFileSync(path.join(src, '.caché'), 'x');
  fs.writeFileSync(path.join(src, 'style.css'), 'body{}');

  const dest = path.join(dir, 'dist', 'copié');
  copyDir(src, dest);

  assert.deepStrictEqual(fs.readFileSync(path.join(dest, 'icônes', 'a.png')), bin);
  assert.strictEqual(fs.readFileSync(path.join(dest, '.caché'), 'utf8'), 'x');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'style.css'), 'utf8'), 'body{}');
  assert.ok(fs.statSync(path.join(dest, 'icônes', 'vide')).isDirectory());
});
