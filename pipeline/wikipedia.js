'use strict';
// Mode archives : import de la liste des étapes d'une édition depuis Wikipédia
// (API REST en.wikipedia.org / fr.wikipedia.org — pages « <année> Tour de France »,
// tableaux structurés, licence CC BY-SA). La provenance de chaque champ est stockée.
// Recoupement manuel autorisé : bikeraceinfo.com. On ne scrape NI letour.fr NI lequipe.fr.

const fs = require('fs');
const path = require('path');
const { parse: parseHtml } = require('node-html-parser');
const { httpText, isOffline } = require('./http');
const { cached } = require('./cache');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const HISTORIC_ROUTES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'historic_routes.json'), 'utf8')
);
// Référentiel centralisé des altitudes de cols connus (backlog issue #10,
// section A) — évite de retaper la même altitude dans chaque édition de
// historic_routes.json où le col apparaît. Une entrée peut toujours fournir
// son propre `ele` explicite pour prévaloir sur ce référentiel.
const KNOWN_COLS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'known_cols.json'), 'utf8')
);

// --- Parseur HTML (tableaux Wikipédia) -----------------------------------------
// node-html-parser (backlog #10, section F) : un vrai DOM plutôt qu'un mini-
// parseur regex maison — celui-ci cassait silencieusement (aucune erreur,
// juste des cellules mal découpées) dès qu'une évolution de mise en page
// Wikipédia sortait des motifs prévus. Dépendance évaluée avant adoption :
// 11 paquets, ~3 Mo, 0 vulnérabilité connue (`npm audit`) — et son extraction
// vérifiée bit-à-bit identique à l'ancien parseur sur les 3 fixtures réelles
// du dépôt (pipeline/fixtures/wikipedia_*.html, formats 1903 historique et
// 2025/2026 modernes) avant remplacement, pas seulement testée sur un
// nouveau cas inventé.

function cellText(cell) {
  const clone = cell.clone();
  clone.querySelectorAll('sup, style').forEach((n) => n.remove()); // appels de référence [1]
  clone.querySelectorAll('br').forEach((n) => n.replaceWith(' '));
  return clone.text // .text décode les entités HTML (via node-html-parser)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrait toutes les tables wikitable d'une page HTML → [ [ [cell,…], … ], … ]. */
function extractTables(html) {
  const root = parseHtml(html);
  const tables = [];
  for (const table of root.querySelectorAll('table')) {
    if (!/wikitable/i.test(table.getAttribute('class') || '')) continue;
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('th, td').map(cellText);
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
 * Retourne [{label, kind, altitude_hint_m?, bonus_sec?, source}]
 */
function reconstructionWaypoints(year, stage) {
  const { isColQuery } = require('./geocode');
  const curated = HISTORIC_ROUTES[String(year)]?.stages?.[String(stage.number)];
  const wps = [];
  const startLabel = curated?.start || stage.start;
  const finishLabel = curated?.finish || stage.finish;
  wps.push({ label: startLabel, kind: 'start', bonus_sec: null, source: curated?.start ? 'parcours curé' : 'wikipedia' });
  for (const via of curated?.vias || []) {
    if (typeof via === 'string') wps.push({ label: via, kind: 'via', bonus_sec: null, source: 'parcours curé' });
    else {
      const ele = via.ele ?? KNOWN_COLS[via.label]?.ele ?? null;
      wps.push({
        label: via.label, kind: via.kind || 'via', altitude_hint_m: ele,
        bonus_sec: via.bonus_sec || null,
        source: 'parcours curé',
      });
    }
  }
  // Arrivée au sommet (Alpe d'Huez, Hautacam…) : traitée comme un col pour
  // garantir le passage au sommet et la vérification d'altitude.
  wps.push({
    label: finishLabel,
    kind: isColQuery(finishLabel) ? 'col' : 'finish',
    bonus_sec: curated?.finish_bonus_sec || null,
    source: curated?.finish ? 'parcours curé' : 'wikipedia',
  });
  return wps;
}

function editionNotes(year) {
  return HISTORIC_ROUTES[String(year)]?.notes || null;
}

/**
 * Années dont l'édition curée porte un `highlight` (libellé court, ex.
 * « Premier Galibier ») — backlog issue #10, section D, "mettre en avant les
 * étapes mythiques dans Archives". Triées par année croissante. Une édition
 * curée sans `highlight` (ex. les éditions 2020+, détaillées année par année
 * mais pas individuellement "mythiques") n'apparaît pas dans la liste.
 */
function historicHighlights() {
  return Object.entries(HISTORIC_ROUTES)
    .filter(([, edition]) => edition.highlight)
    .map(([year, edition]) => ({ year: parseInt(year, 10), highlight: edition.highlight }))
    .sort((a, b) => a.year - b.year);
}

const CONFIDENCE_STATUSES = ['OK', 'FIX', 'UNSURE'];
const CONFIDENCE_LEVELS = ['haute', 'moyenne', 'basse'];

/**
 * Affirmations à confiance structurée d'une étape (backlog issue #10, section
 * A) : plutôt que de noyer une réserve (« altitude à confirmer », etc.) dans
 * le texte libre `note`, historic_routes.json peut porter un tableau
 * `confidence` par étape — [{claim, status: OK|FIX|UNSURE, level: haute|
 * moyenne|basse, detail?}]. Absent = aucune réserve connue sur cette étape,
 * pas une affirmation « tout est vérifié à 100 % ».
 */
function stageConfidence(year, stageNumber) {
  const stage = HISTORIC_ROUTES[String(year)]?.stages?.[String(stageNumber)];
  return stage?.confidence || [];
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
  historicHighlights,
  stageConfidence,
  CONFIDENCE_STATUSES,
  CONFIDENCE_LEVELS,
  HISTORIC_ROUTES,
  KNOWN_COLS,
};
