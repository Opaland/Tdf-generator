'use strict';
// Copie et suppression récursives qui tiennent sous Windows dans un chemin
// non ASCII (Epic 36.1 et 36.2). Constaté le 21/10/2026 dans un dépôt cloné
// sous C:\Users\Moretti Cédric\… :
// - fs.cpSync (binding natif cpSyncCopyDir, Node 22.23 et 24.13) sort en
//   code 127 sans message, ou lève EIO « Access is denied » ;
// - fs.rmSync (Node 24.13) ne supprime rien et ne lève rien, dossier comme
//   simple fichier — build-site ne vidait plus dist/.
// readdirSync, copyFileSync, unlinkSync et rmdirSync n'ont pas ce défaut.

const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** Supprime un fichier ou un dossier et son contenu ; absent, ou disparu
 * pendant le parcours : rien (comme rmSync { recursive, force }). Un lien
 * symbolique est retiré, jamais suivi. */
function removeSync(p) {
  try {
    if (fs.lstatSync(p).isDirectory()) {
      for (const name of fs.readdirSync(p)) removeSync(path.join(p, name));
      fs.rmdirSync(p);
    } else {
      fs.unlinkSync(p);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { copyDir, removeSync };
