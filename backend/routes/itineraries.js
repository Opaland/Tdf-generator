'use strict';
// Itinéraires curés village par village, par édition (story 41.6, issue
// #631) : lecture seule de pipeline/data/stage_itineraries.json, mêmes
// données que data/itineraries.json et data/itinerary-<année>.json du site
// statique (scripts/build-site.js).

const { editionIndex, editionPage, passagesIndex, YEAR_RE } = require('../../pipeline/editionPages');

module.exports = function registerItineraries(app) {
  app.get('/api/itineraries', (req, res) => {
    res.json(editionIndex());
  });
  // Index des lieux de passage, pour « passé chez moi » (story 41.7) : la
  // recherche se fait dans le navigateur, ici comme sur le site statique.
  app.get('/api/passages', (req, res) => {
    res.json(passagesIndex());
  });
  app.get('/api/itineraries/:year', (req, res) => {
    if (!YEAR_RE.test(req.params.year)) return res.status(400).json({ error: 'année invalide' });
    const page = editionPage(req.params.year);
    if (!page) return res.status(404).json({ error: 'édition sans itinéraire curé' });
    res.json(page);
  });
};
