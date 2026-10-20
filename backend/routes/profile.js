'use strict';
// Profil sportif de l'instance (Epic 30.5) : FC max de référence saisie par
// l'utilisateur, base des 5 zones de FC de la fiche étape. Une seule valeur
// pour l'instance, comme les traces (aucun cloisonnement par compte) — la
// modifier est réservé à l'admin en mode public (ADMIN_ROUTES, server.js).

const { getSetting, setSetting } = require('../settings');
const { wrap, httpError } = require('../apiHelpers');
const { validateZones, parseZones, PRIVACY_ZONES_KEY } = require('../../pipeline/privacy');

// Zones de confidentialité (backlog 34.7), une liste pour l'instance comme
// la FC max ; modifiables par l'admin seul en mode public (même route PUT).
const privacyZones = () => parseZones(getSetting(PRIVACY_ZONES_KEY));
// Réglage illisible : affiché comme tel (les exports retirent alors tous les
// points des traces, voir pipeline/privacy.js).
const profileBody = () => {
  const zones = privacyZones();
  return { hrMaxBpm: hrMaxBpm(), privacyZones: zones || [], ...(zones === null ? { privacyZonesUnreadable: true } : {}) };
};

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
    res.json(profileBody());
  }));

  // Champs absents : inchangés (le formulaire FC et celui des zones
  // n'envoient chacun que le leur).
  app.put('/api/profile', wrap(async (req, res) => {
    const body = req.body || {};
    if (!('hrMaxBpm' in body) && !('privacyZones' in body)) throw httpError(400, 'hrMaxBpm ou privacyZones attendu');
    if ('hrMaxBpm' in body) {
      const v = body.hrMaxBpm;
      if (v !== null && !(Number.isInteger(v) && v >= HR_MAX_MIN && v <= HR_MAX_MAX)) {
        throw httpError(400, `hrMaxBpm doit être un entier entre ${HR_MAX_MIN} et ${HR_MAX_MAX} bpm, ou null`);
      }
    }
    const zones = 'privacyZones' in body ? validateZones(body.privacyZones) : null;
    if ('hrMaxBpm' in body) setSetting(HR_MAX_KEY, body.hrMaxBpm);
    if (zones) setSetting(PRIVACY_ZONES_KEY, JSON.stringify(zones));
    res.json(profileBody());
  }));
};

module.exports.HR_MAX_MIN = HR_MAX_MIN;
module.exports.privacyZones = privacyZones;
module.exports.HR_MAX_MAX = HR_MAX_MAX;
