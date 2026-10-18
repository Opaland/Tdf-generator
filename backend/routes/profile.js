'use strict';
// Profil sportif de l'instance (Epic 30.5) : FC max de référence saisie par
// l'utilisateur, base des 5 zones de FC de la fiche étape. Une seule valeur
// pour l'instance, comme les traces (aucun cloisonnement par compte) — la
// modifier est réservé à l'admin en mode public (ADMIN_ROUTES, server.js).

const { getSetting, setSetting } = require('../settings');
const { wrap, httpError } = require('../apiHelpers');

const HR_MAX_KEY = 'hr_max_bpm';
// Bornes physiologiques larges : en dehors, c'est une faute de saisie.
const HR_MAX_MIN = 100;
const HR_MAX_MAX = 240;

function hrMaxBpm() {
  const v = Number(getSetting(HR_MAX_KEY));
  return Number.isInteger(v) && v >= HR_MAX_MIN && v <= HR_MAX_MAX ? v : null;
}

module.exports = function register(app) {
  app.get('/api/profile', wrap(async (req, res) => {
    res.json({ hrMaxBpm: hrMaxBpm() });
  }));

  app.put('/api/profile', wrap(async (req, res) => {
    const v = req.body?.hrMaxBpm;
    if (v !== null && !(Number.isInteger(v) && v >= HR_MAX_MIN && v <= HR_MAX_MAX)) {
      throw httpError(400, `hrMaxBpm doit être un entier entre ${HR_MAX_MIN} et ${HR_MAX_MAX} bpm, ou null`);
    }
    setSetting(HR_MAX_KEY, v);
    res.json({ hrMaxBpm: hrMaxBpm() });
  }));
};

module.exports.HR_MAX_MIN = HR_MAX_MIN;
module.exports.HR_MAX_MAX = HR_MAX_MAX;
