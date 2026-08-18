'use strict';
// Mode archives : import de la liste des étapes d'une édition depuis Wikipédia
// (API REST en.wikipedia.org / fr.wikipedia.org — pages « <année> Tour de France »,
// tableaux structurés, licence CC BY-SA). La provenance de chaque champ est stockée.
// Recoupement manuel autorisé : bikeraceinfo.com. On ne scrape NI letour.fr NI lequipe.fr.

const fs = require('fs');
const path = require('path');
const { httpText, isOffline } = require('./http');
const { cached } = require('./cache');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const HISTORIC_ROUTES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'historic_routes.json'), 'utf8')
);

// --- Petit parseur HTML (tableaux Wikipédia), sans dépendance ------------------

const NAMED_ENTITIES = {
  nbsp: ' ', ndash: '–', mdash: '—', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', auml: 'ä',
  icirc: 'î', iuml: 'ï',
  ocirc: 'ô', ouml: 'ö',
  ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', oelig: 'œ', aelig: 'æ',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = parseInt(d, 10);
      return cp === 160 ? ' ' : String.fromCodePoint(cp);
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function cellText(html) {
  return decodeEntities(
    html
      .replace(/<sup[\s\S]*?<\/sup>/gi, '') // appels de référence [1]
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrait toutes les tables wikitable d'une page HTML → [ [ [cell,…], … ], … ]. */
function extractTables(html) {
  const tables = [];
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    if (!/wikitable/i.test(m[0].slice(0, 200))) continue;
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = rowRe.exec(m[0]))) {
      const cells = [];
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let c;
      while ((c = cellRe.exec(r[1]))) cells.push(cellText(c[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  'décembre': 12, decembre: 12,
};

function parseDate(text, year) {
  // « 1 July », « 1–2 July », « 5 juillet 1903 »…
  const m = String(text).toLowerCase().match(/(\d{1,2})(?:\s*[–—-]\s*\d{1,2})?(?:er)?\s+([a-zéûôà]+)/);
  if (!m || !MONTHS[m[2]]) return null;
  const d = parseInt(m[1], 10);
  return `${year}-${String(MONTHS[m[2]]).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCourse(text) {
  // « Paris to Lyon », « Paris – Lyon », « Paris > Lyon »
  const m = String(text).match(/^(.*?)\s+(?:to|à|a|>|–|—|-)\s+(.*)$/i);
  if (!m) return null;
  const clean = (s) => s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return { start: clean(m[1]), finish: clean(m[2]) };
}

function parseDistanceKm(text) {
  const m = String(text).replace(/\s/g, ' ').match(/([\d][\d ,.]*)\s*km/i);
  if (!m) return null;
  // « 2,428 km » (séparateur de milliers anglo-saxon) vs « 467,5 km » (décimale française)
  const v = parseFloat(m[1].replace(/ /g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function normalizeType(text) {
  const t = String(text).toLowerCase();
  if (/mountain|montagne/.test(t)) return 'montagne';
  if (/hilly|accident|medium/.test(t)) return 'accidentée';
  if (/time trial|contre-la-montre|clm/.test(t)) return t.includes('team') || t.includes('équipes') ? 'clm par équipes' : 'clm';
  if (/plain|flat|plaine/.test(t)) return 'plaine';
  return text ? String(text).trim() : null;
}

/**
 * Parse les étapes depuis le HTML d'une page « <année> Tour de France ».
 * Retourne [{ number, dateText, dateIso, start, finish, distanceKm, type, winner, sourceRow }]
 */
function parseStagesFromHtml(html, year) {
  const tables = extractTables(html);
  for (const rows of tables) {
    const header = rows[0].map((h) => h.toLowerCase());
    const looksRight =
      header.some((h) => /stage|étape|etape/.test(h)) &&
      header.some((h) => /distance/.test(h)) &&
      header.some((h) => /course|parcours|route|itinéraire/.test(h) || true);
    if (!looksRight) continue;

    const col = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const iStage = col(['stage', 'étape', 'etape']);
    const iDate = col(['date']);
    const iCourse = col(['course', 'parcours', 'route']);
    const iDist = col(['distance']);
    const iType = col(['type', 'terrain']);
    const iWinner = col(['winner', 'vainqueur']);
    if (iStage < 0 || iDist < 0) continue;

    const stages = [];
    for (const row of rows.slice(1)) {
      if (row.length < 3) continue; // lignes de repos / totaux
      const distanceKm = parseDistanceKm(row[iDist]);
      const numM = String(row[iStage]).match(/\d+/);
      if (!distanceKm || !numM) continue; // jour de repos, ligne « Total »…
      const courseText = iCourse >= 0 ? row[iCourse] : '';
      const course = parseCourse(courseText);
      if (!course) continue;
      stages.push({
        number: parseInt(numM[0], 10),
        dateText: iDate >= 0 ? row[iDate] : null,
        dateIso: iDate >= 0 ? parseDate(row[iDate], year) : null,
        start: course.start,
        finish: course.finish,
        distanceKm,
        type: iType >= 0 ? normalizeType(row[iType]) : null,
        winner: iWinner >= 0 ? row[iWinner] : null,
        sourceRow: row.join(' | '),
      });
    }
    if (stages.length >= 2) return stages;
  }
  throw new Error(`Aucun tableau d'étapes reconnu pour ${year}`);
}

/** HTML de la page « <année> Tour de France » (cache api_cache ; fixture en hors-ligne). */
async function fetchEditionHtml(year) {
  const fixture = path.join(FIXTURES_DIR, `wikipedia_${year}_en.html`);
  if (isOffline()) {
    if (fs.existsSync(fixture)) return fs.readFileSync(fixture, 'utf8');
    throw new Error(
      `Mode hors-ligne : pas de fixture locale pour ${year}. ` +
        `Relancez avec accès réseau pour importer cette année depuis Wikipédia.`
    );
  }
  const { value } = await cached('api', 'wikipedia-en', { page: `${year}_Tour_de_France` }, async () => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${year}_Tour_de_France`;
    return httpText(url, { minDelayMs: 600 });
  });
  return value;
}

/**
 * Waypoints de reconstruction d'une étape historique : villes officielles
 * (Wikipédia) + points de passage curés (historic_routes.json) quand ils existent.
 * Retourne [{label, kind, altitude_hint_m?, source}]
 */
function reconstructionWaypoints(year, stage) {
  const { isColQuery } = require('./geocode');
  const curated = HISTORIC_ROUTES[String(year)]?.stages?.[String(stage.number)];
  const wps = [];
  const startLabel = curated?.start || stage.start;
  const finishLabel = curated?.finish || stage.finish;
  wps.push({ label: startLabel, kind: 'start', source: curated?.start ? 'parcours curé' : 'wikipedia' });
  for (const via of curated?.vias || []) {
    if (typeof via === 'string') wps.push({ label: via, kind: 'via', source: 'parcours curé' });
    else wps.push({ label: via.label, kind: via.kind || 'via', altitude_hint_m: via.ele ?? null, source: 'parcours curé' });
  }
  // Arrivée au sommet (Alpe d'Huez, Hautacam…) : traitée comme un col pour
  // garantir le passage au sommet et la vérification d'altitude.
  wps.push({
    label: finishLabel,
    kind: isColQuery(finishLabel) ? 'col' : 'finish',
    source: curated?.finish ? 'parcours curé' : 'wikipedia',
  });
  return wps;
}

function editionNotes(year) {
  return HISTORIC_ROUTES[String(year)]?.notes || null;
}

module.exports = {
  parseStagesFromHtml,
  extractTables,
  parseCourse,
  parseDistanceKm,
  parseDate,
  fetchEditionHtml,
  reconstructionWaypoints,
  editionNotes,
  HISTORIC_ROUTES,
};
