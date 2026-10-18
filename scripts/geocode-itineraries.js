'use strict';
// Géocode les itinéraires détaillés (Epic 33) : pipeline/data/stage_itineraries.json.
//
// Chaque étape y porte la liste des villes et cols de son profil officiel,
// avec leur kilomètre, transcrite à la main depuis la source citée (profils du
// Dico du Tour, road books). Ce script ajoute les coordonnées, sans jamais
// deviner : une ville n'est placée que si la distance à vol d'oiseau depuis le
// point précédent ne dépasse pas l'écart de kilomètres du profil (une route
// n'est jamais plus courte que la ligne droite), et si elle reste compatible
// avec l'arrivée. Cette contrainte serrée (quelques km entre deux villes)
// écarte presque tous les homonymes ; un point sans candidat compatible reste
// sans coordonnées, signalé.
//
// Usage : node scripts/geocode-itineraries.js [année …]   (réseau requis)
// Idempotent : seuls les points sans coordonnées sont traités.

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.ETAPEFORGE_DATA_DIR = process.env.ETAPEFORGE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-itin-'));

const { communeCandidates, normName } = require('../pipeline/geocode');
const { haversine } = require('../pipeline/geo');
const { KNOWN_COLS } = require('../pipeline/wikipedia');

const FILE = path.join(__dirname, '..', 'pipeline', 'data', 'stage_itineraries.json');
const TOWNS_FILE = path.join(__dirname, '..', 'pipeline', 'data', 'stage_towns.json');
// Marge : centre-ville géocodé vs point de passage réel, et arrondis du profil.
const SLACK_M = 3000;
// Le km 0 d'un profil est le départ réel, souvent à plusieurs km du centre de
// la ville de départ (1992/10 : départ réel à Hesperange, au sud de
// Luxembourg) : marge élargie pour les points mesurés depuis le départ.
const START_SLACK_M = 10000;
const round = (v) => Math.round(v * 1e5) / 1e5;

async function defaultCandidates(label, kind, original = label) {
  const out = [];
  const known = KNOWN_COLS[label];
  if (known && Number.isFinite(known.lat)) out.push({ lat: known.lat, lon: known.lon, how: 'known-cols' });
  if (kind === 'ville') {
    const want = normName(label);
    const communes = (await communeCandidates(label))
      .filter((c) => { const n = normName(c.name); return n === want || n.startsWith(`${want} `) || n.startsWith(`${want}-`); })
      .sort((a, b) => (b.population || 0) - (a.population || 0));
    // Nom exact seulement pour le rang « commune IGN » : un préfixe
    // (« Vovray » → Vovray-en-Bornes) est une autre commune (relecture adverse).
    for (const c of communes) out.push({ lat: round(c.lat), lon: round(c.lon), how: normName(c.name) === want ? 'commune-ign' : 'commune-ign-prefixe' });
  }
  const { nominatimCandidates } = require('./build-stage-towns');
  const osm = await nominatimCandidates(label);
  for (const c of osm) out.push(c);
  // Commune nouvelle (geocodeAs « Lamballe-Armor » pour Lamballe) : le point
  // OSM du nom fusionné n'est pas le bourg cherché, pas de recalage.
  return label === original ? snapToTown(out) : out;
}

// L'index IGN donne le centre géographique de la commune, pas le bourg :
// dans une grande commune de montagne, l'écart atteint 7,7 km (Bagnères-de-
// Bigorre, relecture adverse 1993). Une commune IGN au nom exact est donc
// recalée sur le point OpenStreetMap le plus proche s'il est à moins de
// SNAP_M — même nom, même commune ; au-delà, c'est un homonyme, ignoré.
const SNAP_M = 8000;
function snapToTown(cands) {
  const osm = cands.filter((c) => c.how === 'nominatim');
  return cands.map((c) => {
    if (c.how !== 'commune-ign') return c;
    let best = null;
    for (const o of osm) {
      const d = haversine(c, o);
      if (d <= SNAP_M && (!best || d < best.d)) best = { d, o };
    }
    return best ? { lat: best.o.lat, lon: best.o.lon, how: 'commune-ign' } : c;
  });
}

/**
 * Place les points d'une étape. `towns` : [{label, km, kind, lat?, lon?}]
 * triés par km. `anchors` : {start?, finish?} positions vérifiées des villes
 * de départ/arrivée (stage_towns.json), facultatives.
 * Retourne la liste complétée (lat/lon/how/confidence), sans muter l'entrée.
 */
