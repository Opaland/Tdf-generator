#!/usr/bin/env node
'use strict';
// Issue #170 : audit systématique des cols à risque d'homonymie ou absents du
// référentiel IGN, sur known_cols.json ET tous les via.label de type col/peak
// de historic_routes.json — trouvé au cas par cas jusqu'ici (Col de Toses,
// Col du Calvaire), jamais balayé sur l'ensemble du catalogue.
//
// N'écrit rien : produit un rapport (stdout + JSON dans --out) qui signale,
// pour chaque nom interrogé sur data.geopf.fr/geocodage/search?index=poi :
//   - ZERO résultat  → col potentiellement hors référentiel IGN (comme Toses)
//   - UN résultat    → pas d'ambiguïté de score, mais comparé aux coordonnées
//                       curées de known_cols.json quand elles existent : un
//                       écart important entre la coordonnée curée et l'unique
//                       résultat API est un signal fort (l'une des deux est
//                       fausse) — c'est ce signal, pas le score, qui a
//                       trouvé le Col du Calvaire (l'API ne renvoyait QUE
//                       l'homonyme vosgien, un seul résultat, "sans
//                       ambiguïté" au sens du score).
//   - 2+ résultats   → écart de score entre les deux premiers candidats dont
//                       le nom correspond EXACTEMENT à la requête (même
//                       normalisation que pickFeature(), pipeline/geocode.js :
//                       une comparaison de score entre deux noms différents
//                       du tout n'est pas l'ambiguïté que pickFeature() gère
//                       en production). Un écart serré entre deux candidats
//                       exacts EST cette même ambiguïté, utile à recenser.
//                       Aucun candidat exact (résultats seulement approchés)
//                       est un signal séparé et plus faible : peut-être hors
//                       référentiel sous ce nom précis, peut-être une simple
//                       variante orthographique à essayer à la main.
//
// Chaque signal reste une PISTE, pas une conclusion : à recouper contre une
// source externe (Wikipédia/cyclingstage.com/bikeraceinfo.com) avant tout
// correctif, comme pour Toses et Calvaire — ce script ne modifie jamais
// known_cols.json ni historic_routes.json lui-même.
//
// Nécessite un accès réseau réel (un balayage complet interroge ~130 noms
// distincts) : volontairement hors de `npm test`, à lancer à part avec
// `npm run audit-col-homonyms`.
//
// Usage : node scripts/audit-col-homonyms.js [--out report.json] [--score-gap 0.03] [--distance-km 20]

const fs = require('fs');
const path = require('path');
const { httpJson } = require('../pipeline/http');
const { haversine } = require('../pipeline/geo');

function parseArgs(argv) {
  const opts = { out: null, scoreGap: 0.03, distanceKm: 20 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--score-gap') opts.scoreGap = parseFloat(argv[++i]);
    else if (argv[i] === '--distance-km') opts.distanceKm = parseFloat(argv[++i]);
  }
  return opts;
}

/** Union des noms à auditer : known_cols.json (clés) + tous les via.label de
 * type col/peak de historic_routes.json, avec la liste des éditions/étapes
 * où chaque nom apparaît (contexte utile pour le recoupement manuel). */
function collectNames() {
  const knownCols = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'known_cols.json'), 'utf8')
  );
  const historicRoutes = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'historic_routes.json'), 'utf8')
  );
  const occurrences = new Map(); // label -> { fromKnownCols, curated: {lat,lon}|null, stages: [String] }
  for (const [label, entry] of Object.entries(knownCols)) {
    if (label.startsWith('_')) continue;
    occurrences.set(label, {
      fromKnownCols: true,
      curated: entry.lat != null && entry.lon != null ? { lat: entry.lat, lon: entry.lon } : null,
      stages: [],
    });
  }
  for (const [year, edition] of Object.entries(historicRoutes)) {
    for (const [stageIdx, stage] of Object.entries(edition.stages || {})) {
      for (const via of stage.vias || []) {
        if (typeof via !== 'object' || (via.kind !== 'col' && via.kind !== 'peak')) continue;
        if (!occurrences.has(via.label)) {
          occurrences.set(via.label, { fromKnownCols: false, curated: null, stages: [] });
        }
        occurrences.get(via.label).stages.push(`${year}/${stageIdx}`);
      }
    }
  }
  return occurrences;
}

