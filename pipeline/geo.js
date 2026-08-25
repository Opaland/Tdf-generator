'use strict';
// Utilitaires géométriques : distances, interpolation, ré-échantillonnage de polylignes.

const R_EARTH = 6371000; // m

function toRad(d) { return (d * Math.PI) / 180; }

/** Distance haversine en mètres entre deux points {lat, lon}. */
function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

/** Interpolation linéaire entre deux points (suffisant aux échelles routières). */
function lerpPoint(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/**
 * Longueur cumulée d'une polyligne [{lat,lon},...].
 * Retourne { total, cum } avec cum[i] = distance du départ au point i.
 */
function cumulativeDistances(points) {
  const cum = new Array(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversine(points[i - 1], points[i]);
  }
  return { total: cum[points.length - 1] || 0, cum };
}

/**
 * Ré-échantillonne une polyligne à pas constant (en mètres).
 * Retourne [{lat, lon, dist}] — le premier et le dernier point d'origine sont conservés.
 */
function resamplePolyline(points, stepM) {
  if (points.length < 2) {
    return points.map((p) => ({ lat: p.lat, lon: p.lon, dist: 0 }));
  }
  const { total, cum } = cumulativeDistances(points);
  const out = [];
  let seg = 0;
  const n = Math.max(1, Math.round(total / stepM));
  for (let k = 0; k <= n; k++) {
    const target = Math.min(total, (k * total) / n);
    while (seg < points.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    const p = lerpPoint(points[seg], points[seg + 1], t);
    out.push({ lat: p.lat, lon: p.lon, dist: target });
  }
  return out;
}

/** Moyenne glissante centrée sur une fenêtre exprimée en mètres, sur des échantillons {dist, ele}. */
function movingAverageByDistance(samples, windowM) {
  const half = windowM / 2;
  const out = new Array(samples.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i].dist;
    while (hi < samples.length && samples[hi].dist <= d + half) {
      sum += samples[hi].ele;
      hi++;
    }
    while (lo < hi && samples[lo].dist < d - half) {
      sum -= samples[lo].ele;
      lo++;
    }
    out[i] = sum / (hi - lo);
  }
  return out;
}

module.exports = {
  haversine,
  lerpPoint,
  cumulativeDistances,
  resamplePolyline,
  movingAverageByDistance,
};
