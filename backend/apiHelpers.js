'use strict';
// Helpers partagés par les routes de l'API (extraits de backend/server.js,
// Epic 27.2). CLAUDE.md règle 5 : un helper transverse se relit à chaque
// nouvel appelant ; règle 8 : toute route qui écrit en base valide le type
// de chaque champ avant l'écriture SQL.

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err.status) return res.status(err.status).json({ error: err.message }); // rejet de validation attendu, pas de log
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  });

// Validation d'entrée minimale : SQLite (better-sqlite3) n'accepte comme
// paramètre lié qu'un nombre, une chaîne, un bigint, un buffer ou null — un
// objet/tableau/booléen envoyé par erreur (ou par un client hostile) fait
// planter .run() avec une exception non gérée (500 + fuite de stack trace).
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function requireString(v, field) {
  if (typeof v !== 'string' || !v.trim()) throw httpError(400, `${field} doit être une chaîne non vide`);
  return v;
}
function optionalString(v, field) {
  if (v == null) return null;
  if (typeof v !== 'string') throw httpError(400, `${field} doit être une chaîne (ou absent)`);
  return v;
}
function optionalNumber(v, field) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) throw httpError(400, `${field} doit être un nombre (ou absent)`);
  return n;
}
// lat/optionalNumber(lon) sont validés indépendamment ci-dessus (chacun
// accepte null séparément) — un waypoint avec lat défini et lon absent (ou
// l'inverse) passait donc la validation et finissait en base ainsi.
// frontend/editor.js:85 fait `wp.lon.toFixed(4)` dès que `wp.lat != null`,
// sans re-vérifier lon : une paire dépareillée y lève une TypeError qui
// casse tout le rendu de la liste de waypoints (trouvaille de sprint dédié).
// Bornes : un waypoint {lat: 999, lon: -500} passait, et sa génération
// saturait la mémoire jusqu'à l'arrêt du process ; une longitude de 359,6
// (clic sur une copie du monde dans la carte de l'éditeur) donnait une étape
// de 29 000 km (revue globale du 19/10/2026).
function assertLatLonPaired(waypoints, prefix) {
  waypoints.forEach((w, i) => {
    if ((w.lat == null) !== (w.lon == null)) {
      throw httpError(400, `${prefix}[${i}] : lat et lon doivent être fournis ensemble ou absents tous les deux`);
    }
    if (w.lat != null && (w.lat < -90 || w.lat > 90 || w.lon < -180 || w.lon > 180)) {
      throw httpError(400, `${prefix}[${i}] : lat doit être entre -90 et 90, lon entre -180 et 180`);
    }
  });
}

/** Rang numérique d'une catégorie de côte (plus haut = plus dur) — pour comparer
 * des étapes entre elles, pas pour un affichage (voir climbs.js pour le libellé).
 * Partagé par routes/stages.js (étapes similaires) et routes/traces.js (bilan). */
const CLIMB_CATEGORY_RANK = { HC: 5, 1: 4, 2: 3, 3: 2, 4: 1 };

module.exports = { CLIMB_CATEGORY_RANK, wrap, httpError, requireString, optionalString, optionalNumber, assertLatLonPaired };
