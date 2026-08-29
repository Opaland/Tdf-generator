'use strict';
// Test du parseur Wikipédia sur les fixtures locales (1903 exigé, + 2025/2026).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  parseStagesFromHtml,
  parseCourse,
  parseDistanceKm,
  parseDate,
  reconstructionWaypoints,
  extractTables,
  extractTablesRich,
} = require('../pipeline/wikipedia');

const FIXTURES = path.join(__dirname, '..', 'pipeline', 'fixtures');
const load = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

test('parse le tableau des étapes du Tour 1903', () => {
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  assert.strictEqual(stages.length, 6, '6 étapes en 1903 (la ligne Total est ignorée)');

  const s1 = stages[0];
  assert.strictEqual(s1.number, 1);
  assert.strictEqual(s1.start, 'Paris');
  assert.strictEqual(s1.finish, 'Lyon');
  assert.strictEqual(s1.distanceKm, 467);
  assert.strictEqual(s1.dateIso, '1903-07-01');
  assert.match(s1.winner, /Garin/);

  const s6 = stages[5];
  assert.strictEqual(s6.number, 6);
  assert.strictEqual(s6.start, 'Nantes');
  assert.strictEqual(s6.distanceKm, 471);

  const total = stages.reduce((a, s) => a + s.distanceKm, 0);
  assert.strictEqual(total, 2428, 'distance totale officielle 1903');
});

test('waypoints de reconstruction 1903 étape 1 : Montgeron au départ, col du Pin-Bouchain', () => {
  // Le col du Pin-Bouchain (759 m, entre Tarare et Roanne) est le tout premier
  // col franchi dans l'histoire du Tour — sur l'étape 1 Paris→Lyon, pas le col
  // de la République (qui est franchi à l'étape 2, premier col > 1000 m).
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  const wps = reconstructionWaypoints(1903, stages[0]);
  assert.strictEqual(wps[0].label, 'Montgeron', 'départ réel au Réveil-Matin de Montgeron');
  assert.strictEqual(wps[wps.length - 1].label, 'Lyon');
  const col = wps.find((w) => w.kind === 'col');
  assert.ok(col, 'le col du Pin-Bouchain figure dans le parcours curé de l\'étape 1');
  assert.strictEqual(col.label, 'Col du Pin-Bouchain');
  assert.strictEqual(col.altitude_hint_m, 759);
});

test('waypoints de reconstruction 1903 étape 2 : col de la République (premier col > 1000 m)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_1903_en.html'), 1903);
  const wps = reconstructionWaypoints(1903, stages[1]);
  const col = wps.find((w) => w.kind === 'col');
  assert.ok(col, 'le col de la République figure dans le parcours curé de l\'étape 2');
  assert.strictEqual(col.label, 'Col de la République');
  assert.strictEqual(col.altitude_hint_m, 1161);
});

test('reconstructionWaypoints() : country_hint propagé au départ/arrivée non curés, jamais aux parcours curés', () => {
  const stage = {
    number: 99, start: 'Dover', finish: 'Brighton',
    startCountry: 'United Kingdom', finishCountry: null,
  };
  const wps = reconstructionWaypoints(1994, stage); // 1994 étape 99 : aucun curatif connu
  assert.strictEqual(wps[0].label, 'Dover');
  assert.strictEqual(wps[0].country_hint, 'United Kingdom');
  assert.strictEqual(wps[wps.length - 1].label, 'Brighton');
  assert.strictEqual(wps[wps.length - 1].country_hint, null, 'aucune annotation de pays pour Brighton dans ce test');
});

test('reconstructionWaypoints() : country_hint absent quand aucune annotation de pays', () => {
  const stage = { number: 1, start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null };
  const wps = reconstructionWaypoints(2000, stage);
  assert.strictEqual(wps[0].country_hint, null);
  assert.strictEqual(wps[wps.length - 1].country_hint, null);
});

