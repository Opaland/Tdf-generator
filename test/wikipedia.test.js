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
  resolveViaCoords,
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

// region_hint : même mécanisme que country_hint ci-dessus, pour le
// qualificatif de département (« Bonneval, Eure-et-Loir ») — trouvaille du
// 30/08/2026 (mission tracés historiques) : plusieurs étapes réelles de
// l'édition 2026 en portent un (« Périgueux → Bergerac, Dordogne », « Pau,
// Pyrénées-Atlantiques », « Dole, Jura », « Gap, Hautes-Alpes »…), jamais
// exploité jusqu'ici — envoyé tel quel au géocodeur, il dégrade le
// classement au lieu de l'affiner (voir extractDepartment()).
test('reconstructionWaypoints() : region_hint propagé au départ/arrivée non curés, jamais aux parcours curés', () => {
  const stage = {
    number: 99, start: 'Bonneval', finish: 'Chartres',
    startDepartment: 'Eure-et-Loir', finishDepartment: null,
  };
  const wps = reconstructionWaypoints(1994, stage); // 1994 étape 99 : aucun curatif connu
  assert.strictEqual(wps[0].label, 'Bonneval');
  assert.strictEqual(wps[0].region_hint, 'Eure-et-Loir');
  assert.strictEqual(wps[wps.length - 1].label, 'Chartres');
  assert.strictEqual(wps[wps.length - 1].region_hint, null, 'aucune annotation de département pour Chartres dans ce test');
});

test('reconstructionWaypoints() : region_hint absent quand aucune annotation de département', () => {
  const stage = { number: 1, start: 'Paris', finish: 'Lyon', startDepartment: null, finishDepartment: null };
  const wps = reconstructionWaypoints(2000, stage);
  assert.strictEqual(wps[0].region_hint, null);
  assert.strictEqual(wps[wps.length - 1].region_hint, null);
});

test('reconstructionWaypoints() : region_hint jamais deviné automatiquement pour un départ/arrivée CURÉ (forme chaîne), même si stage porte une annotation', () => {
  // Même garde-fou que country_hint (curated?.start ? null : ...) : un
  // parcours curé (historic_routes.json) porte un libellé choisi à la main,
  // jamais une annotation de département devinée depuis le Wikipédia brut.
  // 1903 étape 1 (Paris → Lyon) est entièrement curée dans ce dépôt, sous
  // forme chaîne simple (pas d'ambiguïté connue sur ces deux noms).
  const stage = {
    number: 1, start: 'Paris', finish: 'Lyon',
    startDepartment: 'Ne devrait jamais apparaître', finishDepartment: 'Ne devrait jamais apparaître',
  };
  const wps = reconstructionWaypoints(1903, stage);
  assert.strictEqual(wps[0].region_hint, null);
  assert.strictEqual(wps[wps.length - 1].region_hint, null);
});

test('reconstructionWaypoints() : region_hint explicite propagé pour un départ/arrivée curé en forme objet { label, region }', () => {
  // Trouvaille du 31/08/2026 (vérification du run complet post-PR #167) :
  // 2026 étape 3 (Granollers → Les Angles) génère 1788 km au lieu de 195,9 km
  // officiels — l'arrivée "Les Angles" (chaîne simple) géocodait au mauvais
  // homonyme (Gard, score 0,9818 sur l'index address,poi réellement utilisé
  // par geocode() pour une arrivée) au lieu du bon (Pyrénées-Orientales,
  // score 0,9727 — à égalité stricte avec Hautes-Pyrénées, vrai quasi-tie
  // Géoplateforme) faute de tout indice de région pour un libellé curé.
  // Contrairement au qualificatif Wikipédia (jamais deviné
  // pour un parcours curé — test ci-dessus), une forme objet explicite
  // { label, region } écrite à la main dans historic_routes.json DOIT
  // pouvoir fournir ce region_hint : c'est un choix humain, pas une
  // supposition automatique.
  const stage = { number: 3, start: 'ignoré (curé)', finish: 'ignoré (curé)' };
  const wps = reconstructionWaypoints(2026, stage);
  const finish = wps[wps.length - 1];
  assert.strictEqual(finish.label, 'Les Angles');
  assert.strictEqual(finish.region_hint, 'Pyrénées-Orientales');
});

