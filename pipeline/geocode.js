'use strict';
// Géocodage : France → Géoplateforme (data.geopf.fr), hors France → Nominatim
// (User-Agent dédié, max 1 req/s). Tout passe par le cache SQLite geocode_cache.
// En mode hors-ligne : simulateur déterministe (fournisseur 'simulateur').

const { httpJson, isOffline } = require('./http');
const { cached } = require('./cache');
const { simGeocode, simReverseGeocode, simElevation } = require('./simulator');

const FRANCE_BBOX = { latMin: 41.0, latMax: 51.5, lonMin: -5.5, lonMax: 10.0 };

function looksLikeFrance(lat, lon) {
  return (
    lat >= FRANCE_BBOX.latMin && lat <= FRANCE_BBOX.latMax &&
    lon >= FRANCE_BBOX.lonMin && lon <= FRANCE_BBOX.lonMax
  );
}

function isColQuery(q) {
  return /\b(col|cote|côte|montee|montée|pic|puy|mont|alpe|plateau|station)\b/i.test(q);
}

/**
 * Géocode un libellé. `countryHint` ('fr' par défaut) choisit le fournisseur.
 * Retourne { label, lat, lon, ele?, provider, raw? }.
 */
async function geocode(query, { countryHint = 'fr' } = {}) {
  if (isOffline()) {
    const { value } = await cached('geocode', 'simulateur', { q: query }, async () => simGeocode(query));
    return value;
  }
  if (countryHint === 'fr') {
    const { value } = await cached('geocode', 'geopf', { q: query }, async () => {
      // index=poi indispensable pour les cols/sommets (l'index par défaut est adresse).
      const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5&index=address,poi`;
      const json = await httpJson(url, { minDelayMs: 120 });
      const feats = (json.features || []).map((f) => ({
        label: f.properties.label || f.properties.name || query,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        type: f.properties.type,
        score: f.properties.score,
        provider: 'geopf',
      }));
      if (!feats.length) return null;
      return feats[0];
    });
    if (value) return value;
    // Repli : Nominatim si la Géoplateforme ne trouve rien.
  }
  const { value } = await cached('geocode', 'nominatim', { q: query }, async () => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&accept-language=fr`;
    const json = await httpJson(url, { minDelayMs: 1100 }); // max 1 req/s
    if (!json.length) return null;
    const r = json[0];
    return {
      label: r.display_name.split(',').slice(0, 2).join(','),
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      type: r.type,
      provider: 'nominatim',
    };
  });
  if (!value) throw new Error(`Géocodage sans résultat : « ${query} »`);
  return value;
}

/**
 * Géocode un col : localise le sommet puis vérifie/complète l'altitude
 * (échantillon d'altimétrie au point trouvé).
 */
async function geocodeCol(query, opts = {}) {
  const res = await geocode(query, opts);
  const { sampleElevations } = require('./elevation'); // import tardif (cycle)
  try {
    const eles = await sampleElevations([{ lat: res.lat, lon: res.lon }]);
    res.eleChecked = eles[0];
    if (res.ele == null) res.ele = eles[0];
  } catch {
    if (res.ele == null && isOffline()) res.ele = Math.round(simElevation(res.lat, res.lon));
  }
  return res;
}

/** Géocodage inverse (nommage des sommets, clic sur la carte). */
async function reverseGeocode(lat, lon) {
  lat = Math.round(lat * 1e5) / 1e5;
  lon = Math.round(lon * 1e5) / 1e5;
  if (isOffline()) {
    const { value } = await cached('geocode', 'simulateur-reverse', { lat, lon }, async () =>
      simReverseGeocode(lat, lon)
    );
    return value;
  }
  if (looksLikeFrance(lat, lon)) {
    const { value } = await cached('geocode', 'geopf-reverse', { lat, lon }, async () => {
      const url = `https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=1`;
      const json = await httpJson(url, { minDelayMs: 120 });
      const f = (json.features || [])[0];
      return f
        ? { label: f.properties.label || f.properties.city || f.properties.name, provider: 'geopf' }
        : null;
    });
    if (value) return value;
  }
  const { value } = await cached('geocode', 'nominatim-reverse', { lat, lon }, async () => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&accept-language=fr&zoom=14`;
    const json = await httpJson(url, { minDelayMs: 1100 });
    if (!json || !json.display_name) return null;
    return { label: json.display_name.split(',').slice(0, 2).join(','), provider: 'nominatim' };
  });
  return value || { label: `(${lat.toFixed(3)}, ${lon.toFixed(3)})`, provider: 'aucun' };
}

/** Suggestions pour l'autocomplétion de l'éditeur (jusqu'à 5 résultats). */
async function geocodeSuggest(query) {
  if (!query || query.trim().length < 2) return [];
  if (isOffline()) {
    const { GAZETTEER } = require('./simulator');
    const norm = (s) =>
      String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const q = norm(query);
    const hits = GAZETTEER.filter((g) => norm(g.name).includes(q)).slice(0, 5).map((g) => ({
      label: g.name,
      lat: g.lat,
      lon: g.lon,
      ele: g.ele,
      kind: g.kind === 'peak' ? 'col' : 'via',
      provider: 'simulateur',
    }));
    if (hits.length) return hits;
    const s = simGeocode(query);
    return [{ label: s.label, lat: s.lat, lon: s.lon, ele: s.ele, kind: 'via', provider: 'simulateur' }];
  }
  const { value } = await cached('geocode', 'geopf-suggest', { q: query }, async () => {
    const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5&index=address,poi`;
    const json = await httpJson(url, { minDelayMs: 120 });
    return (json.features || []).map((f) => ({
      label: f.properties.label || f.properties.name,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      kind: isColQuery(f.properties.label || '') ? 'col' : 'via',
      provider: 'geopf',
    }));
  });
  return value;
}

module.exports = { geocode, geocodeCol, reverseGeocode, geocodeSuggest, looksLikeFrance, isColQuery };
