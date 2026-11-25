'use strict';
// Story 42.3 (WCAG 2.1.1, règle axe scrollable-region-focusable) : un conteneur
// à défilement horizontal doit pouvoir prendre le focus, sinon un tableau plus
// large que l'écran est hors de portée du clavier. La CI l'a trouvé sur
// diag.html avec des données que l'environnement local n'avait pas : on
// vérifie donc chaque conteneur .scrollx, pas seulement ceux qui débordent.
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const DIR = path.join(__dirname, '..', 'frontend');

test('chaque conteneur .scrollx est focalisable et nommé', () => {
  let n = 0;
  for (const f of fs.readdirSync(DIR).filter((x) => /\.(html|js)$/.test(x))) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/<div class="[^"]*\bscrollx\b[^"]*"([^>]*)>/g)) {
      n++;
      assert.match(m[1], /tabindex="0"/, `${f} : .scrollx sans tabindex="0"`);
      assert.match(m[1], /role="region"/, `${f} : .scrollx sans role="region"`);
      assert.match(m[1], /aria-label="[^"]+"/, `${f} : .scrollx sans nom accessible`);
    }
  }
  assert.ok(n >= 7, `${n} conteneurs .scrollx trouvés, 7 attendus au moins`);
});
