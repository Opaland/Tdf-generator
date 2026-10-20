'use strict';
// Traces personnelles : bilan, import GPX/FIT/lien, connecteurs Suunto/Strava.
// Extrait de backend/server.js (Epic 27.2, recommandation R3 de
// docs/ARCHITECTURE-REVIEW.md) — code des routes inchangé, enregistré dans
// le même ordre par server.js.

const { getDb } = require('../db');
const { httpText } = require('../../pipeline/http');
const { suuntoRouter } = require('../suunto');
const { stravaRouter } = require('../strava');
const { parseGpx, parseFit, importTrackAsStage } = require('../../pipeline/importTrack');
const { wrap, httpError, requireString, queryString, CLIMB_CATEGORY_RANK } = require('../apiHelpers');

module.exports = function register(app) {
  // ---------------------------------------------------------------- import de traces

  /** Bilan personnel « année en cols » (backlog #10, section D) : agrège les
   * traces importées. Marqueur fiable : `tracks.router = 'trace'`, posé par
   * une seule ligne de code (pipeline/importTrack.js) qui n'est jamais
   * atteinte par un autre chemin — ni valeur littérale ailleurs dans le
   * dépôt, ni champ de requête que POST/PUT /api/stages laisserait passer.
   * `stages.stage_type` a été écarté volontairement : relecture adverse,
   * `stage_type` est une chaîne libre acceptée telle quelle par
   * POST/PUT /api/stages (optionalString, aucune liste blanche) — un
   * brouillon créé à la main dans l'éditeur avec stage_type: 'trace' se
   * routerait normalement, finirait state='done', et se ferait passer pour
   * une sortie réellement parcourue sans jamais toucher importTrackAsStage.
   * Cols gravis dédupliqués par nom : une même côte grimpée deux fois compte
   * une fois dans la liste, avec un compteur d'ascensions et l'altitude
   * sommet la plus haute observée. */
  app.get('/api/traces/summary', wrap(async (req, res) => {
    const db = getDb();
    const traces = db
      .prepare(
        `SELECT s.id, s.name, s.date, s.generated_distance_km, s.total_ascent_m, s.elapsed_time_s,
                s.city_hint, s.region_hint, s.country_hint, s.gear_id
         FROM stages s JOIN tracks t ON t.stage_id = s.id
         WHERE t.router = 'trace' AND s.state = 'done'`
      )
      .all();
    if (!traces.length) {
      return res.json({
        traceCount: 0, totalDistanceKm: 0, totalAscentM: 0, totalElapsedTimeS: null, tracesWithTimeCount: 0,
        highestSummit: null, climbs: [], daily: [], recent: [],
        exploration: { countries: [], regions: [], cities: [] },
      });
    }
    // stages.date n'est PAS garanti au format YYYY-MM-DD ici : posé ainsi par
    // dateAndDurationFromPoints() (pipeline/importTrack.js) à l'import, mais
    // PUT /api/stages/:id (route générique, non scopée aux traces) ne valide
    // que le TYPE de `date` (optionalString), jamais son format — un appel API
    // direct peut donc y écrire n'importe quelle chaîne. `daily`/`recent`
    // ci-dessous trient lexicographiquement sur ce champ : un format différent
    // (ex. JJ/MM/AAAA) s'y intercalerait silencieusement au mauvais endroit
    // plutôt que de lever une erreur (trouvaille de relecture adverse,
    // 18/09/2026 — CLAUDE.md règle 3, format supposé compatible entre deux
    // couches sans vérification). Normalisé une seule fois ici, plutôt que
    // vérifié à chaque site d'usage plus bas : un format inattendu est traité
    // exactement comme une date absente (jamais affiché tel quel, jamais
    // utilisé pour trier), même garde que frontend/editor.js:239.
    for (const t of traces) {
      if (t.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) t.date = null;
    }
    const traceIds = new Set(traces.map((t) => t.id));
    const allClimbs = db.prepare('SELECT stage_id, name, category, summit_ele_m FROM climbs').all();

    const byName = new Map();
    let highestSummit = null;
    for (const c of allClimbs) {
      if (!traceIds.has(c.stage_id) || !c.name) continue;
      // c.summit_ele_m peut être null (schéma sans NOT NULL, backend/db.js) —
      // atteignable via un import de sauvegarde (POST /api/backup/import).
      // Même classe de bug que CLAUDE.md règle 10 : sans le filtre != null,
      // `c.summit_ele_m > highestSummit.summit_ele_m` coercerait un null de
      // part ou d'autre en 0 — un col sans altitude connue, traité en premier,
      // empêcherait alors un col réel négatif suivant de devenir "le plus
      // haut" (vérifié : -30 > 0 est faux). entry.maxSummitM ci-dessous n'a
      // PAS ce risque malgré le même `|| 0` apparent : initialisé à 0 et mis à
      // jour par Math.max(), il ne peut jamais descendre sous 0 de toute façon
      // (Math.max(0, x) plancherait déjà x au même endroit) — un vrai
      // changement de comportement y aurait été un no-op, vérifié en écrivant
      // le test avant de le garder (voir tracesSummary.test.js).
      if (c.summit_ele_m != null && (!highestSummit || c.summit_ele_m > highestSummit.summit_ele_m)) {
        highestSummit = { name: c.name, summit_ele_m: c.summit_ele_m };
      }
      const entry = byName.get(c.name) || { name: c.name, count: 0, maxSummitM: 0, bestCategory: null };
      entry.count += 1;
      entry.maxSummitM = Math.max(entry.maxSummitM, c.summit_ele_m || 0);
      if (CLIMB_CATEGORY_RANK[c.category] > (CLIMB_CATEGORY_RANK[entry.bestCategory] || 0)) entry.bestCategory = c.category;
      byName.set(c.name, entry);
    }

    // elapsed_time_s : null pour toute trace importée avant PR #227, ou dont le
    // GPX/FIT source ne portait aucun horodatage exploitable (voir
    // dateAndDurationFromPoints(), pipeline/importTrack.js) — jamais traité
    // comme 0, qui se lirait comme une sortie réellement chronométrée à zéro
    // seconde (CLAUDE.md règle 10). tracesWithTimeCount permet au frontend
    // d'afficher honnêtement "X sur Y sorties chronométrées" plutôt que de
    // laisser croire que totalElapsedTimeS couvre traceCount sorties.
    const withTime = traces.filter((t) => t.elapsed_time_s != null);
    const totalElapsedTimeS = withTime.length ? Math.round(withTime.reduce((sum, t) => sum + t.elapsed_time_s, 0)) : null;

    // Agrégats par jour calendaire (date de DÉPART de la sortie, voir
    // dateAndDurationFromPoints — UTC) : base commune pour le graphique cumul/
    // barres hebdomadaires et pour tout calcul d'award (meilleur jour/semaine/
    // mois/année) fait côté frontend, plutôt que de dupliquer cette logique de
    // regroupement calendaire ici ET côté client. Une trace sans date connue
    // (GPX/FIT sans horodatage, ou import antérieur à PR #227) est comptée
    // dans les totaux ci-dessus mais absente de `daily` — elle ne peut pas
    // être rattachée à un jour, jamais approximée.
    const dailyMap = new Map();
    for (const t of traces) {
      if (!t.date) continue;
      const entry = dailyMap.get(t.date) || { date: t.date, distanceKm: 0, ascentM: 0, elapsedTimeS: null };
      entry.distanceKm += t.generated_distance_km || 0;
      entry.ascentM += t.total_ascent_m || 0;
      if (t.elapsed_time_s != null) entry.elapsedTimeS = (entry.elapsedTimeS || 0) + t.elapsed_time_s;
      dailyMap.set(t.date, entry);
    }
    const daily = [...dailyMap.values()]
      .map((d) => ({ ...d, distanceKm: Math.round(d.distanceKm * 10) / 10, ascentM: Math.round(d.ascentM) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Sorties récentes : les traces sans date connue n'ont pas d'ordre
    // chronologique significatif — reléguées en fin de liste (par id
    // décroissant, un repli raisonnable : plus récemment importées d'abord)
    // plutôt que mélangées arbitrairement parmi les traces datées.
    // Exploration (backlog #228, phase 3) : compte les pays/régions/villes
    // distincts parmi les traces qui en portent un (city_hint/region_hint/
    // country_hint — géocodage inverse du point de départ à l'import, voir
    // pipeline/importTrack.js, PR #231). Une trace sans hint connu (import
    // hors-ligne, panne réseau au moment de l'import, trace antérieure à
    // PR #231) est simplement absente de ces trois listes — jamais comptée
    // comme un pays/ville "inconnu", qui gonflerait artificiellement les
    // compteurs sans rien dire de réel sur les lieux visités.
    function countBy(field) {
      const counts = new Map();
      for (const t of traces) {
        const v = t[field];
        if (!v) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    const exploration = {
      countries: countBy('country_hint'),
      regions: countBy('region_hint'),
      cities: countBy('city_hint'),
    };

    const recent = [...traces]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id)
      .slice(0, 20)
      .map((t) => ({
        id: t.id, name: t.name, date: t.date,
        distanceKm: Math.round((t.generated_distance_km || 0) * 10) / 10,
        ascentM: Math.round(t.total_ascent_m || 0),
        elapsedTimeS: t.elapsed_time_s,
        gearId: t.gear_id,
      }));

    res.json({
      traceCount: traces.length,
      totalDistanceKm: Math.round(traces.reduce((sum, t) => sum + (t.generated_distance_km || 0), 0) * 10) / 10,
      totalAscentM: Math.round(traces.reduce((sum, t) => sum + (t.total_ascent_m || 0), 0)),
      totalElapsedTimeS,
      tracesWithTimeCount: withTime.length,
      highestSummit,
      climbs: [...byName.values()].sort((a, b) => b.maxSummitM - a.maxSummitM),
      exploration,
      daily,
      recent,
    });
  }));

  // GPX brut dans le corps de la requête → étape « trace » (pipeline aval identique).
  app.post('/api/import/gpx', wrap(async (req, res) => {
    const { points, name } = parseGpx(String(req.body || ''));
    if (points.length < 2) return res.status(400).json({ error: 'GPX illisible : aucun point de trace (trkpt/rtept)' });
    const id = await importTrackAsStage(points, {
      // Nom de fichier : une seule valeur (?name répété → 400), tronquée à
      // 200 comme un nom d'étape plutôt que refusée (nom de fichier long).
      name: (queryString(req.query.name, 'name') || '').slice(0, 200) || name || 'Trace GPX importée',
      source: 'gpx',
    });
    res.json({ id, points: points.length });
  }));

  // FIT brut dans le corps de la requête → étape « trace » (même pipeline aval
  // que l'import GPX ci-dessus ; parseFit() est partagé avec le connecteur
  // Suunto, qui télécharge lui aussi un FIT mais depuis cloudapi.suunto.com).
  app.post('/api/import/fit', wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw httpError(400, 'FIT illisible : corps de requête vide');
    }
    let points;
    try {
      points = await parseFit(req.body);
    } catch (err) {
      throw httpError(400, `FIT illisible : ${err.message}`);
    }
    if (points.length < 2) return res.status(400).json({ error: 'FIT illisible : aucun point de trace (position_lat/position_long)' });
    const id = await importTrackAsStage(points, {
      name: (queryString(req.query.name, 'name') || '').slice(0, 200) || 'Trace FIT importée',
      source: 'fit',
    });
    res.json({ id, points: points.length });
  }));

  // Import depuis un lien d'export direct (ex. Suunto app → « télécharger GPX »,
  // qui ne fournit pas de fichier local mais un lien signé api.sports-tracker.com —
  // backend historique de l'appli Suunto). Le navigateur ne peut pas le récupérer
  // lui-même (pas de CORS côté sports-tracker.com), donc le serveur le fait à sa
  // place. Liste blanche d'hôtes stricte : un lien saisi par l'utilisateur ne doit
  // jamais permettre au serveur d'aller sonder une adresse interne (SSRF).
  const ALLOWED_IMPORT_LINK_HOSTS = [/(^|\.)sports-tracker\.com$/i];

  app.post('/api/import/link', wrap(async (req, res) => {
    const url = requireString(req.body?.url, 'url');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw httpError(400, 'URL invalide');
    }
    if (parsed.protocol !== 'https:') throw httpError(400, 'Seules les URL https:// sont acceptées');
    const allowed = (u) => u.protocol === 'https:' && ALLOWED_IMPORT_LINK_HOSTS.some((re) => re.test(u.hostname));
    if (!allowed(parsed)) {
      throw httpError(400, `Domaine non autorisé pour l'import par lien (${parsed.hostname}). Domaines acceptés : sports-tracker.com (export Suunto).`);
    }
    // Chaque redirection est revérifiée contre la même liste blanche.
    const text = await httpText(url, { retries: 1, allowRedirect: allowed });
    const { points, name } = parseGpx(text);
    if (points.length < 2) {
      throw httpError(400, "Le lien n'a pas renvoyé un GPX exploitable — vérifie que l'export choisi (dans Suunto/Sports-Tracker) est bien au format GPX.");
    }
    const id = await importTrackAsStage(points, {
      name: (typeof req.body?.name === 'string' && req.body.name.trim()) || name || 'Trace importée (lien)',
      source: 'import-link',
    });
    res.json({ id, points: points.length });
  }));

  // Connecteur Suunto (OAuth2, liste des sorties, import FIT).
  app.use('/api/suunto', suuntoRouter);

  // Connecteur Strava (OAuth2, liste des activités, import par flux GPS).
  app.use('/api/strava', stravaRouter);
};
