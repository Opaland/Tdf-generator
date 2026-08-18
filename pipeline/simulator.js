'use strict';
// Simulateur hors-ligne : fournit des réponses DÉTERMINISTES et plausibles pour le
// géocodage, le routage et l'altimétrie quand le réseau est indisponible (démo,
// tests, CI). Les données produites sont synthétiques et étiquetées comme telles :
// gazetier de villes/cols réels + modèle de terrain continu calibré sur les
// altitudes connues des sommets. Le reste du pipeline (échantillonnage, lissage,
// détection de côtes, analyse km par km, checks) est strictement identique au mode réel.

const crypto = require('crypto');
const { haversine, lerpPoint } = require('./geo');

// --- Gazetier : lieux réels (coordonnées et altitudes approchées, source : cartes IGN/OSM) ---
// kind: 'city' | 'peak'
const GAZETTEER = [
  { name: 'Paris', lat: 48.8566, lon: 2.3522, ele: 35, kind: 'city' },
  { name: 'Montgeron', lat: 48.7049, lon: 2.4593, ele: 55, kind: 'city' },
  { name: 'Ville-d\'Avray', lat: 48.8261, lon: 2.1934, ele: 130, kind: 'city' },
  { name: 'Versailles', lat: 48.8044, lon: 2.1301, ele: 130, kind: 'city' },
  { name: 'Melun', lat: 48.5421, lon: 2.6607, ele: 55, kind: 'city' },
  { name: 'Fontainebleau', lat: 48.4042, lon: 2.7016, ele: 75, kind: 'city' },
  { name: 'Montargis', lat: 47.9972, lon: 2.7325, ele: 85, kind: 'city' },
  { name: 'Nevers', lat: 46.9896, lon: 3.1592, ele: 180, kind: 'city' },
  { name: 'Moulins', lat: 46.5661, lon: 3.3328, ele: 220, kind: 'city' },
  { name: 'Lapalisse', lat: 46.2417, lon: 3.6444, ele: 275, kind: 'city' },
  { name: 'Roanne', lat: 46.0367, lon: 4.0689, ele: 280, kind: 'city' },
  { name: 'Tarare', lat: 45.9027, lon: 4.4372, ele: 250, kind: 'city' },
  { name: 'Col du Pin-Bouchain', lat: 45.9360, lon: 4.3450, ele: 759, kind: 'peak' },
  { name: 'Saint-Étienne', lat: 45.4397, lon: 4.3872, ele: 520, kind: 'city' },
  { name: 'Col de la République', lat: 45.3522, lon: 4.4563, ele: 1161, kind: 'peak' },
  { name: 'Givors', lat: 45.5904, lon: 4.7716, ele: 160, kind: 'city' },
  { name: 'Lyon', lat: 45.7640, lon: 4.8357, ele: 170, kind: 'city' },
  { name: 'Vienne', lat: 45.5250, lon: 4.8740, ele: 160, kind: 'city' },
  { name: 'Valence', lat: 44.9334, lon: 4.8924, ele: 125, kind: 'city' },
  { name: 'Avignon', lat: 43.9493, lon: 4.8055, ele: 25, kind: 'city' },
  { name: 'Arles', lat: 43.6766, lon: 4.6278, ele: 10, kind: 'city' },
  { name: 'Salon-de-Provence', lat: 43.6404, lon: 5.0973, ele: 80, kind: 'city' },
  { name: 'Marseille', lat: 43.2965, lon: 5.3698, ele: 20, kind: 'city' },
  { name: 'Montpellier', lat: 43.6108, lon: 3.8767, ele: 30, kind: 'city' },
  { name: 'Béziers', lat: 43.3442, lon: 3.2158, ele: 25, kind: 'city' },
  { name: 'Narbonne', lat: 43.1837, lon: 3.0031, ele: 15, kind: 'city' },
  { name: 'Carcassonne', lat: 43.2130, lon: 2.3510, ele: 110, kind: 'city' },
  { name: 'Castelnaudary', lat: 43.3180, lon: 1.9540, ele: 160, kind: 'city' },
  { name: 'Toulouse', lat: 43.6045, lon: 1.4440, ele: 150, kind: 'city' },
  { name: 'Agen', lat: 44.2028, lon: 0.6163, ele: 50, kind: 'city' },
  { name: 'Marmande', lat: 44.5001, lon: 0.1653, ele: 30, kind: 'city' },
  { name: 'Bordeaux', lat: 44.8378, lon: -0.5792, ele: 10, kind: 'city' },
  { name: 'Saintes', lat: 45.7455, lon: -0.6337, ele: 20, kind: 'city' },
  { name: 'Rochefort', lat: 45.9421, lon: -0.9588, ele: 10, kind: 'city' },
  { name: 'La Rochelle', lat: 46.1603, lon: -1.1511, ele: 10, kind: 'city' },
  { name: 'La Roche-sur-Yon', lat: 46.6705, lon: -1.4266, ele: 60, kind: 'city' },
  { name: 'Niort', lat: 46.3239, lon: -0.4646, ele: 25, kind: 'city' },
  { name: 'La Flèche', lat: 47.6989, lon: -0.0755, ele: 35, kind: 'city' },
  { name: 'Nogent-le-Rotrou', lat: 48.3212, lon: 0.8215, ele: 120, kind: 'city' },
  { name: 'Nantes', lat: 47.2184, lon: -1.5536, ele: 20, kind: 'city' },
  { name: 'Angers', lat: 47.4784, lon: -0.5632, ele: 25, kind: 'city' },
  { name: 'Le Mans', lat: 48.0061, lon: 0.1996, ele: 60, kind: 'city' },
  { name: 'Chartres', lat: 48.4469, lon: 1.4892, ele: 140, kind: 'city' },
  { name: 'Pau', lat: 43.2965, lon: -0.3700, ele: 200, kind: 'city' },
  { name: 'Tarbes', lat: 43.2328, lon: 0.0716, ele: 300, kind: 'city' },
  { name: 'Lourdes', lat: 43.0946, lon: -0.0466, ele: 410, kind: 'city' },
  { name: 'Argelès-Gazost', lat: 43.0063, lon: -0.0996, ele: 460, kind: 'city' },
  { name: 'Col du Soulor', lat: 42.9580, lon: -0.2601, ele: 1474, kind: 'peak' },
  { name: "Col d'Aubisque", lat: 42.9770, lon: -0.3382, ele: 1709, kind: 'peak' },
  { name: 'Hautacam', lat: 43.0000, lon: 0.0100, ele: 1520, kind: 'peak' },
  { name: 'Col du Tourmalet', lat: 42.9086, lon: 0.1452, ele: 2115, kind: 'peak' },
  { name: 'Luz-Saint-Sauveur', lat: 42.8720, lon: -0.0030, ele: 710, kind: 'city' },
  { name: 'Bagnères-de-Bigorre', lat: 43.0640, lon: 0.1494, ele: 550, kind: 'city' },
  { name: "L'Alpe d'Huez", lat: 45.0920, lon: 6.0700, ele: 1850, kind: 'peak' },
  { name: 'Bourg-d\'Oisans', lat: 45.0553, lon: 6.0290, ele: 720, kind: 'city' },
  { name: 'Mont Ventoux', lat: 44.1741, lon: 5.2789, ele: 1910, kind: 'peak' },
  { name: 'Col du Galibier', lat: 45.0640, lon: 6.4077, ele: 2642, kind: 'peak' },
  { name: "Col d'Aspin", lat: 42.9370, lon: 0.3260, ele: 1490, kind: 'peak' },
  { name: 'Col de Peyresourde', lat: 42.7972, lon: 0.4453, ele: 1569, kind: 'peak' },
  { name: "Col d'Izoard", lat: 44.8203, lon: 6.7347, ele: 2360, kind: 'peak' },
  { name: 'Col de la Croix de Fer', lat: 45.2274, lon: 6.2628, ele: 2067, kind: 'peak' },
  { name: "Col de l'Iseran", lat: 45.4172, lon: 7.0310, ele: 2764, kind: 'peak' },
  { name: 'Col du Télégraphe', lat: 45.2031, lon: 6.4442, ele: 1566, kind: 'peak' },
  { name: 'Col des Aravis', lat: 45.8705, lon: 6.4670, ele: 1486, kind: 'peak' },
  { name: "Ballon d'Alsace", lat: 47.8217, lon: 6.8400, ele: 1178, kind: 'peak' },
  { name: 'Puy de Dôme', lat: 45.7717, lon: 2.9644, ele: 1465, kind: 'peak' },
  { name: 'Nancy', lat: 48.6921, lon: 6.1844, ele: 210, kind: 'city' },
  { name: 'Besançon', lat: 47.2378, lon: 6.0241, ele: 250, kind: 'city' },
  { name: 'Belfort', lat: 47.6380, lon: 6.8629, ele: 360, kind: 'city' },
  { name: 'Chamonix', lat: 45.9237, lon: 6.8694, ele: 1035, kind: 'city' },
  { name: 'Lausanne', lat: 46.5197, lon: 6.6323, ele: 495, kind: 'city' },
  { name: 'Grenoble', lat: 45.1885, lon: 5.7245, ele: 215, kind: 'city' },
  { name: 'Nice', lat: 43.7102, lon: 7.2620, ele: 10, kind: 'city' },
  { name: 'Brest', lat: 48.3904, lon: -4.4861, ele: 40, kind: 'city' },
  { name: 'Caen', lat: 49.1829, lon: -0.3707, ele: 20, kind: 'city' },
  { name: 'Rouen', lat: 49.4431, lon: 1.0993, ele: 15, kind: 'city' },
  { name: 'Lille', lat: 50.6292, lon: 3.0573, ele: 25, kind: 'city' },
  { name: 'Reims', lat: 49.2583, lon: 4.0317, ele: 85, kind: 'city' },
  { name: 'Strasbourg', lat: 48.5734, lon: 7.7521, ele: 140, kind: 'city' },
  { name: 'Dijon', lat: 47.3220, lon: 5.0415, ele: 240, kind: 'city' },
  { name: 'Clermont-Ferrand', lat: 45.7772, lon: 3.0870, ele: 400, kind: 'city' },
  { name: 'Limoges', lat: 45.8336, lon: 1.2611, ele: 290, kind: 'city' },
  { name: 'Perpignan', lat: 42.6887, lon: 2.8948, ele: 30, kind: 'city' },
  { name: 'Bayonne', lat: 43.4933, lon: -1.4750, ele: 10, kind: 'city' },
  // Villes et arrivées des éditions récentes (fixtures 2025-2026).
  { name: 'Lille Métropole', lat: 50.6292, lon: 3.0573, ele: 25, kind: 'city' },
  { name: 'Lauwin-Planque', lat: 50.4034, lon: 3.0611, ele: 30, kind: 'city' },
  { name: 'Boulogne-sur-Mer', lat: 50.7264, lon: 1.6147, ele: 30, kind: 'city' },
  { name: 'Valenciennes', lat: 50.3570, lon: 3.5180, ele: 25, kind: 'city' },
  { name: 'Dunkerque', lat: 51.0344, lon: 2.3768, ele: 5, kind: 'city' },
  { name: 'Amiens Métropole', lat: 49.8942, lon: 2.2957, ele: 30, kind: 'city' },
  { name: 'Bayeux', lat: 49.2764, lon: -0.7024, ele: 40, kind: 'city' },
  { name: 'Vire Normandie', lat: 48.8380, lon: -0.8890, ele: 150, kind: 'city' },
  { name: 'Saint-Malo', lat: 48.6493, lon: -2.0257, ele: 10, kind: 'city' },
  { name: 'Mûr-de-Bretagne', lat: 48.1983, lon: -2.9850, ele: 220, kind: 'city' },
  { name: 'Saint-Méen-le-Grand', lat: 48.1897, lon: -2.1950, ele: 90, kind: 'city' },
  { name: 'Laval', lat: 48.0698, lon: -0.7700, ele: 50, kind: 'city' },
  { name: 'Chinon', lat: 47.1671, lon: 0.2430, ele: 40, kind: 'city' },
  { name: 'Châteauroux', lat: 46.8103, lon: 1.6911, ele: 155, kind: 'city' },
  { name: 'Ennezat', lat: 45.8983, lon: 3.2247, ele: 320, kind: 'city' },
  { name: 'Le Mont-Dore', lat: 45.5717, lon: 2.8092, ele: 1050, kind: 'city' },
  { name: 'Auch', lat: 43.6465, lon: 0.5855, ele: 170, kind: 'city' },
  { name: 'Loudenvielle', lat: 42.7986, lon: 0.4147, ele: 980, kind: 'city' },
  { name: 'Peyragudes', lat: 42.7936, lon: 0.4463, ele: 1580, kind: 'peak' },
  { name: 'Luchon-Superbagnères', lat: 42.7300, lon: 0.5240, ele: 1800, kind: 'peak' },
  { name: 'Muret', lat: 43.4611, lon: 1.3267, ele: 170, kind: 'city' },
  { name: 'Bollène', lat: 44.2811, lon: 4.7194, ele: 55, kind: 'city' },
  { name: 'Vif', lat: 45.0561, lon: 5.6706, ele: 310, kind: 'city' },
  { name: 'Courchevel', lat: 45.4154, lon: 6.6345, ele: 2000, kind: 'peak' },
  { name: 'La Plagne', lat: 45.5072, lon: 6.6772, ele: 1970, kind: 'peak' },
  { name: 'Albertville', lat: 45.6755, lon: 6.3928, ele: 340, kind: 'city' },
  { name: 'Nantua', lat: 46.1528, lon: 5.6086, ele: 480, kind: 'city' },
  { name: 'Pontarlier', lat: 46.9033, lon: 6.3550, ele: 840, kind: 'city' },
  { name: 'Mantes-la-Ville', lat: 48.9744, lon: 1.7106, ele: 30, kind: 'city' },
  { name: 'Thoiry', lat: 48.8683, lon: 1.7983, ele: 120, kind: 'city' },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686, ele: 12, kind: 'city' },
  { name: 'Tarragona', lat: 41.1189, lon: 1.2445, ele: 20, kind: 'city' },
  { name: 'Granollers', lat: 41.6083, lon: 2.2886, ele: 145, kind: 'city' },
  { name: 'Les Angles', lat: 42.5720, lon: 2.0764, ele: 1650, kind: 'peak' },
  { name: 'Foix', lat: 42.9638, lon: 1.6053, ele: 380, kind: 'city' },
  { name: 'Lannemezan', lat: 43.1256, lon: 0.3847, ele: 585, kind: 'city' },
  { name: 'Gavarnie-Gèdre', lat: 42.7333, lon: -0.0089, ele: 1365, kind: 'peak' },
  { name: 'Hagetmau', lat: 43.6558, lon: -0.5928, ele: 60, kind: 'city' },
  { name: 'Bergerac', lat: 44.8508, lon: 0.4815, ele: 50, kind: 'city' },
  { name: "Le Bourg-d'Oisans", lat: 45.0553, lon: 6.0290, ele: 720, kind: 'city' },
];

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Hash → nombre déterministe dans [0,1)
function hash01(str) {
  const h = crypto.createHash('sha256').update(str).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

// --- Modèle de terrain ---------------------------------------------------------
// Altitude continue = socle ondulé + piémont pyrénéen + Massif central + pics
// gaussiens calibrés pour retrouver l'altitude connue de chaque sommet du gazetier.

function baseTerrain(lat, lon) {
  // Socle : plaines ondulées, jamais négatif.
  let e =
    120 +
    90 * Math.sin(lat * 1.9 + 0.7) * Math.cos(lon * 1.3 + 2.1) +
    60 * Math.sin(lat * 5.3 + lon * 3.7) +
    35 * Math.sin(lat * 11.7 - lon * 9.1);
  // Piémont pyrénéen : montée douce vers le sud entre Atlantique et Méditerranée.
  if (lat < 43.45 && lon > -2.0 && lon < 3.2) {
    e += Math.min(1.2, 43.45 - lat) * 550;
  }
  // Massif central : dôme resserré sur son cœur (Puy-de-Dôme/Pilat) — un dôme
  // trop large gonflait artificiellement toute la vallée du Rhône (Lyon
  // simulé à ~760 m au lieu de 170 m réels) et masquait les vraies montées
  // locales (ex. col du Pin-Bouchain entre Tarare et Roanne).
  const dMc = Math.hypot((lat - 45.1) / 0.85, (lon - 3.1) / 1.0);
  e += 750 * Math.exp(-dMc * dMc);
  // Préalpes : dôme à l'est du Rhône.
  const dAl = Math.hypot((lat - 44.9) / 1.8, (lon - 6.4) / 1.6);
  e += 900 * Math.exp(-dAl * dAl);
  return Math.max(2, e);
}

// Cols modestes situés dans un relief déjà vallonné (le socle de base y est
// proche de l'altitude du sommet) : un sigma plus court concentre le peu
// d'amplitude disponible dans une rampe finale plus nette et détectable.
const SIGMA_OVERRIDES = { 'col du pin bouchain': 2200 };

const PEAKS = GAZETTEER.filter((g) => g.kind === 'peak').map((g) => ({
  ...g,
  sigmaM: SIGMA_OVERRIDES[normalize(g.name)] || 5000, // étalement du pic : concentre l'ascension sur les ~6 derniers km (pentes 4-10 %)
  amp: 0,
}));

function peakContribution(lat, lon, excludeIdx = -1) {
  let e = 0;
  for (let i = 0; i < PEAKS.length; i++) {
    if (i === excludeIdx) continue;
    const p = PEAKS[i];
    const d = haversine({ lat, lon }, p);
    e += p.amp * Math.exp(-((d / p.sigmaM) ** 2));
  }
  return e;
}

// Calibration : l'amplitude de chaque pic est ajustée pour que l'altitude simulée
// au sommet égale l'altitude connue (3 itérations de point fixe suffisent).
(function calibrate() {
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < PEAKS.length; i++) {
      const p = PEAKS[i];
      const without = baseTerrain(p.lat, p.lon) + peakContribution(p.lat, p.lon, i);
      p.amp = Math.max(0, p.ele - without);
    }
  }
})();

