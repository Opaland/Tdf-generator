#!/usr/bin/env node
'use strict';
// Construit une vitrine statique dans dist/ pour GitHub Pages :
// - mini-sites HTML autonomes des tours présents en base (démo 1903 incluse)
// - page d'accueil avec les captures d'écran et le lien vers le dépôt
// Prérequis : `npm run demo` (les données sont générées en mode hors-ligne).

const fs = require('fs');
const path = require('path');
const { getDb } = require('../backend/db');
const { tourToStandaloneHtml } = require('../backend/exports');

const DIST = path.join(__dirname, '..', 'dist');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const db = getDb();
  const editions = db
    .prepare(
      `SELECT e.id, e.name, e.year, COUNT(s.id) AS n,
              SUM(CASE WHEN s.state = 'done' THEN 1 ELSE 0 END) AS done
       FROM editions e LEFT JOIN stages s ON s.edition_id = e.id
       GROUP BY e.id HAVING done > 0 ORDER BY e.year, e.name`
    )
    .all();

  const links = [];
  for (const e of editions) {
    const file = `tour-${e.year || 'perso'}-${e.id}.html`;
    fs.writeFileSync(path.join(DIST, file), tourToStandaloneHtml(e.id));
    links.push({ file, name: e.name, n: e.n, done: e.done });
    console.log(`✔ ${file} (${e.done}/${e.n} étapes)`);
  }

  // Captures d'écran pour la page d'accueil.
  const capSrc = path.join(__dirname, '..', 'docs', 'captures');
  const capDst = path.join(DIST, 'captures');
  fs.mkdirSync(capDst, { recursive: true });
  for (const f of fs.readdirSync(capSrc)) fs.copyFileSync(path.join(capSrc, f), path.join(capDst, f));

  const captures = fs.readdirSync(capDst).sort();
  fs.writeFileSync(
    path.join(DIST, 'index.html'),
    `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ÉtapeForge — vitrine</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #faf7f0; color: #222; }
  header { background: #141414; color: #ffd320; padding: 18px 24px; }
  header h1 { margin: 0; }
  main { max-width: 960px; margin: 0 auto; padding: 20px; }
  .note { background: #fdf6dd; border: 1px solid #e8d48a; border-radius: 8px; padding: 10px 14px; }
  a.tour { display: block; background: #fff; border: 1px solid #ddd; border-radius: 8px;
           padding: 14px 18px; margin: 10px 0; text-decoration: none; color: #222; font-weight: 600; }
  a.tour:hover { background: #f3ecd9; }
  img { max-width: 100%; border: 1px solid #ddd; border-radius: 8px; margin: 10px 0; }
  footer { text-align: center; color: #777; font-size: 0.8em; padding: 20px; }
</style>
</head>
<body>
<header><h1>Étape<span style="color:#fff">Forge</span> — vitrine statique</h1></header>
<main>
  <p class="note">Démo <b>pré-générée en mode hors-ligne</b> (simulateur déterministe — tracés et altitudes
  synthétiques, clairement étiquetés). L'application complète (éditeur, génération sur les vraies APIs
  IGN/OSRM, archives Wikipédia) tourne en local :
  <code>git clone</code> → <code>npm install &amp;&amp; npm run demo &amp;&amp; npm start</code> —
  voir <a href="https://github.com/Opaland/Tdf-generator">le dépôt GitHub</a>.</p>
  <h2>Tours pré-générés (mini-sites autonomes)</h2>
  ${links.map((l) => `<a class="tour" href="${l.file}">${esc(l.name)} — ${l.done}/${l.n} étapes</a>`).join('\n  ')}
  <h2>Captures de l'application</h2>
  ${captures.map((c) => `<img src="captures/${c}" alt="${esc(c)}" loading="lazy">`).join('\n  ')}
</main>
<footer>Données simulées pour la démo · application : © IGN/Géoplateforme, © OpenStreetMap contributors,
OSRM, opentopodata, Wikipédia (CC BY-SA)</footer>
</body>
</html>`
  );
  console.log(`✔ dist/index.html (${links.length} tours, ${captures.length} captures)`);
}

main();
