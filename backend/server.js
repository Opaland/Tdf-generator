'use strict';
// Serveur local ÉtapeForge : API REST + frontend statique. Aucun compte, aucune
// dépendance cloud propriétaire — tout est servi depuis cette machine, les appels
// externes (géocodage, routage, altimétrie, Wikipédia) passent par le cache SQLite.

const path = require('path');
const express = require('express');
const { getDb, DB_PATH } = require('./db');
const { generateStage, loadStageFull } = require('../pipeline/generate');
const { importEdition } = require('../pipeline/importer');
const { geocodeSuggest, reverseGeocode } = require('../pipeline/geocode');
const { isOffline, setOffline } = require('../pipeline/http');
const { stageToGpx, stagePayload, tourToStandaloneHtml, ATTRIBUTIONS } = require('./exports');

const PORT = parseInt(process.env.PORT || '4567', 10);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Leaflet servi localement (aucune dépendance CDN pour l'application elle-même).
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));

// Générations en cours (une par étape).
const running = new Map(); // stageId -> Promise

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  });

// ---------------------------------------------------------------- statut
app.get('/api/status', (req, res) => {
  const db = getDb();
  const counts = {
    stages: db.prepare('SELECT COUNT(*) n FROM stages').get().n,
    editions: db.prepare('SELECT COUNT(*) n FROM editions').get().n,
    geocode_cache: db.prepare('SELECT COUNT(*) n FROM geocode_cache').get().n,
    elevation_cache: db.prepare('SELECT COUNT(*) n FROM elevation_cache').get().n,
  };
  res.json({ offline: isOffline(), db: DB_PATH, counts, attributions: ATTRIBUTIONS });
});
app.post('/api/offline', (req, res) => {
  setOffline(!!req.body.offline);
  res.json({ offline: isOffline() });
});

// ---------------------------------------------------------------- géocodage
app.get('/api/geocode', wrap(async (req, res) => {
  res.json(await geocodeSuggest(String(req.query.q || '')));
}));
app.get('/api/reverse', wrap(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon requis' });
  res.json(await reverseGeocode(lat, lon));
}));

// ---------------------------------------------------------------- étapes
app.get('/api/stages', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.date, s.stage_type, s.status, s.state, s.stage_order,
              s.official_distance_km, s.generated_distance_km, s.total_ascent_m,
              s.edition_id, s.is_transfer, e.name AS edition_name, e.year AS edition_year
       FROM stages s LEFT JOIN editions e ON e.id = s.edition_id
       ORDER BY COALESCE(e.year, 9999), s.stage_order, s.id`
    )
    .all();
  res.json(rows);
});

app.post('/api/stages', (req, res) => {
  const { name, date, stage_type, status, edition_id, stage_order, waypoints } = req.body || {};
  if (!name || !Array.isArray(waypoints) || waypoints.length < 2) {
    return res.status(400).json({ error: 'name et au moins 2 waypoints requis' });
  }
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO stages (name, date, stage_type, status, edition_id, stage_order, state)
       VALUES (?, ?, ?, ?, ?, ?, 'draft')`
    )
    .run(name, date || null, stage_type || null, status || null, edition_id || null, stage_order || null);
  const id = r.lastInsertRowid;
  const ins = db.prepare(
    `INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon, altitude_hint_m, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  waypoints.forEach((w, i) =>
    ins.run(id, i, w.label || `Point ${i + 1}`, w.kind || 'via', w.lat ?? null, w.lon ?? null, w.altitude_hint_m ?? null, w.source || 'éditeur')
  );
  res.json({ id });
});

app.put('/api/stages/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const stage = db.prepare('SELECT id FROM stages WHERE id = ?').get(id);
  if (!stage) return res.status(404).json({ error: 'Étape introuvable' });
  const { name, date, stage_type, status, edition_id, stage_order, waypoints } = req.body || {};
  db.prepare(
    `UPDATE stages SET name = COALESCE(?, name), date = COALESCE(?, date),
       stage_type = COALESCE(?, stage_type), status = COALESCE(?, status),
       edition_id = COALESCE(?, edition_id), stage_order = COALESCE(?, stage_order),
       updated_at = datetime('now') WHERE id = ?`
  ).run(name ?? null, date ?? null, stage_type ?? null, status ?? null, edition_id ?? null, stage_order ?? null, id);
  if (Array.isArray(waypoints) && waypoints.length >= 2) {
    db.prepare('DELETE FROM waypoints WHERE stage_id = ?').run(id);
    const ins = db.prepare(
      `INSERT INTO waypoints (stage_id, idx, label, kind, lat, lon, altitude_hint_m, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    waypoints.forEach((w, i) =>
      ins.run(id, i, w.label || `Point ${i + 1}`, w.kind || 'via', w.lat ?? null, w.lon ?? null, w.altitude_hint_m ?? null, w.source || 'éditeur')
    );
    db.prepare(`UPDATE stages SET state = 'draft' WHERE id = ?`).run(id);
  }
  res.json({ ok: true });
});