test('parseCourse() : extrait et retire le qualificatif de département d\'une commune française homonyme', () => {
  // Trouvaille en interrogeant l'API Géoplateforme réelle (30/08/2026) :
  // envoyer la requête AVEC ce qualificatif dégrade le classement au lieu de
  // l'affiner — « Bonneval, Eure-et-Loir » ne retrouve la vraie commune dans
  // AUCUN des 5 premiers résultats (seulement des rues homonymes), alors que
  // la requête nue « Bonneval » la retrouve en tête (score 0.98).
  assert.deepStrictEqual(
    parseCourse('Bonneval, Eure-et-Loir to Chartres'),
    { start: 'Bonneval', finish: 'Chartres', startCountry: null, finishCountry: null, startDepartment: 'Eure-et-Loir', finishDepartment: null }
  );
  assert.deepStrictEqual(
    parseCourse('Périgueux to Bergerac, Dordogne'),
    { start: 'Périgueux', finish: 'Bergerac', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: 'Dordogne' }
  );
  // Un segment après virgule qui n'est PAS un département français reconnu
  // (précision non départementale, ou pays étranger déjà couvert par
  // extractCountry) n'est jamais confondu avec un département — dégradation
  // sûre (comportement inchangé), même philosophie que KNOWN_COUNTRIES.
  assert.deepStrictEqual(
    parseCourse('Paris, Montgeron to Lyon'),
    { start: 'Paris, Montgeron', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null }
  );
});

// Trouvaille de relecture adverse (30/08/2026) sur le test précédent : le
// retrait du département, ancré en fin de chaîne, échouait SILENCIEUSEMENT
// dès qu'un « via » suivait dans le même segment — le département n'était
// alors plus en fin de chaîne au moment du retrait, rouvrant exactement le
// bug que ce correctif visait à fermer (vérifié en direct sur data.geopf.fr :
// « Bergerac, Dordogne » non stripé retombe à un score de 0.399, hors des 5
// premiers résultats côté index POI). Corrigé en retirant le « via » avant
// le département dans clean(), pour que la regex de fin-de-chaîne retrouve
// toujours le département en dernière position.
test('parseCourse() : le qualificatif de département est retiré même quand un « via » suit dans le même segment', () => {
  assert.deepStrictEqual(
    parseCourse('Périgueux to Bergerac, Dordogne via Sarlat-la-Canéda'),
    { start: 'Périgueux', finish: 'Bergerac', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: 'Dordogne' }
  );
  assert.deepStrictEqual(
    parseCourse('Bonneval, Eure-et-Loir via Chartres to Lyon'),
    { start: 'Bonneval', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: 'Eure-et-Loir', finishDepartment: null }
  );
});

// Trouvaille de relecture adverse (30/08/2026, 2e tour) sur une première
// tentative de correctif du test précédent : réordonner clean() en retirant
// « via » AVANT les parenthèses cassait ce cas-ci — \s+via\b.*$ ne sait pas
// distinguer un « via » séparateur de trajet d'un « via » simplement présent
// À L'INTÉRIEUR d'une parenthèse pas encore retirée, et tronque au milieu
// (« Lyon (something » au lieu de « Lyon after », parenthèse non fermée
// envoyée telle quelle au géocodeur). Aucun cas réel connu de ce dépôt ne
// déclenche ce motif à ce jour (aucune occurrence de « via » dans les
// fixtures Wikipédia locales), mais rien ne garantit qu'un futur import ne
// le produise pas — même esprit que le test « via retiré même entièrement
// entre parenthèses » plus haut dans ce fichier.
test('parseCourse() : un « via » à l\'intérieur d\'une parenthèse (précédé d\'un autre mot) ne tronque jamais le texte qui suit cette parenthèse', () => {
  assert.deepStrictEqual(
    parseCourse('Paris to Lyon (something via Melun) after'),
    { start: 'Paris', finish: 'Lyon after', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null }
  );
});

// Trouvaille de relecture adverse (30/08/2026, 3e tour) : même avec clean()
// corrigé (parenthèses puis via, test ci-dessus), extractDepartment()
// gardait sa PROPRE implémentation « via puis parenthèses » — un « via » à
// l'intérieur d'une parenthèse faisait donc échouer la DÉTECTION du
// département avant même que clean() ait la moindre chance de le retirer :
// les deux fonctions étaient chacune correctes isolément mais désynchroni-
// sées l'une de l'autre. Fermé en extrayant l'ordre commun dans
// stripParensThenVia(), partagée par les deux — élimine la classe de bug
// par construction plutôt qu'un 4e correctif ponctuel.
test('parseCourse() : un « via » à l\'intérieur d\'une parenthèse n\'empêche jamais la détection ET le retrait d\'un département qui suit', () => {
  assert.deepStrictEqual(
    parseCourse('Paris to Bergerac, Dordogne (une note via ancien tracé)'),
    { start: 'Paris', finish: 'Bergerac', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: 'Dordogne' }
  );
  // Cas combiné (via-dans-parenthèse ET département ET via de trajet, tous
  // dans le même segment) — le plus adversarial des trois trouvés cette
  // session sur cette fonction.
  assert.deepStrictEqual(
    parseCourse('Périgueux to Bergerac (une note historique via ancien tracé), Dordogne via Sarlat-la-Canéda'),
    { start: 'Périgueux', finish: 'Bergerac', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: 'Dordogne' }
  );
});

