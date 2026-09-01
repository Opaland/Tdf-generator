'use strict';
// Sondes de connectivité vers chaque API externe du projet — extrait de
// GET /api/diagnostic (backend/server.js) pour être réutilisable ailleurs
// qu'une requête HTTP, notamment par scripts/demo.js --online (Chantier L,
// "CI de vérification croisée périodique" : le job nightly demo-online.yml
// n'exerçait jusqu'ici que les services français, via la seule route 1903 —
// Nominatim et opentopodata, tous deux "hors France", n'étaient jamais
// sondés en CI). Toujours un vrai appel réseau, quel que soit
// ETAPEFORGE_OFFLINE — à n'appeler qu'en mode en ligne volontaire.
//
// BRouter ajouté le 31/08/2026 (issue #169, migration du routage vers un
// profil vélo réel) : désormais le fournisseur de routage PRIMAIRE, OSRM
// n'étant plus qu'un repli — les deux restent sondés séparément, un échec
// de l'un ne dit rien de l'autre.

const { USER_AGENT } = require('./http');

async function probe(name, url, check) {
  const t0 = Date.now();
  const ctl = new AbortController();
  // Le timer doit être annulé dans un `finally`, pas juste après l'await
  // réussi : un fetch qui rejette (hôte injoignable, DNS, proxy qui répond
  // avant même le timeout) sautait tout droit au `catch` sans jamais
  // atteindre le `clearTimeout` — le timer de 8 s restait armé, gardant le
  // process Node vivant jusqu'à son déclenchement (observé : ~8 s de trop
  // par sonde en échec immédiat lors de l'écriture de test/diagnostic.test.js).
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* réponse non-JSON (proxy, page d'erreur…) */ }
    const ok = r.ok && body != null && (!check || check(body));
    return {
      name, ok, ms: Date.now() - t0,
      detail: ok ? `HTTP ${r.status}` : `HTTP ${r.status} — ${body == null ? text.slice(0, 80) : 'réponse inattendue'}`,
    };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t0, detail: String(err.cause?.message || err.message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sonde les 7 hôtes externes du projet en parallèle (Promise.all préserve
 * l'ordre du tableau, pas l'ordre de résolution — un service lent ne doit
 * jamais faire remonter son résultat en tête). Retourne { allOk, results }.
 */
async function runDiagnostic() {
  // OSRM_BASE/BROUTER_BASE respectent ETAPEFORGE_OSRM/ETAPEFORGE_BROUTER
  // (backlog issue #10, section E, "plan de continuité") : sur un
  // déploiement avec l'un des deux auto-hébergé, ce test sonde l'instance
  // réellement utilisée, pas systématiquement le service public.
  const { OSRM_BASE, BROUTER_BASE, BROUTER_PROFILE } = require('./routing');
  const results = await Promise.all([
    probe('Géoplateforme — géocodage',
      'https://data.geopf.fr/geocodage/search?q=Paris&limit=1', (b) => (b.features || []).length > 0),
    probe('Géoplateforme — altimétrie (RGE ALTI)',
      'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=2.35&lat=48.85&resource=ign_rge_alti_wld&zonly=true', (b) => (b.elevations || []).length > 0),
    probe(`BRouter — routage (profil vélo, primaire)${BROUTER_BASE !== 'https://brouter.de/brouter' ? ' (auto-hébergé)' : ''}`,
      `${BROUTER_BASE}?lonlats=2.35,48.85|2.37,48.86&profile=${BROUTER_PROFILE}&format=geojson`,
      // Vérifie aussi track-length (pas seulement la géométrie) : BRouter la
      // renvoie sous forme de chaîne, et pipeline/routing.js la coerce avec
      // Number() avant de la valider — un vrai bug de ce type (trouvé par
      // relecture adverse avant tout commit, jamais expédié) serait resté
      // invisible ici si la sonde ne regardait que la géométrie, alors que
      // routeLeg() basculerait déjà silencieusement sur OSRM à chaque appel.
      (b) => Array.isArray(b.features) && b.features.length > 0 && b.features[0].geometry?.type === 'LineString'
        && Number.isFinite(Number(b.features[0].properties?.['track-length']))),
    probe(`OSRM — routage (profil voiture, repli seulement)${OSRM_BASE !== 'https://router.project-osrm.org' ? ' (auto-hébergé)' : ''}`,
      `${OSRM_BASE}/route/v1/driving/2.35,48.85;2.37,48.86?overview=false`, (b) => b.code === 'Ok'),
    probe('Nominatim — géocodage hors France',
      'https://nominatim.openstreetmap.org/search?q=Barcelona&format=jsonv2&limit=1', (b) => Array.isArray(b) && b.length > 0),
    probe('opentopodata — altimétrie hors France',
      'https://api.opentopodata.org/v1/eudem25m?locations=41.38,2.17', (b) => b.status === 'OK'),
    probe('Wikipédia — archives',
      'https://en.wikipedia.org/api/rest_v1/page/summary/Tour_de_France', (b) => !!b.title),
  ]);
  return { allOk: results.every((r) => r.ok), results };
}

module.exports = { runDiagnostic };
