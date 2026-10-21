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
  require('../backend/db').closeDb();
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

test('bout en bout : importEdition pose routing_profile depuis la curation, generateStage le transmet à routeStage', async () => {
  // Wikipédia 1975 servi par le cache (aucun appel réseau) : une seule ligne,
  // l'étape 22 (le parseur exige au moins deux lignes) curée avec `routing_profile: "shortest"` dans historic_routes.json.
  const { cachePut } = require('../pipeline/cache');
  cachePut('api', 'wikipedia-en', { page: '1975_Tour_de_France' }, `<section>
  <h2 id="Route_and_stages">Route and stages</h2>
  <table class="wikitable" style="text-align:center;">
    <tbody>
      <tr>
        <th scope="col">Stage</th>
        <th scope="col">Date</th>
        <th scope="col">Course</th>
        <th scope="col">Distance</th>
        <th scope="col">Type</th>
        <th scope="col">Winner</th>
      </tr>
      <tr>
        <td>21</td>
        <td>19 July</td>
        <td>Orléans to Paris</td>
        <td>120&#160;km (75&#160;mi)</td>
        <td>Plain stage</td>
        <td>Walter Godefroot&#160;(<span class="flagicon">BEL</span>)</td>
      </tr>
      <tr>
        <td>22</td>
        <td>20 July</td>
        <td>Paris to Paris</td>
        <td>163.5&#160;km (101.6&#160;mi)</td>
        <td>Plain stage</td>
        <td>Walter Godefroot&#160;(<span class="flagicon">BEL</span>)</td>
      </tr>
    </tbody>
  </table>
</section>`);
  const { importEdition } = require('../pipeline/importer');
  const { getDb } = require('../backend/db');
  const { edition } = await importEdition(1975);
  const editionId = edition.id;
  const db = getDb();
  const st = db.prepare('SELECT id, routing_profile FROM stages WHERE edition_id = ? AND stage_order = 22').get(editionId);
  assert.ok(st, 'étape 22 importée');
  assert.strictEqual(st.routing_profile, 'shortest');

  // generate.js → routeStage : un profil hors liste en base (sauvegarde
  // forgée, par exemple) fait échouer la génération AVANT tout réseau — preuve
  // que la colonne est bien lue et transmise. Hors-ligne : aucun appel externe.
  db.prepare("UPDATE stages SET routing_profile = 'car-fast' WHERE id = ?").run(st.id);
  setOffline(true);
  try {
    const { generateStage } = require('../pipeline/generate');
    await assert.rejects(() => generateStage(st.id), /Profil de routage inconnu : car-fast/);
  } finally {
    setOffline(false);
  }
});

test('clé de cache : un leg mis en cache sous l\'ancien format (profil par défaut) est toujours servi', async () => {
  const { cachePut } = require('../pipeline/cache');
  const c = { lat: 44.0, lon: 2.0, label: 'C' };
  const d = { lat: 44.0, lon: 2.01, label: 'D' };
  // Format de requête écrit en cache avant le profil par étape (routing.js, 17/10/2026).
  cachePut('api', 'brouter', { a: { lat: 44, lon: 2 }, b: { lat: 44, lon: 2.01 }, profile: 'fastbike' },
    { points: [{ lat: 44, lon: 2 }, { lat: 44, lon: 2.01 }], distanceM: 801, router: 'brouter', surfaces: [] });
  calls.length = 0;
  const r = await routeStage([c, d]);
  assert.deepStrictEqual(calls, [], 'servi par le cache existant, aucun appel BRouter');
  assert.strictEqual(r.legs[0].router, 'brouter');
});
