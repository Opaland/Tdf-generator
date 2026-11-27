'use strict';
// Page par édition du site public (story 41.6, issue #631) : les itinéraires
// curés village par village de pipeline/data/stage_itineraries.json,
// préparés pour l'affichage. Lecture seule : ce module ne réécrit jamais le
// fichier de données (la curation est faite par la routine quotidienne).
//
// L'écart entre le profil et la reconstitution routée (route_check, écrit
// par scripts/check-itineraries.js) est toujours rendu, même hors tolérance
// (AGENTS.md règle 12) ; une étape sans contrôle le dit.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'stage_itineraries.json');
const YEAR_RE = /^\d{4}$/;

/** Le km d'un point n'est pas lu sur le profil (mesuré à l'échelle, porté
 * par une graduation, illisible ou approché) : il s'affiche « ≈ ». */
const KM_NOT_PRINTED = /aucun km|km imprimé illisible|km illisible|km peu lisible|km approché|km de la graduation|km interpolé/;
/** Altitude imprimée mais mal lue : jamais affichée comme certaine. */
const ALT_DOUBTFUL = /altitude (?:peu lisible|illisible)/;

function kmIsPrinted(note) {
  return !KM_NOT_PRINTED.test(note || '');
}

/** Altitude imprimée lue dans la note (« 1415 m imprimés »), ou null. */
function printedAltitude(note) {
  const m = /(?:^|; )(\d{1,4}) m imprimés/.exec(note || '');
  return m ? Number(m[1]) : null;
}

/** Catégorie imprimée d'une côte ou d'un col (« 1re cat. »), ou null. */
function printedCategory(note) {
  const n = note || '';
  if (/\bHC\b|hors catégorie/i.test(n)) return 'HC';
  const m = /\b([1-4])(?:re|e|ère)\s*cat(?:\.|égorie)/i.exec(n);
  return m ? m[1] : null;
}

/** Ordre des étapes (« 1a » avant « 2 », « 12a » avant « 12b »), pas celui
 * des clés d'objet JS, qui place les clés numériques en premier. */
function stageOrder(keys) {
  const parts = (k) => [parseInt(k, 10), k];
  return [...keys].sort((x, y) => {
    const [a, ka] = parts(x);
    const [b, kb] = parts(y);
    return a - b || (ka < kb ? -1 : ka > kb ? 1 : 0);
  });
}

// Relu seulement quand le fichier change (le serveur local le sert à
// chaque requête ; la routine de curation le réécrit en dehors).
let cached = null;
function readEditions(file = DATA_FILE) {
  const { mtimeMs, size } = fs.statSync(file);
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs && cached.size === size) return cached.editions;
  const editions = JSON.parse(fs.readFileSync(file, 'utf8')).editions || {};
  cached = { file, mtimeMs, size, editions };
  return editions;
}

/** Un point est sur la carte s'il est placé à sa position propre : une côte
 * placée au village éponyme (geocodeAs) n'est pas sur la route. */
const onMap = (t) => Number.isFinite(t.lat) && Number.isFinite(t.lon) && !t.geocodeAs;

function point(t) {
  const note = t.note || '';
  const alt = printedAltitude(note);
  const p = {
    label: t.label,
    km: t.km,
    km_printed: kmIsPrinted(note),
    kind: t.kind,
    altitude_m: alt,
    altitude_doubtful: alt != null && ALT_DOUBTFUL.test(note),
    placed: onMap(t),
  };
  if (t.kind === 'côte' || t.kind === 'col') p.category = printedCategory(note);
  if (p.placed) {
    p.lat = t.lat;
    p.lon = t.lon;
  } else if (t.geocodeAs) {
    p.at_village = true;
  }
  // Les notes de curation des points ne sont pas publiées : détails
  // internes, et un quart du poids des fichiers (relecture adverse).
  return p;
}

/** Écart profil / reconstitution d'une étape, ou null si elle n'a pas été
 * contrôlée. `within` : dans la tolérance du contrôle. */