async function geocodeStage(towns, anchors = {}, candidatesFor = defaultCandidates, totalKm = null) {
  const total = Number.isFinite(totalKm) ? totalKm : towns.length ? towns[towns.length - 1].km : 0;
  const out = towns.map((t) => ({ ...t }));
  let prev = anchors.start ? { ...anchors.start, km: 0 } : null;
  for (const t of out) {
    if (Number.isFinite(t.lat)) { if (!t.geocodeAs || t.kind === 'ville') prev = t; continue; }
    // Côte : placée au village éponyme quand le profil le permet (geocodeAs),
    // à quelques km du sommet réel — jamais présenté comme le sommet.
    const cands = t.geocodeAs ? await candidatesFor(t.geocodeAs, 'ville', t.label) : await candidatesFor(t.label, t.kind);
    const ok = cands.filter((c) => {
      const slack = prev && prev.km === 0 ? START_SLACK_M : SLACK_M;
      if (prev && haversine(prev, c) > (t.km - prev.km) * 1000 + slack) return false;
      if (anchors.finish && haversine(c, anchors.finish) > (total - t.km) * 1000 + SLACK_M) return false;
      return true;
    });
    if (!ok.length) { t.confidence = 'non-place'; continue; }
    // Source la plus fiable d'abord : un résultat Nominatim plus « sur le
    // chemin » ne l'emporte jamais sur la commune IGN compatible (1992/15 :
    // Grenoble placée à 10 km au sud, Fontaine rejetée ensuite).
    const tier = (c) => (c.how === 'known-cols' ? 0 : c.how === 'commune-ign' ? 1 : 2);
    const bestTier = Math.min(...ok.map(tier));
    for (let i = ok.length - 1; i >= 0; i--) if (tier(ok[i]) !== bestTier) ok.splice(i, 1);
    // Plusieurs candidats compatibles et distincts : le plus « sur le
    // chemin » (moindre détour vers l'arrivée), signalé ambigu.
    const detour = (c) => (prev ? haversine(prev, c) : 0) + (anchors.finish ? haversine(c, anchors.finish) : 0);
    ok.sort((a, b) => detour(a) - detour(b));
    const distinct = ok.filter((c) => haversine(c, ok[0]) > SLACK_M);
    Object.assign(t, { lat: ok[0].lat, lon: ok[0].lon, how: ok[0].how, confidence: distinct.length ? 'ambigu' : 'ok' });
    // Une côte placée au village éponyme est trop approchée pour servir de
    // repère au point suivant (1992/10 : Freybouse rejetée depuis « Barst »).
    if (!t.geocodeAs || t.kind === 'ville') prev = t;
  }
  return out;
}

function anchorsFor(townsDoc, edition, stage) {
  const ed = townsDoc?.editions?.[edition];
  if (!ed) return {};
  const s = ed.stages.find((x) => String(x.number) === String(stage).replace(/[a-z]$/, ''));
  const ok = (t) => (t && Number.isFinite(t.lat) && t.confidence !== 'douteux' ? { lat: t.lat, lon: t.lon } : undefined);
  return s ? { start: ok(s.start), finish: ok(s.finish) } : {};
}

/** Ancres d'une étape du fichier. Transcription partielle sans longueur
 * connue (length_km) : le dernier point n'est pas forcément l'arrivée, la
 * contrainte vers l'arrivée serait fausse (1979/13 : Fresse-sur-Moselle
 * rejetée, à 9 km du Ballon d'Alsace) — ancre d'arrivée retirée. */
function stageAnchors(townsDoc, edition, stage, st) {
  const anchors = anchorsFor(townsDoc, edition, stage);
  if (st.partial && !Number.isFinite(st.length_km)) delete anchors.finish;
  return anchors;
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let townsDoc = null;
  try { townsDoc = JSON.parse(fs.readFileSync(TOWNS_FILE, 'utf8')); } catch { /* ancres facultatives */ }
  const only = process.argv.slice(2);
  for (const [edition, ed] of Object.entries(doc.editions)) {
    if (only.length && !only.includes(edition)) continue;
    for (const [stage, st] of Object.entries(ed.stages)) {
      const anchors = stageAnchors(townsDoc, edition, stage, st);
      st.towns = await geocodeStage(st.towns, anchors, defaultCandidates, st.length_km);
      const miss = st.towns.filter((t) => !Number.isFinite(t.lat)).map((t) => t.label);
      console.log(`${edition}/${stage} : ${st.towns.length - miss.length}/${st.towns.length} placés${miss.length ? ` — non placés : ${miss.join(', ')}` : ''}`);
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { geocodeStage, anchorsFor, stageAnchors, snapToTown, SNAP_M, SLACK_M, START_SLACK_M };
