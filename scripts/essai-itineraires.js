#!/usr/bin/env node
'use strict';
// Essai de la story 39.6 : le générateur gagne-t-il à suivre les itinéraires
// détaillés (stage_itineraries.json) ? Génère une édition par le pipeline réel,
// sans rien modifier hors de la base jetable. En mode « apres », les points de
// l'itinéraire remplacent en mémoire les vias curées de chaque étape ; le
// fichier historic_routes.json n'est pas réécrit.
//
// Usage : node scripts/essai-itineraires.js <avant|apres> <année> <sortie.json> [étape…]   (réseau requis)
// Un seul mode par processus (CLAUDE.md, règle 4).

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ETAPEFORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-essai-'));

const { getDb } = require('../backend/db');
const { importEdition } = require('../pipeline/importer');
const { generateStage } = require('../pipeline/generate');
const { HISTORIC_ROUTES } = require('../pipeline/wikipedia');
const { buildItinerary } = require('../pipeline/placeSearch');

/** Points intermédiaires d'une étape transcrite, sous forme de vias : ni le
 * départ, ni l'arrivée, ni ce qui suit l'entrée d'un circuit final (les tours
 * ne se routent pas d'un point au suivant, voir check-itineraries.js). */
function itineraryVias(st) {
  const towns = Number.isFinite(st.circuit_km) ? st.towns.filter((t) => t.km <= st.circuit_km) : st.towns;
  const { points } = buildItinerary(towns);
  const last = st.towns[st.towns.length - 1];
  return points
    .filter((p) => p.km > 0 && p.km < last.km)
    .map((p) => ({ label: p.label, lat: p.lat, lon: p.lon }));
}

async function main() {
  const [mode, year, out, ...only] = process.argv.slice(2);
  if (!['avant', 'apres'].includes(mode) || !/^\d{4}$/.test(year || '') || !out) {
    console.error('Usage : node scripts/essai-itineraires.js <avant|apres> <année> <sortie.json> [étape…]');
    process.exit(1);
  }
  const itin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'data', 'stage_itineraries.json'), 'utf8')).editions[year]?.stages;
  if (!itin) throw new Error(`pas d'itinéraire pour ${year}`);
  if (mode === 'apres') {
    HISTORIC_ROUTES[year] = HISTORIC_ROUTES[year] || { stages: {} };
    HISTORIC_ROUTES[year].stages = HISTORIC_ROUTES[year].stages || {};
    for (const [n, st] of Object.entries(itin)) {
      HISTORIC_ROUTES[year].stages[n] = { ...HISTORIC_ROUTES[year].stages[n], vias: itineraryVias(st) };
    }
  }
  const { edition } = await importEdition(Number(year));
  const db = getDb();
  const stages = db.prepare('SELECT id, stage_order FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(edition.id);
  const results = [];
  for (const s of stages) {
    if (only.length && !only.includes(String(s.stage_order))) continue;
    const t0 = Date.now();
    let error = null;
    try { await generateStage(s.id); } catch (err) { error = String(err.message || err); }
    const row = db.prepare('SELECT stage_order, name, official_distance_km AS official, generated_distance_km AS generated, total_ascent_m AS ascent, state, error FROM stages WHERE id = ?').get(s.id);
    const track = db.prepare('SELECT router, approx_segments FROM tracks WHERE stage_id = ?').get(s.id);
    const vias = db.prepare("SELECT COUNT(*) AS n FROM waypoints WHERE stage_id = ? AND kind NOT IN ('start', 'finish')").get(s.id).n;
    const res = { order: row.stage_order, name: row.name, official: row.official, generated: row.generated, ascent: row.ascent, state: row.state, error: error || row.error, router: track?.router || null,
      approx: track?.approx_segments ? JSON.parse(track.approx_segments).length : null, vias, seconds: Math.round((Date.now() - t0) / 1000) };
    results.push(res);
    console.log(`${mode} ${year} #${res.order} ${res.name} : ${res.generated} km / ${res.official} (${res.vias} vias, ${res.router}, ${res.seconds} s)${res.error ? ' ERREUR ' + res.error : ''}`);
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
  }
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { itineraryVias };