test('parse le tableau des étapes du Tour 2025 (format moderne)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_2025_en.html'), 2025);
  assert.strictEqual(stages.length, 21, '21 étapes en 2025 (repos et Total ignorés)');

  const clm = stages.find((s) => s.number === 5);
  assert.strictEqual(clm.start, 'Caen');
  assert.strictEqual(clm.type, 'clm');
  assert.strictEqual(clm.distanceKm, 33);

  const hautacam = stages.find((s) => s.number === 12);
  assert.strictEqual(hautacam.finish, 'Hautacam');
  assert.strictEqual(hautacam.type, 'montagne');

  const bretagne = stages.find((s) => s.number === 7);
  assert.strictEqual(bretagne.finish, 'Mûr-de-Bretagne', 'entités HTML accentuées décodées');
});

test('parse la fixture 2026 (parcours annoncé, partielle)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_2026_en.html'), 2026);
  assert.ok(stages.length >= 10);
  assert.strictEqual(stages[0].type, 'clm par équipes', 'étape 1 : CLM par équipes à Barcelone');
  assert.strictEqual(stages[0].start, 'Barcelona');
  const alpe = stages.filter((s) => s.finish === "Alpe d'Huez");
  assert.strictEqual(alpe.length, 2, "doublé de l'Alpe d'Huez");
});

// Trouvaille en testant l'import Femmes avec un vrai accès réseau (26/08/2026,
// PR #132) : le tableau « Stage characteristics » de la page Femmes porte un
// en-tête « Type » en colspan="2" (icône de profil d'étape + libellé texte)
// mais une seule cellule d'en-tête, alors que chaque ligne de données a deux
// cellules pour cette colonne — un cran de décalage qui faisait atterrir le
// libellé de type (« Flat stage ») dans `winner`, et laissait `type` vide.
// Jamais rencontré sur les fixtures Hommes existantes (pas de cette icône).
test('parse le tableau des étapes du Tour de France Femmes 2022 (colonne icône sans en-tête propre)', () => {
  const stages = parseStagesFromHtml(load('wikipedia_2022_femmes_en.html'), 2022);
  assert.strictEqual(stages.length, 8, '8 étapes en 2022 (première édition moderne)');

  const s1 = stages[0];
  assert.strictEqual(s1.start, 'Paris: Tour Eiffel');
  assert.strictEqual(s1.finish, 'Champs-Élysées');
  assert.strictEqual(s1.distanceKm, 81.6);
  assert.strictEqual(s1.type, 'plaine', 'pas "Flat stage" mal aligné dans winner');
  assert.strictEqual(s1.winner, 'Lorena Wiebes (NED)', 'pas le libellé de type par erreur de colonne');

  const s8 = stages[7];
  assert.strictEqual(s8.finish, 'La Super Planche des Belles Filles');
  assert.strictEqual(s8.type, 'montagne');
  assert.strictEqual(s8.winner, 'Annemiek van Vleuten (NED)');

  // Aucune étape ne doit avoir un type resté vide/null à cause du décalage.
  assert.ok(stages.every((s) => s.type != null), 'toutes les étapes ont un type reconnu, aucune ne reste null');
});

