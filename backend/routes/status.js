'use strict';
// GET /api/status — sonde de santé, accessible sans compte (enregistrée avant requireAuth).
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const notify = require('../notify');
const { getDb, DB_PATH } = require('../db');
const { isOffline } = require('../../pipeline/http');
const { ATTRIBUTIONS } = require('../exports');
const { AUTH_REQUIRED } = require('../auth');
const { getBackupStatus } = require('../backup');
const { version: APP_VERSION } = require('../../package.json');

function publicBackupStatus() {
  const b = getBackupStatus();
  if (!AUTH_REQUIRED || !b.enabled) return b;
  const { dir, ...rest } = b; // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = function register(app) {
  // ---------------------------------------------------------------- statut
  app.get('/api/status', (req, res) => {
    const db = getDb();
    const counts = {
      stages: db.prepare('SELECT COUNT(*) n FROM stages').get().n,
      editions: db.prepare('SELECT COUNT(*) n FROM editions').get().n,
      geocode_cache: db.prepare('SELECT COUNT(*) n FROM geocode_cache').get().n,
      elevation_cache: db.prepare('SELECT COUNT(*) n FROM elevation_cache').get().n,
    };
    res.json({
      // Route lisible sans compte, même en mode public : les chemins absolus
      // du serveur (base, sauvegardes) n'y sont donnés qu'en mode local.
      offline: isOffline(), authRequired: AUTH_REQUIRED, ...(AUTH_REQUIRED ? {} : { db: DB_PATH }), counts,
      attributions: ATTRIBUTIONS, backup: publicBackupStatus(), version: APP_VERSION,
      notify: { enabled: !!notify.WEBHOOK_URL, format: notify.FORMAT },
    });
  });
};
