'use strict';
// Profil de routage BRouter par étape curée (`routing_profile`, Epic 9,
// issue #243) : routing.js → generate.js → importer.js → migration 5.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-routing-profile-test-${process.pid}`);

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const { setOffline } = require('../pipeline/http');
const { routeStage, ALLOWED_PROFILES } = require('../pipeline/routing');
const { curatedRoutingProfile } = require('../pipeline/wikipedia');
const HISTORIC_ROUTES = require('../pipeline/data/historic_routes.json');

let realFetch;
const calls = [];
before(() => {
  setOffline(false);
  realFetch = global.fetch;
  // Mock limité à brouter.de (CLAUDE.md règle 6) ; le reste passe au vrai fetch.
  global.fetch = async (url) => {
    if (!String(url).includes('brouter.de')) return realFetch(url);
    calls.push(new URL(String(url)).searchParams.get('profile'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[1.0, 43.0, 0], [1.01, 43.0, 0]] },
          properties: { 'track-length': '813', messages: [] },
        }],
      }),
    };
  };
});
after(() => {
  global.fetch = realFetch;
  setOffline(true);
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

const a = { lat: 43.0, lon: 1.0, label: 'A', kind: 'start' };
const b = { lat: 43.0, lon: 1.01, label: 'B', kind: 'finish' };

test('routeStage : profil demandé transmis à BRouter, défaut fastbike, cache distinct par profil', async () => {
  calls.length = 0;
  await routeStage([a, b]);
  await routeStage([a, b], { profile: 'shortest' });
  await routeStage([a, b], { profile: 'shortest' }); // même leg, même profil : servi par le cache
  assert.deepStrictEqual(calls, ['fastbike', 'shortest']);
});

test('routeStage : profil hors liste → erreur explicite avant tout appel réseau', async () => {
  calls.length = 0;
  await assert.rejects(() => routeStage([a, b], { profile: 'car-fast' }), /Profil de routage inconnu/);
  await assert.rejects(() => routeStage([a, b], { profile: 'fastbike&lonlats=0,0' }), /Profil de routage inconnu/);
  assert.deepStrictEqual(calls, []);
});

test('historic_routes.json : chaque routing_profile curé fait partie des profils autorisés', () => {
  const errors = [];
  for (const [key, edition] of Object.entries(HISTORIC_ROUTES)) {
    for (const [stage, entry] of Object.entries(edition.stages || {})) {
      if (entry.routing_profile !== undefined && !ALLOWED_PROFILES.includes(entry.routing_profile)) {
        errors.push(`${key} étape ${stage} : ${entry.routing_profile}`);
      }
    }
  }
  assert.deepStrictEqual(errors, []);
});

test('curatedRoutingProfile : null sans curation, valeur curée sinon', () => {
  assert.strictEqual(curatedRoutingProfile(1903, { number: 99 }), null);
  const curated = Object.entries(HISTORIC_ROUTES).flatMap(([key, ed]) =>
    Object.entries(ed.stages || {}).filter(([, e]) => e.routing_profile).map(([n, e]) => ({ key, n, p: e.routing_profile })));
  for (const c of curated.filter((x) => /^\d{4}$/.test(x.key) && /^\d+$/.test(x.n))) {
    assert.strictEqual(curatedRoutingProfile(Number(c.key), { number: Number(c.n) }), c.p, `${c.key}/${c.n}`);
  }
});

test('migration 5 : stages.routing_profile existe sur une base fraîche', () => {
  const { getDb } = require('../backend/db');
  const cols = getDb().prepare('PRAGMA table_info(stages)').all().map((c) => c.name);
  assert.ok(cols.includes('routing_profile'));
});