test('parseStagesFromHtml : réaligne une ligne avec une cellule vide en trop, jamais une ligne déjà alignée', () => {
  // Synthèse minimale du motif colspan Femmes 2022 : en-tête à 4 colonnes,
  // lignes à 5 cellules (icône vide insérée avant Type).
  const decale = '<table class="wikitable"><tr><th>Stage</th><th>Course</th><th>Distance</th><th>Type</th></tr>' +
    '<tr><td>1</td><td>Paris to Lyon</td><td>100 km</td><td></td><td>Flat stage</td></tr>' +
    '<tr><td>2</td><td>Lyon to Marseille</td><td>120 km</td><td></td><td>Hilly stage</td></tr></table>';
  const stages = parseStagesFromHtml(decale, 2000);
  assert.strictEqual(stages.length, 2);
  assert.strictEqual(stages[0].type, 'plaine', 'la cellule vide en trop est retirée, Type retombe sur la bonne colonne');
  assert.strictEqual(stages[1].type, 'accidentée');

  // Une ligne déjà alignée (même nombre de cellules que l'en-tête) avec une
  // vraie cellule vide (ex. type non renseigné) ne doit jamais être touchée
  // par le réalignement — comportement inchangé.
  const aligneAvecVide = '<table class="wikitable"><tr><th>Stage</th><th>Course</th><th>Distance</th><th>Type</th></tr>' +
    '<tr><td>1</td><td>Paris to Lyon</td><td>100 km</td><td></td></tr>' +
    '<tr><td>2</td><td>Lyon to Marseille</td><td>120 km</td><td>Hilly stage</td></tr></table>';
  const stages2 = parseStagesFromHtml(aligneAvecVide, 2000);
  assert.strictEqual(stages2[0].type, null, 'ligne déjà alignée : cellule vide légitime, pas de réalignement à tort');
  assert.strictEqual(stages2[1].type, 'accidentée');
});

test('fonctions unitaires du parseur', () => {
  assert.deepStrictEqual(parseCourse('Paris to Lyon'), { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null });
  assert.deepStrictEqual(parseCourse('Pau – Hautacam'), { start: 'Pau', finish: 'Hautacam', startCountry: null, finishCountry: null });
  // « Montgeron » n'est pas un pays reconnu : precision de lieu française
  // pure (le vrai point de départ 1903, dans cette commune), pas une
  // annotation de pays — countryHint doit rester 'fr' par défaut pour elle.
  assert.deepStrictEqual(
    parseCourse('Paris (Montgeron) to Lyon'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null }
  );
  assert.strictEqual(parseDistanceKm('467 km (290 mi)'), 467);
  assert.strictEqual(parseDistanceKm('2,428 km'), 2428, 'séparateur de milliers anglo-saxon');
  assert.strictEqual(parseDistanceKm('467,5 km'), 467.5, 'décimale française');
  assert.strictEqual(parseDate('1–2 July', 1903), '1903-07-01');
  assert.strictEqual(parseDate('5 juillet 1903', 1903), '1903-07-05');
});

// Trouvaille en générant en masse avec un vrai accès réseau (27/08/2026,
// Tour de France 2019, étape 1) : ligne source réelle capturée en base —
// « Brussels (Belgium) to Brussels (Belgium) via Charleroi (Belgium) »,
// un circuit qui part et revient à Brussels. Avant ce correctif, finish
// valait littéralement « Brussels via Charleroi », un géocodage sans
// résultat puisque ce n'est pas un vrai nom de lieu — « via Charleroi »
// décrit un point de passage du trajet, jamais la ville d'arrivée.
test('parseCourse() : « via <ville> » est un point de passage du trajet, jamais retenu dans start/finish', () => {
  assert.deepStrictEqual(
    parseCourse('Brussels (Belgium) to Brussels (Belgium) via Charleroi (Belgium)'),
    { start: 'Brussels', finish: 'Brussels', startCountry: 'Belgium', finishCountry: 'Belgium' }
  );
  assert.deepStrictEqual(
    parseCourse('Paris via Melun to Lyon'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null }
  );
});

