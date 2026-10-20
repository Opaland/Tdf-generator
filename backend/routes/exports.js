'use strict';
// Exports d'étape et d'édition (JSON, GPX, TCX, KML, HTML autonome, roadbook).
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { loadExportable, stageToGpx, stageToTcx, stageToKml, tourToStandaloneHtml, stageToStandaloneHtml, stageToRoadbookHtml } = require('../exports');
const { wrap } = require('../apiHelpers');

// Réglage des zones de confidentialité illisible : tous les points sont
// retirés (pipeline/privacy.js). Le dire, plutôt que « non générée ».
const UNREADABLE_MSG = 'Zones de confidentialité illisibles : export impossible tant qu\'elles ne sont pas enregistrées à nouveau (page Mes traces).';
const unreadable = (full) => !!(full && full.privacyUnreadable);

module.exports = function register(app) {
  // ---------------------------------------------------------------- exports
  app.get('/api/stages/:id/export.json', (req, res) => {
    const full = loadExportable(parseInt(req.params.id, 10));
    if (!full) return res.status(404).json({ error: 'Étape introuvable' });
    res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.json"`);
    res.json(full);
  });

  app.get('/api/stages/:id/export.gpx', (req, res) => {
    const full = loadExportable(parseInt(req.params.id, 10));
    if (unreadable(full)) return res.status(409).json({ error: UNREADABLE_MSG });
    if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
    res.setHeader('Content-Type', 'application/gpx+xml');
    res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.gpx"`);
    res.send(stageToGpx(full));
  });

  app.get('/api/stages/:id/export.tcx', (req, res) => {
    const full = loadExportable(parseInt(req.params.id, 10));
    if (unreadable(full)) return res.status(409).json({ error: UNREADABLE_MSG });
    if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
    res.setHeader('Content-Type', 'application/vnd.garmin.tcx+xml');
    res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.tcx"`);
    res.send(stageToTcx(full));
  });

  app.get('/api/stages/:id/export.kml', (req, res) => {
    const full = loadExportable(parseInt(req.params.id, 10));
    if (unreadable(full)) return res.status(409).json({ error: UNREADABLE_MSG });
    if (!full || !full.samples.length) return res.status(404).json({ error: 'Étape non générée' });
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.setHeader('Content-Disposition', `attachment; filename="etape-${full.stage.id}.kml"`);
    res.send(stageToKml(full));
  });

  app.get('/api/stages/:id/export.html', wrap(async (req, res) => {
    // Id entier dans le nom de fichier : `req.params.id` brut permettait
    // d'injecter un second filename= (parseInt tolère le suffixe).
    const id = parseInt(req.params.id, 10);
    const html = stageToStandaloneHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="etape-${id}.html"`);
    res.send(html);
  }));

  // Roadbook imprimable — affiché inline (pas en téléchargement) pour être
  // immédiatement imprimable (Ctrl+P) depuis l'onglet ouvert.
  app.get('/api/stages/:id/roadbook.html', wrap(async (req, res) => {
    const html = stageToRoadbookHtml(parseInt(req.params.id, 10));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }));

  // Prévisualisation de la fiche autonome (sans téléchargement).
  app.get('/api/stages/:id/site', wrap(async (req, res) => {
    const html = stageToStandaloneHtml(parseInt(req.params.id, 10));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }));

  app.get('/api/editions/:id/export.html', wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const html = tourToStandaloneHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tour-${id}.html"`);
    res.send(html);
  }));

  // Prévisualisation du mini-site (sans téléchargement).
  app.get('/api/editions/:id/site', wrap(async (req, res) => {
    const html = tourToStandaloneHtml(parseInt(req.params.id, 10));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }));
};