function routeCheck(rc) {
  if (!rc || !Number.isFinite(rc.routed_km) || !Number.isFinite(rc.profile_km)) return null;
  const tol = Number.isFinite(rc.tolerance_pct) ? rc.tolerance_pct : 5;
  const delta = Number.isFinite(rc.delta_pct)
    ? rc.delta_pct
    : Math.round(((rc.routed_km - rc.profile_km) / rc.profile_km) * 1000) / 10;
  return {
    routed_km: rc.routed_km,
    profile_km: rc.profile_km,
    delta_pct: delta,
    tolerance_pct: tol,
    coverage_pct: Number.isFinite(rc.coverage_pct) ? rc.coverage_pct : null,
    within: Math.abs(delta) <= tol,
    car_legs: Number.isFinite(rc.car_legs) ? rc.car_legs : null,
  };
}

function stage(key, s) {
  const towns = s.towns || [];
  const first = towns[0];
  const last = towns[towns.length - 1];
  const out = {
    key,
    depart: first ? first.label : null,
    arrivee: last ? last.label : null,
    // Distance imprimée par le profil : son total quand la transcription le
    // donne, sinon le km de l'arrivée.
    distance_km: Number.isFinite(s.length_km) ? s.length_km : last ? last.km : null,
    // https seulement : le lien est rendu dans un href (relecture adverse).
    source_url: /^https:\/\/[^\s"<>]+$/.test(s.source_url || '') ? s.source_url : null,
    check: routeCheck(s.route_check),
    points: towns.map(point),
  };
  if (Number.isFinite(s.circuit_km)) out.circuit_km = s.circuit_km;
  if (s.partial) out.partial = true;
  if (s.note) out.note = s.note;
  out.placed = out.points.filter((p) => p.placed).length;
  return out;
}

/** Une édition prête à afficher, ou null si elle n'est pas curée. */
function editionPage(year, editions = readEditions()) {
  const y = String(year);
  if (!YEAR_RE.test(y) || !editions[y]) return null;
  const stages = editions[y].stages || {};
  return { year: Number(y), stages: stageOrder(Object.keys(stages)).map((k) => stage(k, stages[k])) };
}

/** Index des éditions curées : année, étapes, points, points placés,
 * étapes contrôlées et dans la tolérance. */
function editionIndex(editions = readEditions()) {
  return Object.keys(editions)
    .filter((y) => YEAR_RE.test(y))
    .sort()
    .map((y) => {
      const page = editionPage(y, editions);
      const checked = page.stages.filter((s) => s.check);
      return {
        year: page.year,
        stages: page.stages.length,
        points: page.stages.reduce((n, s) => n + s.points.length, 0),
        placed: page.stages.reduce((n, s) => n + s.placed, 0),
        checked: checked.length,
        within: checked.filter((s) => s.check.within).length,
      };
    });
}

/** Index des lieux de passage (story 41.7) : chaque point placé à sa
 * position propre, regroupé par nom et position (arrondie à 1e-4°, ≈ 10 m),
 * avec tous ses passages. Format compact, pour le navigateur :
 * places = [[nom, lat, lon, type, [[année, étape, km, kmImprimé], …]], …]. */
function passagesIndex(editions = readEditions()) {
  const years = Object.keys(editions).filter((y) => YEAR_RE.test(y)).sort();
  const byKey = new Map();
  let stages = 0;
  for (const y of years) {
    const st = editions[y].stages || {};
    for (const k of stageOrder(Object.keys(st))) {
      stages += 1;
      for (const t of st[k].towns || []) {
        if (!onMap(t)) continue;
        const lat = Math.round(t.lat * 1e4) / 1e4;
        const lon = Math.round(t.lon * 1e4) / 1e4;
        const key = `${t.label}|${lat}|${lon}`;
        if (!byKey.has(key)) byKey.set(key, [t.label, lat, lon, t.kind, []]);
        byKey.get(key)[4].push([Number(y), k, t.km, kmIsPrinted(t.note) ? 1 : 0]);
      }
    }
  }
  return { years: years.map(Number), stages, places: [...byKey.values()] };
}

module.exports = {
  DATA_FILE, YEAR_RE, kmIsPrinted, printedAltitude, printedCategory,
  stageOrder, readEditions, editionPage, editionIndex, passagesIndex,
};
