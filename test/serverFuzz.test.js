'use strict';
// Régression sur deux bugs trouvés par fuzzing (monkey test API, persona
// "Fatiha") et corrigés dans la foulée :
//  1. POST/PUT sur /api/stages et /api/editions plantait en 500 (avec fuite
//     de stack trace incluant les chemins de fichiers du serveur) dès qu'un
//     champ attendu en chaîne recevait un objet/tableau/booléen — SQLite
//     (better-sqlite3) n'accepte que number/string/bigint/buffer/null comme
//     paramètre lié.
//  2. Le mini-site HTML exporté (backend/exports.js) était vulnérable à une
//     évasion de balise <script> : un nom d'étape contenant le texte littéral
//     "</script>" fermait prématurément le <script> qui embarque les
//     données JSON, faisant passer le reste du payload comme du HTML brut
//     interprété par le navigateur — indépendamment de tout échappement côté
//     JS client (le DOM-sink escHtml() ajouté plus tôt ne protégeait pas
//     contre cette évasion au niveau du parseur HTML lui-même).

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-serverfuzz-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer?.close();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const NON_STRINGS = [{}, [], [1, 2, 3], true, false];

for (const bad of NON_STRINGS) {
  test(`POST /api/stages avec name=${JSON.stringify(bad)} : 400 propre, pas 500`, async () => {
    const res = await fetch(`${base}/api/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bad, waypoints: [{ label: 'A' }, { label: 'B' }] }),
    });
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.ok(json.error);
  });
}

test('POST /api/editions avec name non-chaîne : 400 propre, pas 500', async () => {
  const res = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: { toString: () => 'x' } }),
  });
  assert.strictEqual(res.status, 400);
});

test('POST /api/editions avec year non-numérique : 400 propre, pas 500', async () => {
  const res = await fetch(`${base}/api/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Édition test', year: ['pas un an'] }),
  });
  assert.strictEqual(res.status, 400);
});

// Trouvaille de sprint dédié : pipeline/importer.js posait déjà .status=400
// sur la validation de catégorie (Chantier L, Tour de France Femmes) mais
// pas sur la validation d'année juste au-dessus — une année absente, non
// numérique ou hors plage renvoyait donc 500 (journalisé côté serveur
// comme une panne inattendue) au lieu de 400 pour une simple erreur de
// saisie utilisateur.
for (const bad of [1900, 3000, 'abc', {}]) {
  test(`POST /api/editions/import avec year=${JSON.stringify(bad)} : 400 propre, pas 500`, async () => {
    const res = await fetch(`${base}/api/editions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: bad }),
    });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /Année invalide/);
  });
}

test('PUT /api/stages/:id avec des champs non-chaîne : 400 propre, pas 500', async () => {
  const create = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape valide', waypoints: [{ label: 'A' }, { label: 'B' }] }),
  });
  const { id } = await create.json();
  const res = await fetch(`${base}/api/stages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: [1, 2, 3] }),
  });
  assert.strictEqual(res.status, 400);
});

// Trouvaille de sprint dédié : lat et lon sont validés indépendamment
// (optionalNumber() sur chacun séparément), donc un waypoint avec l'un
// défini et l'autre absent passait la validation et finissait en base
// ainsi. frontend/editor.js:85 fait `wp.lon.toFixed(4)` dès que
// `wp.lat != null` sans re-vérifier lon — une paire dépareillée y lève une
// TypeError qui casse tout le rendu de la liste de waypoints.
test('POST /api/stages avec un waypoint lat sans lon : 400 propre, pas stocké dépareillé', async () => {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape lat sans lon', waypoints: [{ label: 'A', lat: 45.5 }, { label: 'B' }] }),
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /lat et lon doivent être fournis ensemble/);
});

test('POST /api/stages avec un waypoint lon sans lat : 400 propre (symétrique)', async () => {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape lon sans lat', waypoints: [{ label: 'A', lon: 2.3 }, { label: 'B' }] }),
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /lat et lon doivent être fournis ensemble/);
});

test('POST /api/stages avec lat ET lon, ou ni l\'un ni l\'autre : accepté (paire cohérente)', async () => {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape paires cohérentes',
      waypoints: [{ label: 'A', lat: 45.5, lon: 2.3 }, { label: 'B' }],
    }),
  });
  assert.strictEqual(res.status, 200);
});

