'use strict';
// Epic 35.19 (revue globale du 19/10/2026) : « 460.3 km » côtoyait
// « 12,3 km ». Les nombres affichés prennent la virgule décimale, y compris
// dans les messages de contrôle générés côté serveur.

const { test } = require('node:test');
const assert = require('node:assert');

test('contrôles : distances et écarts à la française', () => {
  const { runChecks } = require('../pipeline/checks');
  const base = { waypointsOnTrack: [], approxSegments: [], climbs: [], samples: [], legs: [] };
  const free = runChecks({ ...base, stage: {}, distanceM: 58049 }).items.map((i) => i.detail || '').join(' | ');
  assert.match(free, /58,0 km \(pas de distance cible/);
  const off = runChecks({ ...base, stage: { official_distance_km: 172.5 }, distanceM: 160800 }).items.map((i) => i.detail || '').join(' | ');
  assert.match(off, /officielle 172,5 km \/ reconstitution 160,8 km \(écart -6,8 %/);
  assert.doesNotMatch(off, /\d\.\d/);
});

test('profil : encart distance et fiche côte à la française', () => {
  global.EF = { esc: (s) => String(s ?? '') };
  const EFProfile = require('../frontend/profile.js');
  const profile = [];
  for (let k = 0; k <= 20; k++) profile.push({ d: k * 1000, e: 400 + k * 10, r: 400 + k * 10, lat: 45, lon: 6 + k * 0.01 });
  const svg = EFProfile.renderProfileSVG({ stage: { generated_distance_km: 122.2, total_ascent_m: 3026 }, climbs: [], waypoints: [], profile }, { width: 1000, height: 260 });
  assert.match(svg, />122,2 km — D\+ 3026 m</);
  const climb = { name: 'Côte', category: '3', length_km: 4.6, avg_gradient: 5.2, max_gradient: 7.4, summit_ele_m: 900, start_km: 1, end_km: 5.6,
    km_blocks: [{ fromKm: 1, toKm: 2, gradient: 5.25, ele0: 700, ele1: 752 }] };
  const c = EFProfile.renderClimbSVG(climb, { width: 1000, height: 260 });
  assert.match(c, /4,6 km à 5,2 % \(max 7,4 %\)/);
  assert.match(c, />5,3%</);
});