// Trouvaille en creusant un signalement utilisateur sur le site publié
// (28/08/2026) : deux étapes historiques réelles mal placées sur la carte —
// Tour 1992 étape 10 (Luxembourg City → Strasbourg) et Tour 1994 étape 4
// (Dover → Brighton, le passage du Tour en Angleterre). Cause racine :
// pipeline/geocode.js interroge toujours la Géoplateforme (base FRANCE
// uniquement) en premier, quel que soit le pays réel de la ville — une ville
// étrangère y trouve quand même une correspondance textuelle plausible mais
// fausse (ex. une rue « Cité du Luxembourg » à Bury, Oise, pour « Luxembourg
// City »), qui sert ensuite d'ancre de proximité pour la ville suivante et la
// fait dérailler à son tour. Le texte Wikipédia annote pourtant déjà le pays
// entre parenthèses pour ces villes précises — jeté à la trappe par clean()
// jusqu'ici. startCountry/finishCountry permettent à pipeline/generate.js de
// sauter directement Nominatim (couverture mondiale) pour ces waypoints.
test('parseCourse() : extrait le pays annoté entre parenthèses pour une ville hors de France', () => {
  assert.deepStrictEqual(
    parseCourse('Dover (United Kingdom) to Brighton'),
    { start: 'Dover', finish: 'Brighton', startCountry: 'United Kingdom', finishCountry: null }
  );
  assert.deepStrictEqual(
    parseCourse('Luxembourg City (Luxembourg) to Strasbourg'),
    { start: 'Luxembourg City', finish: 'Strasbourg', startCountry: 'Luxembourg', finishCountry: null }
  );
});

// Reproduction directe de deux bugs trouvés en vérifiant le wikitexte brut
// réel (29/08/2026, mission tracés historiques — étapes reconstruites avec
// une distance délirante, ex. « Cologne → Liège » 1965 reconstruite à
// +600 % de la distance officielle) :
test('parseCourse() : « West Germany »/« East Germany » reconnus (Guerre froide, absents de Germany)', () => {
  // Wikitexte réel, page « 1965 Tour de France » : « [[Cologne]] (West
  // Germany) to [[Liège]] (Belgium) » — sans cette entrée, « Cologne » (aucun
  // pays détecté) partait sur la Géoplateforme par défaut et résolvait sur un
  // homonyme du Gers (France), à ~750 km de la vraie Cologne allemande.
  assert.deepStrictEqual(
    parseCourse('Cologne (West Germany) to Liège (Belgium)'),
    { start: 'Cologne', finish: 'Liège', startCountry: 'West Germany', finishCountry: 'Belgium' }
  );
});

test('parseCourse() : pays annoté avec un nom alternatif dans la même parenthèse (« Ville, Pays »)', () => {
  // Wikitexte réel, page « 1969 Tour de France » : « [[Woluwe-Saint-Pierre]]
  // (Sint-Pieters-Woluwe, Belgium) » — la parenthèse entière ne correspond
  // jamais telle quelle à KNOWN_COUNTRIES ; sans repli sur le dernier segment
  // séparé par une virgule, le pays annoté est perdu et « Woluwe-Saint-Pierre »
  // (sans indice) résolvait à La Réunion (homonymie « Saint-Pierre », un
  // référentiel légitimement français) au lieu de Belgique.
  assert.deepStrictEqual(
    parseCourse('Roubaix to Woluwe-Saint-Pierre (Sint-Pieters-Woluwe, Belgium)'),
    { start: 'Roubaix', finish: 'Woluwe-Saint-Pierre', startCountry: null, finishCountry: 'Belgium' }
  );
});

// Trouvaille de relecture adverse sur le test précédent : si le nom de la
// ville-via est ENTIÈREMENT entre parenthèses, l'ancien ordre (parenthèses
// retirées avant « via ») laissait un « via » orphelin (« Lyon via (Melun) »
// → « Lyon via » au lieu de « Lyon ») — même classe de bug que ci-dessus,
// pas déclenchée par les fixtures connues de ce dépôt, mais un futur format
// Wikipédia pourrait la reproduire silencieusement.
test('parseCourse() : « via » retiré même quand le point de passage est entièrement entre parenthèses', () => {
  assert.deepStrictEqual(
    parseCourse('Paris to Lyon via (Melun)'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null }
  );
  // « France » explicite ne compte jamais comme étranger (countryHint 'fr'
  // par défaut déjà correct) — vérifié distinctement de « aucune parenthèse
  // reconnue » ci-dessus, pas juste les deux confondus en un même null.
  assert.deepStrictEqual(
    parseCourse('Paris to Lyon (France) via (Melun) (une note)'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: 'France' }
  );
});

