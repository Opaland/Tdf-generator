'use strict';
// Politiques de sécurité du contenu partagées (stories 42.2 et 42.4, issue #566).
//
// CSP de l'application : deuxième barrière, indépendante de l'échappement
// EF.esc, contre une XSS stockée (règle 1 d'AGENTS.md). Aucun script en ligne
// n'est permis (test/csp.test.js le vérifie sur frontend/*.html) ; les styles
// en ligne restent admis (attributs style= et Leaflet). Tuiles IGN et OSM en
// img-src ; data: pour les icônes de Leaflet, blob: pour les exports PNG.
// Trusted Types en Report-Only le temps de recenser les sinks innerHTML.
// Servie en en-tête par Express, et en balise <meta> dans le site GitHub
// Pages (scripts/build-site.js), qui n'a pas d'en-têtes à lui.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://data.geopf.fr https://tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const CSP_REPORT_ONLY = "require-trusted-types-for 'script'";

// Une balise <meta> ne peut pas porter frame-ancestors (le navigateur
// l'ignore avec un avertissement en console) : retirée de la balise, elle
// reste dans l'en-tête quand un serveur en envoie un.
function cspMetaTag(policy) {
  const kept = policy.split(';').map((s) => s.trim()).filter((s) => s && !/^frame-ancestors\b/.test(s));
  // Aucune valeur de politique ne contient de « " » ni de « < » : rien à échapper.
  return `<meta http-equiv="Content-Security-Policy" content="${kept.join('; ')}">`;
}

// Insère la balise juste après <meta charset> : avant tout script et toute
// feuille, sans quoi ce qui la précède échappe à la politique.
function withCspMeta(html, policy) {
  const charset = /<meta charset="utf-8">/i;
  if (!charset.test(html)) throw new Error('withCspMeta : <meta charset="utf-8"> introuvable');
  return html.replace(charset, (m) => `${m}\n${cspMetaTag(policy)}`);
}

module.exports = { CSP, CSP_REPORT_ONLY, cspMetaTag, withCspMeta };