// Même normalisation que pickFeature() (pipeline/geocode.js) — un écart de
// score n'est l'ambiguïté qui intéresse pickFeature() en production que si
// LES DEUX candidats portent le nom exact interrogé (ses "exactMatches").
// Sinon (aucun résultat, ou un seul, ne correspond exactement), c'est un
// signal différent — un nom approché a été trouvé, mais peut-être pas le
// bon toponyme du tout (ex. "Perl", frontière Sarre/Moselle : la
// Géoplateforme ne renvoie que des noms qui ne sont PAS "Perl", à un score
// pourtant correct — un faux calme, pas une vraie absence d'ambiguïté).
function normLabel(s) {
  return String(s || '').trim().toLowerCase();
}

async function auditOne(label) {
  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(label)}&index=poi&limit=5`;
  const json = await httpJson(url, { minDelayMs: 150 });
  const feats = (json.features || []).map((f) => ({
    name: Array.isArray(f.properties.name) ? f.properties.name[0] : f.properties.name,
    score: f.properties.score,
    depcode: Array.isArray(f.properties.depcode) ? f.properties.depcode[0] : f.properties.depcode,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
  return feats;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const occurrences = collectNames();
  const names = [...occurrences.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  console.log(`Audit de ${names.length} noms de cols/sommets distincts (known_cols.json + historic_routes.json)...\n`);

  const zeroResult = [];
  const curatedMismatch = [];
  const closeScore = [];
  const fuzzyOnly = [];
  const clean = [];

  for (let i = 0; i < names.length; i++) {
    const label = names[i];
    const info = occurrences.get(label);
    process.stdout.write(`[${i + 1}/${names.length}] ${label}... `);
    let feats;
    try {
      feats = await auditOne(label);
    } catch (err) {
      console.log(`ERREUR RÉSEAU (${err.message}) — ignoré, à relancer`);
      continue;
    }

    if (feats.length === 0) {
      console.log('AUCUN RÉSULTAT (hors référentiel IGN ?)');
      zeroResult.push({ label, ...info });
      continue;
    }

    if (info.curated) {
      const top = feats[0];
      const distM = haversine(info.curated, { lat: top.lat, lon: top.lon });
      if (distM > opts.distanceKm * 1000) {
        console.log(`ÉCART CURATÉ/API : ${(distM / 1000).toFixed(1)} km entre known_cols.json et le résultat API le plus proche (${top.name}, dept ${top.depcode})`);
        curatedMismatch.push({ label, ...info, apiTop: top, distanceKm: Math.round(distM / 1000) });
        continue;
      }
    }

    const exact = feats.filter((f) => normLabel(f.name) === normLabel(label));
    if (exact.length >= 2) {
      const gap = exact[0].score - exact[1].score;
      if (gap < opts.scoreGap) {
        console.log(`SCORES PROCHES (candidats exacts) : ${exact[0].name} (${exact[0].score.toFixed(3)}, dept ${exact[0].depcode}) vs ${exact[1].name} (${exact[1].score.toFixed(3)}, dept ${exact[1].depcode})`);
        closeScore.push({ label, ...info, top2: exact.slice(0, 2) });
        continue;
      }
    } else if (exact.length === 0) {
      console.log(`AUCUN CANDIDAT EXACT (résultats trouvés mais aucun nommé "${label}" — ${feats[0].name}, dept ${feats[0].depcode})`);
      fuzzyOnly.push({ label, ...info, top: feats[0] });
      continue;
    }

    console.log(`OK (${feats.length} résultat${feats.length > 1 ? 's' : ''}, dept ${feats[0].depcode})`);
    clean.push(label);
  }

  console.log(`\n--- Résumé ---`);
  console.log(`${clean.length} noms sans signal.`);
  console.log(`${zeroResult.length} noms sans aucun résultat API (potentiellement hors référentiel IGN, ou hors de France) : ${zeroResult.map((r) => r.label).join(', ') || '(aucun)'}`);
  console.log(`${curatedMismatch.length} noms curatés dont le résultat API le plus proche est à >${opts.distanceKm} km : ${curatedMismatch.map((r) => r.label).join(', ') || '(aucun)'}`);
  console.log(`${closeScore.length} noms avec deux candidats EXACTS à score proche (< ${opts.scoreGap}) : ${closeScore.map((r) => r.label).join(', ') || '(aucun)'}`);
  console.log(`${fuzzyOnly.length} noms sans aucun candidat exact (résultats approchés seulement) : ${fuzzyOnly.map((r) => r.label).join(', ') || '(aucun)'}`);
  console.log(`\nChaque signal est une PISTE à recouper contre une source externe avant tout correctif — voir issue #170.`);

  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify({ zeroResult, curatedMismatch, closeScore, fuzzyOnly, clean }, null, 2));
    console.log(`\nRapport écrit dans ${opts.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
