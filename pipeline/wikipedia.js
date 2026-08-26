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
    // Un 3e critère (colonne « course/parcours/route/itinéraire ») avait été
    // introduit ici mais avec un `|| true` qui le rendait tautologique — donc
    // mort depuis son introduction (trouvaille de sprint dédié, survivant de
    // mutation testing). Retiré plutôt que « réparé » en ôtant juste le
    // `|| true` : cette dernière option resserre réellement la condition et
    // rejetterait un tableau qui fonctionne aujourd'hui si son en-tête réel
    // (page Wikipédia vivante, non vérifiable depuis ce sandbox sans accès
    // réseau) ne contient aucun de ces mots — un changement de comportement
    // non vérifiable, alors que la suppression pure et simple ne change rien
    // (elle équivaut exactement à `&& true`, comme le code l'exécutait déjà).
    const looksRight =
      header.some((h) => /stage|étape|etape/.test(h)) &&
      header.some((h) => /distance/.test(h));
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
    for (const rawRow of rows.slice(1)) {
      if (rawRow.length < 3) continue; // lignes de repos / totaux
      // Certains tableaux (ex. Tour de France Femmes 2022) portent une
      // colonne supplémentaire sans en-tête textuel entre Distance et Type
      // (icône de profil d'étape, extraite comme cellule vide) : le nombre
      // de cellules de la ligne dépasse alors celui de l'en-tête, et les
      // colonnes indexées après Distance (type, winner) décalent d'un cran
      // — « Flat stage » se retrouvait dans `winner`, `type` restait vide.
      // Ne retire les cellules vides que si ça réaligne exactement la ligne
      // sur l'en-tête (jamais sur une ligne déjà alignée, pour ne rien
      // changer au comportement existant des fixtures 1903/2025/2026).
      // Limite connue (relecture adverse du 26/08/2026) : si une ligne
      // décalée porte AUSSI une vraie donnée manquante à côté de l'icône
      // (deux cellules vides au lieu d'une), le réalignement échoue et la
      // ligne retombe sur son état d'origine, non corrigé — dégradation
      // sûre plutôt que corruption silencieuse (la ligne est rejetée faute
      // de distance/numéro d'étape exploitable), mais pas rencontré en
      // pratique : Wikipédia représente une valeur pas encore connue par un
      // tiret « — », jamais par une cellule vide (vérifié sur
      // wikipedia_2026_en.html, étapes non courues).
      let row = rawRow;
      if (rawRow.length > header.length) {
        const nonEmpty = rawRow.filter((c) => String(c).trim() !== '');
        if (nonEmpty.length === header.length) row = nonEmpty;
      }
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

/** HTML de la page « <année> Tour de France [Femmes] » (cache api_cache ; fixture en hors-ligne). */
async function fetchEditionHtml(year, category = 'hommes') {
  const pageTitle = category === 'femmes' ? `${year} Tour de France Femmes` : `${year} Tour de France`;
  const fixtureSuffix = category === 'femmes' ? `${year}_femmes_en.html` : `${year}_en.html`;
  const fixture = path.join(FIXTURES_DIR, `wikipedia_${fixtureSuffix}`);
  if (isOffline()) {
    if (fs.existsSync(fixture)) return fs.readFileSync(fixture, 'utf8');
    throw new Error(
      `Mode hors-ligne : pas de fixture locale pour « ${pageTitle} ». ` +
        `Relancez avec accès réseau pour importer cette édition depuis Wikipédia.`
    );
  }
  const { value } = await cached('api', 'wikipedia-en', { page: pageTitle.replace(/ /g, '_') }, async () => {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${pageTitle.replace(/ /g, '_')}`;
    return httpText(url, { minDelayMs: 600 });
  });
  return value;
}

// Clé historic_routes.json : l'année seule pour Hommes (rétrocompatible avec
// toute la curation existante), `<année>-femmes` pour Femmes — sans ce
// suffixe, une édition Femmes partageant l'année d'une édition Hommes déjà
// curée (ex. 2022) hériterait à tort de ses points de passage et de ses
// notes (Chantier L, Tour de France Femmes). Aucune entrée `-femmes`
// n'existe encore dans historic_routes.json : une import Femmes retombe
// donc simplement sur les libellés de ville bruts de Wikipédia, comme
// n'importe quelle année Hommes non curée.
function historicRoutesKey(year, category) {
  return category === 'femmes' ? `${year}-femmes` : String(year);
}

/**
 * Waypoints de reconstruction d'une étape historique : villes officielles
 * (Wikipédia) + points de passage curés (historic_routes.json) quand ils existent.
 * Retourne [{label, kind, altitude_hint_m?, bonus_sec?, source}]
 */
function reconstructionWaypoints(year, stage, category = 'hommes') {
  const { isColQuery } = require('./geocode');
  const curated = HISTORIC_ROUTES[historicRoutesKey(year, category)]?.stages?.[String(stage.number)];
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

function editionNotes(year, category = 'hommes') {
  return HISTORIC_ROUTES[historicRoutesKey(year, category)]?.notes || null;
}

/**
 * Années dont l'édition curée porte un `highlight` (libellé court, ex.
 * « Premier Galibier ») — backlog issue #10, section D, "mettre en avant les
 * étapes mythiques dans Archives". Triées par année croissante. Une édition
 * curée sans `highlight` (ex. les éditions 2020+, détaillées année par année
 * mais pas individuellement "mythiques") n'apparaît pas dans la liste.
 *
 * Clé `<année>-femmes` (voir historicRoutesKey) explicitement exclue plutôt
 * que parsée avec le reste : parseInt("2022-femmes", 10) renverrait 2022 et
 * confondrait silencieusement une vignette Femmes avec l'édition Hommes de
 * la même année tant qu'aucun champ `category` n'est propagé jusqu'ici.
 */
function historicHighlights() {
  return Object.entries(HISTORIC_ROUTES)
    .filter(([key, edition]) => edition.highlight && /^\d+$/.test(key))
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
function stageConfidence(year, stageNumber, category = 'hommes') {
  const stage = HISTORIC_ROUTES[historicRoutesKey(year, category)]?.stages?.[String(stageNumber)];
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
