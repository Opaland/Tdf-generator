'use strict';
// Test structurel de pipeline/data/historic_routes.json — item de backlog
// issue #10 (section A/F) : le même bug (un col sommet-d'arrivée listé à la
// fois en `via` et en `finish`, créant un waypoint redondant au même point
// une fois géocodé) a été corrigé trois fois de suite à la main (2022, 2023,
// 2024) avant qu'un test ne l'empêche de revenir. Ce test échoue si ça se
// reproduit, et vérifie par ailleurs la cohérence structurelle minimale du
// fichier (déjà validé comme JSON par require(), donc pas re-testé ici).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  HISTORIC_ROUTES, KNOWN_COLS, reconstructionWaypoints,
  stageConfidence, CONFIDENCE_STATUSES, CONFIDENCE_LEVELS, historicHighlights,
} = require('../pipeline/wikipedia');

const VALID_KINDS = new Set(['start', 'via', 'col', 'peak', 'finish']);

function viaLabel(via) {
  return typeof via === 'string' ? via : via.label;
}

test('historic_routes.json : deux points de passage consécutifs ne partagent jamais le même label', () => {
  // Vérifie l'ADJACENCE dans toute la séquence start→vias→finish, pas
  // n'importe quelle occurrence répétée du même label : une étape peut
  // légitimement retraverser une même ville en cours de route sans que ce
  // soit le bug visé (ex. 2021 étape 11, double ascension du Ventoux par
  // Sault puis Bédoin, qui redescend sur Malaucène avant d'y remonter et d'y
  // finir — "Malaucène" apparaît deux fois dans la séquence, mais jamais deux
  // fois côte à côte).
  //
  // Deux points adjacents avec le même label géocodent au même endroit, donc
  // routent en un saut de distance nulle : c'est le bug Markstein 2023 (un
  // col sommet-d'arrivée listé à la fois en dernier via et en finish, corrigé
  // 3 fois à la main avant ce test), et c'est aussi ce qui a fait fusionner
  // en une seule côte la double ascension du Ventoux 2021 avant que ses deux
  // vias "Mont Ventoux" adjacents ne soient séparés par de vrais points de
  // passage intermédiaires (Sault, Malaucène, Bédoin — voir backlog #10,
  // section C, "vérifier la détection des ascensions doublées").
  //
  // Un start == finish SANS via entre les deux (ex. 2026 étape 1, contre-la-
  // montre par équipes en circuit fermé à Barcelone) est volontairement
  // exclu : ce n'est pas un via redondant, c'est juste une étape en boucle.
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stageNum, stage] of Object.entries(edition.stages || {})) {
      const vias = stage.vias || [];
      if (!vias.length) continue;
      const sequence = [stage.start, ...vias.map(viaLabel), stage.finish].filter(Boolean);
      for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] === sequence[i - 1]) {
          offenders.push(`${year} étape ${stageNum} : "${sequence[i]}" apparaît deux fois de suite (position ${i - 1}/${i})`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, [], 'deux points de passage adjacents ne doivent jamais partager le même label (voir les corrections 2022/2023/2024 dans l\'historique git, et 2021 étape 11)');
});

