'use strict';
// Revêtement de chaussée le long d'une étape, lu dans les tags OSM que BRouter
// renvoie déjà avec chaque itinéraire (`properties.messages`, colonne
// `WayTags` : « highway=… surface=… ») — aucun appel réseau supplémentaire,
// contrairement au map-matching Overpass envisagé à l'origine (issue #14,
// conception et vérification en direct sur la Colle delle Finestre : issue
// #350). Item C du backlog (issue #10) : « flag surface non goudronnée ».
//
// Cinq classes. « inconnu » n'est jamais « revêtu ». La plupart des routes
// départementales françaises n'ont PAS de tag surface dans OSM (mesuré le
// 17/10/2026 sur l'étape 2024/9 : 150 km sur 204 sans tag, presque tous en
// highway=tertiary/secondary) : une route classée sans tag compte en
// « revetu_presume », affichée comme une présomption tirée de la classe de
// route, jamais fondue avec un revêtement tagué. Restent
// inconnus les tronçons sans tag `surface` dans OSM, les legs routés par OSRM
// (sa réponse ne porte aucun tag), les legs sortis d'un cache antérieur à ce
// module, et les montées/descentes interpolées (col contourné, routing.js) —
// précisément les cas où un vrai tronçon en terre est le plus probable.

// Valeurs `surface=*` d'OSM (wiki « Key:surface »). Les pavés sont une classe
// à part : sur le Tour (secteurs de Roubaix), ce n'est ni du goudron ni de la
// terre. `paving_stones` (dalles modernes, lisses) reste « revêtu ».
const PAVED = new Set([
  'asphalt', 'paved', 'concrete', 'concrete:plates', 'concrete:lanes', 'chipseal',
  'paving_stones', 'metal', 'wood',
]);
const COBBLES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened']);
const UNPAVED = new Set([
  'unpaved', 'compacted', 'fine_gravel', 'gravel', 'pebblestone', 'dirt', 'earth',
  'ground', 'grass', 'grass_paver', 'mud', 'sand', 'rock', 'woodchips', 'clay',
]);

// Classes de route dont l'usage OSM présume un revêtement en l'absence de tag
// `surface` (wiki « Key:surface », valeur implicite). `track`, `path`,
// `service`… restent inconnus : aucune présomption sûre.
const PRESUMED_PAVED_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

/** Classe une valeur `surface=*` : 'revetu' | 'paves' | 'non_revetu' | 'inconnu'. */
function classifySurface(surface) {
  if (!surface) return 'inconnu';
  const s = String(surface).toLowerCase();
  if (PAVED.has(s)) return 'revetu';
  if (COBBLES.has(s)) return 'paves';
  if (UNPAVED.has(s)) return 'non_revetu';
  return 'inconnu';
}

/**
 * Classe un tronçon {surface, highway} : tag surface d'abord, sinon
 * présomption par classe de route. Symétrique de « revêtu présumé » : une
 * piste agricole/forestière (`highway=track`) sans tag est présumée non
 * revêtue — mesuré le 17/10/2026, la plupart des 14 secteurs de chemins
 * blancs de 2024/9 sont des `highway=track` sans `surface`, et BRouter ne
 * transmet pas `tracktype` (qui distinguerait une piste goudronnée, grade1).
 */
function classifyWay({ surface, highway }) {
  if (surface) return classifySurface(surface);
  if (highway && PRESUMED_PAVED_HIGHWAY.has(highway)) return 'revetu_presume';
  if (highway === 'track') return 'non_revetu_presume';
  return 'inconnu';
}

/**
 * Tronçons d'un leg BRouter, positions relatives au début du leg, avec les
 * tags BRUTS (`surface`, `highway`) — jamais la classe : ce résultat est mis
 * en cache 180 jours avec l'itinéraire (routing.js), la classification se
 * fait à la lecture (classifyWay) pour qu'un changement de règle n'exige
 * jamais de re-télécharger les itinéraires.
 * `messages` : tableau BRouter (1re ligne = en-têtes, puis une ligne par
 * changement de way, `Distance` = longueur en mètres du tronçon, en chaîne).
 * Renvoie [] si le format n'est pas celui attendu — jamais d'exception : la
 * surface est une information en plus, elle ne doit pas faire échouer un
 * routage qui a réussi.
 */
function brouterSurfaceStretches(messages) {
  if (!Array.isArray(messages) || messages.length < 2 || !Array.isArray(messages[0])) return [];
  const iDist = messages[0].indexOf('Distance');
  const iTags = messages[0].indexOf('WayTags');
  if (iDist < 0 || iTags < 0) return [];
  const out = [];
  let at = 0;
  for (const row of messages.slice(1)) {
    const len = Number(row[iDist]);
    if (!Number.isFinite(len) || len <= 0) continue;
    const tags = String(row[iTags] || '');
    const surface = (/(?:^|\s)surface=(\S+)/.exec(tags) || [])[1] || null;
    const highway = (/(?:^|\s)highway=(\S+)/.exec(tags) || [])[1] || null;
    const last = out[out.length - 1];
    if (last && last.surface === surface && last.highway === highway) last.toM += len;
    else out.push({ fromM: at, toM: at + len, surface, highway });
    at += len;
  }
  return out;
}

/**
 * Résumé d'une étape : mètres par classe (le reste de `totalM` non couvert par
 * un tronçon connu compte en « inconnu ») et liste des tronçons non revêtus
 * ou pavés (adjacents de même classe fusionnés), positions en mètres depuis
 * le départ.
 */
function summarizeSurfaces(stretches, totalM) {
  const m = { revetu: 0, revetu_presume: 0, paves: 0, non_revetu: 0, non_revetu_presume: 0, inconnu: 0 };
  const notable = [];
  for (const s of stretches) {
    const cls = classifyWay(s);
    m[cls] += s.toM - s.fromM;
    if (cls !== 'non_revetu' && cls !== 'non_revetu_presume' && cls !== 'paves') continue;
    const last = notable[notable.length - 1];
    if (last && last.cls === cls && s.fromM - last.toM < 1) {
      last.toM = s.toM;
      if (s.surface && !last.surfaces.includes(s.surface)) last.surfaces.push(s.surface);
    } else {
      notable.push({ fromM: s.fromM, toM: s.toM, cls, surfaces: s.surface ? [s.surface] : [] });
    }
  }
  const covered = Object.values(m).reduce((a, b) => a + b, 0);
  m.inconnu += Math.max(0, totalM - covered);
  const round = (x) => Math.round(x);
  return {
    meters: {
      revetu: round(m.revetu), revetu_presume: round(m.revetu_presume), paves: round(m.paves),
      non_revetu: round(m.non_revetu), non_revetu_presume: round(m.non_revetu_presume), inconnu: round(m.inconnu),
    },
    stretches: notable.map((n) => ({ ...n, fromM: round(n.fromM), toM: round(n.toM) })),
    source: 'tags OSM surface=*/highway=* via BRouter',
  };
}

module.exports = { classifySurface, classifyWay, brouterSurfaceStretches, summarizeSurfaces, PRESUMED_PAVED_HIGHWAY };
