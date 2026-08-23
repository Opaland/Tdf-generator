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
const { HISTORIC_ROUTES, KNOWN_COLS, reconstructionWaypoints } = require('../pipeline/wikipedia');

const VALID_KINDS = new Set(['start', 'via', 'col', 'peak', 'finish']);

function viaLabel(via) {
  return typeof via === 'string' ? via : via.label;
}

test('historic_routes.json : aucun via ne duplique le start/finish de sa propre étape', () => {
  const offenders = [];
  for (const [year, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stageNum, stage] of Object.entries(edition.stages || {})) {
      for (const via of stage.vias || []) {
        const label = viaLabel(via);
        if (stage.finish && label === stage.finish) offenders.push(`${year} étape ${stageNum} : "${label}" en via ET en finish`);
        if (stage.start && label === stage.start) offenders.push(`${year} étape ${stageNum} : "${label}" en via ET en start`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], 'un via ne doit jamais reprendre le label exact du start/finish de la même étape (voir les corrections 2022/2023/2024 dans l\'historique git)');
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
