'use strict';
// stageRow() (frontend/archives.js) plantait silencieusement toute la liste
// Archives dès qu'une étape reconstituait 0 km (ville de départ = ville
// d'arrivée, aucun waypoint intermédiaire curé — motif réel présent dans
// pipeline/data/historic_routes.json, ex. 1975 étape 22 Paris → Paris).
// EF.distanceDelta() (frontend/common.js) renvoie null pour
// generated_distance_km === 0 (valeur falsy), pas seulement quand la donnée
// manque. stageRow() ne revérifiait pas `delta != null` avant d'appeler
// EF.formatDelta(delta) — contrairement aux 3 autres appelants
// (frontend/stage.js, frontend/tourmap.js) — donc `delta.toFixed(1)` sur
// `null` plantait. runLoadEditions() (frontend/archives.js) n'a pas de
// try/catch par itération : l'exception interrompait la boucle avant
// d'ajouter l'édition en cours ni les suivantes au DOM, tronquant la liste
// sans aucun message d'erreur visible. Trouvaille croisée développeur+QA de
// l'agent revue-personas.
//
// stageRow est require()-able côté test grâce à la garde `typeof module`
// déjà en place (même schéma que pollWhileGenerating — voir
// test/archivesPoll.test.js). Implémentations fidèles de
// distanceDelta/formatDelta/stateBadge/esc (copiées de frontend/common.js)
// plutôt que des stubs simplifiés, pour que le test exerce le vrai contrat
// entre les deux fichiers plutôt qu'une version édulcorée.

const { test } = require('node:test');
const assert = require('node:assert');

global.EF = {
  qs: () => null,
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  distanceDelta(officialKm, generatedKm) {
    if (!officialKm || !generatedKm) return null;
    return ((generatedKm - officialKm) / officialKm) * 100;
  },
  formatDelta(delta) {
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %`;
  },
  stateBadge(state) {
    const labels = { done: 'générée', generating: 'génération…', error: 'erreur', draft: 'brouillon' };
    return `<span class="badge ${state}">${labels[state] || state}</span>`;
  },
};

const { stageRow } = require('../frontend/archives.js');

function baseStage(overrides) {
  return {
    id: 1, name: 'Étape 1 : Lille → Lille', date: '2025-07-05', stage_type: 'plaine',
    official_distance_km: 184.9, generated_distance_km: 172.3, state: 'done',
    is_curated: false, ...overrides,
  };
}

test('stageRow() : distance reconstituée à 0 km (motif réel — ville départ = arrivée) → pas d\'exception, "0 km" affiché sans écart', () => {
  const s = baseStage({ generated_distance_km: 0 });
  assert.doesNotThrow(() => stageRow(s));
  const html = stageRow(s);
  assert.match(html, />0 km</, 'la valeur reconstituée réelle (0 km) doit rester affichée');
  assert.doesNotMatch(html, /NaN|undefined|null/);
});

test('stageRow() : cas nominal — distance et écart tous deux affichés', () => {
  const html = stageRow(baseStage());
  assert.match(html, />172\.3 km/);
  assert.match(html, /-6\.8 %/, 'écart calculé et affiché normalement quand les deux distances sont non nulles');
});

test('stageRow() : aucune distance reconstituée (étape non générée) → tiret, pas d\'exception', () => {
  const html = stageRow(baseStage({ generated_distance_km: null, state: 'draft' }));
  assert.doesNotThrow(() => stageRow(baseStage({ generated_distance_km: null, state: 'draft' })));
  assert.match(html, /—/);
});