app.delete('/api/stages/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM stages WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.get('/api/stages/:id', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full) return res.status(404).json({ error: 'Étape introuvable' });
  res.json(full);
});

app.post('/api/stages/:id/generate', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (running.has(id)) return res.status(202).json({ running: true });
  const p = generateStage(id)
    .catch((err) => console.error(`Génération étape ${id} :`, err.message))
    .finally(() => running.delete(id));
  running.set(id, p);
  res.status(202).json({ running: true });
}));

// ---------------------------------------------------------------- éditions / tours
app.get('/api/editions', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.*, COUNT(s.id) AS stage_count,
              SUM(CASE WHEN s.state = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM editions e LEFT JOIN stages s ON s.edition_id = e.id
       GROUP BY e.id ORDER BY e.year, e.name`
    )
    .all()
    .map((e) => ({ ...e, source: e.source ? JSON.parse(e.source) : null }));
  res.json(rows);
});

app.post('/api/editions', (req, res) => {
  const { name, year, is_custom } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name requis' });
  const db = getDb();
  const r = db
    .prepare('INSERT INTO editions (year, name, is_custom) VALUES (?, ?, ?)')
    .run(year ?? null, name, is_custom ? 1 : 0);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/editions/:id', (req, res) => {
  const db = getDb();
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
  const stages = db
    .prepare('SELECT * FROM stages WHERE edition_id = ? ORDER BY stage_order, id')
    .all(edition.id)
    .map((s) => ({ ...s, checks: s.checks ? JSON.parse(s.checks) : null, progress: s.progress ? JSON.parse(s.progress) : null, source: s.source ? JSON.parse(s.source) : null }));
  res.json({ ...edition, source: edition.source ? JSON.parse(edition.source) : null, stages });
});

app.post('/api/editions/import', wrap(async (req, res) => {
  const year = parseInt((req.body || {}).year, 10);
  const result = await importEdition(year);
  res.json({ edition: result.edition, stages: result.stages });
}));

/** Données carte globale d'un tour : tracés décimés + profils miniatures. */
app.get('/api/editions/:id/mapdata', wrap(async (req, res) => {
  const db = getDb();
  const editionId = parseInt(req.params.id, 10);
  const edition = db.prepare('SELECT * FROM editions WHERE id = ?').get(editionId);
  if (!edition) return res.status(404).json({ error: 'Édition introuvable' });
  const ids = db.prepare('SELECT id FROM stages WHERE edition_id = ? ORDER BY stage_order, id').all(editionId);
  const stages = ids.map((r) => stagePayload(loadStageFull(r.id), { maxSamples: 200, maxTrack: 500 }));
  res.json({ edition: { ...edition, source: edition.source ? JSON.parse(edition.source) : null }, stages });
}));

// ---------------------------------------------------------------- exports
app.get('/api/stages/:id/export.json', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full) return res.status(404).json({ error: 'Étape introuvable' });
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.json"`);
  res.json(full);
});

app.get('/api/stages/:id/export.gpx', (req, res) => {
  const full = loadStageFull(parseInt(req.params.id, 10));
  if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.gpx"`);
  res.send(stageToGpx(full));
});

app.get('/api/editions/:id/export.html', wrap(async (req, res) => {
  const html = tourToStandaloneHtml(parseInt(req.params.id, 10));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tour-${req.params.id}.html"`);
  res.send(html);
}));

// Prévisualisation du mini-site (sans téléchargement).
app.get('/api/editions/:id/site', wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(tourToStandaloneHtml(parseInt(req.params.id, 10)));
}));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ÉtapeForge démarré : http://localhost:${PORT}`);
    if (isOffline()) console.log('Mode hors-ligne actif (ETAPEFORGE_OFFLINE=1) : données simulées.');
  });
}

module.exports = { app };
