'use strict';
// Service worker minimal : seul son enregistrement (avec un gestionnaire
// `fetch`) est nécessaire à l'installabilité PWA sur certains navigateurs —
// aucune mise en cache volontaire ici. ÉtapeForge sert des pages et des
// données dynamiques (SQLite, régénérées à la demande) : un cache
// applicatif introduirait un risque de données périmées affichées comme à
// jour, contraire à la discipline du dépôt sur les données non vérifiées
// (CLAUDE.md, règle 12 — jamais rien de masqué ou présenté comme certain
// sans l'être). Si un besoin hors-ligne côté client apparaît un jour, le
// mode ETAPEFORGE_OFFLINE=1 déjà en place côté serveur reste le mécanisme
// prévu pour ça, pas un cache silencieux ici.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