test('resolveViaCoords() : la paire complète du via l\'emporte sur known_cols.json', () => {
  const via = { label: 'Test', lat: 1, lon: 2 };
  const known = { ele: 999, lat: 9, lon: 9 };
  assert.deepStrictEqual(resolveViaCoords(via, known), { lat: 1, lon: 2 });
});

test('resolveViaCoords() : sans coordonnées locales, retombe sur la paire complète de known_cols.json', () => {
  const via = { label: 'Test' };
  const known = { ele: 999, lat: 9, lon: 9 };
  assert.deepStrictEqual(resolveViaCoords(via, known), { lat: 9, lon: 9 });
});

test('resolveViaCoords() : ni via ni known_cols.json n\'ont de coordonnées → null/null', () => {
  const via = { label: 'Test' };
  const known = { ele: 999 };
  assert.deepStrictEqual(resolveViaCoords(via, known), { lat: null, lon: null });
  assert.deepStrictEqual(resolveViaCoords(via, undefined), { lat: null, lon: null });
});

test('resolveViaCoords() : un via avec SEULEMENT lat (jamais lon) ne se complète JAMAIS avec le lon de known_cols.json — jamais de mélange de sources', () => {
  // Trouvaille de relecture adverse (30/08/2026) sur le premier correctif
  // « Col de Toses » : une résolution champ par champ (via.lat ?? known?.lat,
  // via.lon ?? known?.lon, indépendamment) aurait ici combiné lat=1 (via) et
  // lon=9 (known) — deux sources différentes pour un même point, un point
  // fabriqué qui n'existe nulle part, sans jamais planter. Un via partiel
  // comme celui-ci n'existe dans aucune entrée réelle de historic_routes.json
  // à ce jour (voir le test dédié plus bas) — ce test couvre la fonction pure
  // en isolation, avant qu'un futur via partiel ne le déclenche en pratique.
  const via = { label: 'Test', lat: 1 };
  const known = { ele: 999, lat: 9, lon: 9 };
  assert.deepStrictEqual(resolveViaCoords(via, known), { lat: 9, lon: 9 }, 'retombe sur la paire COMPLÈTE de known_cols.json, jamais un mélange avec via.lat');
});