/** Altitude simulée (m) en un point quelconque. */
function simElevation(lat, lon) {
  return baseTerrain(lat, lon) + peakContribution(lat, lon);
}

// --- Fournisseurs simulés ------------------------------------------------------

/** Géocodage direct simulé : gazetier, sinon point déterministe dérivé du texte. */
function simGeocode(query) {
  const q = normalize(query);
  let best = null;
  let bestScore = 0;
  for (const g of GAZETTEER) {
    const n = normalize(g.name);
    let score = 0;
    if (n === q) score = 3;
    else if (q.includes(n) || n.includes(q)) score = 2 + Math.min(1, n.length / 40);
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  if (best) {
    return {
      label: best.name,
      lat: best.lat,
      lon: best.lon,
      ele: best.ele,
      kind: best.kind,
      provider: 'simulateur',
      score: 1,
    };
  }
  // Lieu inconnu : point stable en France métropolitaine, dérivé du hash du texte.
  const lat = 43.5 + hash01('lat:' + q) * 5.5;
  const lon = -1.5 + hash01('lon:' + q) * 7.0;
  return {
    label: `${query} (position simulée)`,
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
    ele: Math.round(simElevation(lat, lon)),
    kind: 'unknown',
    provider: 'simulateur',
    score: 0.2,
  };
}

/** Géocodage inverse simulé : entrée du gazetier la plus proche (< 25 km). */
function simReverseGeocode(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const g of GAZETTEER) {
    const d = haversine({ lat, lon }, g);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (best && bestD < 25000) {
    return { label: best.name, distanceM: Math.round(bestD), provider: 'simulateur' };
  }
  return { label: `Lieu (${lat.toFixed(3)}, ${lon.toFixed(3)})`, distanceM: null, provider: 'simulateur' };
}

/**
 * Routage simulé entre deux points : trajectoire incurvée déterministe
 * (sinuosité latérale dépendant du relief), points tous les ~400 m.
 * Retourne { points: [{lat,lon}], distanceM }.
 */
function simRouteLeg(a, b) {
  const straight = haversine(a, b);
  const seed = `${a.lat.toFixed(4)},${a.lon.toFixed(4)}-${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
  // Sinuosité : plus le relief moyen est marqué, plus la route serpente.
  const midEle = simElevation((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
  const hilliness = Math.min(1, Math.max(0, (midEle - 250) / 1200));
  // Amplitude et nombre de lacets calibrés pour une sinuosité routière réaliste
  // (~+15 % en plaine, ~+40 % en montagne), indépendante de la longueur du leg.
  const amplitudeM = straight * (0.045 + 0.05 * hilliness) * (0.75 + 0.5 * hash01('amp' + seed));
  const lobes =
    3 + Math.round(straight / 25000) + Math.floor(hash01('lobes' + seed) * 2) + Math.round(hilliness * 3);
  const n = Math.max(2, Math.round(straight / 400));
  const points = [];
  // Vecteur perpendiculaire unitaire (approximation plane locale).
  const kx = Math.cos((a.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const dx = (b.lon - a.lon) * kx;
  const dy = (b.lat - a.lat) * ky;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const phase = hash01('phase' + seed) * Math.PI;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const base = lerpPoint(a, b, t);
    const offset = amplitudeM * Math.sin(t * Math.PI * lobes + phase) * Math.sin(t * Math.PI);
    points.push({
      lat: base.lat + (py * offset) / ky,
      lon: base.lon + (px * offset) / kx,
    });
  }
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += haversine(points[i - 1], points[i]);
  return { points, distanceM };
}

/** Altimétrie simulée pour une liste de points [{lat,lon}]. */
function simElevations(points) {
  return points.map((p) => Math.round(simElevation(p.lat, p.lon) * 10) / 10);
}

module.exports = {
  GAZETTEER,
  simGeocode,
  simReverseGeocode,
  simRouteLeg,
  simElevation,
  simElevations,
};
