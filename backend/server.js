'use strict';
// Serveur local ÉtapeForge : API REST + frontend statique. Aucun compte, aucune
// dépendance cloud propriétaire — tout est servi depuis cette machine, les appels
// externes (géocodage, routage, altimétrie, Wikipédia) passent par le cache SQLite.

const path = require('path');
const express = require('express');
const { resetInterruptedGenerations } = require('../pipeline/generate');
const { isOffline } = require('../pipeline/http');
const { authRouter, requireAuth, requireAdmin, AUTH_REQUIRED } = require('./auth');
const { startScheduledBackups } = require('./backup');

const PORT = parseInt(process.env.PORT || '4567', 10);
const app = express();
// Derrière un reverse proxy (déploiement public), fait foi de X-Forwarded-For
// pour que req.ip (utilisé par le limiteur de tentatives login/register)
// reflète l'IP réelle du client plutôt que celle du proxy.
if (AUTH_REQUIRED) app.set('trust proxy', 1);
// 20mb (pas 2mb) : un dump complet pour /api/backup/import (voir plus bas)
// dépasse vite l'ancienne limite de 2 Mo dès quelques dizaines d'étapes
// générées (~55 Ko/étape mesuré, surtout elevation_samples — 7 étapes
// suffisent déjà à dépasser 1,8 Mo en pratique). Un second body-parser
// scopé à cette seule route ne fonctionne PAS : Express traite les
// middlewares dans l'ordre d'enregistrement, donc le premier express.json()
// qui matche le Content-Type rejette (413) une requête surdimensionnée
// avant même d'atteindre un second parseur plus permissif plus loin dans la
// chaîne — vérifié empiriquement avant de choisir cette approche plutôt
// qu'un contournement par Content-Type (relecture adverse : ce contournement
// laissait une route qui échouait silencieusement avec le Content-Type
// standard application/json, la seule route ici qui a besoin d'un gros
// body, donc pas de raison de complexifier les autres avec une limite plus
// large qu'elles ne portent jamais.
// /api/import/gpx et /api/import/fit AVANT express.json() global ci-dessous :
// body-parser marque req._body = true dès qu'un parseur dont le `type`
// matche a lu le corps, et tout parseur suivant (même scopé, même avec
// type: '*/*') saute silencieusement si req._body est déjà vrai. Un client
// qui poserait Content-Type: application/json sur un import GPX/FIT (le
// front ne le fait pas — application/gpx+xml / application/octet-stream —
// mais rien ne l'empêche) se ferait sinon intercepter par express.json(),
// qui plante sur un corps non-JSON avec un message de body-parser brut, ou
// pire, parse un JSON quelconque et retombe sur "corps de requête vide"
// (relecture adverse, 16/09/2026 — même mécanisme déjà documenté juste
// au-dessus pour /api/backup/import, cette fois côté ordre plutôt que taille).
app.use('/api/import/gpx', express.text({ type: '*/*', limit: '30mb' }));
app.use('/api/import/fit', express.raw({ type: '*/*', limit: '30mb' }));
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
// Comptes email/mot de passe : mur d'accès actif seulement en ETAPEFORGE_PUBLIC=1
// (voir backend/auth.js). En usage local/Synology par défaut, requireAuth ne fait
// rien — le comportement historique « aucun compte » est inchangé.
app.use('/api/auth', authRouter);
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Leaflet servi localement (aucune dépendance CDN pour l'application elle-même).
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));

// Routes de l'API, dans l'ordre d'enregistrement historique (l'ordre compte :
// /api/status reste accessible sans compte, tout le reste passe par requireAuth).
require('./routes/status')(app);

// Tout ce qui suit nécessite une session valide quand ETAPEFORGE_PUBLIC=1
// (GET /api/status ci-dessus reste accessible sans compte : sonde de santé).
app.use('/api', requireAuth);

// Routes destructrices ou de configuration partagée : admin seulement en mode
// public (backend/auth.js, requireAdmin — sans effet en usage local).
// Enregistrées AVANT les routes elles-mêmes pour passer en premier.
const ADMIN_ROUTES = [
  ['post', '/api/offline'],
  ['post', '/api/backup/import'],
  ['post', '/api/editions/import'],
  ['post', '/api/editions/import-all'],
  ['delete', '/api/stages/:id'],
  // Connecteurs : un seul compte Suunto/Strava partagé par l'instance —
  // le (re)connecter écrase les jetons de l'admin, lister ou importer lit
  // ses sorties privées (relecture adverse).
  ['post', '/api/suunto/config'],
  ['post', '/api/suunto/disconnect'],
  ['get', '/api/suunto/connect'],
  ['get', '/api/suunto/callback'],
  ['get', '/api/suunto/workouts'],
  ['post', '/api/suunto/import'],
  ['post', '/api/strava/config'],
  ['post', '/api/strava/disconnect'],
  ['get', '/api/strava/connect'],
  ['get', '/api/strava/callback'],
  ['get', '/api/strava/activities'],
  ['post', '/api/strava/import'],
  ['get', '/api/secrets/status'],
];
for (const [method, route] of ADMIN_ROUTES) app[method](route, requireAdmin);

require('./routes/admin')(app);
require('./routes/geocode')(app);
require('./routes/stages')(app);
require('./routes/traces')(app);
require('./routes/climbs')(app);
require('./routes/editions')(app);
require('./routes/exports')(app);

// Gestionnaire d'erreur global (4 arguments — signature reconnue par Express
// pour un middleware d'erreur) : filet de sécurité pour toute exception
// synchrone non interceptée par une route (ex. requireString/optionalNumber
// ci-dessus, ou un bug futur). Sans ce middleware, Express renvoie sa page
// HTML par défaut qui inclut la stack trace complète — donc les chemins de
// fichiers internes du serveur — trouvée en pratique lors d'un fuzzing de
// l'API (payloads de type non-primitif dans des champs attendus en chaîne).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.status) return res.status(err.status).json({ error: err.message }); // rejet de validation attendu, pas de log
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

if (require.main === module) {
  const interrupted = resetInterruptedGenerations();
  if (interrupted) console.log(`${interrupted} génération(s) interrompue(s) par l'arrêt précédent marquée(s) en erreur.`);
  app.listen(PORT, () => {
    console.log(`ÉtapeForge démarré : http://localhost:${PORT}`);
    if (isOffline()) console.log('Mode hors-ligne actif (ETAPEFORGE_OFFLINE=1) : données simulées.');
  });
  startScheduledBackups();
}

module.exports = { app };
