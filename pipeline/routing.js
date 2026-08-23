'use strict';
// Routage : OSRM public (router.project-osrm.org, profil driving), leg par leg
// (chaque paire de waypoints est mise en cache indépendamment). Si un col est
// contourné (tracé à plus de 500 m du sommet), on route jusqu'au pied puis on
// interpole pied→sommet, et le segment est marqué « approximé ».

const { httpJson, isOffline } = require('./http');
const { cached } = require('./cache');
const { haversine, lerpPoint } = require('./geo');
const { simRouteLeg } = require('./simulator');

const OSRM_BASE = process.env.ETAPEFORGE_OSRM || 'https://router.project-osrm.org';
const COL_TOLERANCE_M = 500;

function r5(x) {
  return Math.round(x * 1e5) / 1e5;
}

/** Route un leg a→b. Retourne { points, distanceM, snapStartM, snapEndM, router }. */
async function routeLeg(a, b) {
  if (isOffline()) {
    const req = { a: { lat: r5(a.lat), lon: r5(a.lon) }, b: { lat: r5(b.lat), lon: r5(b.lon) } };
    const { value } = await cached('api', 'simulateur-route', req, async () => {
      const leg = simRouteLeg(a, b);
      return { ...leg, snapStartM: 0, snapEndM: 0, router: 'simulateur' };
    });
    return value;
  }
  const req = { a: { lat: r5(a.lat), lon: r5(a.lon) }, b: { lat: r5(b.lat), lon: r5(b.lon) } };
  const { value } = await cached('api', 'osrm', req, async () => {
    const coords = `${r5(a.lon)},${r5(a.lat)};${r5(b.lon)},${r5(b.lat)}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const json = await httpJson(url, { minDelayMs: 700 }); // courtoisie serveur public
    if (json.code !== 'Ok' || !json.routes || !json.routes.length) {
      throw new Error(`OSRM sans itinéraire (${json.code}) entre ${req.a.lat},${req.a.lon} et ${req.b.lat},${req.b.lon}`);
    }
    const route = json.routes[0];
    const points = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    return {
      points,
      distanceM: route.distance,
      snapStartM: json.waypoints?.[0]?.distance ?? 0,
      snapEndM: json.waypoints?.[1]?.distance ?? 0,
      router: 'osrm',
    };
  });
  return value;
}

/** Interpolation pied→sommet (route inexistante ou col contourné) : ligne droite échantillonnée. */
function interpolateSegment(from, to) {
  const d = haversine(from, to);
  const n = Math.max(1, Math.round(d / 100));
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push(lerpPoint(from, to, i / n));
  return { points: pts, distanceM: d };
}

/**
 * Route une étape en chaînant les waypoints [{lat, lon, label, kind}].
 * Retourne {
 *   points: [{lat,lon}], distanceM,
 *   waypointsOnTrack: [{...wp, alongM, offTrackM, approximated}],
 *   approxSegments: [{fromM, toM, reason}], router
 * }
 */
async function routeStage(waypoints, { onProgress } = {}) {
  if (waypoints.length < 2) throw new Error('Il faut au moins deux waypoints (départ et arrivée).');
  const allPoints = [];
  const approxSegments = [];
  const wpOnTrack = [];
  const legs = []; // diagnostic : distance routée vs vol d'oiseau par leg
  let cum = 0;
  let router = null;

  const pushPoints = (pts) => {
    for (const p of pts) {
      const last = allPoints[allPoints.length - 1];
      if (last && Math.abs(last.lat - p.lat) < 1e-7 && Math.abs(last.lon - p.lon) < 1e-7) continue;
      if (last) cum += haversine(last, p);
      allPoints.push(p);
    }
  };

  pushPoints([{ lat: waypoints[0].lat, lon: waypoints[0].lon }]);
  wpOnTrack.push({ ...waypoints[0], alongM: 0, offTrackM: 0, approximated: false });

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (onProgress) {
      onProgress({
        step: 'routage',
        detail: `Leg ${i + 1}/${waypoints.length - 1} : ${a.label || 'wp'} → ${b.label || 'wp'}`,
        percent: Math.round((i / (waypoints.length - 1)) * 100),
      });
    }
    const leg = await routeLeg(a, b);
    router = router || leg.router;
    legs.push({
      from: a.label || `wp${i}`,
      to: b.label || `wp${i + 1}`,
      straightM: Math.round(haversine(a, b)),
      roadM: Math.round(leg.distanceM),
    });

    const isColB = b.kind === 'col' || b.kind === 'peak';
    const legEnd = leg.points[leg.points.length - 1];
    const endGap = haversine(legEnd, b);

    // Si le départ du leg est loin du waypoint précédent qui était un col :
    // le col a été atteint par interpolation, on redescend du sommet vers la route.
    const legStart = leg.points[0];
    const startGap = haversine(legStart, a);
    const isColA = a.kind === 'col' || a.kind === 'peak';
    if (startGap > COL_TOLERANCE_M && isColA) {
      const seg = interpolateSegment({ lat: a.lat, lon: a.lon }, legStart);
      const fromM = cum;
      pushPoints(seg.points);
      approxSegments.push({ fromM, toM: cum, reason: `descente interpolée depuis ${a.label || 'col'}` });
    }

    pushPoints(leg.points);

    if (endGap > COL_TOLERANCE_M && isColB) {
      // Col contourné : la route s'arrête au pied → interpolation pied→sommet.
      const fromM = cum;
      const seg = interpolateSegment(legEnd, { lat: b.lat, lon: b.lon });
      pushPoints(seg.points);
      approxSegments.push({ fromM, toM: cum, reason: `montée interpolée vers ${b.label || 'col'} (col contourné par la route)` });
      wpOnTrack.push({ ...b, alongM: cum, offTrackM: 0, approximated: true });
    } else {
      wpOnTrack.push({ ...b, alongM: cum, offTrackM: Math.round(endGap), approximated: false });
    }
  }

  return { points: allPoints, distanceM: cum, waypointsOnTrack: wpOnTrack, approxSegments, legs, router: router || 'osrm' };
}

module.exports = { routeStage, routeLeg, COL_TOLERANCE_M, OSRM_BASE };
