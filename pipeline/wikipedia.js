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
// Nom de département français → code INSEE (source geo.api.gouv.fr,
// 30/08/2026 — voir pipeline/data/french_departments.json). Sert à
// reconnaître le qualificatif « Ville, Département » que porte le titre
// Wikipédia anglais d'une commune française homonyme (ex. « Bonneval,
// Eure-et-Loir »), jamais à valider une adresse complète.
const FRENCH_DEPARTMENTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'french_departments.json'), 'utf8')
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

/**
 * Extrait le texte d'une cellule sous deux formes : `text` (texte affiché,
 * comportement historique inchangé) et `titledText` (identique, sauf que le
 * texte affiché de tout lien wiki portant un attribut `title` est remplacé
 * par ce `title` — le nom de page Wikipédia canonique).
 *
 * Utile car le texte AFFICHÉ d'un lien peut perdre un diacritique que porte
 * le titre réel de la page ciblée — trouvaille sur la génération réelle du
 * 28/08/2026, Tour 1994 étape 18 : le tableau affiche « Moutiers » (texte du
 * lien) alors que title="Moûtiers" (le vrai nom de la commune savoyarde).
 * Sans l'accent, la Géoplateforme (pipeline/geocode.js) trouve une commune
 * homonyme sans rapport (Meuse) à égalité de score avec la vraie Moûtiers,
 * et retient la mauvaise faute d'un signal de désambiguïsation.
 *
 * `titledText` n'est PAS utilisé partout (relecture adverse, 28/08/2026) :
 * un premier correctif l'appliquait à `cellText()` pour toute cellule, donc
 * aussi la colonne numéro d'étape (dont le lien pointe vers un sous-article
 * dont le title commence par l'année, ex. « 1994 Tour de France, Stage 11 to
 * Stage 21 » pour l'étape 18 — le numéro devenait l'année, cassant en
 * cascade stage_order, la curation historic_routes.json et le calcul des
 * jours de montagne consécutifs) et la colonne vainqueur (icône de drapeau
 * sans texte affiché, dont le title — un nom de pays — polluait le champ).
 * `titledText` n'est donc lu que pour la colonne course (parseStagesFromHtml).
 */
function cellTexts(cell) {
  const clone = cell.clone();
  clone.querySelectorAll('sup, style').forEach((n) => n.remove()); // appels de référence [1]
  clone.querySelectorAll('br').forEach((n) => n.replaceWith(' '));
  const finalize = (raw) => raw // .text décode les entités HTML (via node-html-parser)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const text = finalize(clone.text);
  const titledClone = clone.clone();
  titledClone.querySelectorAll('a').forEach((a) => {
    const title = a.getAttribute('title');
    if (title) a.set_content(title);
  });
  return { text, titledText: finalize(titledClone.text) };
}

/**
 * Extrait toutes les tables wikitable d'une page HTML → [ [ [{text,
 * titledText},…], … ], … ] — variante « riche » de extractTables() (voir
 * cellTexts ci-dessus), réservée à parseStagesFromHtml.
 */