test('PUT /api/stages/:id avec un waypoint lat sans lon : 400 propre', async () => {
  const create = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape à modifier', waypoints: [{ label: 'A' }, { label: 'B' }] }),
  });
  const { id } = await create.json();
  const res = await fetch(`${base}/api/stages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints: [{ label: 'A', lat: 45.5 }, { label: 'B' }] }),
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /lat et lon doivent être fournis ensemble/);
});

test('erreur non gérée : JSON propre, jamais la page HTML par défaut d\'Express (fuite de stack trace)', async () => {
  const res = await fetch(`${base}/api/stages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: true, waypoints: [{ label: 'A' }, { label: 'B' }] }),
  });
  assert.strictEqual(res.headers.get('content-type')?.includes('application/json'), true);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
  assert.ok(!text.includes('<pre>'), 'pas la page d\'erreur HTML par défaut d\'Express');
});

test('export.html : une évasion de balise </script> dans le nom d\'étape est neutralisée', async () => {
  const ed = await (await fetch(`${base}/api/editions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Fuzz XSS regression', is_custom: 1 }),
  })).json();

  const payload = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
  await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: payload, edition_id: ed.id, stage_order: 1,
      waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }],
    }),
  });

  const html = await (await fetch(`${base}/api/editions/${ed.id}/site`)).text();
  assert.ok(!html.includes('<script>window.__xss=1</script>'), 'le payload ne doit jamais apparaître comme un vrai tag <script> non échappé');
  assert.ok(!html.includes('<img src=x onerror='), 'le payload ne doit jamais apparaître comme un vrai tag <img> non échappé');
  assert.match(html, /\\u003cscript>window\.__xss=1/, 'le JSON embarqué doit échapper les < en \\u003c (évite la fermeture prématurée du <script> englobant)');
});

test('étape/export.html (fiche individuelle, backlog #10 section D) : même évasion </script>, même neutralisation', async () => {
  // Régression identique à la précédente mais sur stageToStandaloneHtml
  // (nouvelle fonction sœur de tourToStandaloneHtml) — CLAUDE.md règle 1 :
  // corriger la faille sur un chemin ne ferme pas la classe de bug sur un
  // autre chemin qui la réintroduit indépendamment.
  const payload = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: payload, waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();

  const html = await (await fetch(`${base}/api/stages/${create.id}/site`)).text();
  assert.ok(!html.includes('<script>window.__xss=1</script>'), 'le payload ne doit jamais apparaître comme un vrai tag <script> non échappé');
  assert.ok(!html.includes('<img src=x onerror='), 'le payload ne doit jamais apparaître comme un vrai tag <img> non échappé');
  assert.match(html, /\\u003cscript>window\.__xss=1/, 'le JSON embarqué doit échapper les < en \\u003c (évite la fermeture prématurée du <script> englobant)');
});

test('GET /api/stages/:id/export.html : téléchargement (Content-Disposition attachment)', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape à exporter', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const res = await fetch(`${base}/api/stages/${create.id}/export.html`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-disposition')?.includes('attachment'));
  assert.ok(res.headers.get('content-type')?.includes('text/html'));
});

test('GET /api/stages/:id/export.html : étape introuvable → erreur JSON propre, pas 500 avec fuite de stack', async () => {
  const res = await fetch(`${base}/api/stages/999999/export.html`);
  assert.notStrictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
});

test('GET /api/stages/:id/export.tcx : XML bien formé, noms tronqués au format TCX (Course 15 car., CoursePoint 10 car.)', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape 18 : Pau → Bagnères-de-Luchon via le Tourmalet',
      waypoints: [
        { label: 'Bagnères-de-Luchon' },
        { label: 'Col du Tourmalet', kind: 'col' },
        { label: 'Pau' },
      ],
    }),
  })).json();
  await generateStage(create.id);

  const res = await fetch(`${base}/api/stages/${create.id}/export.tcx`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-disposition')?.includes('attachment'));
  assert.ok(res.headers.get('content-type')?.includes('tcx'));
  const xml = await res.text();

  // XML bien formé : parse sans lever d'exception (pas de balise mal fermée,
  // pas de caractère spécial non échappé dans les Name/Notes interpolés).
  assert.doesNotThrow(() => {
    if (!xml.startsWith('<?xml')) throw new Error('pas de prologue XML');
    const stack = [];
    const tagRe = /<\/?([a-zA-Z][\w:]*)[^>]*?(\/)?>/g;
    let m;
    while ((m = tagRe.exec(xml))) {
      const [full, tag, selfClose] = m;
      if (selfClose || full.startsWith('<?')) continue;
      if (full.startsWith('</')) {
        const top = stack.pop();
        if (top !== tag) throw new Error(`fermeture inattendue </${tag}>, attendu </${top}>`);
      } else {
        stack.push(tag);
      }
    }
    if (stack.length) throw new Error(`balises non fermées : ${stack.join(',')}`);
  });

  assert.match(xml, /<TrainingCenterDatabase/);
  assert.match(xml, /<Trackpoint>/);
  assert.match(xml, /<CoursePoint>/);

  // Le nom de l'étape (39 caractères) dépasse la limite TCX de 15 caractères
  // pour Course/Name (RestrictedToken_t) — doit être tronqué, pas rejeté.
  const courseName = xml.match(/<Course>\s*<Name>([^<]*)<\/Name>/)?.[1];
  assert.ok(courseName && courseName.length <= 15, `Course/Name doit tenir en 15 car. (reçu "${courseName}")`);

  // "Col du Tourmalet" (17 caractères) dépasse la limite TCX de 10 caractères
  // pour CoursePointName_t — doit être tronqué dans <Name>, mais le libellé
  // complet doit rester lisible dans <Notes> (non contraint par le schéma).
  const names = [...xml.matchAll(/<CoursePoint>[\s\S]*?<Name>([^<]*)<\/Name>/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'au moins un CoursePoint généré (via ou côte)');
  for (const n of names) assert.ok(n.length <= 10, `CoursePoint/Name doit tenir en 10 car. (reçu "${n}")`);
  assert.match(xml, /Col du Tourmalet/, 'le libellé complet doit rester lisible dans <Notes>');
});

test('GET /api/stages/:id/export.tcx : étape non générée → 404 propre, pas de plantage sur samples vide', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape jamais générée', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const res = await fetch(`${base}/api/stages/${create.id}/export.tcx`);
  assert.strictEqual(res.status, 404);
});

test('GET /api/stages/:id/export.tcx : étape introuvable → erreur JSON propre, pas 500 avec fuite de stack', async () => {
  const res = await fetch(`${base}/api/stages/999999/export.tcx`);
  assert.notStrictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
});

test('GET /api/stages/:id/export.kml : XML bien formé, contient le tracé (LineString) et les points de passage (Point)', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape 18 : Pau → Bagnères-de-Luchon via le Tourmalet',
      waypoints: [
        { label: 'Bagnères-de-Luchon' },
        { label: 'Col du Tourmalet', kind: 'col' },
        { label: 'Pau' },
      ],
    }),
  })).json();
  await generateStage(create.id);

  const res = await fetch(`${base}/api/stages/${create.id}/export.kml`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-disposition')?.includes('attachment'));
  assert.ok(res.headers.get('content-type')?.includes('kml'));
  const xml = await res.text();

  assert.doesNotThrow(() => {
    if (!xml.startsWith('<?xml')) throw new Error('pas de prologue XML');
    const stack = [];
    const tagRe = /<\/?([a-zA-Z][\w:]*)[^>]*?(\/)?>/g;
    let m;
    while ((m = tagRe.exec(xml))) {
      const [full, tag, selfClose] = m;
      if (selfClose || full.startsWith('<?')) continue;
      if (full.startsWith('</')) {
        const top = stack.pop();
        if (top !== tag) throw new Error(`fermeture inattendue </${tag}>, attendu </${top}>`);
      } else {
        stack.push(tag);
      }
    }
    if (stack.length) throw new Error(`balises non fermées : ${stack.join(',')}`);
  });

  assert.match(xml, /xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2"/);
  assert.match(xml, /<LineString>/);
  assert.match(xml, /<coordinates>/);
  assert.match(xml, /Col du Tourmalet/, 'le libellé complet du waypoint doit apparaître (pas de troncature comme en TCX)');
});

test('GET /api/stages/:id/export.kml : un nom d\'étape avec des caractères spéciaux XML est échappé', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape "spéciale" <test> & Cie', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  await generateStage(create.id);
  const res = await fetch(`${base}/api/stages/${create.id}/export.kml`);
  const xml = await res.text();
  assert.doesNotMatch(xml, /<test>/, 'les chevrons du nom ne doivent jamais former un vrai tag XML');
  assert.match(xml, /&lt;test&gt;/);
});

test('GET /api/stages/:id/export.kml : étape non générée → 404 propre, pas de plantage sur samples vide', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape jamais générée (kml)', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const res = await fetch(`${base}/api/stages/${create.id}/export.kml`);
  assert.strictEqual(res.status, 404);
});

test('GET /api/stages/:id/export.kml : étape introuvable → erreur JSON propre, pas 500 avec fuite de stack', async () => {
  const res = await fetch(`${base}/api/stages/999999/export.kml`);
  assert.notStrictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
});

test('GET /api/stages/:id/roadbook.html : affiché inline (pas en téléchargement), tableau villes/km + côtes + note ravitaillements', async () => {
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape roadbook',
      waypoints: [{ label: 'Pau' }, { label: 'Col du Tourmalet', kind: 'col' }, { label: 'Lourdes' }],
    }),
  })).json();
  await generateStage(create.id);

  const res = await fetch(`${base}/api/stages/${create.id}/roadbook.html`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/html'));
  assert.strictEqual(res.headers.get('content-disposition'), null, 'affiché inline, pas en pièce jointe — l\'utilisateur doit pouvoir imprimer directement depuis l\'onglet ouvert');
  const html = await res.text();
  assert.match(html, /Étape roadbook/);
  assert.match(html, /Col du Tourmalet/);
  assert.match(html, /Villes et points de passage/);
  assert.match(html, /Ravitaillements : non représentés/, 'ne doit jamais laisser croire à une donnée de ravitaillement qu\'ÉtapeForge ne possède pas (CLAUDE.md règle 9)');
});

test('roadbook.html : un nom d\'étape contenant </script> ou des guillemets est neutralisé (même classe de bug que export.html, CLAUDE.md règle 1)', async () => {
  const { generateStage } = require('../pipeline/generate');
  const payload = '<script>window.__xss=1</script>"><img src=x onerror="window.__xss=2">';
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: payload, waypoints: [{ label: payload }, { label: 'Tarbes' }] }),
  })).json();
  await generateStage(create.id);

  const res = await fetch(`${base}/api/stages/${create.id}/roadbook.html`);
  const html = await res.text();
  assert.ok(!html.includes('<script>window.__xss=1</script>'), 'le payload ne doit jamais apparaître comme un vrai tag <script> non échappé');
  assert.ok(!html.includes('<img src=x onerror='), 'le payload ne doit jamais apparaître comme un vrai tag <img> non échappé');
  assert.match(html, /&lt;script&gt;window\.__xss=1&lt;\/script&gt;/);
});

test('GET /api/stages/:id/roadbook.html : étape existante mais non générée → 200 avec tableau vide, pas de plantage (contrairement à GPX/TCX, un roadbook reste utile sans trace complète, même comportement que export.html)', async () => {
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Étape jamais générée (roadbook)', waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }] }),
  })).json();
  const res = await fetch(`${base}/api/stages/${create.id}/roadbook.html`);
  assert.strictEqual(res.status, 200, 'une étape existante mais non générée reste servie (0 point/côte listés) — seule une étape introuvable doit échouer');
  const html = await res.text();
  assert.match(html, /Villes et points de passage/);
});

test('GET /api/stages/:id/roadbook.html : étape introuvable → erreur JSON propre, pas 500 avec fuite de stack', async () => {
  const res = await fetch(`${base}/api/stages/999999/roadbook.html`);
  assert.notStrictEqual(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('/home/'), 'aucun chemin de fichier serveur dans la réponse');
});

test('une étape au statut "démo spéculative" (scripts/demo-2027.js) reste comparable comme n\'importe quelle autre — backlog #10, section D', async () => {
  // Investigation de l'item "étendre le comparateur aux étapes spéculatives" :
  // rien côté serveur ni dans frontend/compare.js (filtre uniquement sur
  // `state === 'done'`) ne distingue une étape par le contenu de son champ
  // `status` — ce test verrouille ce comportement plutôt que d'ajouter un
  // traitement spécial qui n'a pas lieu d'être.
  const { generateStage } = require('../pipeline/generate');
  const create = await (await fetch(`${base}/api/stages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Étape spéculative test',
      status: 'démo spéculative — parcours non officiel',
      waypoints: [{ label: 'Pau' }, { label: 'Tarbes' }],
    }),
  })).json();
  await generateStage(create.id);

  const list = await (await fetch(`${base}/api/stages`)).json();
  const found = list.find((s) => s.id === create.id);
  assert.ok(found, 'l\'étape spéculative générée doit apparaître dans la liste servant au sélecteur du comparateur');
  assert.strictEqual(found.state, 'done');

  const full = await (await fetch(`${base}/api/stages/${create.id}`)).json();
  assert.ok(full.samples.length, 'un profil complet reste généré, comparable comme toute autre étape');
});
