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
const { HISTORIC_ROUTES } = require('../pipeline/wikipedia');

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