// looksRight (sélection du bon tableau parmi plusieurs wikitable de la page) :
// portait un 3e critère (colonne « course/parcours/route/itinéraire ») posé
// avec un `|| true` qui le rendait tautologique — mort depuis son
// introduction, jamais tué par le mutation testing (aucun code ne peut
// changer son résultat). Retiré plutôt que « réparé » (voir le commentaire
// dans pipeline/wikipedia.js) : ne reste que les deux critères réels
// (colonne étape + colonne distance), verrouillés ici explicitement — rien
// ne les couvrait directement avant, seulement en creux via les fixtures
// réelles à une seule table candidate.
// Trouvaille en vérifiant ce correctif contre le vrai HTML de la page
// « 1994 Tour de France » (pas seulement les fixtures locales) : une ligne
// « Total » (résumé, moins de cellules que l'en-tête, ex. 3 cellules pour un
// en-tête à 6 colonnes) faisait planter parseStagesFromHtml — row[iDist]
// hors bornes vaut `undefined`, et `undefined.text` lève une exception,
// alors que l'ancien code (String(undefined) sur une valeur brute, pas un
// objet {text,titledText}) tolérait ça et retombait sur le rejet normal de
// la ligne (distance/numéro introuvable → continue).
test('parseStagesFromHtml : une ligne plus courte que l\'en-tête (ligne « Total ») est rejetée, pas une exception', () => {
  const html = '<table class="wikitable"><tr><th>Stage</th><th>Date</th><th>Course</th><th>Distance</th><th>Type</th><th>Winner</th></tr>' +
    '<tr><td>1</td><td>1 July</td><td>Paris to Lyon</td><td>100 km</td><td>Flat stage</td><td>Rider X</td></tr>' +
    '<tr><td>2</td><td>2 July</td><td>Lyon to Marseille</td><td>120 km</td><td>Hilly stage</td><td>Rider Y</td></tr>' +
    '<tr><td></td><td>Total</td><td>220 km</td></tr></table>';
  const stages = parseStagesFromHtml(html, 2000);
  assert.strictEqual(stages.length, 2, 'la ligne Total est ignorée, pas plantée dessus');
});

