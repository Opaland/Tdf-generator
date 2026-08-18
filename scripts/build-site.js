#!/usr/bin/env node
'use strict';
// Construit dans dist/ la **démo interactive statique** pour GitHub Pages :
// l'application frontend complète (fiches avec profil 3D, carte globale, cols,
// comparateur…) branchée sur des JSON pré-générés (data/) au lieu de l'API —
// aucune écriture possible, un bandeau l'explique. Les chemins sont réécrits en
// relatif pour fonctionner sous un sous-chemin (opaland.github.io/Tdf-generator/).
// Prérequis : `npm run demo` (données générées en mode hors-ligne).

const fs = require('fs');
const path = require('path');
const { getDb } = require('../backend/db');
const { tourToStandaloneHtml, stagePayload, ATTRIBUTIONS } = require('../backend/exports');
const { loadStageFull } = require('../pipeline/generate');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FRONTEND = path.join(ROOT, 'frontend');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const write = (rel, content) => {
  const p = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const writeJson = (rel, obj) => write(rel, JSON.stringify(obj));

// Réécriture des URL absolues en relatives (l'app est servie sous un sous-chemin).
const TOKENS = [
  ["location.href = '/'", "location.href = 'editeur.html'"],
  ['href="/"', 'href="editeur.html"'],
  ['/?id=', 'editeur.html?id='],
  ['/api/', 'api/'],
  ['/stage.html', 'stage.html'],
  ['/tour.html', 'tour.html'],
  ['/cols.html', 'cols.html'],
  ['/compare.html', 'compare.html'],
  ['/archives.html', 'archives.html'],
  ['/traces.html', 'traces.html'],
  ['/diag.html', 'diag.html'],
];
function rewrite(content, { html = false } = {}) {
  let out = content;
  for (const [from, to] of TOKENS) out = out.split(from).join(to);
  if (html) {
    out = out.replace(/(href|src)="\//g, '$1="'); // /style.css, /vendor/…, /common.js…
    // active le mode statique avant tout script applicatif
    out = out.replace(/<script src="(\.\/)?common\.js">/,
      '<script>window.EF_STATIC = true;</script>\n<script src="common.js">');
  }
  return out;
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  const db = getDb();

  // --- 1. Données pré-générées (miroir des endpoints GET) ----------------------
  writeJson('data/status.json', {
    offline: true,
    static: true,
    counts: {},
    attributions: ATTRIBUTIONS,
  });

  const stages = db
    .prepare(
      `SELECT s.id, s.name, s.date, s.stage_type, s.status, s.state, s.stage_order,
              s.official_distance_km, s.generated_distance_km, s.total_ascent_m,
              s.edition_id, s.is_transfer, e.name AS edition_name, e.year AS edition_year
       FROM stages s LEFT JOIN editions e ON e.id = s.edition_id
       WHERE s.state = 'done'
       ORDER BY COALESCE(e.year, 9999), s.stage_order, s.id`
    )
    .all();
  writeJson('data/stages.json', stages);
  for (const s of stages) writeJson(`data/stage-${s.id}.json`, loadStageFull(s.id));

  const editions = db
    .prepare(
      `SELECT e.*, COUNT(s.id) AS stage_count,
              SUM(CASE WHEN s.state = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM editions e LEFT JOIN stages s ON s.edition_id = e.id
       GROUP BY e.id HAVING done_count > 0 ORDER BY e.year, e.name`
    )
    .all()
    .map((e) => ({ ...e, source: e.source ? JSON.parse(e.source) : null }));
  writeJson('data/editions.json', editions);

  const sitelinks = {};
  for (const e of editions) {
    const full = db.prepare('SELECT * FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(e.id)
      .map((s) => ({ ...s, checks: s.checks ? JSON.parse(s.checks) : null, progress: null, source: s.source ? JSON.parse(s.source) : null }));
    writeJson(`data/edition-${e.id}.json`, { ...e, stages: full });
    const ids = full.filter((s) => s.state === 'done').map((s) => s.id);
    writeJson(`data/mapdata-${e.id}.json`, {
      edition: e,
      stages: ids.map((id) => stagePayload(loadStageFull(id), { maxSamples: 200, maxTrack: 500 })),
    });
    const file = `tour-${e.year || 'perso'}-${e.id}.html`;
    write(file, tourToStandaloneHtml(e.id));
    sitelinks[e.id] = file;
    console.log(`✔ ${file} + data édition ${e.id} (${ids.length} étapes)`);
  }
  writeJson('data/sitelinks.json', sitelinks);

  const climbs = db
    .prepare(
      `SELECT c.*, s.name AS stage_name, s.date AS stage_date, s.state AS stage_state,
              e.name AS edition_name, e.year AS edition_year, e.id AS edition_id
       FROM climbs c JOIN stages s ON s.id = c.stage_id
       LEFT JOIN editions e ON e.id = s.edition_id
       WHERE s.state = 'done' ORDER BY c.summit_ele_m DESC`
    )
    .all()
    .map((c) => ({ ...c, km_blocks: c.km_blocks ? JSON.parse(c.km_blocks) : [] }));
  writeJson('data/climbs.json', climbs);

  // --- 2. Frontend copié avec chemins réécrits ---------------------------------
  for (const f of fs.readdirSync(FRONTEND)) {
    const src = fs.readFileSync(path.join(FRONTEND, f), 'utf8');
    if (f === 'index.html') write('editeur.html', rewrite(src, { html: true }));
    else if (f.endsWith('.html')) write(f, rewrite(src, { html: true }));
    else if (f.endsWith('.js')) write(f, rewrite(src));
    else write(f, src);
  }
  // Leaflet vendorisé.
  const leafletSrc = path.join(ROOT, 'node_modules', 'leaflet', 'dist');
  for (const f of ['leaflet.js', 'leaflet.css']) {
    write(path.join('vendor', 'leaflet', f), fs.readFileSync(path.join(leafletSrc, f)));
  }
  fs.cpSync(path.join(leafletSrc, 'images'), path.join(DIST, 'vendor', 'leaflet', 'images'), { recursive: true });
  // Captures.
  fs.cpSync(path.join(ROOT, 'docs', 'captures'), path.join(DIST, 'captures'), { recursive: true });

  // --- 3. Page d'accueil (hub de la démo) --------------------------------------
  const demoStage = stages.find((s) => /hautacam/i.test(s.name)) || stages[0];
  const captures = fs.readdirSync(path.join(DIST, 'captures')).sort();
  write(
    'index.html',
    `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ÉtapeForge — démo interactive</title>
<link rel="stylesheet" href="style.css">
<style>
  .hub { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; margin: 18px 0; }
  .hub a { background: var(--carte); border: 1px solid var(--bord); border-radius: 10px;
           padding: 18px; text-decoration: none; color: var(--texte); display: block; }
  .hub a:hover { background: var(--sable); }
  .hub .t { font-weight: 800; font-size: 1.05em; margin-bottom: 6px; }
  .hub .d { font-size: 0.85em; color: var(--texte2); }
  img.cap { max-width: 100%; border: 1px solid var(--bord); border-radius: 10px; margin: 8px 0; }
</style>
</head>
<body>
<main>
  <h1>ÉtapeForge — démo interactive</h1>
  <p class="meta-line">Générateur d'étapes du Tour de France, open source et 100 % local.
    Cette démo est <b>entièrement navigable</b> (données pré-générées hors-ligne, simulateur) ;
    la création d'étapes et les vraies APIs (IGN, OSRM, Wikipédia) fonctionnent dans la
    <a href="https://github.com/Opaland/Tdf-generator">version locale</a>.</p>
  <div class="hub">
    ${demoStage ? `<a href="stage.html?id=${demoStage.id}"><div class="t">📈 Fiche d'étape</div>
      <div class="d">${esc(demoStage.name)} — profil ASO, <b>profil 3D pivotable</b>, côte par côte, km par km, carte</div></a>` : ''}
    <a href="tour.html"><div class="t">🗺 Carte globale</div>
      <div class="d">Tour de France 1903 complet — tracés, popups, stats triables, animation</div></a>
    <a href="cols.html"><div class="t">⛰ Catalogue des cols</div>
      <div class="d">Toutes les côtes détectées — tri, filtres, profils déroulables</div></a>
    <a href="compare.html"><div class="t">⚖️ Comparateur</div>
      <div class="d">Deux étapes superposées, métriques côte à côte</div></a>
    <a href="archives.html"><div class="t">🏛 Archives 1903→</div>
      <div class="d">Reconstruction historique — distances officielles vs reconstituées, sources</div></a>
    <a href="editeur.html"><div class="t">✎ Éditeur (lecture seule)</div>
      <div class="d">L'interface de création — la génération nécessite la version locale</div></a>
  </div>
  <h2>Captures de la version locale</h2>
  ${captures.map((c) => `<img class="cap" src="captures/${c}" alt="${esc(c)}" loading="lazy">`).join('\n  ')}
</main>
<script>window.EF_STATIC = true;</script>
<script src="common.js"></script>
<script>document.addEventListener('DOMContentLoaded', () => EF.initChrome(''));</script>
</body>
</html>`
  );

  console.log(`✔ dist/ : app statique (${stages.length} étapes, ${editions.length} tours, ${climbs.length} côtes, ${captures.length} captures)`);
}

main();