function extractTablesRich(html) {
  const root = parseHtml(html);
  const tables = [];
  for (const table of root.querySelectorAll('table')) {
    if (!/wikitable/i.test(table.getAttribute('class') || '')) continue;
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('th, td').map(cellTexts);
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/** Extrait toutes les tables wikitable d'une page HTML → [ [ [cell,…], … ], … ]. */
function extractTables(html) {
  return extractTablesRich(html).map((rows) => rows.map((row) => row.map((c) => c.text)));
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

// Wikipédia annote entre parenthèses le PAYS d'une ville de départ/arrivée
// uniquement quand elle est hors de France (convention observée sur les
// pages réelles « <année> Tour de France », ex. « Dover (United Kingdom) »,
// « Luxembourg City (Luxembourg) ») — jamais pour une précision purement
// française (ex. « Paris (Montgeron) », le point de départ réel dans la
// commune parisienne en 1903). Liste fermée plutôt que « toute parenthèse
// vaut annotation de pays » : sans elle, « Montgeron » serait pris à tort
// pour un pays. Couvre les pays européens plausibles pour un Grand Départ,
// pas une liste exhaustive mondiale — un pays absent de cette liste retombe
// simplement sur le comportement par défaut (countryHint 'fr' inchangé),
// dégradation sûre plutôt que fausse détection.
const KNOWN_COUNTRIES = new Set([
  'france', 'belgium', 'netherlands', 'luxembourg', 'germany', 'switzerland',
  'italy', 'spain', 'monaco', 'andorra', 'united kingdom', 'england',
  'scotland', 'wales', 'ireland', 'northern ireland', 'denmark', 'san marino',
  'portugal', 'austria', 'liechtenstein', 'slovenia', 'czech republic', 'poland',
  // Guerre froide : le Tour a démarré à Cologne en 1965 avant la réunification
  // allemande — le texte Wikipédia de l'époque annote « (West Germany) »,
  // jamais « (Germany) » — trouvaille en vérifiant le wikitexte brut réel de
  // la page « 1965 Tour de France » (29/08/2026, mission tracés historiques) :
  // sans cette entrée, « Cologne » (aucune commune française homonyme
  // plausible) partait sur la Géoplateforme par défaut et résolvait sur un
  // homonyme du Gers, à ~750 km de la vraie ville allemande.
  'west germany', 'east germany',
]);

/**
 * Pays annoté entre parenthèses juste après le nom de ville (avant un
 * éventuel « via », qui décrit un point de passage, jamais la ville elle-
 * même — voir parseCourse). `null` si aucune parenthèse ne correspond à un
 * pays reconnu (précision de lieu française, ex. « Paris (Montgeron) »).
 */
function extractCountry(text) {
  const beforeVia = String(text).replace(/\s+via\b.*$/i, '');
  const matches = [...beforeVia.matchAll(/\(([^)]*)\)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i][1].trim();
    if (KNOWN_COUNTRIES.has(candidate.toLowerCase())) return candidate;
    // Nom alternatif + pays dans la même parenthèse, ex. « Woluwe-Saint-Pierre
    // (Sint-Pieters-Woluwe, Belgium) » (wikitexte réel, Tour 1969) — le pays
    // reste conventionnellement le DERNIER segment séparé par une virgule.
    // Sans ce repli, la parenthèse entière ("sint-pieters-woluwe, belgium")
    // ne correspond jamais telle quelle à KNOWN_COUNTRIES et le pays annoté
    // par Wikipédia est perdu — trouvaille en vérifiant le wikitexte brut réel
    // (29/08/2026, mission tracés historiques).
    const parts = candidate.split(',').map((p) => p.trim());
    if (parts.length > 1 && KNOWN_COUNTRIES.has(parts[parts.length - 1].toLowerCase())) {
      return parts[parts.length - 1];
    }
  }
  return null;
}

/**
 * Département français annoté après une virgule, juste après le nom de
 * ville (avant un éventuel « via ») — convention de titre Wikipédia anglais
 * pour une commune française homonyme (ex. « Bonneval, Eure-et-Loir »),
 * jamais pour un pays (voir extractCountry, entre parenthèses). `null` si
 * aucun segment après la dernière virgule ne correspond à un département
 * reconnu (FRENCH_DEPARTMENTS, liste fermée — même philosophie que
 * KNOWN_COUNTRIES : une précision de lieu qui n'est pas un département
 * connu retombe simplement sur le comportement par défaut, jamais une
 * fausse détection).
 *
 * Trouvaille en interrogeant l'API Géoplateforme réelle (30/08/2026,
 * mission tracés historiques) : envoyer la requête AVEC ce qualificatif
 * dégrade le classement au lieu de l'affiner — « Bonneval, Eure-et-Loir »
 * ne retrouve la vraie commune dans AUCUN des 5 premiers résultats
 * (seulement des rues homonymes de Bonneval elle-même, noyées par le texte
 * du département), alors que la requête nue « Bonneval » la retrouve en
 * tête (commune réelle, score 0.98). Le qualificatif est donc retiré de la
 * requête envoyée au géocodeur (voir clean() ci-dessous) — mais conservé
 * séparément ici comme indice de département : retirer la requête nue seule
 * ne suffit pas dans tous les cas, deux communes françaises peuvent
 * légitimement partager le même nom (ex. « Les Angles », Gard ET Pyrénées-
 * Orientales, vérifié en direct : score Géoplateforme quasi identique,
 * 0.9727 pour les deux, ordre non garanti sur une égalité — même classe de
 * fragilité que Bristol/Martinique cette session).
 */
function extractDepartment(text) {
  const beforeVia = String(text).replace(/\s+via\b.*$/i, '');
  const withoutParens = beforeVia.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const m = withoutParens.match(/,\s*([^,]+)\s*$/);
  if (!m) return null;
  const candidate = m[1].trim();
  return Object.prototype.hasOwnProperty.call(FRENCH_DEPARTMENTS, candidate) ? candidate : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCourse(text) {
  // « Paris to Lyon », « Paris – Lyon », « Paris > Lyon »
  const m = String(text).match(/^(.*?)\s+(?:to|à|a|>|–|—|-)\s+(.*)$/i);
  if (!m) return null;
  // Trouvaille en générant en masse avec un vrai accès réseau (27/08/2026) :
  // « Brussels (Belgium) to Brussels (Belgium) via Charleroi (Belgium) »
  // (Tour 2019, étape 1, un circuit qui part et revient à Brussels) donnait
  // finish = "Brussels via Charleroi" — un géocodage sans résultat, ce nom
  // composé n'étant pas un vrai lieu. « via X » décrit un point de passage
  // du trajet, jamais la ville de départ/arrivée elle-même. \s+via\b (pas
  // juste "via") exige un espace avant pour ne jamais tronquer une ville
  // dont le nom contiendrait « via » comme sous-chaîne collée (aucun cas
  // réel connu, mais coûte rien) ; \b (pas \s+ après) plutôt que .+ pour
  // couvrir aussi un « via » qui se retrouve seul en fin de chaîne.
  //
  // Le retrait de « via » reste APRÈS le retrait des parenthèses et la
  // normalisation des espaces, exactement comme avant l'ajout du retrait de
  // département ci-dessous (voir « Lyon via (Melun) » plus haut) — un
  // réordonnancement « via avant parenthèses » a été tenté puis reverté
  // (relecture adverse, 30/08/2026, 2e tour) : \s+via\b.*$ ne sait pas
  // distinguer un « via » séparateur de trajet d'un « via » simplement
  // présent À L'INTÉRIEUR d'une parenthèse encore non retirée (ex. « Lyon
  // (something via Melun) after ») — appliqué avant le retrait des
  // parenthèses, il tronque au milieu de la parenthèse et laisse une
  // parenthèse non fermée dans le résultat (« Lyon (something » au lieu de
  // « Lyon after »). Retirer d'abord les parenthèses ferme cette classe de
  // bug : leur contenu (« via » compris s'il s'y trouve) disparaît en bloc,
  // donc le retrait de « via » qui suit ne voit plus que les VRAIS
  // séparateurs de trajet, jamais un mot interne à une parenthèse déjà
  // retirée.
  //
  // Trouvaille de relecture adverse (30/08/2026, 1er tour, sur l'ajout du
  // retrait de département ci-dessous) : le retrait du département, ancré
  // en fin de chaîne (`,\s*${dept}\s*$`), échouait SILENCIEUSEMENT dès
  // qu'un « via » suivait dans le même segment (ex. « Bergerac, Dordogne
  // via Sarlat-la-Canéda ») — le département n'était alors plus en fin de
  // chaîne au moment du retrait, rouvrant exactement le bug que ce
  // correctif entier visait à fermer. Fermé en retirant le département en
  // DERNIER (après le retrait de « via », qui garde son ordre d'origine
  // après les parenthèses) plutôt qu'en réordonnant via/parenthèses — les
  // deux bugs sont indépendants, une seule ligne de correctif (déplacer le
  // retrait de département en fin de chaîne d'opérations) ferme le premier
  // sans rouvrir le second.
  const startDepartment = extractDepartment(m[1]);
  const finishDepartment = extractDepartment(m[2]);
  const clean = (s, dept) => {
    let out = s
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+via\b.*$/i, '')
      .trim();
    if (dept) {
      out = out.replace(new RegExp(`,\\s*${escapeRegExp(dept)}\\s*$`, 'i'), '').trim();
    }
    return out;
  };
  return {
    start: clean(m[1], startDepartment),
    finish: clean(m[2], finishDepartment),
    startCountry: extractCountry(m[1]),
    finishCountry: extractCountry(m[2]),
    startDepartment,
    finishDepartment,
  };
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
  const tables = extractTablesRich(html);
  for (const rows of tables) {
    const header = rows[0].map((h) => h.text.toLowerCase());
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
        // Décision de réalignement basée UNIQUEMENT sur `.text` (jamais
        // `.titledText`) : une icône sans texte affiché mais avec un `title`
        // (ex. drapeau de pays) deviendrait « non vide » sous titledText,
        // ce qui déclencherait le réalignement à tort — `.text` reproduit
        // exactement le comportement historique (avant l'ajout de
        // titledText), garanti insensible à ce nouveau champ.
        const nonEmpty = rawRow.filter((c) => String(c.text).trim() !== '');
        if (nonEmpty.length === header.length) row = nonEmpty;
      }
      // `row[i]?.text` (jamais `row[i].text`) : une ligne plus courte que
      // l'en-tête (ligne « Total », résumé sans toutes les colonnes — ligne
      // rencontrée sur du HTML Wikipédia réel, 1994) laisse `row[iDist]`
      // `undefined` — l'ancien code tolérait ça via `String(undefined)`
      // (coercion silencieuse, jamais une exception) pour retomber sur le
      // rejet normal juste en dessous (`!distanceKm || !numM`) ; un accès
      // direct `.text` plante avant d'y arriver (trouvaille en vérifiant ce
      // correctif contre le vrai HTML de la page 1994, pas seulement les
      // fixtures locales qui n'ont pas ce genre de ligne).
      const distanceKm = parseDistanceKm(row[iDist]?.text);
      const numM = String(row[iStage]?.text).match(/\d+/);
      if (!distanceKm || !numM) continue; // jour de repos, ligne « Total »…
      // Seule la colonne course lit `titledText` (nom de ville canonique,
      // diacritiques compris) — toutes les autres colonnes gardent `text`
      // (comportement historique inchangé, voir cellTexts()).
      const courseText = iCourse >= 0 ? row[iCourse]?.titledText : '';
      const course = parseCourse(courseText);
      if (!course) continue;
      stages.push({
        number: parseInt(numM[0], 10),
        dateText: iDate >= 0 ? row[iDate]?.text ?? null : null,
        dateIso: iDate >= 0 ? parseDate(row[iDate]?.text, year) : null,
        start: course.start,
        finish: course.finish,
        startCountry: course.startCountry,
        finishCountry: course.finishCountry,
        startDepartment: course.startDepartment,
        finishDepartment: course.finishDepartment,
        distanceKm,
        type: iType >= 0 ? normalizeType(row[iType]?.text) : null,
        winner: iWinner >= 0 ? row[iWinner]?.text ?? null : null,
        sourceRow: row.map((c) => c.text).join(' | '),
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
    // .status : consommé par wrap() (backend/server.js) pour renvoyer 503
    // plutôt que 500 — cas attendu du mode hors-ligne (année/catégorie
    // valides, simplement pas de fixture locale pour elles), pas une vraie
    // panne serveur (trouvaille de revue-personas/monkey testing : ce cas
    // déclenchait un console.error() comme s'il s'agissait d'un bug).
    const err = new Error(
      `Mode hors-ligne : pas de fixture locale pour « ${pageTitle} ». ` +
        `Relancez avec accès réseau pour importer cette édition depuis Wikipédia.`
    );
    err.status = 503;
    throw err;
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
 * Résout les coordonnées curées d'un `via` PAR PAIRE, jamais champ par
 * champ : `via.lat`/`via.lon` (explicite dans historic_routes.json) l'emporte
 * seulement si les DEUX sont fournis, sinon on retombe sur la paire complète
 * de `known` (known_cols.json) ou `{ lat: null, lon: null }` — jamais un
 * mélange des deux sources pour un même point. Repli exceptionnel, jamais
 * deviné : sert un col dont le libellé curé ne se résout correctement chez
 * AUCUN des deux géocodeurs (ex. « Col de Toses », un col espagnol hors du
 * référentiel IGN — trouvaille du 30/08/2026, voir la source détaillée dans
 * known_cols.json). Un waypoint déjà pourvu de lat/lon court-circuite tout
 * géocodage (pipeline/generate.js).
 *
 * Fonction séparée (pas inlinée dans reconstructionWaypoints()) : trouvaille
 * de relecture adverse sur le premier correctif (30/08/2026), qui résolvait
 * `lat` et `lon` indépendamment (`via.lat ?? known?.lat ?? null` /
 * `via.lon ?? known?.lon ?? null`) — un `via` hypothétique ne portant QUE
 * `lat` explicite aurait pu se voir compléter avec le `lon` de known_cols.json,
 * pour un lieu potentiellement différent, sans jamais planter. Aucun `via`
 * actuel de historic_routes.json ne porte lat/lon local (vérifié par grep),
 * donc jamais rencontré en pratique — corrigé avant qu'un futur via partiel
 * ne le déclenche silencieusement.
 */
function resolveViaCoords(via, known) {
  if (via.lat != null && via.lon != null) return { lat: via.lat, lon: via.lon };
  if (known && known.lat != null && known.lon != null) return { lat: known.lat, lon: known.lon };
  return { lat: null, lon: null };
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
  // country_hint seulement pour un départ/arrivée NON curé (issu tel quel du
  // texte Wikipédia) : un parcours curé (historic_routes.json) porte déjà un
  // libellé choisi à la main, sans indice de pays associé — countryHint reste
  // 'fr' par défaut pour lui, comportement inchangé. « France » explicite
  // (ex. « Lyon (France) via (Melun) ») ne compte jamais comme étranger.
  const foreignCountry = (country) => (country && !/^france$/i.test(country) ? country : null);
  // region_hint : même logique que country_hint ci-dessus, mais pour le
  // qualificatif de département (« Bonneval, Eure-et-Loir ») — seulement
  // pour un départ/arrivée NON curé, jamais deviné pour un libellé choisi à
  // la main (historic_routes.json).
  wps.push({
    label: startLabel, kind: 'start', bonus_sec: null,
    source: curated?.start ? 'parcours curé' : 'wikipedia',
    country_hint: curated?.start ? null : foreignCountry(stage.startCountry),
    region_hint: curated?.start ? null : stage.startDepartment || null,
  });
  for (const via of curated?.vias || []) {
    if (typeof via === 'string') wps.push({ label: via, kind: 'via', bonus_sec: null, source: 'parcours curé' });
    else {
      const known = KNOWN_COLS[via.label];
      const ele = via.ele ?? known?.ele ?? null;
      const { lat, lon } = resolveViaCoords(via, known);
      wps.push({
        label: via.label, kind: via.kind || 'via', altitude_hint_m: ele,
        lat, lon,
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
    country_hint: curated?.finish ? null : foreignCountry(stage.finishCountry),
    region_hint: curated?.finish ? null : stage.finishDepartment || null,
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
  extractTablesRich,
  parseCourse,
  parseDistanceKm,
  parseDate,
  fetchEditionHtml,
  reconstructionWaypoints,
  resolveViaCoords,
  FRENCH_DEPARTMENTS,
  editionNotes,
  historicHighlights,
  stageConfidence,
  CONFIDENCE_STATUSES,
  CONFIDENCE_LEVELS,
  HISTORIC_ROUTES,
  KNOWN_COLS,
};