test('parseStagesFromHtml : ignore un tableau sans colonne étape ou sans colonne distance', () => {
  // Décoys seuls (aucune table candidate ne passe looksRight) : la fonction
  // rejette explicitement plutôt que de renvoyer [] en silence.
  const decoyNoStage = '<table class="wikitable"><tr><th>Rider</th><th>Distance</th></tr><tr><td>X</td><td>100 km</td></tr></table>';
  const decoyNoDistance = '<table class="wikitable"><tr><th>Stage</th><th>Winner</th></tr><tr><td>1</td><td>X</td></tr></table>';
  assert.throws(() => parseStagesFromHtml(decoyNoStage, 2000), /Aucun tableau d'étapes reconnu/);
  assert.throws(() => parseStagesFromHtml(decoyNoDistance, 2000), /Aucun tableau d'étapes reconnu/);

  // Page réaliste (plusieurs wikitable, comme une vraie page Wikipédia) :
  // les décoys précèdent la vraie table des étapes — doit passer par-dessus,
  // pas s'arrêter au premier tableau venu. Au moins 2 étapes exploitables
  // requises pour qu'une table soit acceptée (garde-fou existant,
  // stages.length >= 2, contre un faux positif à une seule ligne).
  const real = '<table class="wikitable"><tr><th>Stage</th><th>Date</th><th>Course</th><th>Distance</th><th>Winner</th></tr>' +
    '<tr><td>1</td><td>1 July</td><td>Paris to Lyon</td><td>100 km</td><td>Rider X</td></tr>' +
    '<tr><td>2</td><td>2 July</td><td>Lyon to Marseille</td><td>120 km</td><td>Rider Y</td></tr></table>';
  const stages = parseStagesFromHtml(decoyNoStage + decoyNoDistance + real, 2000);
  assert.strictEqual(stages.length, 2);
  assert.strictEqual(stages[0].start, 'Paris');

  // Le 3e critère retiré n'était pas nécessaire pour parser correctement :
  // même sans aucune colonne "course/parcours/route/itinéraire" dans l'en-tête,
  // un tableau avec étape + distance + une colonne de villes reconnue sous un
  // autre nom (ex. « Route ») fonctionne toujours (col() cherche 'route' même
  // hors du critère looksRight, indépendamment).
  const sansEnteteCourseExplicite = '<table class="wikitable"><tr><th>Stage</th><th>Date</th><th>Route</th><th>Distance</th></tr>' +
    '<tr><td>1</td><td>1 July</td><td>Pau to Hautacam</td><td>50 km</td></tr>' +
    '<tr><td>2</td><td>2 July</td><td>Hautacam to Lourdes</td><td>40 km</td></tr></table>';
  const stages2 = parseStagesFromHtml(sansEnteteCourseExplicite, 2000);
  assert.strictEqual(stages2.length, 2);
  assert.strictEqual(stages2[0].finish, 'Hautacam');
});

// extractTables (backlog #10, section F) : remplacement du mini-parseur
// regex par node-html-parser (un vrai DOM) — vérifié bit-à-bit identique à
// l'ancien parseur sur les 3 fixtures réelles du dépôt avant remplacement
// (pas dans ce fichier, en amont, avant l'écriture du diff). Ces tests
// couvrent des cas que le mini-parseur regex maison gérait déjà pour
// partie, ou pas du tout — à ne pas régresser avec un futur changement.
test('extractTables : ignore les tables sans classe wikitable', () => {
  const html = '<table class="infobox"><tr><td>x</td></tr></table><table class="wikitable"><tr><td>y</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['y']]]);
});

test('extractTables : retire les appels de référence <sup> du texte de cellule', () => {
  const html = '<table class="wikitable"><tr><td>Paris<sup>[1]</sup> to Lyon</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Paris to Lyon']]]);
});

test('extractTables : <br> devient un espace, pas une concaténation collée', () => {
  const html = '<table class="wikitable"><tr><td>Ligne1<br>Ligne2</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Ligne1 Ligne2']]]);
});

test('extractTables : décode les entités HTML au-delà du tableau fixe de l\'ancien parseur (ex. &hellip;, &#39;, entité numérique)', () => {
  const html = '<table class="wikitable"><tr><td>L&#39;étape&hellip; &#233;tape</td></tr></table>';
  const cell = extractTables(html)[0][0][0];
  assert.strictEqual(cell, "L'étape… étape");
});

// Trouvaille en creusant le signalement utilisateur du 28/08/2026 (voir
// parseCourse ci-dessus) : le HTML réel de la page « 1994 Tour de France »
// affiche le lien vers Moûtiers avec le texte « Moutiers » (sans accent)
// mais title="Moûtiers" (le vrai titre de la page, canonique) — vérifié en
// récupérant la page réelle. Sans l'accent, la Géoplateforme trouve un
// homonyme sans rapport (commune de la Meuse) à égalité de score avec la
// vraie Moûtiers (Savoie), et prend la mauvaise.
//
// extractTables() (texte affiché, contrat historique) ne doit JAMAIS
// préférer le title= — seul extractTablesRich() (.titledText) le fait,
// et seule la colonne course de parseStagesFromHtml le lit (voir plus bas).
// Trouvaille de relecture adverse (28/08/2026) sur une première version de
// ce correctif qui appliquait la préférence à extractTables() lui-même,
// donc à TOUTE cellule (numéro d'étape, vainqueur…) — vérifié avec du HTML
// Wikipédia réel : le lien du numéro d'étape pointe vers un sous-article
// dont le title commence par l'année (« 1994 Tour de France, Stage 11 to
// Stage 21 »), faisant confondre le numéro d'étape avec l'année ; la
// cellule vainqueur contient une icône de drapeau (title = nom de pays,
// aucun texte affiché) qui polluait le champ. Ce test verrouille que
// extractTables() reste inchangé.
test('extractTables (texte affiché) : ignore le title= d\'un lien, contrairement à extractTablesRich', () => {
  const html = '<table class="wikitable"><tr><td>' +
    '<a href="./Mo%C3%BBtiers" title="Moûtiers">Moutiers</a> to ' +
    '<a href="./Cluses" title="Cluses">Cluses</a></td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Moutiers to Cluses']]]);
});

