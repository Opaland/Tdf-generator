'use strict';
// Catalogue des cols.
// Extrait de backend/server.js (Epic 27.1/27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { getDb } = require('../db');

module.exports = function register(app) {
  // ---------------------------------------------------------------- catalogue des cols
  // Toutes les côtes détectées, toutes étapes confondues (liste dense façon VeloViewer).
  app.get('/api/climbs', (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*, s.name AS stage_name, s.date AS stage_date, s.state AS stage_state, s.checks AS stage_checks,
                e.name AS edition_name, e.year AS edition_year, e.id AS edition_id
         FROM climbs c
         JOIN stages s ON s.id = c.stage_id
         LEFT JOIN editions e ON e.id = s.edition_id
         WHERE s.state = 'done'  -- une étape modifiée (draft) garde ses anciennes côtes jusqu'à regénération
         ORDER BY c.summit_ele_m DESC`
      )
      .all()
      .map((c) => {
        // simulated : reprend le même drapeau offline posé à la génération
        // (pipeline/generate.js, stages.checks JSON) plutôt qu'un nouveau
        // JOIN sur tracks — un profil de montée généré par le simulateur peut
        // afficher des pentes irréalistes (ex. 17,7 % de moyenne sur 8 km,
        // aucune ascension réelle n'en approche), jusqu'ici signalé
        // uniquement par un bandeau global de page, jamais par ligne dans ce
        // catalogue qui prétend cataloguer « toutes les côtes détectées »
        // (trouvaille de revue-personas, persona ancien coureur).
        let simulated = false;
        try { simulated = JSON.parse(c.stage_checks || '{}').offline === true; } catch { /* stage_checks absent/corrompu : simulated reste false, pas de crash */ }
        delete c.stage_checks; // détail d'implémentation, pas une donnée à exposer
        return { ...c, km_blocks: c.km_blocks ? JSON.parse(c.km_blocks) : [], simulated };
      });
    res.json(rows);
  });
};