test('historic_routes.json : chaque via objet a un label et un kind reconnu', () => {
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stageNum, stage] of Object.entries(edition.stages || {})) {
      for (const via of stage.vias || []) {
        if (typeof via === 'string') continue;
        if (!via.label) offenders.push(`${year} étape ${stageNum} : via objet sans label`);
        if (via.kind && !VALID_KINDS.has(via.kind)) offenders.push(`${year} étape ${stageNum} : kind inconnu "${via.kind}" sur "${via.label}"`);
        if (via.ele != null && typeof via.ele !== 'number') offenders.push(`${year} étape ${stageNum} : ele non numérique sur "${via.label}"`);
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('historic_routes.json : chaque édition a des notes sourcées et au moins une étape', () => {
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    if (!edition.notes || edition.notes.trim().length < 10) offenders.push(`${year} : notes manquantes ou trop courtes`);
    if (!edition.stages || Object.keys(edition.stages).length === 0) offenders.push(`${year} : aucune étape curée`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('historic_routes.json : les clés d\'étape sont des numéros d\'étape positifs', () => {
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const stageNum of Object.keys(edition.stages || {})) {
      if (!/^\d+$/.test(stageNum) || parseInt(stageNum, 10) < 1) offenders.push(`${year} : clé d'étape invalide "${stageNum}"`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('known_cols.json : chaque entrée a une altitude numérique positive et une source non vide', () => {
  const offenders = [];
  for (const [label, entry] of Object.entries(KNOWN_COLS)) {
    if (label === '_notes') continue;
    if (typeof entry.ele !== 'number' || entry.ele <= 0) offenders.push(`"${label}" : ele invalide (${entry.ele})`);
    if (!entry.source || entry.source.trim().length < 5) offenders.push(`"${label}" : source manquante ou trop courte`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('historic_routes.json : toutes les occurrences d\'un même col résolvent la même altitude (backlog #10 section A)', () => {
  // Le bug que le référentiel centralisé prévient : « Tourmalet 2115 m »
  // retapé dans huit éditions différentes, avec un risque de faute de frappe
  // silencieuse sur l'une d'elles. Ici on vérifie l'effet, pas la cause : que
  // chaque occurrence d'un même label (via son propre `ele`, ou en repli par
  // known_cols.json) résolve la même altitude partout où elle apparaît. Un
  // col sans altitude connue nulle part (ex. Col du Noyer 2026, marqué
  // « altitude non vérifiée » dans sa note) reste toléré — ce test attrape
  // une divergence, pas une absence de données.
  const byLabel = new Map();
  for (const edition of Object.values(HISTORIC_ROUTES)) {
    for (const stage of Object.values(edition.stages || {})) {
      for (const via of stage.vias || []) {
        if (typeof via === 'string') continue;
        if (via.kind !== 'col' && via.kind !== 'peak') continue;
        const resolved = via.ele ?? KNOWN_COLS[via.label]?.ele ?? null;
        if (!byLabel.has(via.label)) byLabel.set(via.label, new Set());
        byLabel.get(via.label).add(resolved);
      }
    }
  }
  const offenders = [];
  for (const [label, values] of byLabel) {
    if (values.size > 1) offenders.push(`"${label}" résout des altitudes différentes selon l'occurrence : ${[...values].join(', ')}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('historic_routes.json : chaque affirmation confidence est bien formée (backlog #10, section A)', () => {
  // Format repris de la revue de vérification manuelle du 18/08/2026 (voir
  // CLAUDE.md) : status OK/FIX/UNSURE, confiance haute/moyenne/basse — porté
  // maintenant comme métadonnée structurée plutôt que noyé dans `note`.
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stageNum, stage] of Object.entries(edition.stages || {})) {
      for (const c of stage.confidence || []) {
        const where = `${year} étape ${stageNum}`;
        if (!c.claim || typeof c.claim !== 'string' || c.claim.trim().length < 5) {
          offenders.push(`${where} : claim manquant ou trop court`);
        }
        if (!CONFIDENCE_STATUSES.includes(c.status)) {
          offenders.push(`${where} : status invalide "${c.status}" (attendu ${CONFIDENCE_STATUSES.join('/')})`);
        }
        if (!CONFIDENCE_LEVELS.includes(c.level)) {
          offenders.push(`${where} : level invalide "${c.level}" (attendu ${CONFIDENCE_LEVELS.join('/')})`);
        }
      }
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('stageConfidence : renvoie [] pour une étape sans réserve connue, le détail pour une étape marquée UNSURE', () => {
  assert.deepStrictEqual(stageConfidence(1903, 3), [], 'aucune réserve connue sur cette étape');
  const puyDeDome = stageConfidence(2023, 9);
  assert.strictEqual(puyDeDome.length, 1);
  assert.strictEqual(puyDeDome[0].status, 'UNSURE');
  assert.strictEqual(puyDeDome[0].level, 'moyenne');
  assert.match(puyDeDome[0].claim, /1415|1 415/);

  const colDuNoyer = stageConfidence(2026, 19);
  assert.strictEqual(colDuNoyer.length, 1);
  assert.strictEqual(colDuNoyer[0].status, 'UNSURE');
  assert.strictEqual(colDuNoyer[0].level, 'basse');
});

test('reconstructionWaypoints : le col du Tourmalet résout son altitude via known_cols.json sans ele local', () => {
  // 2021 étape 18 est l'une des occurrences du Tourmalet sans `ele` propre
  // depuis le passage au référentiel centralisé — vérifie le chemin de bout
  // en bout (pas seulement la présence de la clé dans known_cols.json).
  const stage = HISTORIC_ROUTES['2021'].stages['18'];
  assert.ok(stage, 'édition 2021, étape 18 attendue dans la fixture de test');
  const tourmalet = (stage.vias || []).find((v) => typeof v === 'object' && v.label === 'Col du Tourmalet');
  assert.ok(tourmalet, 'le Tourmalet doit être un via de cette étape');
  assert.strictEqual(tourmalet.ele, undefined, 'ne doit plus porter son propre ele (retapé ailleurs sinon)');
  const wps = reconstructionWaypoints(2021, { number: 18, start: stage.start, finish: stage.finish });
  const wp = wps.find((w) => w.label === 'Col du Tourmalet');
  assert.strictEqual(wp.altitude_hint_m, 2115, 'résolu via known_cols.json malgré l\'absence de ele local');
});

test('1913 étape 6 : la fourche cassée d\'Eugène Christophe — Aubisque, Tourmalet, Sainte-Marie-de-Campan, Aspin dans l\'ordre', () => {
  const wps = reconstructionWaypoints(1913, { number: 6, start: 'Bayonne', finish: 'Bagnères-de-Luchon' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, [
    'Bayonne', "Col d'Aubisque", 'Col du Tourmalet', 'Sainte-Marie-de-Campan', "Col d'Aspin", 'Bagnères-de-Luchon',
  ]);
  const tourmalet = wps.find((w) => w.label === 'Col du Tourmalet');
  assert.strictEqual(tourmalet.altitude_hint_m, 2115, 'altitude résolue via known_cols.json');
});

test('1951 étape 17 : première ascension du Ventoux par le Tour — montée par Malaucène, descente par Bédoin', () => {
  const wps = reconstructionWaypoints(1951, { number: 17, start: 'Montpellier', finish: 'Avignon' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, ['Montpellier', 'Malaucène', 'Mont Ventoux', 'Bédoin', 'Avignon']);
  const ventoux = wps.find((w) => w.label === 'Mont Ventoux');
  assert.strictEqual(ventoux.kind, 'col');
  assert.strictEqual(ventoux.altitude_hint_m, 1909, 'altitude résolue via known_cols.json');
});

test('historicHighlights : toute édition pré-2020 curée porte un highlight non vide, aucune édition 2020+ n\'en porte (backlog #10, section D)', () => {
  // Les vignettes cliquables de l'écran Archives (frontend/archives.js)
  // s'appuient sur ce champ — une édition mythique pré-2020 sans highlight
  // resterait invisible côté UI sans qu'aucun test ne le signale.
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    const y = parseInt(year, 10);
    if (y < 2020 && (!edition.highlight || edition.highlight.trim().length < 3)) {
      offenders.push(`${year} : highlight manquant ou trop court`);
    }
    if (y >= 2020 && edition.highlight) {
      offenders.push(`${year} : highlight inattendu sur une édition 2020+ (détaillée, pas "mythique")`);
    }
  }
  assert.deepStrictEqual(offenders, []);

  const highlights = historicHighlights();
  assert.ok(highlights.length >= 8);
  assert.deepStrictEqual(
    highlights.map((h) => h.year),
    [...highlights.map((h) => h.year)].sort((a, b) => a - b),
    'triée par année croissante'
  );
});

test('1922 étape 10 : première apparition du col d\'Izoard — Colle Saint-Michel, Allos, Vars, Izoard dans l\'ordre', () => {
  const wps = reconstructionWaypoints(1922, { number: 10, start: 'Nice', finish: 'Briançon' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, [
    'Nice', 'Colle Saint-Michel', "Col d'Allos", 'Col de Vars', "Col d'Izoard", 'Briançon',
  ]);
  const izoard = wps.find((w) => w.label === "Col d'Izoard");
  assert.strictEqual(izoard.kind, 'col');
  assert.strictEqual(izoard.altitude_hint_m, 2360, 'altitude résolue via known_cols.json');
});

test('1919 étape 11 : premier maillot jaune — Lautaret, Galibier, Aravis dans l\'ordre', () => {
  const wps = reconstructionWaypoints(1919, { number: 11, start: 'Grenoble', finish: 'Genève' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, [
    'Grenoble', 'Col du Lautaret', 'Col du Galibier', 'Col des Aravis', 'Genève',
  ]);
  const lautaret = wps.find((w) => w.label === 'Col du Lautaret');
  assert.strictEqual(lautaret.kind, 'col');
  assert.strictEqual(lautaret.altitude_hint_m, 2058, 'altitude résolue via known_cols.json');
});

test('1989 étape 21 : LeMond bat Fignon de 8 secondes — contre-la-montre Versailles → Paris, sourcé', () => {
  const wps = reconstructionWaypoints(1989, { number: 21, start: 'Versailles', finish: 'Paris' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, ['Versailles', 'Paris']);
  assert.ok(wps.every((w) => w.source === 'parcours curé'), 'les deux extrémités sont explicitement sourcées, pas seulement Wikipédia');
});

test('1975 étape 22 : première arrivée aux Champs-Élysées — circuit fermé Paris, sourcé', () => {
  // Étape en circuit fermé (27 tours du circuit Paris/Champs-Élysées) : même
  // pattern start === finish sans via que 2026 étape 1 (Barcelone) — le test
  // d'adjacence de historic_routes.json l'exclut déjà explicitement (aucun
  // via, donc rien à comparer).
  const wps = reconstructionWaypoints(1975, { number: 22, start: 'Paris', finish: 'Paris' });
  const labels = wps.map((w) => w.label);
  assert.deepStrictEqual(labels, ['Paris', 'Paris']);
  assert.ok(wps.every((w) => w.source === 'parcours curé'), 'les deux extrémités sont explicitement sourcées, pas seulement Wikipédia');
});