test('extractTablesRich : .titledText préfère le title= d\'un lien, .text garde le texte affiché', () => {
  const html = '<table class="wikitable"><tr><td>' +
    '<a href="./Mo%C3%BBtiers" title="Moûtiers">Moutiers</a> to ' +
    '<a href="./Cluses" title="Cluses">Cluses</a></td></tr></table>';
  const cell = extractTablesRich(html)[0][0][0];
  assert.strictEqual(cell.text, 'Moutiers to Cluses');
  assert.strictEqual(cell.titledText, 'Moûtiers to Cluses');
});

test('extractTablesRich : un lien sans title= garde son texte affiché dans les deux champs', () => {
  const html = '<table class="wikitable"><tr><td><a href="./Paris">Paris</a></td></tr></table>';
  const cell = extractTablesRich(html)[0][0][0];
  assert.deepStrictEqual(cell, { text: 'Paris', titledText: 'Paris' });
});

// Reproduction directe de la régression trouvée par relecture adverse
// (28/08/2026) sur la première version de ce correctif : numéro d'étape et
// vainqueur (dont les liens portent un title sans rapport avec leur usage
// dans ce tableau) doivent rester lus depuis le texte affiché — seule la
// colonne course doit refléter le title= du lien.
test('parseStagesFromHtml : le title= d\'un lien de la colonne numéro/vainqueur n\'altère jamais le numéro d\'étape ni le vainqueur', () => {
  const html = '<table class="wikitable"><tr><th>Stage</th><th>Course</th><th>Distance</th><th>Winner</th></tr>' +
    '<tr><td><a title="1994 Tour de France, Stage 11 to Stage 21">18</a></td>' +
    '<td><a title="Moûtiers">Moutiers</a> to <a title="Cluses">Cluses</a></td>' +
    '<td>174.5 km</td>' +
    '<td><a title="Italy"></a> Mario Cipollini</td></tr>' +
    '<tr><td><a title="1994 Tour de France, Stage 11 to Stage 21">19</a></td>' +
    '<td>Cluses to Avoriaz</td><td>47.5 km</td><td>Rider X</td></tr></table>';
  const stages = parseStagesFromHtml(html, 1994);
  assert.strictEqual(stages[0].number, 18, 'le numéro d\'étape reste 18, pas 1994 (l\'année du title du lien)');
  assert.strictEqual(stages[0].start, 'Moûtiers', 'la colonne course reflète bien le title= (correctif visé)');
  assert.strictEqual(stages[0].finish, 'Cluses');
  assert.strictEqual(stages[0].winner, 'Mario Cipollini', 'le vainqueur reste le texte affiché, pas le title= du drapeau');
  assert.strictEqual(stages[1].number, 19);
});

test('extractTables : balisage légèrement malformé (attribut non fermé) ne casse pas le parseur', () => {
  const html = '<table class="wikitable"><tr><td class=unquoted>Étape 1</td></tr></table>';
  assert.deepStrictEqual(extractTables(html), [[['Étape 1']]]);
});

test('extractTables : HTML vide ou sans aucune table → tableau vide, pas d\'exception', () => {
  assert.deepStrictEqual(extractTables(''), []);
  assert.deepStrictEqual(extractTables('<p>rien ici</p>'), []);
});
