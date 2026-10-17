'use strict';
// Géocodage (autocomplétion, inverse) pour l'éditeur.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { geocodeSuggest, reverseGeocode } = require('../../pipeline/geocode');
const { wrap } = require('../apiHelpers');

module.exports = function register(app) {
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
};