test('historic_routes.json : aucun via ne porte de lat/lon partiel (l\'un sans l\'autre) — sinon resolveViaCoords() ignorerait silencieusement la moitié fournie', () => {
  const offenders = [];
  for (const [year, edition] of Object.entries(require('../pipeline/wikipedia').HISTORIC_ROUTES)) {
    for (const [stageNum, stage] of Object.entries(edition.stages || {})) {
      for (const via of stage.vias || []) {
        if (typeof via === 'string') continue;
        if ((via.lat == null) !== (via.lon == null)) {
          offenders.push(`${year} étape ${stageNum} "${via.label}" : lat/lon partiel (lat=${via.lat}, lon=${via.lon})`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
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

// Trouvaille du 31/08/2026, en vérifiant en direct pourquoi le Tour 1989
// (infobox Wikipédia : « 21 + Prologue ») n'importait que 19 étapes :
// - le Prologue est numéroté « P » dans la colonne étape, jamais un
//   chiffre, donc invisible à l'ancienne regex /\d+/ (traité comme jour de
//   repos) ;
// - le Prologue et les étapes 1/2 de 1989 sont des CIRCUITS (départ =
//   arrivée à Luxembourg City) : le texte Wikipédia ne porte alors aucun
//   séparateur « to », que parseCourse() exigeait pour ne pas renvoyer
//   null ;
// - l'étape 2 (contre-la-montre par équipes) partage en plus son jour avec
//   l'étape 1 : sa cellule Date est omise (rowspan HTML), décalant Course/
//   Distance/Type d'une position vers la gauche — la ligne entière était
//   rejetée faute de distance exploitable à la bonne position.
// Les trois causes sont corrigées ensemble ici, sur une reconstitution
// minimale de la vraie structure de table 1989 (vérifiée en direct le même
// jour, pas inventée).
test('parseStagesFromHtml : Prologue, circuit (départ = arrivée) et cellule Date omise (rowspan, même jour)', () => {
  const html = '<table class="wikitable">' +
    '<tr><th>Stage</th><th>Date</th><th>Course</th><th>Distance</th><th>Type</th><th>Winner</th></tr>' +
    '<tr><td>P</td><td>1 July</td><td>Testville</td><td>7.8 km</td><td></td><td>Individual time trial</td><td>Rider A</td></tr>' +
    '<tr><td>1</td><td>2 July</td><td>Testville</td><td>135.5 km</td><td></td><td>Plain stage</td><td>Rider B</td></tr>' +
    '<tr><td>2</td><td>Testville</td><td>46 km</td><td></td><td>Team time trial</td><td>Team C</td></tr>' +
    '<tr><td>3</td><td>3 July</td><td>Testville to Otherville</td><td>241 km</td><td></td><td>Plain stage</td><td>Rider D</td></tr>' +
    '</table>';
  const stages = parseStagesFromHtml(html, 1989);
  assert.strictEqual(stages.length, 4, 'Prologue + 2 circuits + 1 étape normale, aucune perdue');

  const prologue = stages.find((s) => s.number === 0);
  assert.ok(prologue, 'le Prologue doit être importé, numéroté 0');
  assert.strictEqual(prologue.isPrologue, true);
  assert.strictEqual(prologue.start, 'Testville');
  assert.strictEqual(prologue.finish, 'Testville', 'circuit : départ = arrivée, jamais rejeté faute de "to"');
  assert.strictEqual(prologue.type, 'clm');
  assert.strictEqual(prologue.distanceKm, 7.8);

  const stage1 = stages.find((s) => s.number === 1);
  assert.ok(stage1, 'étape 1 (circuit, numérotée) ne doit pas disparaître avec le Prologue');
  assert.strictEqual(stage1.isPrologue, false);
  assert.strictEqual(stage1.start, 'Testville');
  assert.strictEqual(stage1.finish, 'Testville');

  const stage2 = stages.find((s) => s.number === 2);
  assert.ok(stage2, 'étape 2 (CLM par équipes, cellule Date omise) doit être importée');
  assert.strictEqual(stage2.type, 'clm par équipes');
  assert.strictEqual(stage2.distanceKm, 46);
  assert.strictEqual(stage2.dateText, '2 July', 'date reprise de la ligne précédente (même jour), jamais devinée autrement');
  assert.strictEqual(stage2.dateIso, '1989-07-02');

  const stage3 = stages.find((s) => s.number === 3);
  assert.strictEqual(stage3.start, 'Testville');
  assert.strictEqual(stage3.finish, 'Otherville', 'étape normale (avec "to") non affectée par ces correctifs');
});

test('parseCourse() : un lieu unique sans séparateur "to" est un circuit (départ = arrivée), jamais null', () => {
  assert.deepStrictEqual(
    parseCourse('Luxembourg City (Luxembourg)'),
    { start: 'Luxembourg City', finish: 'Luxembourg City', startCountry: 'Luxembourg', finishCountry: 'Luxembourg', startDepartment: null, finishDepartment: null }
  );
  assert.strictEqual(parseCourse(''), null, 'texte vide : toujours rejeté, pas un circuit');
  assert.strictEqual(parseCourse('   '), null, 'texte blanc : toujours rejeté');
});

test('fonctions unitaires du parseur', () => {
  assert.deepStrictEqual(parseCourse('Paris to Lyon'), { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null });
  assert.deepStrictEqual(parseCourse('Pau – Hautacam'), { start: 'Pau', finish: 'Hautacam', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null });
  // « Montgeron » n'est pas un pays reconnu : precision de lieu française
  // pure (le vrai point de départ 1903, dans cette commune), pas une
  // annotation de pays — countryHint doit rester 'fr' par défaut pour elle.
  assert.deepStrictEqual(
    parseCourse('Paris (Montgeron) to Lyon'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null }
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
    { start: 'Brussels', finish: 'Brussels', startCountry: 'Belgium', finishCountry: 'Belgium', startDepartment: null, finishDepartment: null }
  );
  assert.deepStrictEqual(
    parseCourse('Paris via Melun to Lyon'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null }
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
    { start: 'Dover', finish: 'Brighton', startCountry: 'United Kingdom', finishCountry: null, startDepartment: null, finishDepartment: null }
  );
  assert.deepStrictEqual(
    parseCourse('Luxembourg City (Luxembourg) to Strasbourg'),
    { start: 'Luxembourg City', finish: 'Strasbourg', startCountry: 'Luxembourg', finishCountry: null, startDepartment: null, finishDepartment: null }
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
    { start: 'Cologne', finish: 'Liège', startCountry: 'West Germany', finishCountry: 'Belgium', startDepartment: null, finishDepartment: null }
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
    { start: 'Roubaix', finish: 'Woluwe-Saint-Pierre', startCountry: null, finishCountry: 'Belgium', startDepartment: null, finishDepartment: null }
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
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: null, startDepartment: null, finishDepartment: null }
  );
  // « France » explicite ne compte jamais comme étranger (countryHint 'fr'
  // par défaut déjà correct) — vérifié distinctement de « aucune parenthèse
  // reconnue » ci-dessus, pas juste les deux confondus en un même null.
  assert.deepStrictEqual(
    parseCourse('Paris to Lyon (France) via (Melun) (une note)'),
    { start: 'Paris', finish: 'Lyon', startCountry: null, finishCountry: 'France', startDepartment: null, finishDepartment: null }
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
