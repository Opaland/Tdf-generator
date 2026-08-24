'use strict';
// Détection des descentes — symétrique de la détection de côtes
// (pipeline/climbs.js), implémentée par réutilisation directe plutôt que
// réécrite en miroir : une descente de D mètres sur une distance L est
// exactement une « côte » de D mètres sur L une fois l'altitude inversée
// (ele → -ele). Réutiliser detectClimbs (déjà testé, déjà couvert par le
// détecteur de côtes) évite de dupliquer la logique de fusion/rognage/blocs
// km, et donc de dupliquer ses bugs potentiels dans une seconde copie qui
// dériverait avec le temps.
//
// Aucune catégorie ASO n'existe pour les descentes (contrairement aux côtes,
// classées HC/1/2/3/4 par l'organisation) : ce module n'en invente pas, pour
// ne pas laisser croire à une classification officielle qui n'existe pas
// (CLAUDE.md règle 9).

const { detectClimbs, MIN_LENGTH_M, MIN_AVG_GRADIENT: CLIMB_MIN_GRADIENT } = require('./climbs');

const MIN_AVG_GRADIENT = -CLIMB_MIN_GRADIENT; // %, négatif — dérivé du seuil des côtes, jamais divergent

function negate(samples) {
  return samples.map((s) => ({
    dist: s.dist,
    eleRaw: s.eleRaw != null ? -s.eleRaw : s.eleRaw,
    eleSmooth: s.eleSmooth != null ? -s.eleSmooth : s.eleSmooth,
  }));
}

/**
 * Détecte les descentes.
 * @param samples [{dist, eleRaw?, eleSmooth}] triés par dist (m) — mêmes
 *                règles de seuil que detectClimbs (≥ 1,5 km, ≥ 3 % de
 *                moyenne, fusion sous 500 m), appliquées à la pente
 *                descendante plutôt que montante.
 * @returns [{ startM, endM, lengthKm, topEle, bottomEle, avgGradient (< 0),
 *             maxGradient (< 0, la pente la plus raide), irregularityIndex, kmBlocks }]
 */
function detectDescents(rawSamples) {
  const inverted = detectClimbs(negate(rawSamples));
  return inverted.map((c) => ({
    startM: c.startM,
    endM: c.endM,
    lengthKm: c.lengthKm,
    topEle: -c.startEle,
    bottomEle: -c.summitEle,
    avgGradient: -c.avgGradient,
    maxGradient: -c.maxGradient,
    irregularityIndex: c.irregularityIndex,
    kmBlocks: c.kmBlocks.map((b) => ({
      fromM: b.fromM, toM: b.toM,
      ele0: -b.ele0, ele1: -b.ele1,
      gradient: -b.gradient,
    })),
  }));
}

/**
 * Nomme chaque descente : côte détectée juste avant elle (son sommet, à
 * moins de 800 m le long du tracé — le cas le plus fréquent, une descente
 * qui suit immédiatement le col qu'on vient de grimper), sinon waypoint de
 * type col le plus proche du sommet de la descente, sinon géocodage inverse.
 *
 * Utilise `fromClimb.rawLabel` (toponyme nu, sans préfixe) plutôt que
 * `fromClimb.name` : ce dernier porte déjà "Côte de X" quand la côte a été
 * nommée par géocodage inverse (pipeline/climbs.js), et concaténer donnerait
 * "Descente de Côte de X" — trouvaille de la relecture adverse, reproduite
 * avec `npm run demo` avant d'être corrigée. Une côte au nom générique de
 * repli ("Côte du km X", aucun rawLabel) ne sert donc pas de source ici :
 * la descente retombe sur sa propre chaîne de repli (waypoint puis
 * géocodage inverse) plutôt que d'hériter d'un nom tout aussi générique
 * mais mal accordé ("Descente de Côte du km X").
 */
async function nameDescents(descents, climbs, waypointsOnTrack, samples, reverseGeocodeFn) {
  for (const d of descents) {
    const fromClimb = (climbs || []).find((c) => Math.abs(c.endM - d.startM) < 800 && c.rawLabel);
    if (fromClimb) {
      d.name = `Descente de ${fromClimb.rawLabel}`;
      d.nameSource = 'climb-summit';
      continue;
    }
    const summitWp = (waypointsOnTrack || []).find(
      (w) => (w.kind === 'col' || w.kind === 'peak') && Math.abs(w.alongM - d.startM) < 1500
    );
    if (summitWp) {
      d.name = `Descente de ${summitWp.label}`;
      d.nameSource = 'waypoint';
      continue;
    }
    let si = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i].dist - d.startM) < Math.abs(samples[si].dist - d.startM)) si = i;
    }
    try {
      const r = await reverseGeocodeFn(samples[si].lat, samples[si].lon);
      d.name = r && r.label ? `Descente de ${r.label}` : `Descente du km ${(d.startM / 1000).toFixed(0)}`;
      d.nameSource = 'reverse-geocode';
    } catch {
      d.name = `Descente du km ${(d.startM / 1000).toFixed(0)}`;
      d.nameSource = 'defaut';
    }
  }
  return descents;
}

module.exports = { detectDescents, nameDescents, MIN_LENGTH_M, MIN_AVG_GRADIENT };
