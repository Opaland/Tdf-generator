'use strict';
// Compteur de requêtes par hôte externe (backlog issue #10, section E,
// « dashboard de consommation des quotas API ») — en mémoire, remis à zéro à
// chaque redémarrage du process. Pas de persistance en base : l'objectif est
// de donner un ordre de grandeur pendant une session prolongée (import de
// plusieurs éditions d'affilée, génération en lot), pas un historique
// durable. Incrémenté à chaque tentative HTTP réelle envoyée à l'hôte
// (retries inclus, voir pipeline/http.js) — c'est le nombre de requêtes qui
// compte pour un rate-limit côté serveur distant, pas le nombre d'appels
// logiques (une requête retentée 3 fois pèse 3 fois sur la limite distante).

const usage = new Map(); // host -> { count, firstAt, lastAt }

function recordRequest(host) {
  const now = new Date().toISOString();
  const entry = usage.get(host);
  if (entry) {
    entry.count += 1;
    entry.lastAt = now;
  } else {
    usage.set(host, { count: 1, firstAt: now, lastAt: now });
  }
}

function getUsageStats() {
  return [...usage.entries()]
    .map(([host, stats]) => ({ host, ...stats }))
    .sort((a, b) => b.count - a.count);
}

function resetUsageStats() {
  usage.clear();
}

module.exports = { recordRequest, getUsageStats, resetUsageStats };
