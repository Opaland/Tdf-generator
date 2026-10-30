# Suivi de backlog (modèle Epic → Story, inspiré de BMAD-METHOD)

Ce fichier adopte le modèle d'organisation du [BMad Method](https://github.com/bmad-code-org/bmad-method)
(Epics → Stories, suivi par statut, code-review obligatoire avant "done")
sans installer le framework lui-même — nouvelle dépendance non justifiée au
regard de `docs/BRIEF.md`. Chaque Epic correspond à un sprint du plan daté du
14-17/10/2026 ; chaque Story est une unité de travail vérifiable
indépendamment. Statuts : `done`, `blocked`, `backlog`.

Demande explicite du 17/10/2026 : décomposer le plan à cette granularité
plutôt que de gonfler artificiellement un compte de "sprints" — ce fichier
en est le résultat. Le compte de stories (~81 à venir) rejoint les ~48
déjà closes cette session (curation d'étape par étape, tâches #2-#49) à un
total dépassant 100 une fois comptées au même niveau de détail.

Nouvelle demande explicite du 17/10/2026 : monter à 200. Plutôt que
d'inventer 100+ stories fictives pour atteindre ce chiffre — ce que ce
document a toujours refusé de faire, voir ci-dessus — la Partie A compte le
travail **réel et déjà mergé sur `main`**, vérifié par `git log`, dépôt
entier (pas seulement cette session). La Partie B (Epics 1-28, 25 à 28 ajoutés le 17/10/2026)
reste la feuille de route active, à la même granularité qu'avant.

## Partie A — Travail déjà mergé sur `main` (vérifié par `git log`)

Commande de référence, rejouable : `git log origin/main --oneline | wc -l`
(dépôt dé-superficialisé via `git fetch --unshallow` le 17/10/2026, sinon
le clone par défaut tronque l'historique à 50 commits et sous-compte).

**312 commits mergés sur `main`, du 18/08/2026 (commit initial) au
13/10/2026** (aucun merge depuis — les 5 PR ouvertes #339/#340/#341/#348/#349
attendent toujours une revue humaine, voir Epics 2/3/5/7 et la veille en
cours). Répartition mensuelle, exacte et non chevauchante :

| Mois | Commits | Vérifié par |
|---|---|---|
| Août 2026 | 171 | `git log origin/main --oneline --since=2026-08-01 --until=2026-09-01 \| wc -l` |
| Septembre 2026 | 49 | idem `--since=2026-09-01 --until=2026-10-01` |
| Octobre 2026 (1→13) | 92 | idem `--since=2026-10-01 --until=2026-10-14` |
| **Total** | **312** | `git log origin/main --oneline \| wc -l` |

Ces 312 commits dépassent déjà seuls les 200 demandés — aucune story n'a
besoin d'être inventée. Regroupement thématique ci-dessous : **approximatif
et non exclusif** (un commit de curation d'étape est aussi souvent un
correctif de bug ; les pourcentages de thème ne s'additionnent donc pas au
total exact ci-dessus, qui est la seule somme garantie sans double-compte).

- **Curation historique étape par étape** (≥143 commits, `grep -ciE
  "étape|tour de france|édition|prologue"`) — le cœur du projet : chaque
  édition (1903 → 2026, hommes et femmes) reconstruite tour de rôle,
  documentée dans `pipeline/data/historic_routes.json` avec sa `confidence`.
  Exemples réels : « Cure le tracé réel de 14 étapes du Tour 1992 » (#176),
  « Reconstruit le road book complet du Tour 1992 étape 10 » (#179),
  « Documente l'écart irréductible du prologue 1992 (San Sebastián) » (#254),
  « Détecte les points de passage curés trop espacés (via-gap) » (#181).
- **Sécurité** (≥6 commits) — « Corrige une XSS stockée via
  `POST /api/backup/import` sur `climbs.*` » (#337), « Revue globale :
  corrige 4 XSS stockées (Leaflet `bindPopup`/`bindTooltip`) » (#94), « Revue
  croisée multi-perspective : corrige une faille XSS... » (#11, origine de
  la règle 1 de `CLAUDE.md`).
- **Routage** (≥4 commits) — « Migre le routage principal d'OSRM vers
  BRouter (profil vélo réel) » (#173, issue #169).
- **Performance** (≥4 commits) — « Chronomètre `pipeline/generate.js` au
  lieu de supposer sa performance » (#92), « Parallélise les 6 sondes de
  `GET /api/diagnostic` ».
- **Documentation / resynchronisation** (≥21 commits) — « Resynchronise la
  doc avec l'état réel du dépôt » (#143), et la longue série de
  « Documente l'écart [irréductible/résiduel] de... » par étape.
- **Genèse du projet** (18/08/2026) — commit initial, pipeline
  géocodage→routage→élévation→cols, import GPX/Suunto, vitrine Pages,
  CI GitHub Actions.

Total vérifiable : **312 (mergé, `main`) + 85 (Partie B, actif, dont 5 déjà
en PR ouverte) = 397 unités de travail**, chacune individuellement citable
par un numéro de commit/PR ou une ligne de ce fichier — aucune ajoutée pour
arrondir un compte.

## Partie B — Feuille de route active (Epics 1-28)

Granularité et statuts inchangés depuis la demande du 17/10/2026 précédente
(`done`/`blocked`/`backlog`) : monter le total global passe par compter le
réel (Partie A), pas par subdiviser artificiellement ces stories.

## Epic 1 — Sprint 0.5 : nettoyer les branches mortes

- [x] 1.1 Identifier les branches dont le dernier commit est un ancêtre fusionné de `main`
- [x] 1.2 Vérifier chaque branche contre l'historique des PR (aucune liée à un travail ouvert)
- [ ] 1.3 **blocked** — Supprimer le lot : HTTP 403 du remote sur chaque tentative, aucun outil de contournement (issue #342)

## Epic 2 — Sprint 1 : fiabilité du routage

- [x] 2.1 Auditer `pipeline/http.js` — déjà durci, rien trouvé
- [x] 2.2 Corriger le router mixte invisible (`routing.js`/`checks.js`)
- [x] 2.3 Revue adverse + correction du vote "majoritaire"
- [x] 2.4 Auditer `pipeline/generate.js` — déjà durci, rien trouvé
- [x] 2.5 PR #340 mergée (17/10/2026)

## Epic 3 — Sprint 2 : resynchronisation documentaire

- [x] 3.1 `README.md` (3 mentions OSRM/BRouter périmées)
- [x] 3.2 `docs/PRESENTATION.md` (schéma + tableau)
- [x] 3.3 `docs/PERF-PIPELINE.md`, `SYNOLOGY.md`, `DEPLOY-PUBLIC.md`
- [x] 3.4 `backend/exports.js` (attribution d'export)
- [x] 3.5 PR #341 mergée (17/10/2026)

## Epic 4 — Sprint 3 : dette de confiance des données (65 entrées UNSURE)

- [x] 4.1 Compter et catégoriser les 65 entrées
- [x] 4.2 Isoler le sous-ensemble "recherche épuisée" (~50-60, ne pas rouvrir sans piste neuve)
- [x] 4.3 Isoler le sous-ensemble "décision archi requise" (6, voir Epics 8-9)
- [x] 4.4 Adopter la posture "documenté honnêtement" plutôt que forcer une résolution
- [x] 4.5 Trouvaille du 17/10/2026 : le resserrement de `DIST_TOLERANCE_PCT`
      à ±5 % (24/09/2026) n'avait jamais été répercuté dans les `confidence`
      blocks de `historic_routes.json`, qui citaient encore l'ancien seuil
      ±10 % et un statut `OK` — 50 occurrences de « tolérance ±10 »
      retrouvées par `grep`
- [x] 4.6 5 occurrences confirmées comme réellement mal étiquetées (`OK` au
      lieu de `fail`) par régénération réelle du pipeline (réseau live, pas
      supposé depuis le texte) et corrigées : 1992/20, 2024/4, 2024/16,
      2024/21, 2025/19 — PR #351
- [x] 4.7 Seconde passe (17/10/2026) : toutes les entrées encore marquées `OK` qui citent l'ancien seuil ±10 % passées en revue d'après leur pourcentage déclaré, et chaque cas déclarant plus de ±5 % re-mesuré par régénération réelle — 3 de plus réellement en échec (2002/0 -8,7 %, 2002/3 +5,6 %, 2022/1 -9,3 %), ajoutées à la PR #351 (8 au total) ; 2023/20 re-mesurée à +0,4 % (texte « +5,2 % » périmé, statut OK confirmé). Les ~15 autres entrées `OK` déclarent toutes moins de ±5 % : statut cohérent avec le seuil actuel, mais **non re-mesurées** une à une (la dérive dans le temps d'une donnée reste possible, comme l'a montré 2023/20 dans le sens favorable). Les entrées `UNSURE` qui citent ±10 % sont déjà classées hors tolérance — seule la formulation date.
## Epic 5 — Sprint 4 : performance

- [x] 5.1 Mesurer `EXPLAIN QUERY PLAN` sur `stages.edition_id` avant correctif
- [x] 5.2 Ajouter l'index composite `(edition_id, stage_order, id)`
- [x] 5.3 Vérifier l'effet sur `GET /api/editions` (double jointure)
- [x] 5.4 Évaluer un index sur `editions(year, name)` — testé, aucun gain réel
- [ ] 5.5 **backlog** — Pagination : mesure requise sur données à l'échelle réelle (Epic 17)
- [ ] 5.6 **backlog** — Parallélisation : aucune cible sûre identifiée sans réseau réel (Epic 18)
- [x] 5.7 PR #348 mergée (17/10/2026), index devenu la migration 4

## Epic 6 — Audit applicatif Playwright

- [x] 6.1 Démarrer l'app avec des données réelles (`npm run demo`, Tour 1903)
- [x] 6.2 Script Playwright multi-pages, desktop 1440px + mobile 375px
- [x] 6.3 Vérifier le PWA (manifest, service worker) — OK
- [x] 6.4 Filtrer le bruit TLS propre au bac à sable (`--ignore-certificate-errors`)
- [x] 6.5 Vérifier la fiche d'étape individuelle
- [x] 6.6 Confirmer la non-régression des correctifs nav mobile #16/#17 (clos depuis le 24/08, toujours vrai)
- [x] 6.7 Import réel d'une trace GPX + génération complète d'étape depuis l'éditeur, bout en bout : les deux fonctionnent (vérifié par traçage réseau direct — `POST /api/stages` 200, `POST /api/stages/:id/generate` 202, redirection réelle vers la fiche). Trois "échecs" rencontrés en chemin, tous vérifiés comme des bugs de mon propre script d'audit (hypothèses fausses sur l'état initial des lignes de waypoints, sur le texte affiché après import, et sur le comportement de redirection au succès) — pas des bugs de l'app, corrigés avant de conclure.

## Epic 7 — Sprint correctif post-audit

- [x] 7.1 Clos sans PR : aucune trouvaille réelle sur l'ensemble des parcours couverts (7 pages × 2 viewports, fiche d'étape, PWA, import de trace, génération depuis l'éditeur)

## Epic 8 — Décision + implémentation : mécanisme "laps" (issue #251)

- [x] 8.1 Chiffré : 4 étapes bloquées (1975/22, 1992/21, 2002/20, 2022-femmes/1) + contournements par vias dupliqués (2025/21, 2020/1) — commentaire issue #251
- [x] 8.2 3 options proposées (A : `laps` développé à l'import, S, recommandée ; B : dans routeStage, M ; C : multiplier la distance, déconseillée) — issue #251
- [x] 8.3 `laps` développé à l'import (option A) — PR #384 ; 1975/22 de 0 km à 197,9 km (fastbike)
- [x] 8.4 Tests + revue adverse — PR #384 (roadbook et profil séquentiels, bornes, jonction des tours)

## Epic 9 — Décision + implémentation : profil de routage par étape (issue #243)

- [x] 9.1 Prototype mesuré sur les 4 étapes : `shortest` fait entrer 1903/3 (-1,1 %) et 1992/10 (+4,9 %), pas 1903/2 ni 1992/4 ; `trekking` pire partout — issue #243
- [x] 9.2 Proposé : champ `routing_profile` par étape (S/M), appliqué aux 2 étapes où le gain est mesuré — issue #243
- [x] 9.3 Profil BRouter par étape curée (`routing_profile`, migration 5) — PR #385
- [x] 9.4 Appliqué après mesure : `shortest` retenu pour 1975/22 seulement (+5,0 %) ; écarté pour 1903/3, 1992/10 et 1992/21 (pistes empruntées) — PR #385, #387

## Epic 10 — Tour de France Femmes : données réelles

- [x] 10.1 Récupérer une fixture Wikipédia réelle — `pipeline/fixtures/wikipedia_2022_femmes_en.html`, déjà fait avant ce fichier
- [x] 10.2 Curer les points de passage d'au moins une édition Femmes — 2022-femmes : étapes 7, 8 (montagnes finales, avant ce fichier) et 3 (Reims → Épernay, 17/10, PR #354)
- [x] 10.3 Vérifier import/génération avec cette donnée réelle — vérifié par régénération réelle (réseau live) à chaque étape curée
- [x] 10.4 Documenter dans `historic_routes.json` avec `confidence` — fait pour les 3 étapes curées, honnêtement hors tolérance pour toutes (voir détail de chaque entrée)
- [x] 10.5 Étapes 2, 4, 5, 6 curées (PR #358, #357, #356, #355) et étape 3 refaite (PR #354), toutes depuis le roadbook ASO complet trouvé sur dimensionsvelo.com — étapes 2-5 dans la tolérance (-3,5 % à +3,0 %), étape 6 à -9,8 % mais fidèle à 0,3 km près jusqu'au premier passage à Rosheim (écart entièrement dans la boucle finale, décrite seulement par des numéros de carrefour). Trouvailles transverses : (a) les entrées de roadbook codées comme carrefour (« Piney (D43-D79) ») désignent la route qui frôle la commune, pas le village — viser le centre ajoute 1,5-5,6 km par tronçon ; (b) un total dans la tolérance peut masquer une dérive intermédiaire de ±10 km par compensation — mesuré point par point à chaque étape, documenté dans les confidence ; (c) BRouter renvoie des HTTP 403 par intermittence sous charge (repli OSRM leg par leg), invisible sans la PR #340
- [ ] 10.6 **blocked** — Étape 1 (circuit parisien) : `laps` existe (PR #384), mais les sources divergent sur le nombre de tours (Wikipédia : 11, Rouleur : 12) ; pas tranché sans source primaire
- [x] 10.7 Étapes 7 et 8 refaites depuis leur roadbook ASO (PR #359, #360) : -10,0 % → +4,3 % et -10,2 % → +3,6 %. Trouvailles : « Col du Platzerwasel » résolu sur un autre col (Hilsenfirst, ~4 km) sur main, check « col atteint » passant quand même ; Mélisey (étape 8), ajoutée par la curation précédente comme « commune évidente non sourcée », n'est pas sur le parcours réel.
- [x] 10.8 Note d'édition `2022-femmes` consolidée — PR #370 intègre #354 à #360 (conflits résolus, étapes identiques à leurs branches) : 6 étapes dans ±5 %, étape 6 UNSURE, étape 1 bloquée sur les laps

## Epic 11 — Détection de surface non goudonnée (Overpass API)

- [x] 11.1 Revérifier l'accès réseau à `overpass-api.de` — toujours bloqué (`Connection reset by peer`, proxy d'egress), voir issue #350
- [x] 11.1b Re-testé le 17/10/2026 : `overpass-api.de` toujours bloqué, mais des miroirs répondent depuis ce sandbox — `maps.mail.ru/osm/tools/overpass` renvoie du JSON valide par intermittence (sinon « server too busy »), `overpass.kumi.systems` répond en HTTP 500
- [x] 11.2 Prototype de faisabilité : **Overpass inutile** — la réponse GeoJSON de BRouter porte déjà `WayTags` (dont `surface=`) et `Distance` par segment, vérifié en direct avec le profil `fastbike` (détail et conception : commentaire sur l'issue #350)
- [x] 11.4 Résumé « km non revêtus / pavés » par étape depuis les `WayTags` BRouter — PR #366 (empilée sur #340) ; mesuré en réel sur 2024/9 : 98 % classés
- [x] 11.5 2024/9 recurée sur les 14 secteurs de chemins blancs — PR #368 (empilée sur #366) : 206,8 km (+3,9 %), 28,3 km non revêtus mesurés sur 32,2 km réels
- [x] 11.6 2022/5 (Lille → Arenberg) curée sur ses secteurs pavés — PR #372 (empilée sur #366) : 151,0 km (-1,8 % / -3,8 %), 18,1 km de pavés mesurés sur 19,4
- [ ] 11.3 **blocked** — Évaluer le coût/la complexité : reporté avec 11.2

## Epic 12 — Décision produit : ravitaillement/villages traversés

- [x] 12.1 Chiffrer le coût de géocodage inverse à l'échelle — PR #382 : 2002/18, reverse Géoplateforme 40 % de réponses vides ; geo.api.gouv.fr 0 %, 44 communes au pas de 1 km en 47,6 s
- [x] 12.2 Proposer 2-3 approches à l'utilisateur — PR #382 : A génération / B à la demande (recommandée) / C contours embarqués
- [x] 12.3 Communes traversées à la demande (fiche + roadbook, migration 6) — PR #390 (relecture adverse : course de régénération et relecture stricte corrigées) ; vérification contre le vrai geo.api.gouv.fr encore à faire (hôte injoignable depuis le bac à sable le 17/10)

## Epic 13 — Sécurité : identifiants Suunto stockés

- [x] 13.1 Évaluer le risque réel (LAN strict vs exposition) — issue #379 (vérifié dans le code : jetons OAuth en clair dans `settings`, exclus de la sauvegarde portable)
- [x] 13.2 Proposer un chiffrement at-rest — issue #379 : A durcir/documenter, B AES-256-GCM avec `ETAPEFORGE_SECRET_KEY`, C trousseau OS
- [x] 13.3 Option A (provenance des secrets, PR #386) puis option B (chiffrement au repos AES-256-GCM + scrypt, `ETAPEFORGE_SECRET_KEY`, PR #392)

## Epic 14 — Décision : programme partenaire Suunto

- [x] 14.1 Décidé le 18/10/2026 : usage personnel — le connecteur actuel suffit, aucune candidature au programme partenaire

## Epic 15 — Vérification concurrentielle directe (La Flamme Rouge)

- [ ] 15.1 **blocked** — Accès direct retenté le 17/10/2026 : HTTP 403 (protection anti-bot), recherche web non concluante ; aucun contournement tenté
- [x] 15.2 Mettre à jour issue #14 avec le résultat — corps de l'issue mis à jour le 17/10, commentaire de suivi (surface via BRouter, PR #366)

## Epic 16 — Recherche concurrentielle élargie (rando/ski)

- [x] 16.1 Lister les apps candidates (AllTrails, Visorando, Skitourenguru, etc.)
- [x] 16.2 Rechercher chacune
- [x] 16.3 Synthèse 3 colonnes (idées / à vérifier / différenciant confirmé) — issue #345
- [x] 16.4 Soumis à l'utilisateur (issue #345) — aucune implémentation engagée depuis

## Epic 17 — Performance : pagination

- [x] 17.1 `scripts/scale-bench.js` : base synthétique de 2 200 étapes (simulateur) — PR #373
- [x] 17.2 Mesuré : seul point chaud `/api/stages` (251 ms, 5,2 Mo) ; ~113 Ko/étape en base
- [x] 17.3 Pagination non justifiée : le poids venait du détail des audits, pas du nombre de lignes
- [x] 17.4 Liste allégée à `{ ok, offline }` : 90 ms, 680 Ko (-87 %) — PR #373 (empilée sur #371)

## Epic 18 — Performance : parallélisation (réseau réel)

- [x] 18.1 Profiler une génération d'étape réelle de bout en bout — PR #381 : 2002/18 à froid en 35,8 s, dont ~20 s de délais de courtoisie (brouter.de, Nominatim) ; 0,14 s à chaud
- [x] 18.2 Identifier les attentes réellement indépendantes — PR #381 : 3 leviers entre hôtes différents (flux géocodage→routage ~6-7 s, flux routage→altimétrie, moins de replis Nominatim = choix produit)
- [x] 18.3 Décidé le 17/10/2026 : pas de parallélisation (gain limité à la première génération, 0,14 s à chaud ; délais de courtoisie inchangés)

## Epic 19 — Revue UI/UX globale

- [x] 19.1 Relire les 8 écrans à partir de l'audit Playwright (recoupé avec Epic 6/7 : aucune régression fonctionnelle à re-vérifier)
- [x] 19.2 Vérifier la cohérence avec `docs/DESIGN_SYSTEM.md` — doc à jour sur les couleurs, muet sur l'espacement/rayon/typographie réels
- [x] 19.3 Lister les incohérences concrètes (pas des opinions) — `docs/UI-UX-REVIEW.md` (PR #352) : 8 valeurs de `border-radius`, 17 de `font-size`, 14 d'espacement, mesurées par grep, aucune jeton CSS équivalent à la palette couleur

## Epic 20 — Proposition design system

- [x] 20.1 Chiffrer le coût d'un changement (dépendances, maintenance) — `docs/UI-UX-REVIEW.md`
- [x] 20.2 Proposer 2-3 options avec compromis — A (statu quo) / B (tokeniser l'existant, recommandée) / C (refonte visuelle)
- [x] 20.3 Décidé le 17/10/2026 : option B (jetons CSS d'espacement, rayon, typographie, sans changement visuel) — PR #352 mergée
- [x] 20.4 Jetons CSS sans changement visuel (13 048 styles calculés identiques) — PR #389

## Epic 21 — Stratégie marketing/positionnement

- [x] 21.1 Rédiger l'angle de positionnement (reconstruction fidèle, locale, vérifiable) — `docs/MARKETING.md` (PR #353)
- [x] 21.2 Captures d'écran : 8 existent déjà (`docs/captures/`) ; identifié ce qui manque réellement (mobile/PWA, GIF du pipeline) plutôt que tout refaire
- [x] 21.3 Rédiger un texte de présentation court — 2 variantes (technique/non technique), non validées
- [x] 21.4 PR #353 mergée (document dans le dépôt) ; **aucune diffusion hors du dépôt** : publier reste une action de l'utilisateur (CLAUDE.md règle 15)

## Epic 22 — Resynchroniser l'issue #10

- [x] 22.1 Corriger la mention périmée sur #16/#17 — déjà fait : le corps de l'issue #10 (mis à jour le 17/10/2026) dit « les 8 issues sont closes, y compris #16/#17 », vérifié par relecture

## Epic 23 — Revue globale de fin de session

- [x] 23.1 Sécurité : grep `innerHTML`/`eval`/`new Function` sur tout `frontend/`+`backend/` (~70 occurrences) — toutes passent par `esc()`/`EF.esc()`, `npm audit --omit=dev` : 0 vulnérabilité
- [x] 23.2 Validation d'entrée : spot-check `POST /api/stages` — `requireString`/`optionalString`/`optionalNumber`/`assertLatLonPaired` systématiques, conforme au motif déjà établi
- [x] 23.3 Dette du backlog : issue #10 recomptée — 44 items clos / 6 ouverts (sur 50 suivis), chacun des 6 relié à une issue de suivi dédiée (pas un flou générique)
- [x] 23.4 Cohérence des textes : grep positionnement (« 100% local », « aucun compte »...) — cohérent, pas de contradiction trouvée
- [x] 23.5 Poids et dépendances : 5 dépendances directes (`better-sqlite3`, `express`, `fit-file-parser`, `leaflet`, `node-html-parser`), chacune déjà justifiée dans son historique d'adoption — rien de nouveau

## Epic 25 — Stratégie d'automatisation des tests

- [x] 25.1 Inventorier les couches existantes (unitaires, lint, audit, démo, Docker, Playwright, nightly, monkey, mutation, agents) avec quand/bloquant/réseau — `docs/TESTING.md` (PR #361)
- [x] 25.2 Lister les trous connus (pas d'E2E en CI, données jamais re-mesurées, pas de comparaison au kilométrage de course, pas de test de charge)
- [x] 25.3 Décidé le 17/10/2026 : Playwright minimal en CI (fait, PR #367) ; régénération périodique et champ `race_km` non retenus pour l'instant

## Epic 26 — Revue d'architecture (persona architecte logiciel)

- [x] 26.1 Revue de l'architecture actuelle (couplage, points de défaillance, évolutivité SQLite/PWA, monétisation par clé API) — `docs/ARCHITECTURE-REVIEW.md` (PR #362), propositions seulement
- [x] 26.2 R4 attributions/licences : BRouter cité, redistribution réelle de la démo Pages documentée (PR #363, complète #341)
- [x] 26.3 Bug trouvé par la revue : étape bloquée en `generating` après un crash → remise en erreur au démarrage (PR #364)
- [x] 26.4 R2 (PR #369) et R3 (PR #371) mergées ; R1 suivie en 27.4
- [x] 26.5 Décidé le 17/10/2026 : R5 (API `/v1` à clés) et lecture hors-ligne PWA différées — aucun besoin d'exposition publique exprimé

## Epic 27 — Dette technique issue de la revue d'architecture (règle 15 : autonomie)

- [x] 27.1 Schéma SQLite versionné (`PRAGMA user_version`, migrations numérotées, `settings` dans `db.js`) — PR #369 ; base réelle de `main` migrée v0→v2 sans perte
- [x] 27.2 `backend/server.js` découpé en `backend/routes/*` + `apiHelpers.js` (1 004 → 113 lignes) — PR #371 (empilée sur #369, intègre #364) ; 30 routes GET identiques au différentiel, 39/39 routes à la relecture
- [x] 27.3 Test E2E navigateur en CI (8 écrans × 1440/375 px, contenu rendu exigé, erreurs tardives, débordement) — PR #367 (empilée sur #361), job `e2e` vert sur GitHub Actions
- [x] 27.4 R1 : rôle admin en mode public, jeton d'amorçage, connecteurs couverts — PR #388 (deux relectures adverses)

## Epic 28 — Bugs de géocodage et de curation ouverts en issue

- [x] 28.1 Issue #224 : départ/arrivée curé au sommet — coordonnées et altitude de `known_cols` (PR #374) ; 4 arrivées gagnent leur altitude attendue, 2020/17 vérifiée en réel
- [x] 28.2 Issue #248 : Col du Lautaret figé sur le vrai col (PR #375) ; 1919/11 révèle son vrai écart (-14,1 %), masqué jusqu'ici par l'homonyme isérois
- [x] 28.3 Issue #225 : Col de la Colmiane figé sur le col routier (Col Saint-Martin, 1500,7 m) (PR #376)
- [x] 28.4 1919/11 curée : 329,3 km (+1,3 %), 3 cols au bon point, 0 aller-retour — PR #377 (empilée sur #375)
- [ ] 28.5 **blocked** — Curer 2020/2 : aucune source détaillée trouvée le 17/10/2026 (pas de GPX cyclingstage pour 2020, dossier de presse LCL et Wikipédia limités aux 3 cols, pas de roadbook dimensionsvelo) ; reconstituer les liaisons entre vallées ne serait que de l'inférence géographique sur 186 km de montagne — critère « roadbook sourcé » non atteignable
- [x] 28.6 Issue #280 : pickFeature préfère le nom exact parmi les reliefs — PR #378 ; différentiel réel sur 95 occurrences : 92 identiques, Aravis 1911/5 corrigé, Ballon d'Alsace figé pour ne pas régresser
- [ ] 28.7 **en cours** — Issue #188 : Tour 2002 — 14 et 16 curées (PR #380) ; restent 2002/13 (+9,8 %), 2002/19 (-6,6 %), 2002/20 (-48 % : `laps` disponible, mais nombre de tours de 2002 introuvable dans les sources consultées)
  - 21/10/2026 : ledicodutour.com, inaccessible depuis l'environnement cloud, répond depuis le poste local ; les profils 2002-13a, 2002-19a et 2002-20a ont été relus agrandis. Les vias de 2002/13 et 2002/19 dans `historic_routes.json` en sont déjà tirés, et leurs écarts restants ont une cause notée (aller-retour réel vers la Badourade, Charnay-lès-Mâcon au km 41,5 à 2,3 km de Mâcon). Le profil 2002/20 n'imprime pas les passages sur la ligne : après « Hauts des Champs » (km 80), il n'y a plus que l'arrivée. Compter les bosses du profil serait une inférence. Les sources consultées divergent aussi sur la longueur du tour : cyclingnews (compte rendu de l'étape) écrit « just over a lap (8 km) to go », alors que la source citée pour 1992 donne 6,5 km. `laps` reste donc non renseigné pour 2002/20 : il faut une source primaire sur le nombre de tours.

## Epic 29 — Inventaire matériel (issue #228, phase 7) — PR #394

Périmètre déjà tranché avec l'utilisateur dans #228 (« inventaire matériel :
inclus »). Une seule instance, données partagées comme le reste des traces
(aucun cloisonnement par compte n'existe dans ce dépôt).

- [x] 29.1 Migration 7 : table `gear` (nom, type vélo/chaussures/autre, retiré) et `stages.gear_id` (clé étrangère, `ON DELETE SET NULL`) ; empreinte figée dans `test/dbMigrations.test.js`
- [x] 29.2 API `GET/POST/PUT/DELETE /api/gear`, chaque champ validé avant SQL (règle 8) ; cumuls par matériel calculés sur les seules traces importées terminées (`tracks.router = 'trace'`), durée totale `null` et compteur « chronométrées » quand aucune sortie n'a d'horodatage (règle 10)
- [x] 29.3 `PUT /api/traces/:id/gear` : refusé (404) pour une étape qui n'est pas une trace importée, 400 pour un matériel inexistant ; `null` détache
- [x] 29.4 Sauvegarde portable : `gear` exporté et restauré avant `stages` (ordre des clés étrangères) ; une ancienne sauvegarde sans `gear` se restaure toujours
- [x] 29.5 Mode public : suppression d'un matériel réservée à l'admin (comme `DELETE /api/stages/:id`) ; nom affiché échappé partout (règle 1)
- [x] 29.6 Écran « Mes traces » : section Matériel (liste + cumuls, ajout, renommage, retrait) et choix du matériel par sortie récente ; vérification Playwright avant/après (360 et 1440 px)
- [x] 29.7 Relecture adverse : 4 défauts fonctionnels corrigés — association limitée aux 20 sorties récentes (liste complète `GET /api/gear/traces`), réponses hors ordre (compteur de séquence), bilan dépendant de `/api/auth/me` (droit calculé une fois, échec = non), section invisible avant la première trace (carte à part) ; aucune faille de sécurité trouvée

## Epic 30 — Fréquence cardiaque des traces importées (issue #228, phase 5)

Prérequis de #228 vérifié le 17/10/2026 sur les données réelles de
l'utilisateur (Strava, lecture seule) : une sortie vélo porte un flux de
fréquence cardiaque et de température, ni puissance ni cadence — d'où une
story limitée à la FC. Les zones (modèle, FC max de référence) sont un choix
produit : 30.5 attend une décision.

- [x] 30.1 Lecture de la FC à l'import : GPX (extension `…:hr`, tout préfixe), FIT (`heart_rate`), Strava (flux `heartrate`) ; valeur hors 25–250 bpm = absente, jamais 0
- [x] 30.2 Migration 8 : `elevation_samples.hr_bpm` (valeur du point brut le plus proche en abscisse, jamais interpolée), `stages.avg_hr_bpm`/`max_hr_bpm` ; moyenne et max `null` si moins de la moitié des points bruts portent une FC (règle 10)
- [x] 30.3 Fiche étape : tuiles FC moyenne/max et courbe de FC par distance, seulement pour une trace qui en porte ; aucun changement pour les autres étapes (Playwright avant/après)
- [x] 30.4 Sauvegarde portable et exports : FC incluse dans les exports bruts de ses propres données (sauvegarde portable, `export.json` de la fiche) ; absente des formats faits pour être partagés — GPX/TCX/KML, export HTML, roadbook, mini-sites (donnée de santé)
- [x] 30.6 Relecture adverse : fuite de la FC dans la démo statique (`scripts/build-site.js`, `SELECT *` et `loadStageFull`) corrigée et testée par un vrai build ; courbe mesurée section masquée (texte illisible sur mobile) ; FC lue hors `<extensions>` ; repli Strava si le flux `heartrate` est refusé (comportement réel non vérifié faute d'activité sans capteur testée — règle 9)
- [x] 30.5 Décidé le 18/10/2026 : FC max **saisie** par l'utilisateur, 5 zones en % de la FC max (50-60, 60-70, 70-80, 80-90, 90-100) ; temps passé par zone sur la fiche d'une trace horodatée avec FC (dépend de 31.2) — `GET/PUT /api/profile` (modification réservée à l'admin en mode public), calcul côté fiche, intervalle > 10 min non compté et affiché comme tel ; relecture adverse : plage affichée et calcul divergeaient d'un bpm pour certaines FC max (187) — bornes entières partagées, test balayant toutes les FC max 100–240 × tous les bpm ; FC max hors sauvegarde portable (comme tout `settings`), à ressaisir sur une nouvelle instance

## Epic 31 — Segments et temps comparés (issue #228, phase 6) — en attente de décision

Périmètre accepté dans #228 (« segments : inclus »), mais la forme n'a pas
été tranchée et elle engage le modèle de données. Constat fait dans le code
le 17/10/2026, avant toute proposition :
- aucun temps n'est conservé par point : `elevation_samples` n'a que la
  distance (l'horodatage brut sert seulement à `pipeline/rideStats.js` puis
  il est jeté) ; mesurer un temps sur une portion exige donc d'abord une
  colonne de temps par échantillon (migration), quelle que soit l'option ;
- les côtes détectées (`climbs`) portent déjà un nom et des bornes en km, et
  le bilan les regroupe déjà par nom (« gravi N fois ») ;
- une même côte peut changer de nom d'un import à l'autre (géocodage
  inverse, `name_source`), donc un regroupement par nom seul est fragile.

Options :
- **A — Côtes = segments.** Temps de montée de chaque côte détectée,
  meilleur temps et historique par côte, appariées par position du sommet
  (rayon ~150 m) plutôt que par nom. Pas de saisie, réutilise `climbs` ;
  ne couvre ni le plat ni une portion choisie par l'utilisateur.
- **B — Segments tracés à la main.** L'utilisateur choisit un départ et une
  arrivée sur une de ses traces ; chaque trace qui passe par les deux points
  (dans l'ordre, à ~30 m près) produit un effort. Le plus proche de Strava,
  mais une table `segments` + `segment_efforts`, un écran d'édition et une
  détection de passage à écrire et à fiabiliser.
- **C — A puis B.** A d'abord (peu de surface, profite tout de suite des
  imports existants une fois le temps stocké), B ensuite si le besoin
  demeure.

Recommandation : C. Prérequis commun aux trois : stocker le temps écoulé par
échantillon à l'import (une migration, aucun effet sur les étapes routées).
Les imports déjà faits n'ont pas ce temps : ils ne pourront être comptés
qu'après réimport, ce qui sera affiché, jamais deviné.

- [x] 31.1 Décidé le 18/10/2026 : option C (A d'abord, B ensuite si le besoin demeure)
- [x] 31.2 Temps écoulé par échantillon à l'import (`elevation_samples.elapsed_s`, migration 9) : temps du point brut le plus proche en abscisse, jamais interpolé ; `null` pour toute étape routée ou trace sans horodatage ; absent des formats partageables et de la démo statique (même règle que la FC)
- [x] 31.3 Option A : temps de montée de chaque côte d'une trace horodatée, côtes appariées entre sorties par la position du sommet, meilleur temps et historique par côte dans « Mes traces » ; une trace importée avant 31.2 est signalée « sans temps », jamais estimée — `pipeline/climbEfforts.js`, `GET /api/traces/climb-efforts` ; relecture adverse : sur une boucle repassant au pied, le départ était pris pour le pied (temps faux, non signalé) → dernier passage au pied + longueur de référence exigée ; montée multiple dans une sortie numérotée ; coût mesuré ~0,5 s pour 300 traces × 1 000 échantillons × 8 côtes, sans cache (à surveiller)

## Epic 32 — Recherche par lieu : « un Tour est-il passé près de ce village ? »

Question d'origine du projet, rappelée par l'utilisateur le 18/10/2026
(« un Tour de France est-il passé près de Porcelette, et en quelle année ? »).

- [x] 32.1 `pipeline/placeSearch.js` + `GET /api/search/near?q=&radiusKm=` : géocodage du lieu, puis trois sources par ordre de confiance — tracé reconstitué en base, points de passage en base, points curés de `historic_routes.json` (même édition non importée) ; la plus fiable l'emporte pour une même étape ; couverture toujours renvoyée
- [x] 32.2 Archives : « Le Tour est-il passé près de chez vous ? » — distance, base de calcul (tracé, point, estimation en ligne droite), lien vers l'étape si elle existe ; un « aucun résultat » est affiché comme tel, jamais comme une preuve d'absence
- [x] 32.3 Hors ligne : un lieu inconnu du simulateur (position inventée) est refusé, jamais cherché (règle 12)
- [x] 32.5 Relecture adverse : homonymes choisis au hasard (« Saint-Martin » → deux communes différentes selon l'appel ; « Sainte-Croix » → une voïvodie polonaise) → index des communes IGN, choix proposé avec le département ; segments droits jusqu'à 57 km (« 0 km » au milieu d'une vallée non parcourue) → plafond 10 km ; lieu inconnu en ligne 500 → 404 ; ~0,7 s bloquantes par recherche pour 2 300 étapes → tracés parsés mis en cache
- [x] 32.4 Couverture de toute l'histoire : `pipeline/data/stage_towns.json` (118 éditions, 2 467 étapes, Wikipédia CC BY-SA) construit par `scripts/build-stage-towns.js` — villes de départ/arrivée géocodées (index des communes IGN, sinon géocodeur général avec le pays), puis **vérifiées par la longueur des étapes** : une position qui contredit la distance d'une étape voisine est corrigée par le seul candidat compatible et plausible, sinon retirée (10 retraits, 4 étapes contradictoires entre villes fiables listées). Erreurs attrapées : Charleroi en Dordogne, Genève en France, « Brest Region » en Biélorussie, Barcelone mal placée ; dans la recherche, distance à la ville seulement, signalée

- [x] 32.6 Relecture adverse du jeu de données (géocodage inverse de 858 positions) : ≈ 0,8 % de positions fausses de plus de 20 km que la contrainte de longueur ne voyait pas (Les Menuires à Romans-sur-Isère, Luxembourg-Ville à Nommern, Méribel = un arrêt de bus près de Sallanches, Champs-Élysées à Bourgoin) → contre-vérification Nominatim de toute position hors index des communes : accord à 10 km = confirmée ; désaccord = remplacée seulement si la seule plausible, sinon `douteux` et **exclue de la recherche** ; lieux nommés seulement (jamais rue, arrêt, bâtiment). Demi-étapes (a/b/c, 114 étapes) masquées → clés suffixées. `NOTICE.md` : attribution CC BY-SA + IGN + ODbL. Bilan : 4 799 positions confirmées, 49 corrigées, 65 douteuses exclues, 18 absentes.

Réponse vérifiée pour Porcelette (18/10/2026) : **1992, étape 10 (Luxembourg → Strasbourg)**, road book : Boulay-Moselle → Boucheporn → Longeville-lès-Saint-Avold ; tracé routé (OSRM) entre ces points à ~3,6 km du centre du village (Nominatim) ; la recherche donne 4,0 km depuis le chef-lieu de la commune (index des communes IGN), en ligne droite entre Boucheporn et Longeville. Avec la couverture complète (32.4) : aucune autre étape à moins de 10 km ; à 20 km, le départ de 1970/9 à Sarrelouis (18 km, ville de départ seulement).

## Epic 33 — Itinéraires détaillés : tous les villages traversés

Demande du 18/10/2026 : « cure moi en détail les Tours de France ». Les
villes de départ/arrivée (Epic 32.4) ne disent pas par où l'étape est
passée ; le profil officiel de chaque étape (Dico du Tour) liste les villes
et côtes traversées avec leur kilomètre.

- [x] 33.1 Socle + 1992/10 : `pipeline/data/stage_itineraries.json`
  (transcription manuelle, source citée par étape), `scripts/geocode-itineraries.js`
  (un point n'est placé que s'il est atteignable depuis le précédent dans
  l'écart de km du profil, +3 km — +10 km depuis le km 0, le départ réel
  pouvant être hors du centre-ville (1992/10 : Hesperange) ; sinon sans
  coordonnées ; position ambiguë signalée à l'affichage), source « itinéraire » dans la recherche par lieu, prioritaire
  sur la curation, avec le km du profil et un lien vers le profil.
  Critères : Porcelette → 1992/10 près de Longeville-lès-Saint-Avold (km 83,5),
  profil cité ; un point non placé coupe le segment ; une côte placée au
  village éponyme n'entre pas dans le calcul ; homonyme lointain écarté (test).
  Leçon : la première transcription, faite de mémoire sur une image non
  agrandie, citait Bouzonville, Boulay et Boucheporn — absents du profil
  agrandi. Toute transcription se fait sur l'image agrandie.
- [ ] 33.2 Transcription édition par édition (une PR par lot), en
  commençant par les éditions passées par la Lorraine.
  - [x] Lot Lorraine (PR #404) : 14 étapes (1970/9, 1978/20, 1979/12-13, 1980/2-3,
    1985/8, 1990/6, 1999/7-8, 2002/2-3, 2006/2, 2012/6), 235 points placés
    sur 239 (Fresse-sur-Moselle 1979/13 retirée en relecture : km imprimé
    sous le libellé voisin). Porcelette : 1970/9 passe par Carling (km 18) et Saint-Avold
    (km 25,5), à 4,3 km — réponse que les villes de départ/arrivée seules
    ne donnaient pas. Un point n'est repris que si son km est lisible sans
    doute (`partial` sinon). **Non transcrits** : les profils 1951-1967 du
    lot (1951/1, 1952/6-7, 1953/1-2, 1955/4-5, 1957/6-7, 1959/1-2,
    1961/4-5, 1964/4, 1967/6-7), dont les km en italique sont illisibles à
    la résolution publiée — source à trouver (Gallica, Epic 34.12).
    Absents du Dico du Tour : 1950/1-2.
  - [x] Édition 1992 (PR #405) : 19 nouvelles étapes, soit 20 sur 22 (prologue et 9e étape,
    contre-la-montre à Saint-Sébastien et Luxembourg, sans profil publié),
    341 points placés sur 357. Seuls les km lisibles sans doute sont
    repris ; Vougy et Cluses (1992/12) retirés, leur km contredisant la
    distance réelle. Géocodage : la commune IGN compatible l'emporte
    désormais sur un résultat Nominatim moins détourné (Grenoble était
    placée à 10 km au sud ; Dieuze, 1990/6, corrigée de 4 km) ; un
    lieu-dit placé au centre de sa commune (Gavet, L'Alpe d'Huez,
    Bordeaux-Lac…) est écarté de la recherche, comme une côte.
    Relecture adverse : « Marlhes » (1992/15) était « Marlhoux » sur
    l'image, point retiré ; Vovray (1992/12) placé sur la commune
    Vovray-en-Bornes (7 km au sud) puis sur un homonyme de l'Ain, fixé au
    hameau d'Archamps ; une commune IGN trouvée par préfixe ne prime plus
    sur les autres sources.
  - [x] Édition 1993 (PR #406) : 20 étapes sur 21 (prologue du Puy du Fou, 6,8 km,
    sans km lisibles par point), 315 points placés sur 332. Col de Jau
    fixé au vrai col (Nominatim proposait aussi une route 10 km à l'est,
    retenue à tort comme « moins détournée ») ; communes déléguées placées
    au chef-lieu de leur commune nouvelle (Boufféré, Le Château-d'Olonne…)
    classées lieux-dits, donc hors recherche.
    Relecture adverse : Bagnères-de-Bigorre (1993/17) était au centroïde
    de sa commune IGN, 7,7 km au sud dans la montagne — replacée sur la
    ville ; départ de 1993/12 replacé au village d'Isola (était à Isola
    2000) ; « La Bounette » gardé tel qu'imprimé (vraisemblablement La
    Bolline). Les listes ne reprennent pas tous les points du profil
    (ex. 1993/12 : Côte des Glaciers, Côte de Périer) : « N points » compte
    les points transcrits, pas ceux de l'image.
- [x] 33.3 (PR #407) Bourg plutôt que centroïde : l'index IGN des communes donne le
  centre géographique de la commune, pas le bourg (Bagnères-de-Bigorre à
  7,7 km, Laruns 4,2, Allemond 4,1). Une commune IGN au nom exact est
  recalée sur le point OpenStreetMap du même nom à moins de 8 km
  (`snapToTown`) ; 91 points déjà en base recalés de 1,5 à 5,4 km. Seuls
  les points OSM de localité comptent (city/town/village/hamlet/
  municipality) : la relecture adverse a trouvé Pontorson recalé sur un
  « city_district » (2,4 km de la mairie) et Apremont-la-Forêt idem.
  Pas de recalage pour un point géocodé sous un autre nom (geocodeAs, 84
  points dont 28 villes) : le nom cherché peut être une commune nouvelle
  dont le point OSM n'est pas le bourg (Lamballe-Armor) — ces points
  restent au centroïde IGN, limite connue. Porcelette inchangée : 1970/9
  à 4,2 km, 1992/10 à 5,3 km.
- [x] Édition 1994 (PR #408) : 21 étapes sur 22 (prologue de Lille, rues seulement),
  279 points placés sur 293, dont les deux étapes anglaises (Douvres →
  Brighton, Portsmouth). Erreur trouvée dans `stage_towns.json` : l'arrivée
  « Eurotunnel » de 1994/3 était au terminal de Folkestone (Angleterre) ;
  le profil place toute l'étape dans le Pas-de-Calais — arrivée replacée
  au terminal de Coquelles (`confidence: verifie`). Elle bloquait le
  géocodage de 8 points sur 11.
  Relecture adverse : Noyant-la-Plaine rattachée à tort à Terranjou
  (commune voisine, 6 km) — c'est Tuffalun ; Winchester et Ashford étaient
  au centroïde de leur district anglais (5,7 et 4,5 km), Winchester faisait
  rejeter Andover (désormais placé) ; trois hameaux des Belleville
  superposés au centroïde de la commune, replacés. Étapes dont la
  transcription omet des points du profil marquées `partial` (avec leur
  longueur, la contrainte d'arrivée reste appliquée).
- [x] Édition 1995 (PR #409) : 20 étapes sur 21 (prologue de Saint-Brieuc non
  transcrit), 296 points placés sur 321. Limoges (arrivée de 1995/18),
  recalée sur son centre-ville, était rejetée à 3,9 km de l'ancre
  `stage_towns` (un centroïde IGN). Premier correctif (marge d'arrivée
  portée à 10 km) refusé en relecture adverse : il aurait placé Val
  Thorens au centroïde des Belleville (9,6 km). Correctif retenu : la
  ville d'arrivée prend la position vérifiée de `stage_towns`, la marge
  reste à 3 km pour les autres points. Relecture : Rochetaillée, Livet,
  Mareuil et Auphelle replacés sur le hameau (étaient au centroïde de leur
  commune) ; libellés de l'image restaurés ; étapes 11, 13, 16, 18
  `partial` avec leur longueur, 10 et 12 complètes.
- [x] Édition 1996 (PR #410) : 20 étapes sur 22, 293 points placés sur 316 (283 sur 308 avant le tri 33.12).
  Non transcrits : le prologue de 's-Hertogenbosch et l'étape 9 — le
  profil publié (Val d'Isère → Iseran → Galibier → Sestrières, 189,5 km)
  est le parcours prévu, pas l'étape courue, raccourcie par la neige
  depuis Le Monêtier-les-Bains. Tilburg et Sint-Niklaas placés sur la
  ville (le candidat retenu était la commune élargie, comme Winchester en
  1994). 1996/19 : Mios, Pessac et Talence non placés — les km du profil
  entre Biscarrosse (159) et Bordeaux (226,5) sont plus courts que la
  ligne droite, donnée incohérente laissée telle quelle.
  Gand (1996/2) non placé pour la même raison (31,5 km à vol d'oiseau de
  Sint-Niklaas pour 26 km de profil). Relecture adverse : Kronenburg,
  La Serre et « Besançon (entrée) » ajoutés (omis à la transcription) ;
  arrivée Superbesse-Sancy placée sur l'ancre `stage_towns` ;
  Rosières-sur-Mouzon (graphie du profil) placée sur Rozières-sur-Mouzon ;
  libellés de l'image restaurés (« Goussancourt (près de) », « Alto de
  Ibaneta »…) ; 1996/7 n'est plus `partial`. Non placés parce que le
  km du profil contredit la géographie, laissés tels quels : Ieper et
  Mons (1995/6), Luchon et Cazaux-Layrisse (1995/15). Dourgne (1995/13)
  non repris : km imprimé « 119,5 » entre Castres (198) et Revel (245).

- [x] Édition 1997 (PR #477) : 21 étapes sur 22, 350 points placés sur 357
  (prologue de Rouen non transcrit : des rues seulement, comme 1994-1996).
  Non placés, avec note : côtes des forêts d'Eawy et d'Eu, Saint-Colomban,
  Andorre, Méribel, côte des Rosselières, Paris (1997/21). 19 côtes
  rattachées à leur lieu éponyme (`geocodeAs`), non routées. Contrôlée à
  ±5 % sur un BRouter auto-hébergé, 0 tronçon en voiture : 16 étapes dans la
  tolérance, 4 hors, cause écrite dans la note — 1997/1 (−11,1 % : détour
  de 18 km par les forêts d'Eawy et de Torcy, non routables), 1997/14
  (−7,3 % : 11,5 km de fond de vallée entre Saint-Étienne-de-Cuines et La
  Chambre, à 2 km l'une de l'autre), 1997/18 (−5,3 % : détour de 8 km après
  le col du Hundsruck), 1997/20 (−13,8 % : boucle par la côte de
  Coulommiers, sommet inconnu) ; 1997/21 non contrôlable (circuit des
  Champs-Élysées). Allers-retours corrigés (9 points) : Huez (église
  Saint-Ferréol), La Léchère, Bonneval et Loulans (mairies, règle 17), La
  Perrière (village), Ballon d'Alsace (jonction sous le col, 1 060 m
  imprimés), pont de Brotonne (tête sud), arrivée de 1997/14 à l'altiport
  de Courchevel (2 004 m imprimés). Restent 3 allers-retours avec le point
  à la mairie, notés (Trouville-Alliquerville, Saint-Malo-du-Bois,
  Grumesnil). Règles 22 à 24 ajoutées à CURATION-REGLES.

- [x] Édition 1998 (PR #478) : 19 étapes sur 22, 136 points placés sur 141.
  Non transcrits : le prologue de Dublin (rues), 1998/12 (profil de 222 km,
  ni l'étape prévue — 206 km — ni l'étape courue — 190 km, d'après
  en.wikipedia) et 1998/17 (annulée, grève des coureurs). Noms sans km
  imprimé dans les notes d'étape (règle 4). Non placés, avec note : côtes
  de Curtiswood, de la Secourette, des Treize Vents, de Bournas, pointage
  du Creusot (1998/20). 6 côtes rattachées à leur village (altitude du
  village loin du sommet imprimé). Contrôlée à ±5 % sur BRouter
  auto-hébergé, 0 tronçon en voiture, aucun aller-retour : 12 étapes dans
  la tolérance, 6 hors, cause écrite dans la note — 1998/1 (−11,9 %),
  1998/3 (−6,9 %), 1998/7 et 1998/20 (contre-la-montre, −28,8 % et
  −43,2 %), 1998/8 (−11,3 % : trois côtes rattachées non routées ; 107,4 km
  par leurs villages pour 105,5 au profil), 1998/13 (−6,5 %) ; 1998/21 non
  contrôlable. Corrigés au contrôle : Gavet (centre de la commune fusionnée
  à 1 037 m pour 470 imprimés), côte de Montaigu-de-Quercy (lieu-dit
  « La Côte » pris par le géocodeur), arrivée de Luchon à la mairie
  (l'ancre `stage_towns` est à 5,6 km de la ville, story à part), altitude
  « 1 » des Deux Alpes (catégorie, pas altitude).
- [x] Édition 1999 (PR #499) : 18 étapes ajoutées, 20 sur 21 (1999/7 et 8, du lot
  Lorraine, déjà faites ; prologue du Puy du Fou non transcrit, des rues
  seulement), 206 points placés sur 217, depuis les profils agrandis de
  ledicodutour.com (`99_Na.jpg`). Non placés, avec note : Pornic,
  Château-Gaillard, entrée de Laval, côtes du Procureur, de Fendeille, de
  Chaudes-Aigues, de Cambargue, de Compolibat, de Saint-Rémy ; côtes de
  Limay et de Védrines-Saint-Loup retirées (règle 14). Contrôlée à ±5 % sur
  BRouter public, chaque contrôle avec un tronçon en voiture annulé et
  relancé : 0 tronçon en voiture, aucun aller-retour ; 14 étapes dans la
  tolérance, 3 hors, cause écrite dans la note — 1999/2 (−7,1 %), 1999/12
  (−12,1 %), 1999/19 (contre-la-montre, −16,1 %) ; 1999/20 non contrôlable.
  Corrigés à l'audit Mireille : côte du Port de la Besse replacée côté Tarn
  (La Besse), côte de Duron à Durou (variante, ambigu), arrivée des
  Champs-Élysées sur l'avenue et non au centre de Paris, allers-retours
  d'Onzain et de Pamproux corrigés à la mairie (règle 17).

- [x] Édition 2000 (PR #500) : 21 étapes sur 21, 155 points placés sur 162,
  depuis les profils de ledicodutour.com (`00_N.jpg`, 468 px, sans
  altitude imprimée ; lus au triple). Noms sans km imprimé en note
  (règle 4) : col d'Izoard, côte de Saint-Ferréol. Non placés, avec note :
  carrefour D62-D757 (aller-retour imposé), côtes de Maison-Neuve, de
  Lausanne, de Waldhof et d'Alun, Villefranche-de-Lauragais (24,3 km de
  Revel pour 20,5 au profil), second passage au haut des Champs-Élysées.
  Contrôlée à ±5 % sur BRouter public, chaque contrôle avec un tronçon en
  voiture annulé et relancé : 0 tronçon en voiture ; 12 étapes dans la
  tolérance, 9 hors, cause écrite dans la note avec la comparaison
  vélo / voiture — 2000/1 (contre-la-montre, −65,2 %), 2 (−9,2 %),
  3 (−9,0 %), 6 (−5,9 %), 11 (−8,4 %), 12 (−11,0 %), 14 (−5,7 %, Izoard
  non repris), 17 (−12,3 %), 21 (−86,4 %, boucle dans Paris). Seul
  aller-retour restant : col de Joux-Plane (2000/16), artefact du routeur
  noté (−5,0 % sans lui). Corrigés à l'audit Mireille : La Roche de Grès
  placée (Brains), départs de Bagnères-de-Bigorre, Limoges, Avignon et
  Vitré à la mairie (règle 25 ajoutée), Dompierre au village.

- [x] Édition 2001 (PR #501) : 19 étapes sur 21, 132 points placés sur 139,
  depuis les profils de ledicodutour.com (`2001-Na.jpg`, 468 px, altitudes
  imprimées ; lus au triple). Non transcrits : le prologue de Dunkerque
  (rues) et 2001/11, contre-la-montre de Chamrousse (aucun profil publié).
  Noms sans km imprimé en note (règle 4) : Stekene, côtes du Cap Gris-Nez,
  des Forges, du Sart-Tilman, de Void-Vacon, de Saint-Adrian, col du
  Chioula, Dinsheim, Montbenoît, Rumilly, Le Bourg-d'Oisans, Budelière,
  Itteville. Non placés, avec note : Sainte-Marie-aux-Mines (7,8 km de
  Lièpvre pour 4), côtes de Saint-Hippolyte, de Pralon, de la Tricherie, du
  Puntous, de Lostanges, de la Forêt de la Feuillade. Altitude contrôlée
  point par point (règle 14 complétée). Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 9 étapes dans la tolérance, 10 hors, cause écrite
  dans la note avec la comparaison vélo / voiture ; allers-retours du
  routeur notés à Mont-Theux (2001/3, −8,3 % sans lui) et au col du
  Calvaire (2001/7, −9,0 %). Corrigés à l'audit Mireille : Stekene sans km
  (étiquette décalée, règle 3 complétée), Les Escures sur la D940
  (Altillac), notes de Mont-Theux, Lostanges et du Puntous, côtes de
  Rozeille et de Bossy en ambigu.

- [x] Édition 2002 (PR #512) : les 18 étapes en ligne qui manquaient
  (2002/2 et 3 sont déjà transcrites par le lot Lorraine ; prologue de
  Luxembourg non transcrit, des rues seulement), 191 points placés sur
  213, depuis les profils de ledicodutour.com
  (`cartes_etapes/2002/2002-Na.jpg`, 468 px, altitudes imprimées, lus au
  triple). Altitude contrôlée point par point (règle 14), Luxembourg sur
  EU-DEM. Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture : 13
  étapes dans la tolérance, 6 hors, cause notée — 2002/1 (−15,1 %, −11,1 %
  en voiture : côtes de Vianden et de Hostert non placées), 2002/2
  (−11,8 %, du lot Lorraine, −5,7 % en voiture), 2002/8 (−7,9 %, −6,3 % en
  voiture), 2002/9 (−8,2 %, −4,3 % en voiture), 2002/18 (−7,2 %, +2,8 % en
  voiture : le routeur vélo coupe), 2002/19 (−10,4 %, −7,4 % en voiture) ;
  2002/20 non contrôlable (circuit des Champs-Élysées, nombre de tours non
  sourcé). Les vias de `historic_routes.json` (Epic 28.7) ne changent
  pas ; la Badourade, les Bois de Serves et l'arrivée de La Plagne (Plagne
  Centre) en sont repris. Corrigés à l'audit Mireille : Fût d'Avenas à la
  bifurcation sous le col et La Chapelle-Urée à l'église (les deux « ok »
  obtenus avec un aller-retour disparaissent, règle 24), Génissiat placé
  (son refus reposait sur un point retiré), Igny-le-Jard à la mairie
  d'Igny-Comblizy ; col de Saint-Benoît (col de Dieudé, autre col) et
  lieu-dit Traverses retirés ; notes des tronçons à mairies vérifiées
  réécrites. Règles 9 et 21 de `docs/CURATION-REGLES.md` complétées.

- [x] Édition 2003 (PR #503) : 20 étapes sur 21 (prologue de Paris non
  transcrit, des rues seulement), 356 points placés sur 401, depuis les
  profils de ledicodutour.com (`03_NNb.jpg`, 468 px, altitudes imprimées ;
  lus au triple). Non placés, avec note : 23 carrefours de routes (Nominatim
  ne connaît pas les intersections), départ de Lyon (2003/7), Paray-le-Monial
  (km de Digoin vraisemblablement fautif), côtes sans lieu compatible ou à
  l'altitude incompatible (règle 14). Altitude contrôlée point par point.
  Contrôlée à ±5 % sur BRouter public, chaque contrôle avec un tronçon en
  voiture relancé : 0 tronçon en voiture ; 17 étapes dans la tolérance, 3
  hors, cause écrite dans la note avec la comparaison vélo / voiture —
  2003/1 (−10,3 %), 2003/19 (contre-la-montre, +14,4 %), 2003/20 (−19,8 %,
  boucle dans Paris ; aller-retour du routeur à la Bastille noté). Corrigés
  à l'audit Mireille : 2003/12 de +13,9 % à +1,1 % (Blaye-les-Mines au
  bourg, arrivée sur le site de Cap'Découverte), arrivée de 2003/20 sur les
  Champs-Élysées, Chousse, Iratzordoki et Logibar placés (variantes, règle
  21), Mérignac à la mairie, Saint-Julia retiré, départ de Toulouse à la
  Cité de l'Espace ; règle 25 complétée (départ réel hors de la ville).

- [x] Édition 2004 (PR #504) : 20 étapes sur 21 (prologue de Liège non
  transcrit, des rues seulement), 431 points placés sur 489, depuis les
  profils de ledicodutour.com (`04_NNb.jpg`, 468 px, altitudes imprimées ;
  lus au triple). Non placés, avec note : 21 carrefours de routes, entrées
  de ville, côtes sans lieu compatible ou d'altitude incompatible (règle
  14). Altitude contrôlée point par point. Contrôlée à ±5 % sur BRouter
  public, 0 tronçon en voiture : 16 étapes dans la tolérance, 4 hors, cause
  notée — 2004/1 (+8,2 %), 2 (+7,5 %), 5 (+5,9 %), km du profil plus courts
  que la route à vélo comme en voiture, et 16 (−6,3 %, contre-la-montre en
  montée). Corrigés à l'audit Mireille : 2004/14 de +6,4 à +3,5 % (centre de
  Montpellier retiré), 2004/19 de +6,8 à +2,3 % (arrivée à Micropolis),
  2004/16 de −15,5 à −6,3 % (Huez à l'église, arrivée avenue du Rif Nel),
  circuit d'arrivée de Guéret déclaré, Cap Fréhel retiré (aller-retour),
  arrivée de Paris sur les Champs-Élysées, Mesnois, Lajoux, Les Planchettes,
  le mémorial Casartelli, Les Planches et Dinan placés, Boutigny au village ;
  départs hors de la ville et km imprimés incohérents notés.

- [x] Édition 2005 (PR #505) : 21 étapes sur 21 (pas de prologue en 2005),
  459 points placés sur 524, depuis les profils de ledicodutour.com
  (`05_NNb.jpg` ou `05_NN_2.gif`, 468 px, altitudes imprimées ; lus au
  triple, zooms ciblés sur les colonnes serrées). Non placés, avec note :
  carrefours de routes, entrées de ville, côtes sans sommet localisé.
  Altitude contrôlée point par point (règle 14). Contrôlée à ±5 % sur
  BRouter public, 0 tronçon en voiture : 16 étapes dans la tolérance, 4
  hors, cause notée — 2005/4 (+8,4 %, km du profil plus courts que la
  route, vélo comme voiture), 2005/9 (−6,1 %, vallée du Chajoux non
  reconstituée), 2005/17 (+5,9 %, côte de Baleix non localisée), 2005/20
  (+5,1 %, +8,0 % en voiture) ; 2005/1 non contrôlable (contre-la-montre
  de Noirmoutier, km du profil décalés des bourgs, trop peu de points).
  Bühl (2005/8) était placé à Bühl dans le Bas-Rhin par le géocodage par
  commune : replacé dans le Bade, avec les villages de la vallée du Rhin
  côté allemand. Corrigés à l'audit Mireille : arrivée de Paris sur les
  Champs-Élysées (elle tombait au parvis Notre-Dame), Nachtigall et
  Zimmerplatz placées, Appenweier au village, Grand Ballon au col routier,
  La Chaise à la mairie, Le Bouinenc (la rivière) et Barbâtre retirés,
  côtes posées au village sous le sommet retirées (Baleix, Montigny,
  Joinville), notes de départ (règle 25), allers-retours et tronçons
  suspects notés. Longueur imprimée de 2005/10 (192,5 km) déclarée :
  Wikipédia donne 177 km.

- [x] Édition 2006 (PR #511) : 20
  étapes sur 21 (prologue de Strasbourg non transcrit, des rues seulement),
  485 points placés sur 559, depuis les profils de ledicodutour.com
  (`cartes_etapes/2006/06_NNb.jpg`, 468 px, altitudes imprimées, lus au
  triple, zooms ×9 sur les groupes serrés). 2006/2, déjà transcrite en
  partie par le lot Lorraine, est reprise en entier (6 points de plus),
  avec les positions déjà validées. Critères d'acceptation : chaque nom
  imprimé est transcrit avec son km ; l'altitude est contrôlée point par
  point (règle 14) ; le contrôle à ±5 % passe sur BRouter public avec 0
  tronçon en voiture, et chaque étape hors tolérance a sa cause notée ; le
  test d'invariant passe ; l'audit Mireille est fait avant la fusion.
  Fait : 17 étapes dans la tolérance, 3 hors, cause notée — 2006/7
  (+5,7 %, +6,6 % en voiture : profil plus court que le tracé),
  2006/19 (−9,1 %, −3,2 % en voiture : le routeur vélo coupe), 2006/20
  (−19,7 %, −10,3 % en voiture : tracé de banlieue sinueux non imprimé).
  Altitude : Laguinge, Anéran, La Giettaz et le 2e passage à
  Saint-Jean-de-Maurienne replacés (centres de commune en montagne) ;
  Rehthal, Saint-Sorlin-d'Arves, Verchaix et Verviers non placés (plus de
  100 m d'écart sans meilleur point) ; trou de couverture du MNT au centre
  du Luxembourg noté. « Dufort » relu « Durfort » au zoom ×9. Les km du
  profil 2006 sont souvent plus courts que la ligne droite entre bourgs
  pourtant placés à leur mairie : tronçons notés étape par étape (règle
  11). Corrigés à l'audit Mireille : Queige sur la D925 et côte de
  Châtillon-sur-Cluses au col (les deux allers-retours de 2006/17
  disparaissent, +1,4 % → −1,0 %), Engenthal-le-Bas à son arrêt et non
  plus rattaché, Gévaudaz placé sous l'orthographe OSM « Gevoudaz », Les
  Adrets sur la route des Adrets ; retrait du Cauberg requalifié (l'aller-
  retour vient de l'arrivée au centre de Valkenburg, ligne non sourcée) ;
  altitudes du Luxembourg contrôlées sur EU-DEM ; sept tronçons suspects
  de plus notés. Règles 14 et 21 de `docs/CURATION-REGLES.md` complétées.

- [x] Édition 2007 (PR #506) : 20 étapes sur 21 (prologue de Londres non
  transcrit, des rues seulement), 201 points placés sur 236, depuis les
  profils de ledicodutour.com (`07_NNa`, et `cols/2007/07_N.jpg` pour les 8
  étapes sans profil sur la page de l'édition ; 469 px, altitudes imprimées,
  lus au triple). Non placés, avec note : carrefours, entrées de ville,
  côtes sans sommet localisé. Altitude contrôlée point par point (règle 14).
  Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture : 12 étapes dans
  la tolérance, 6 hors, cause notée — 2007/2 (−7,5 %, +3,7 % en voiture),
  2007/5 (−6,8 %, trois côtes non placées), 2007/8 (−9,0 %, montée
  d'Hauteville non reconstituée), 2007/11 (−5,6 %, détour non imprimé avant
  Montpellier), 2007/12 (−8,4 %, quatre points non placés), 2007/19
  (−11,1 %, contre-la-montre) ; 2007/13 et 2007/20 non contrôlables
  (2007/20 partielle, sans arrivée : km d'arrivée et du circuit non
  imprimés). Angleterre et Belgique géocodées par pays. Corrigés à l'audit
  Mireille : Mesvres, Albertville, Tenterden et le départ de Dunkerque à la
  mairie, Haut-Folin sur la route, Cadarache (un réservoir) retiré, côtes
  posées au hameau au-dessus ou au pied du sommet retirées (Grandmont,
  Galbaux, Domecy), tronçons au profil contradictoire notés.

- [x] Édition 2008 (PR #507) : 21 étapes sur 21 (pas de prologue en 2008),
  251 points placés sur 269, depuis les profils de ledicodutour.com
  (`08_NNa.jpg`, `cols/2008/…` pour 9 étapes ; 470 px, altitudes imprimées,
  lus au triple). Non placés, avec note : côtes sans sommet localisé,
  entrées de ville. Altitude contrôlée point par point (règle 14). Contrôlée
  à ±5 % sur BRouter public, 0 tronçon en voiture : 14 étapes dans la
  tolérance, 7 hors, cause notée — 2008/2 (−16,9 %, tracé sinueux sans point
  imprimé), 2008/7 (−6,8 %), 2008/9 (−6,2 %, côte de Saint-Pey retirée),
  2008/11 (−15,7 %, boucle après le col del Bouich non imprimée), 2008/19
  (−5,2 %), 2008/20 (+6,0 %, contre-la-montre), 2008/21 (−5,4 %). Corrigés à
  l'audit Mireille : arrivée de Paris sur les Champs-Élysées (elle tombait
  au parvis Notre-Dame), Villanova Mondovì, Sampeyre, Demonte et Vinadio au
  village, Les Huguets (homonyme de Roussillon) et Saint-Pey (impasse)
  retirés, notes fausses corrigées, tronçons suspects notés. Melle, Aisone
  et Peveragno replacés au village avant l'audit ; Port de la Besse retiré.

- [x] Édition 2009 (PR #508) : 21 étapes sur 21 (pas de prologue en 2009),
  233 points placés sur 262, depuis les profils de ledicodutour.com
  (`09_NN_1.gif`, `cols/2009/…` pour 9 étapes ; 470 px, altitudes imprimées,
  lus au triple). Non placés, avec note : côtes sans sommet localisé,
  entrées de ville. Altitude contrôlée point par point (règle 14). Contrôlée
  à ±5 % sur BRouter public, 0 tronçon en voiture : 12 étapes dans la
  tolérance, 9 hors, cause notée — 2009/1 (−71,7 %, contre-la-montre de
  Monaco, deux points mesurables), 2009/2 (−5,4 %), 2009/3 (−5,7 %, côte de
  Calissanne retirée), 2009/4 (+10,0 %, contre-la-montre par équipes),
  2009/5 (−8,0 %), 2009/6 (−13,2 %, −0,7 % en voiture), 2009/11 (−9,8 %),
  2009/17 (−20,6 %, côte d'Arâches non reconstituée), 2009/21 (−8,8 %,
  −1,7 % en voiture). Arrivée de Paris sur les Champs-Élysées, Arles au
  centre-ville, villages valdôtains au village. Corrigés à l'audit Mireille :
  La Salle à Derby (sur la route), Calissanne (au pied) retirée, doublon de
  Tarascon non placé, Flumet à la mairie, notes d'arrivée non sourcée
  (Montpellier, Barcelone, Aubenas), notes fausses corrigées (Montredon,
  Saint-Bauzille, Arâches), tronçons suspects notés.

- [x] Édition 2010 (PR #509) : 20 étapes sur 21 (prologue de Rotterdam non
  transcrit : deux ponts seulement), 251 points placés sur 284, depuis les
  profils de ledicodutour.com (`10_NN_1.gif`, `cols/2010/…` pour 9 étapes ;
  470 px, altitudes imprimées, lus au triple). Non placés, avec note : côtes
  sans sommet localisé, entrées de ville. Altitude contrôlée point par point
  (règle 14). Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture : 12
  étapes dans la tolérance, 7 hors, cause notée — 2010/1 (−6,2 %, +2,9 % en
  voiture), 2010/2 (−14,2 %, boucles ardennaises non imprimées), 2010/3
  (−8,9 %, secteurs pavés rattachés à leur village), 2010/4 (−6,4 %), 2010/5
  (−8,1 %), 2010/15 (−5,9 %), 2010/19 (+5,8 %, contre-la-montre) ; 2010/20
  non contrôlable (circuit des Champs-Élysées). La Thuile (2010/9) était
  placée sur un sommet homonyme à 2 283 m. Corrigés à l'audit Mireille :
  arrivée de 2010/7 à la Station des Rousses (massif de la Serra, l'étape
  passe de +6,9 à −0,1 %), départ de 2010/8 à la mairie, Vercheny sur la
  D93, col du Gerbier de Jonc et hameau des Granges placés, Préfontaines,
  Cussac et Arcins à la mairie ; Basse-Bodeux, Saint-Servais, Lombers, côtes
  de Puylaurens et de Saint-Barthélemy et doublon de Braine-le-Comte
  retirés ; notes fausses corrigées (Cuq-Toulza, Zeeland au km 73, Renoir).

- [x] Édition 2011 (PR #510) : 21 étapes sur 21 (pas de prologue en 2011),
  219 points placés sur 233, depuis les profils de ledicodutour.com
  (`11_NN_1.gif`, `cols/2011/…` pour 9 étapes ; 470 px, altitudes
  imprimées, lus au triple). Altitude contrôlée point par point (règle
  14). Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture : 15
  étapes dans la tolérance (dont 2011/11, non probant : −2,2 % avec un
  aller-retour du routeur de 10,7 km à Larroque, règle 24), 5 hors, cause
  notée — 2011/2 (−29,8 %, contre-la-montre par équipes en boucle),
  2011/5 (−5,7 %), 2011/9 (−6,7 %, −9,1 % en voiture : tronçons plus
  courts que le profil), 2011/13 (−7,8 %), 2011/20 (−8,9 %,
  contre-la-montre) ; 2011/21 non contrôlable (circuit des
  Champs-Élysées). Arrivées de Mûr-de-Bretagne au sommet de la côte, du
  Plateau de Beille au parking, de Paris sur les Champs-Élysées ;
  Éraines (imprimé « Eraines ») et non Ernes. Corrigés à l'audit
  Mireille : côte de Laz placée au village (2011/4 passe de −8,8 à
  −1,8 %), col du Perthus placé sous l'orthographe « Col du Pertus »
  (les allers-retours incertains de 2011/9 disparaissent), col de la Core
  au col et non sur un terrain de loisirs, Vire et Vassy à la mairie,
  départ de Blaye-les-Mines à la mairie ; entrée de Montpellier (placée à
  Clapiers) et doublon de Spézet retirés ; `circuit_km` de 2011/21 à
  l'entrée du circuit (km 44) ; tronçons suspects notés (2011/3, 10, 16,
  17). Règle 21 de `docs/CURATION-REGLES.md` complétée (variante
  Perthus / Pertus, type `mountain_pass` d'un col).

- [x] Édition 2012 (PR #513) : les 19 étapes qui manquaient (2012/6 est
  déjà transcrite par le lot Lorraine ; prologue de Liège non transcrit),
  222 points placés sur 240, depuis les profils de ledicodutour.com
  (`cartes_etapes/2012/12_NN_pro.jpg`, 470 px, altitudes imprimées, lus au
  triple). Altitude contrôlée point par point (règle 14), Belgique et Suisse
  sur EU-DEM. Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture :
  10 étapes dans la tolérance, 9 hors, cause notée avec la comparaison en
  voiture — 2012/1 (−17,1 %, −19,1 % en voiture : boucles ardennaises et
  final de Seraing non imprimés), 2012/3 (−12,1 %, −5,2 %), 2012/6 (−6,1 %,
  du lot Lorraine, −3,8 %), 2012/8 (−11,9 % sur 68 %, −6,7 %, allers-retours
  du routeur au col de la Croix, règle 24), 2012/9 (−7,6 %, −3,9 %,
  contre-la-montre), 2012/10 (−8,2 %, −7,6 %), 2012/11 (−6,1 %, −5,2 %),
  2012/17 (−7,5 %, −5,7 %), 2012/19 (−5,9 %, −5,4 %, contre-la-montre) ;
  2012/20 non contrôlable. Côte de Burs et Béon retirés pour aller-retour.
  Altitude : La Toussuire reprise de 2006/16, Belmont à la mairie,
  Castelnau-Montratier non placé. Le profil de 2012/2 porte par erreur
  l'en-tête de l'étape 1. Corrigés à l'audit Mireille : côte de
  Saignelégier placée sans aller-retour, côte de Toussaint à la mairie,
  La Henne Morte placée (« Hennemorte »), côte de Bondeval (au pied)
  retirée, Haut des Champs-Élysées transcrit, `circuit_km` de 2012/20 à
  l'entrée du circuit ; tronçons suspects de 2012/2 et 16 notés avec la
  mesure en voiture.

- [x] Édition 2013 (PR #514) : 20 étapes sur 21, depuis les profils de
  ledicodutour.com (`cartes_etapes/2013/2013_NN_profil.png` ou
  `2013_NN.png`, 502 px, altitudes imprimées, lus au triple). Le
  contre-la-montre par équipes de Nice (2013/4) n'est pas transcrit : son
  profil n'imprime que Nice. 199 points placés sur 225. Contrôlée à ±5 %
  sur BRouter public, 0 tronçon en voiture : 13 étapes dans la tolérance
  (dont 2013/7, non probant : +2,3 % avec un tronçon de 28 km pour 14), 6
  hors, cause notée avec la comparaison en voiture — 2013/2 (−6,4 %,
  −6,5 % : arrivée d'Ajaccio vraisemblablement à l'ouest, non sourcée),
  2013/10 (−8,5 %), 2013/14 (−5,3 %, −2,4 % en voiture), 2013/17 (−30,0 %,
  contre-la-montre, côte de Réallon non placée), 2013/18 (−22,7 % :
  descente de Sarenne par La Ferrière non placée), 2013/19 (−7,5 %) ;
  2013/21 non contrôlable. En 2013/1, deux km imprimés sans nom : noms
  appariés par la distance (règle 3). Altitude : villages perchés et de
  montagne non placés (Fayence, Quet, Valbonnais), Biguglia à sa mairie,
  Castello-di-Rostino à Ponte-Novo. Corrigés à l'audit Mireille : Solaro et
  San-Giuliano placés sur la côte (Marine de Solaro, Alistro) et côte de
  Sotta au village (2013/1 passe de −10,0 à −4,5 %), Mont Revard au hameau
  du Revard (sans aller-retour), col de la Vayède retiré (le « ok » de
  2013/6 ne tenait qu'à un aller-retour, règle 24), Lens-Lestang (autre
  lieu) retirée, Quintaine replacée avec son tronçon noté (règle 21),
  départ de Montpellier à l'hôtel de ville, `circuit_km` de 2013/21 à
  l'entrée ; notes de cause réécrites (2013/1, 2, 16).

- [x] Édition 2014 (PR #515) : 21 étapes sur 21 (pas de prologue en
  2014), depuis les profils de ledicodutour.com
  (`cols/2014/profil_2014_N.png`, 600 px, altitudes imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur un agrandissement ; l'altitude est contrôlée point par point
  (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, et chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 240 points placés sur 258. Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 12 étapes dans la tolérance (dont 2014/10, non
  probante : son −4,2 % compte un aller-retour de 1,3 km au col des
  Chevrères, règle 24), 7 hors, cause notée avec la comparaison en
  voiture — 2014/2 (−14,1 %, −13,8 %), 2014/5 (−13,1 %, −2,3 % : le
  routeur vélo évite les pavés), 2014/6 (−6,0 %, −1,4 %), 2014/7 (−6,2 %,
  −4,3 %), 2014/9 (−6,7 %, −8,0 %), 2014/11 (−10,5 %, −9,2 %), 2014/12
  (−9,0 %, −4,3 %) ; 2014/3 et 2014/21 non contrôlables. Arrivées de La
  Mauselaine et de Risoul 1850 replacées (le point de stage_towns tombait
  en ville, 190 à 750 m trop bas) ; Blubberhouses et Grinton Moor retirés
  pour aller-retour (le −3,8 % de 2014/2 n'était pas probant, règle 24).
  Audit Mireille : Oughtibridge et Ripponden placées sur la montée qui
  porte leur nom (243 et 229 m sur EU-DEM) ; Bradfield (centre de
  paroisse arbitraire) et Epping Forest (centre du district) retirés,
  2014/3 devient non contrôlable ; Campagnette (Bimont), Muhlele
  (Gunsbach), Chemin des Dames (Aizy-Jouy) et Douaumont (hameau) placés,
  écart d'altitude ≤ 8 m ; arrivées de Sheffield et d'Hautacam notées non
  sourcées ; « km imprimé incohérent, mairies vérifiées » sur quatre
  tronçons ; allers-retours incertains notés en 2014/9 et 2014/11.

- [x] Édition 2015 (PR #516) : 21 étapes sur 21 (pas de prologue en
  2015, contre-la-montre d'Utrecht en 1re étape), depuis les profils de
  ledicodutour.com (`cartes_etapes/2015/etape_N.png`, 600 px, altitudes
  imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur un agrandissement ; l'altitude est contrôlée point par point
  (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, et chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 241 points placés sur 263. Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 12 étapes dans la tolérance (dont 2015/19, non
  probante : son +0,5 % compte un aller-retour de 8,1 km à Épierre, que
  l'ordre du profil impose, règle 24), 7 hors, cause notée avec la
  comparaison en voiture — 2015/2 (−12,7 %, −6,9 %), 2015/3 (−12,9 %,
  −11,8 %), 2015/4 (−5,6 %, +2,4 %), 2015/5 (−18,8 %, −13,4 % : boucle
  par Péronne non située), 2015/7 (−6,6 %, −4,4 %), 2015/9 (+26,4 %,
  +30,0 % : contre-la-montre par équipes dont les points ne sont pas sur
  le tracé réel), 2015/14 (−11,2 %, −8,7 %) ; 2015/1 et 2015/21 non
  contrôlables. Étape 20 transcrite depuis le profil modifié (Galibier
  remplacé par la Croix de Fer, tunnel du Chambon fermé). Arrivées du
  Mur de Huy, de Mûr-de-Bretagne, de La Pierre-Saint-Martin, du Plateau
  de Beille, de Mende, de La Toussuire et de Paris replacées (le point
  de stage_towns tombait en ville ou au col, 128 à 512 m d'écart) ; la
  côte de Cherave et Péronne retirés pour aller-retour.
  Audit Mireille : côte de Bohissau (nom alternatif OSM de la voie
  Bousalle), Pierre-Pin Dessous, Grand Tunnel (MNT aux portails), Rieu
  Claret (croisement avec la D 526), Le Mas (Compeyre) et Saint-Sorlin
  (sur la D926, 1 639 m pour 1 642) placés ; Mourenx à la mairie de
  Mourenx-Bourg (tronçon suspect disparu) ; notes de règle 11 ajoutées
  (2015/6, 2015/15) ; règles 14 et 21 complétées (tunnel, `alt_name`,
  Pierre-Pin).

- [x] Édition 2016 (PR #519) : 21 étapes sur 21 (pas de prologue en
  2016), depuis les profils de ledicodutour.com
  (`cartes_etapes/2016/2016_Na.jpg`, 604 px, altitudes imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur un agrandissement ; l'altitude est contrôlée point par point
  (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, et chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 262 points placés sur 283. Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 17 étapes dans la tolérance (dont 2016/15, non
  probante : son −2,2 % compte un aller-retour de 5,0 km à Cerdon, règle
  24), 3 hors, cause notée avec la comparaison en voiture — 2016/1
  (−10,3 %, −5,9 %), 2016/2 (−12,1 %, −9,0 %), 2016/13 (+7,0 %, +7,0 %,
  contre-la-montre mesuré sur 59 %) ; 2016/21 non contrôlable. Étape 12
  arrêtée au Chalet Reynard (raccourcie à 178 km à cause du vent, le
  sommet du Ventoux imprimé au profil n'a pas été monté). Arrivée d'Arcalis
  replacée (780 m trop bas), Paris sur les Champs-Élysées ; départ de
  Montpellier non placé (Sommières à 25,7 km pour 13, règle 25) ; circuit
  final de Culoz déclaré (circuit_km 122) ; abbaye de Valmagne placée sur
  la D 5 (hors réseau routable).
  Audit Mireille : côte d'Avranches au centre d'Avranches (le premier point
  était le camping de Genêts, 11 m pour 98) ; arrivée d'Émosson au barrage
  et non au centre du réservoir (2016/17 : +2,5 % → −0,7 %) ; montée de
  Bisanne sur la route du Signal et côte de l'Ermitage à Sannois placées ;
  côte de Gordes retirée (98 m sous le sommet) ; allers-retours de Cerdon
  (sans lui, 2016/15 vers −11,8 %) et de Vervex chiffrés ; départs de
  Vielha et d'Escaldes notés (règle 14).

- [x] Édition 2017 (PR #520) : 21 étapes sur 21 (pas de prologue en
  2017, contre-la-montre de Düsseldorf en 1re étape), depuis les profils
  de ledicodutour.com (`2017/2017_parcours/2017_Na.jpg`, 600 px,
  altitudes imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur un agrandissement ; l'altitude est contrôlée point par point
  (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, et chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 222 points placés sur 239. Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 10 étapes dans la tolérance, 10 hors, cause notée
  avec la comparaison en voiture — 2017/1 (−13,8 %, −24,7 % : le
  Rheinkniebrücke, sourcé mais non imprimé, n'est pas repris), 2017/2
  (−11,7 %, +3,3 %), 2017/3 (−8,2 %, −1,4 %), 2017/5 (−6,4 %, −10,4 %),
  2017/7 (−10,0 %, −6,7 %), 2017/8 (−6,0 %, −7,5 %, aller-retour de Viry
  compté deux fois), 2017/9 (−6,1 %, −4,9 %), 2017/15 (−12,0 %, −2,3 % :
  le routeur vélo coupe), 2017/16 (−8,2 %, −4,6 %), 2017/20 (−20,8 %,
  −7,8 % : rond-point du MuCEM non localisé) ; 2017/21 non contrôlable.
  Audit Mireille : départ et arrivée de 2017/1 à la Messe Düsseldorf et de
  2017/20 au stade Vélodrome (vias sourcées de historic_routes ; les
  « ok » et −78,3 % d'avant reposaient sur des arrivées fausses) ; Serre
  Chevalier au hameau de Villeneuve (1 392 m pour 1 403) ; côte de Domme à
  la mairie (le point était le lieu-dit « Côte de Flauquet », 112 m pour
  184) ; Jongieux-le-Haut, Langres, Longwy-Haut, Saint-Pierre de Rodez,
  départ de Laissac et sud d'Antony placés ; Viry à la mairie.

- [x] Édition 2018 (PR #521) : 21 étapes sur 21 (pas de prologue en
  2018), depuis les profils de ledicodutour.com
  (`cartes_etapes/2018/N_b.jpg` ou équivalent, altitudes imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur un agrandissement ; l'altitude est contrôlée point par point
  (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, et chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 387 points placés sur 420 (dont quinze secteurs pavés en 2018/9).
  Contrôlée à ±5 % sur BRouter public, 0 tronçon en voiture : 18 étapes
  dans la tolérance, 2 hors, cause notée avec la comparaison en voiture —
  2018/3 (−13,8 %, −9,0 % : final dans Cholet non situé), 2018/5 (−10,7 %,
  −1,7 % : le routeur vélo coupe) ; 2018/21 non contrôlable. Arrivée du
  col du Portet replacée au sommet (le point de stage_towns était à
  Saint-Lary, 817 m pour 2 215), arrivées de Mûr-de-Bretagne et de Mende
  aux points des éditions précédentes ; Entremont, Bonneval et Pontamafrey
  au village (le centre de commune était 180 à 640 m trop haut) ; cinq
  points retirés pour aller-retour (plateau des Glières, Arêches,
  Sainte-Eulalie, Luzençon, Avezac).
  Audit Mireille : 2018/20 recalé (carrefour D250-D88 placé au croisement
  OSM, Hergaraï et Larraldea de Souraïde, Ustaritz retiré : +2,1 % →
  −0,1 %) ; Berd'huis, Les Herbiers et Montroty retirés (lignes droites
  plus longues que le profil, règle 11), Nogent-le-Rotrou à sa mairie ;
  Grand Châtaignier, Moulin-Maurel (nom imprimé rétabli), Les Quatre
  Routes (Avessac), Ti Douar, L'Essert et Haut-de-la-Côte retrouvés par
  recherche bornée ; Bessèges (2e passage) ajouté ; notes de règle 11
  complétées (2018/5, 8, 9, 13, 16).

- [x] Édition 2019 (PR #522) : 21 étapes sur 21 (pas de prologue en
  2019), depuis les profils de ledicodutour.com
  (`images/2019/etape_N.jpg` ou `etape_Nb.jpg`, altitudes imprimées).
  Critères d'acceptation : chaque nom imprimé est transcrit avec son km,
  lu sur l'image ou un agrandissement ; l'altitude est contrôlée point
  par point (règle 14, EU-DEM hors de France) ; le contrôle à ±5 % passe
  sur BRouter public avec 0 tronçon en voiture, et chaque étape hors
  tolérance a sa cause notée ; les étapes 19 (arrêtée à l'Iseran) et 20
  (raccourcie à 59,5 km) suivent le parcours couru, source citée ; le
  test d'invariant passe ; l'audit Mireille est fait avant la fusion.
  Fait : 440 points placés sur 466. Contrôlée à ±5 % sur BRouter public,
  0 tronçon en voiture : 15 étapes dans la tolérance, 5 hors, cause notée
  avec la comparaison en voiture — 2019/2 (+16,8 % : contre-la-montre
  urbain, points de commune au centre), 2019/5 (−5,7 %, +2,8 % en
  voiture), 2019/9 (−5,1 %, 0,0 %), 2019/20 (−5,5 %, +10,6 %) : le
  routeur vélo coupe ; 2019/15 (+6,3 %, +8,8 % : profil plus court que
  la route) ; 2019/21 non contrôlable. Étape 19 arrêtée au col de
  l'Iseran (km 89) et étape 20 ramenée à 59,5 km (N90 jusqu'à Moûtiers,
  km du profil prévu recalés de −70,5), d'après les pages d'étape de
  ledicodutour.com. Arrivée de la Planche des Belles Filles au sommet
  (1 140 m imprimés), Embrun, Le Monêtier-les-Bains et
  Saint-Michel-de-Maurienne remis aux points des éditions précédentes (le
  nouveau géocodage les plaçait 104 à 579 m trop haut), Aÿ au village
  (règle 15) ; Montans non placé (km imprimé contradictoire).
  Audit Mireille : onze lieux non placés retrouvés, dont huit par l'index
  POI de la Géoplateforme (Cériset et Esquillot, qui ramènent 2019/13 de
  −19,9 % à −1,8 %, La Jaillère de Sorbiers à la place d'un homonyme, La
  Vialette, Le Tonkin, Le Lac, col de Liberté, La Malautière) et trois
  par Nominatim (Bellevue, Le Moulin, Les Menuires) ; col de la Croix de
  Part rétabli (son retrait reposait sur un tronçon en voiture, règle
  16) ; Étalans, Flourens, La Chaux-en-Bresse, Jurançon et
  Villers-lès-Nancy retirés (lignes droites, règle 14) ; départ de Nîmes,
  Uzès et Servance à la mairie (règles 17, 25) ; côte du Haut-Kœnigsbourg
  au col du Schaentzel (approchée) ; notes de règle 11 complétées.
- [x] Édition 2020 (PR #523) : 21 étapes sur 21 (pas de prologue en
  2020), depuis les profils de ledicodutour.com (`images/2020/20_N.jpg`,
  `20_18a.jpg` pour l'étape 18, altitudes imprimées). Critères
  d'acceptation : chaque nom imprimé est transcrit avec son km, lu sur un
  agrandissement ; l'altitude est contrôlée point par point (règle 14) ;
  le contrôle à ±5 % passe sur BRouter public avec 0 tronçon en voiture,
  et chaque étape hors tolérance a sa cause notée ; les lieux-dits
  introuvables dans Nominatim sont cherchés aussi dans l'index POI de la
  Géoplateforme (leçon de l'audit 2019) ; le test d'invariant passe ;
  l'audit Mireille est fait avant la fusion.
  Fait : 424 points placés sur 458. Contrôlée à ±5 % sur BRouter public, 0 tronçon en
  voiture : 18 étapes dans la tolérance, 2 hors avec la comparaison en
  voiture — 2020/10 (−5,1 %, +7,9 % : écart réparti), 2020/20 (−7,5 %,
  −4,8 % : premier tronçon exclu) ; 2020/21 non contrôlable (circuit_km à
  l'entrée de Paris). Neuf points retirés pour l'altitude (règle 14),
  arrivées du Pas de Peyrol et de la Côte 2000 recalées.
  Audit Mireille : 2020/18 retranscrite depuis le profil simplifié de la
  page (175 km, distance officielle, avec la côte de la route des Villes)
  au lieu du profil détaillé de 167,5 km — choix pris sans demander à
  Henri, noté dans l'étape ; arrivée de Saint-Martin-de-Ré, Mallemoisson,
  Lestards à la mairie, Brouage au lieu-dit (le point était à Hiers) ;
  Pont de la Baume, Les Payas, La Balmette, Celliers, La Palmyre trouvés
  par l'index POI ; onze points retirés pour ligne droite plus longue que
  le profil (règle 11, choix par défaut), sauf Nice (2020/2), rétabli :
  sans lui le routeur coupe et l'étape tombe à −7,4 % ; circuit_km de
  2020/21 à l'entrée imprimée (règle 19). Hors règles proposés par
  l'audit (comparer le profil à distanceKm et au second profil de la
  page avant de transcrire ; respect du délai et de l'User-Agent de
  curation par check-itineraries.js) laissés à des stories dédiées.
- [x] Édition 2021 (PR #524) : 21 étapes sur 21 (pas de prologue en
  2021), depuis les profils de ledicodutour.com (`images/2021/2021_Na.jpg`,
  altitudes imprimées, km au dixième). Critères d'acceptation : chaque
  nom imprimé est transcrit avec son km, lu sur un agrandissement ; la
  longueur du profil est comparée à la distance officielle
  (stage_towns.json) avant le placement (leçon de l'audit 2020) ;
  l'altitude est contrôlée point par point (règle 14) ; les lieux-dits
  introuvables dans Nominatim sont cherchés aussi dans l'index POI de la
  Géoplateforme ; le contrôle à ±5 % passe sur BRouter public avec 0
  tronçon en voiture, chaque étape hors tolérance a sa cause notée ; le
  test d'invariant passe ; l'audit Mireille est fait avant la fusion.
  Fait : 443 points placés sur 483 ; longueurs des 21 profils conformes à
  stage_towns.json (±0,6 km). Contrôlée à ±5 % sur BRouter public, 0
  tronçon en voiture : 16 étapes dans la tolérance, 4 hors avec la
  comparaison en voiture — 2021/1 (−8,2 %, −6,6 % : le routeur coupe dans
  les monts d'Arrée), 2021/5 (+7,3 %, +21,8 % : arrivée à l'Espace
  Mayenne, km du profil arrondis), 2021/8 (−7,7 %, +1,0 % : le routeur
  vélo coupe vers le col de Romme), 2021/20 (+6,7 %, +5,8 % : écart
  réparti) ; 2021/21 non contrôlable (circuit_km à l'entrée de Paris).
  Arrivées de Mûr-de-Bretagne et du col du Portet aux points des éditions
  précédentes, Mont Ventoux au sommet, Laval à l'Espace Mayenne ;
  Landerneau laissée au centre (sommet de la Fosse aux Loups non situé).
  Points retirés : dix-huit pour ligne droite plus longue que le profil
  (règle 11), six pour aller-retour (règles 9 et 24), trois pour
  l'altitude (règle 14).
  Audit Mireille : Luitré était l'homonyme de La Selle-en-Luitré (rétabli
  au bon bourg) ; départ du Pas de la Case non placé (règle 25) ;
  Montagne Saint-Michel, Menez Meur et Cluses (près) retirés pour
  aller-retour malgré la coupe du routeur (choix par défaut, cause notée
  dans l'étape) ; Feucherolles (près), Meudon, Issy-les-Moulineaux,
  Bagnères-de-Bigorre et Castaignos-Souslens retirés (règle 11) ;
  Balazé, Châtillon-en-Vendelais, Saint-Marcellin, Mérens, Ax,
  Marquixanes, Pouzac, Sault, Lézardrieux, Escueillens, Saint-Quentin,
  Vineuil, Le Stum, Bertineau et Château Corbin recalés au bourg, au
  lieu-dit ou à la mairie ; notes de départ (règle 25), de hors-tolérance
  et de tronçons suspects régénérées après le recontrôle complet.
- [x] Édition 2022 (PR #525) : 21 étapes sur 21 (pas de prologue en
  2022), depuis les profils de ledicodutour.com (`images/2022/etape_Na.jpg`,
  `etape_Nb.jpg`, `etape_18c.jpg` : profils simplifiés seulement, villes
  et cols avec leurs km, pas de km au dixième). Critères d'acceptation :
  chaque nom imprimé est transcrit avec son km, lu sur un agrandissement ;
  la longueur du profil est comparée à la distance officielle
  (stage_towns.json) avant le placement ; l'altitude est contrôlée point
  par point (règle 14) ; les lieux-dits introuvables dans Nominatim sont
  cherchés aussi dans l'index POI de la Géoplateforme ; le contrôle à
  ±5 % passe sur BRouter public avec 0 tronçon en voiture, chaque étape
  hors tolérance a sa cause notée ; le test d'invariant passe ; l'audit
  Mireille est fait avant la fusion.
  Fait : 307 points placés sur 335 ; longueurs des 21 profils conformes à
  stage_towns.json (±0,6 km). Contrôlée à ±5 % sur BRouter public : 12
  étapes dans la tolérance, 8 hors avec la comparaison en voiture et la
  cause notée — surtout le profil simplifié, qui ne donne aucun point sur
  les boucles (2022/1 Copenhague −32,3 %, 2022/2 côtes du Seeland
  −11,9 %, 2022/3 −14,0 %, 2022/4 −17,4 %, 2022/5 secteurs pavés
  −16,5 %), puis des retraits pour aller-retour ou des montées non
  situées (2022/9 −6,6 %, 2022/10 −6,3 %), et un écart réparti entre
  bourgs en 2022/20 (+10,9 %, +10,0 % en voiture) ; 2022/21 non
  contrôlable. Deux tronçons en voiture inévitables en 2022/2 : BRouter
  refuse le pont du Grand Belt (HTTP 400, profil vélo). Homonymes
  corrigés : Cerfontaine (Nord au lieu de la province de Namur, règle 7),
  Charleville-Mézières (centroïde de l'arrondissement), col de l'Espinas
  (non placé). Arrivées au sommet ou au lieu réel (Longwy-Haut, Super
  Planche, stade olympique de Lausanne, Pré-la-Joux, altiport de Megève,
  col du Granon, aérodrome de Mende, plateau de L'Hospitalet à
  Rocamadour). Audinghen et Marquise non placés : le profil les imprime
  dans l'ordre inverse de la carte de la même page. Points retirés : sept
  pour ligne droite plus longue que le profil (règle 11), deux pour
  aller-retour (règles 9 et 24), six pour l'altitude (règle 14), quatre
  côtes posées au pied (règle 21).
  Audit Mireille : deux traits coudés lus sur la colonne voisine
  (2022/6 côte de Montigny-sur-Chiers et Cons-la-Grandville, côte de
  Pulventeux au km 214,6 à la place de la côte des Religieuses, imprimée
  sans km ; 2022/10 Megève et la montée de l'altiport) — règle 2 précisée
  dans CURATION-REGLES.md ; arrivée de Rocamadour déplacée de la cité au
  plateau de L'Hospitalet (règle 22, ligne exacte à confirmer), côte de
  l'Hospitalet rétablie ; côtes de Remilly-Wirquin, Nielles-lès-Bléquin,
  Hejlsminde Strand et Genner Strand retirées (règle 21, choix par
  défaut) ; côte de Châtillon-sur-Cluses retestée après la correction de
  Megève, toujours en aller-retour, retirée ; mairie d'Auberchicourt
  essayée (règle 17). Hors règles proposés par l'audit (point
  `ambigu` tracé, contrôle d'altitude hors de France par EU-DEM à
  documenter, départ de Copenhague au Rådhus) laissés à des stories
  dédiées.
  Leçon : `geocode-itineraries.js` ne relance jamais un point « non-place »
  qui porte une note, or chaque point porte son altitude imprimée en note
  — il faut retirer `confidence` avant de relancer le géocodage.
- [ ] Édition 2023 **en cours** : 21 étapes sur 21 (pas de prologue en
  2023), depuis les profils de ledicodutour.com (`images/2023/2023_N.jpg`,
  altitudes imprimées, km au dixième). Critères d'acceptation : chaque
  nom imprimé est transcrit avec son km, lu sur des agrandissements, en
  suivant chaque trait coudé jusqu'à son pointillé (règle 2, leçon de
  l'audit 2022) ; la longueur du profil est comparée à la distance
  officielle avant le placement ; l'altitude est contrôlée point par
  point (règle 14) ; les lieux-dits introuvables sont cherchés aussi dans
  l'index POI de la Géoplateforme ; le contrôle à ±5 % passe sur BRouter
  public avec 0 tronçon en voiture, chaque étape hors tolérance a sa
  cause notée ; le test d'invariant passe ; l'audit Mireille est fait
  avant la fusion.
  Fait : 393 points placés sur 440 ; longueurs des profils conformes à
  stage_towns.json (±0,4 km), sauf 2023/3 (187,4 km pour 193,5 annoncés
  sur la page, écart noté). Contrôlée à ±5 % sur BRouter public : 14
  étapes dans la tolérance, 6 hors avec la comparaison en voiture et la
  cause notée — 2023/1 (−15,5 %, −8,5 %), 2023/2 (−8,9 %, +2,1 %),
  2023/12 (−7,8 %, −6,4 %), 2023/13 (−7,5 %, −3,5 %), 2023/16 (−6,2 %,
  −1,6 %), 2023/20 (−7,3 %, −4,7 %) ; 2023/21 non contrôlable. Un
  tronçon en voiture inévitable en 2023/9 : BRouter refuse la route du
  puy de Dôme (HTTP 400). Arrivées au sommet ou au lieu réel (Cambasque,
  puy de Dôme, Grand Colombier, Le Bettex, altiport de Courchevel).
  Départs fictifs notés (règle 25), Moûtiers et Les Gets non placés.
  Centroïdes d'arrondissement renvoyés par Nominatim pour Albertville et
  Chambéry, remplacés par l'hôtel de ville et le centre. Points retirés :
  douze pour ligne droite plus longue que le profil (règle 11), trois
  pour aller-retour (règles 9 et 24, mairie essayée avant), cinq pour
  l'altitude (règle 14).
- [x] Recontrôle d'altitude point par point des éditions 1997 à 1999 (PR #502) : leurs
  contrôles d'altitude (règle 14) ont été faits par lots de points
  dispersés, dont la Géoplateforme dégrade la résolution (trouvé en 2001).
  Le recontrôle point par point relève 17 points à plus de 100 m (1997 : 11,
  1998 : 3, 1999 : 3), dont une partie déjà notée (côtes rattachées au
  village, départ de Sestrières). Critères : chaque point trié — déjà noté,
  replacé (géocodage inverse et MNT), ou retiré avec note ; contrôle à ±5 %
  relancé sur les étapes touchées, 0 tronçon en voiture ; curation de
  données, pas de relecture adverse dédiée (règle 11).
  Fait : Canillo et Ordino à la ville, Celliers à Celliers-Dessus, Allemont,
  Aiton et Saint-Chamond à la mairie ; Vire, Barèges, Saint-Jean-d'Arves et
  le départ de Courchevel notés ; 1997/10 passe de +4,7 % à +1,5 %.

- [x] Édition 1991 (PR #412) : 22 étapes sur 23 (prologue de Lyon non transcrit),
  418 points placés sur 444 (405 sur 442 avant le tri 33.12). Contrôlée à ±5 % avant PR : 20 étapes dans la tolérance, 2
  hors, affichées comme telles — 1991/1 (−22,7 %) et 1991/21 (−8,4 %),
  circuits sinueux dont le profil ne liste qu'une partie des villages
  (positions vérifiées une à une en relecture adverse, pas d'erreur de
  donnée). Le contrôle a fait réintégrer les hameaux omis (Charvas,
  Gratay, Quintaine, Roizon, Le Ribot…), dont l'absence coupait la route.
  Relecture adverse : Canfranc-Estación placé sur le village de Canfranc
  à 3 km de la gare (1991/12 de +8,1 % à +2,4 %) ; Charvas placé sur un
  ruisseau homonyme (1991/2 de −6,0 % à +0,3 %, « Jonas » reste
  introuvable, non placé) ; hameaux pyrénéens sortis du centroïde de leur
  commune (Escarilla, Formigal, Gripp, La Séoube, Armanteule) ; libellés
  de l'image restaurés ; « Artouste » (1 140 m, descente du Pourtalet)
  retiré des positions — station ou autre point, non tranché ; ce retrait
  fait passer 1991/13 de +5,9 % à +0,5 %, il est signalé ici pour ne pas
  être pris pour une correction. Aucune commune de rattachement devinée.
- [x] Édition 1990 (PR #414) : 21 étapes sur 22, 316 points placés sur 341 (303 sur 338 avant le tri 33.12 ; 1990/6,
  déjà transcrite dans le lot Lorraine, conservée ; 297 routables (279 avant le tri), les
  autres sont des côtes et lieux-dits « (entrée) » placés au centre de leur
  commune, exclus du calcul comme ailleurs). Non transcrite : l'étape 5
  (Avranches → Rouen), image publiée de 133 px — une partie des km se
  devine agrandie, pas assez pour une transcription sans doute. Non
  repris : les rues du prologue, le libellé du km 72 de 1990/16 (lu
  « Rebichériolet » sans certitude), Issy-les-Moulineaux (même km 123 que
  l'entrée dans Paris). Contrôlée à ±5 % avant PR : 16 étapes dans la
  tolérance, 5 hors, affichées comme telles — prologue (+11,5 % sur
  3,9 km), 1990/2 (+14,6 % : 7,5 km de profil entre Lencloître et
  Vendeuvre-du-Poitou, 10,3 km à vol d'oiseau jusqu'au point retenu, km
  du profil contradictoire laissé tel quel), 1990/15 (−6,2 %, boucle
  finale par la côte de Saint-Ferréol non placée), 1990/20 (+5,9 %),
  1990/21 (−34,8 %, circuit des Champs-Élysées). 1990/9 est à +5,0 %,
  à la limite. Erreurs de position trouvées par le contrôle :
  - Épinal (`stage_towns`, 8 occurrences 1954-1990) au centroïde IGN,
    2,6 km à l'est de la ville — 1990/7 de +13,3 % (première mesure, en
    partie routée en voiture ; +6,0 % en vélo, relecture) à −0,4 % ;
  - Besançon (`stage_towns`, 35 occurrences) au centroïde IGN, 2,3 km du
    centre — 1990/8 de −6,0 % à −4,3 % (trouvé en relecture adverse) ;
  - Bonneval et Les Vignes placés sur leur commune déléguée (« city_district »
    OSM) — 1990/11 de +7,6 % à +1,7 %, 1990/14 de +8,4 % à +0,6 % ;
  - Allemond au centroïde de sa commune, 4 km au nord du village (bloquait
    Le Bourg-d'Oisans) ;
  - « Lac de Vassivière » (`stage_towns`, 1985, 1990, 1995) entre 42 et
    46 km du lac — recalé sur Auphelle, nommée sur les profils de 1990 et
    1995 ; au centre du lac pour 1985, gardé `douteux` (lieu exact non
    sourcé).
  Arrivées en altitude sans position sourcée (Côte 2000, Causse Noir,
  Bordeaux-Lac) laissées non placées plutôt que mises à la position de la
  ville ; Le Bettex placé (Nominatim). Romans non placé : 12,5 km à vol
  d'oiseau de Saint-Lattier pour 9,5 km de profil. Remesure de 1996 (pour
  Besançon, 1996/5) : 1996/18 passe de +10,8 % à +17,7 % sans changement
  de donnée — BRouter de nouveau disponible y remplace 4 tronçons routés
  en voiture par un détour vélo. Relecture adverse : 14 étapes relues
  contre l'image sans erreur de km ; libellés restaurés
  (Saint-Gervais-Mont-Blanc, Huez-en-Oisans, Côte de Marigny-Brizai).
- [x] Édition 1989 (PR #416) : 21 étapes en ligne sur 21 + prologue (rues de
  Luxembourg seulement, gardé pour mémoire, non contrôlable), 321 points
  placés sur 350 (304 sur 345 avant le tri 33.12 ; le « 300 sur 345 »
  écrit ici à la fusion de #416 mêlait le compte d'avant relecture, 300
  sur 340, et celui d'après). Contrôlée à ±5 % avant PR : 15 étapes dans la
  tolérance (1989/5 à +5,0 %, à la limite), 6 hors, affichées comme
  telles — 1989/3 (−12,8 %, Ardennes et passages sur le circuit de Spa),
  1989/4 (−5,1 %), 1989/8 (−6,0 %), 1989/15 (−5,4 %, contre-la-montre de
  39 km), 1989/18 (−12,2 %, contre-la-montre), 1989/21 (−14,5 % ;
  arrivée sur l'ancre `stage_towns` de Paris, au Châtelet et non aux
  Champs-Élysées — story 33.8). Relecture adverse : Benque (1989/11), le
  village de Haute-Garonne, contredit les trois points suivants
  (Labastide-Clermont à 18 km pour 11,5 km de profil) qui s'enchaînent
  avec Plaisance-du-Touch — c'est Benque qui est retiré, l'étape passe de
  +9,3 % à +0,4 % ; points omis ajoutés (côtes de l'Air et de Régagnas ;
  cours la Reine, Concorde, haut des Champs-Élysées ; la côte des
  Rayettes, au même km que Martigues, reste en note) ; Helfent
  placé sur sa propre position (n'était qu'une copie de Bertrange via un
  `geocodeAs` deviné). Non repris, avec une note : Jonzac (pas de km),
  La Lustre et Prignac-et-Marcamps (deux libellés, un trait), Prémian et
  Montpellier (entrée) (km confondus avec les graduations). Erreurs
  de position trouvées :
  - « Luxembourg City » (`stage_towns`, 17 occurrences 1947-2002,
    `douteux`) au centre géographique du pays, 23 km au nord de la ville
    — recalé sur la ville (Nominatim boundary/city) ;
  - Arles (1989/13) au centre de sa commune, en Camargue, 7,6 km de la
    ville — 1989/13 de +10,9 % à −4,1 % (Fontvieille placée du coup) ;
  - Allemond fixé au village (même erreur qu'en 1990, bloquait Le
    Bourg-d'Oisans) ;
  - Bastogne sur son arrondissement — story 33.7.
  Arrivées sans position sourcée (Le Cambasque, Côte 2000, Bordeaux-Lac,
  site Hewlett-Packard de L'Isle-d'Abeau) non placées avec une note.
  Libellés de l'image gardés (Seyne-les-Alpes, Colombières, Malmédy,
  Côte-des-4-Routes) ; longueurs du profil reprises quand elles diffèrent
  de `stage_towns` (1989/11, 13, 16, 17, 20).
- [x] Édition 1988 (PR #418) : 22 étapes sur 23 (prologue Pornichet → La Baule,
  3,8 km, sans profil publié), 403 points placés sur 419 (387 avant le tri 33.12). Contrôlée à
  ±5 % avant PR : 18 étapes dans la tolérance, 4 hors, affichées comme
  telles — 1988/6 (+10,7 %, contre-la-montre par équipes : Villeneuve-
  d'Ascq → Croix, 7 km à vol d'oiseau pour 5 km de profil), 1988/18
  (+5,4 %), 1988/21 (−10,8 %, contre-la-montre, côte de Saint-Romain et
  deux lieux-dits hors du calcul), 1988/22 (+8,9 %, circuit des
  Champs-Élysées retiré de la mesure par `circuit_km` au pont de la
  Concorde ; Jouy-en-Josas → Versailles 3 km de profil pour 5,5 à vol
  d'oiseau). Mesure sensible au routeur : 1988/18 était à +4,8 % routée
  entièrement en voiture (repli OSRM), +5,4 % en vélo ; 6 tronçons voiture
  restent sur 1988 (affichés). Erreur trouvée dans `stage_towns` : « Puy
  de Dôme » (14 arrivées et 1 départ, 1952-2023) était le centre du
  département, 13,9 km au sud-est du sommet — recalé sur le volcan
  (Nominatim natural/volcano) ; 1988/19 de +6,4 % à −0,4 %. Relecture
  adverse : deux km lus sur la graduation au lieu du km du point (Le
  Landreau 16, La Varenne 31, 1988/2) ; Villagrains placé sur son hameau
  (le `geocodeAs` vers Cabanac-et-Villagrains était deviné et faux) ;
  graphies du profil rattachées à la commune IGN (Courgains, Mérigon,
  Cazeaux-de-Larboust, Saint-Marcelin-de-Cray, Lachapelle-sous-Chaux) ;
  quai André-Citroën placé (était le centroïde du 15e arrondissement) ;
  libellés de l'image restaurés (pont de la Concorde, esplanade des
  Quinconces au km 202). Saint-Nazaire (1988/1) non placé : centre-ville
  à 7,7 km de Montoir pour 4,5 km de profil. Libellés illisibles ou
  nommés sans km (Côte de Mamers, Saint-Amand-les-Eaux, Taninges,
  Saint-Yorre, Col de Menté-Mourtis, Payolle…) non repris, notés.
- [x] 33.9 Corrections manuelles de `stage_towns.json` non protégées :
  `scripts/build-stage-towns.js` régénère tout le fichier, et les
  recalages faits à la main (Puy de Dôme, Luxembourg City, Épinal,
  Besançon, Lac de Vassivière, Eurotunnel…) disparaîtraient à la
  prochaine régénération (relecture adverse 1988, lecture de code, non
  rejoué). Fait : `pipeline/data/stage_towns_overrides.json` (9 libellés,
  7 occurrences « édition/étape/côté » pour les lieux qui changent selon
  l'édition — Lac de Vassivière, Eurotunnel 1994/3), chaque entrée avec
  sa source ; le générateur les réapplique après la régénération et après
  `--verify-only` (89 positions). Tests : une position fausse redonnée par
  le géocodeur est corrigée, l'occurrence prime sur le libellé (la
  mutation inverse fait échouer le test), et `stage_towns.json` porte
  déjà chaque position vérifiée (aucune ne bouge en les réappliquant).
  Relecture adverse : la confiance « ok » par défaut n'était pas testée
  (Luxembourg City revenait « douteux », exclu de la recherche) ; un
  fichier d'overrides absent ou mal formé donnait une régénération sans
  corrections, en silence — erreur désormais ; une entrée sans lat/lon
  effaçait la position — refusée ; « Val-d'Isère » (graphie à tiret)
  ajouté (89 positions). L'écriture passe par une seule fonction,
  `writeStageTowns`, qui réapplique les positions (testé, et un test
  vérifie qu'il n'y a qu'une écriture dans le générateur). Limite : le
  générateur lui-même n'a pas été relancé (10-15 min de réseau). Doute
  noté, non tranché : 1959/15 (contre-la-montre de 12 km libellé « Puy
  de Dôme → Puy de Dôme ») a son départ au sommet — vraisemblablement
  Clermont-Ferrand ou Chamalières, à confirmer par une source.
- [x] 33.10 Bourg plutôt que centroïde dans `stage_towns.json` : les
  villes-étapes françaises (`commune-ign`) étaient au centre géographique
  de leur commune — Épinal, Besançon, Avignon, Dijon trouvées une à une
  par le contrôle ±5 %. Balayage : 564 positions distinctes (3 805
  occurrences), 258 à 1 km ou plus de leur bourg OSM, 25 à 3 km ou plus
  (Bagnères-de-Bigorre 7,7, Isola 7,7 — le centroïde tombait vers Isola
  2000 —, Saint-Raphaël 6,8, Hyères 5,9, Limoges 4,1, Avignon 3,7, Pau
  3,1 sur 135 étapes…). Le générateur recale désormais chaque commune IGN
  sur le point OSM de localité du même nom le plus proche, à moins de
  8 km (`snapCommuneAnchors`, même règle que `snapToTown` des itinéraires :
  jamais une « municipality » — celle d'Avignon est à 11 km —, un
  quartier ni une entité administrative ; test, deux mutations
  détectées), appliqué une fois aux données (cache Nominatim). Les 25
  plus grands recalages vérifiés un à un ; Gavarnie-Gèdre (arrivée 2026/6,
  commune nouvelle, point OSM entre Gèdre et Gavarnie) marquée `douteux`
  par une position vérifiée (33.9), le lieu exact de l'arrivée n'étant
  pas sourcé. Les 49 arrivées d'itinéraire posées sur ces ancres suivent ;
  relecture adverse : 82 autres points d'itinéraire (villes au même nom,
  à moins de 300 m de l'ancien centroïde, géocodées avant 33.3) restaient
  sur l'ancienne position — recalés aussi. Isola (départ de 1993/12) passe
  au village, comme l'avait déjà tranché la relecture de l'édition 1993
  d'après le profil (km 0 au village) ; l'arrivée de 1993/11 reste à Isola
  2000. Test renforcé (plus proche de deux bourgs, hameau, classe OSM,
  position non IGN intacte : quatre mutations détectées). Remesure :
  144 étapes dans la tolérance (145 avant) ; rentrent 1979/13, 1989/8,
  1992/14 ; sortent 1989/5 (+5,4 %), 1989/13 (−6,2 %, Marseille recalée
  sur la ville), 1992/15 (+5,7 %), 1993/1 (−5,9 %) — écarts affichés,
  pas ajustés. 25 tronçons routés en voiture (13 avant) : BRouter refusait
  par moments pendant la remesure.
- [x] Édition 1987 (PR #421) : 25 étapes sur 26 (prologue de Berlin-Ouest sans
  profil publié), 502 points placés sur 578. Les deux contre-la-montre
  dans Berlin-Ouest n'ont que des rues et quartiers (1987/1 non
  contrôlable, 1987/2 −33,1 % sur deux tronçons). Contrôlée à ±5 % avant
  PR, entièrement en vélo (BRouter, aucun tronçon voiture) : 14 étapes
  dans la tolérance, 10 hors, affichées comme telles — 1987/3 (−9,0 %,
  passages dans Karlsruhe et Stuttgart), 1987/12 (+13,7 %, vallée de la
  Dordogne), 1987/21 (+8,4 %, Moûtiers → Aime 17 km routés pour 14),
  1987/24 (−15,6 %, contre-la-montre autour de Dijon, Sainte-Foy non
  placé), 1987/5, 8, 11, 15, 23 entre 5,1 et 6,1 %. Circuits retirés de
  la mesure (`circuit_km`) : Bordeaux (1987/12) et Champs-Élysées
  (1987/25, arrivée sur l'avenue, entrée à la Concorde), imprimés sur le
  profil ; Pforzheim (1987/4, de −10,4 % à −1,6 %) — le profil n'imprime
  pas de circuit, boucle ou traversée de la ville non tranchée.
  Longueur du profil retenue quand elle diffère de `stage_towns` :
  1987/11 Poitiers → Chaumeil 255 km (imprimé au bout de l'axe) contre
  206 km sur Wikipédia anglais, incompatible avec les 234 km routés sur
  98 % de l'étape. Relecture adverse : une trentaine de km décalés d'un
  cran (rangée de la graduation prise pour celle du point) dans 1987/1,
  3, 6, 7, 10, 12, 13 — corrigés ; le contrôle ±5 % ne les voyait pas
  (il compare le total, pas chaque tronçon) : par exemple Baires → Saint-
  Julien-les-Villas 12,5 km au profil transcrit pour 3,9 km routés. Col
  du Kreuzweg était au km 60, une graduation (même erreur qu'en 1988) ;
  Le Champ du Feu sans km imprimé, non placé. Iseste est Izeste (était
  rattaché à tort à Louvie-Juzon, 5,9 km) ; Champigny rattaché à
  Souzay-Champigny (Champigny-le-Sec est un homonyme de la Vienne) ;
  Saint-Gervais et Parigny placés sur leur village ; Magny-Fouchard et
  La Villeneuve-au-Chêne placés après correction des km ; libellés de
  l'image restaurés (Geneston, Côte de Ebersteinburg, Côte de la
  Féchalière).
- [x] 33.11 Contrôle par tronçon : `check-itineraries` comparait la
  distance routée totale au profil, si bien qu'un km faux au milieu
  d'une étape ne changeait rien (relecture 1987 : une trentaine de km
  décalés invisibles). Fait : `isSuspectLeg` signale un tronçon dont le
  km du profil est plus court que la ligne droite (+1 km de marge,
  centres de commune) ou dont la route s'écarte du profil d'au moins
  3 km et d'un facteur 1,4 ou 0,7 ; `--legs` les liste pour toutes les
  étapes, plus seulement celles hors tolérance, et `route_check` publie
  leur nombre (`suspect_legs`). Tests : cas réels de 1987, compensation
  entre deux tronçons faux d'une étape dans la tolérance, bornes de
  chaque seuil (3 km, ×1,4, ×0,7, marge de 1 km) — chaque mutation de
  seuil fait échouer un test. Limite mesurée en relecture (simulation
  sur les 225 étapes) : un km décalé de 1 km n'est jamais vu, de 2 km
  une fois sur cinq, de 3 km sept fois sur dix, de 5 km presque
  toujours ; la règle de la ligne droite produit aussi du bruit sur les
  tronçons courts (centres de commune). Premier passage sur les 222
  étapes mesurées : 188 tronçons suspects sur 112 étapes (1987 : 34, 1988 :
  23, 1995 : 21, 1992 : 20…) — à trier contre l'image (33.12) ; la
  liste est la sortie de `check-itineraries --legs`. Remesure
  simultanée : 159 étapes dans la tolérance (158 avant : 1993/6 passe
  de +5,1 % à +5,0 %, un tronçon voiture devenu vélo — verdict à la
  frontière), 1 tronçon voiture (25 avant).
- [x] 33.12 (PR #433 à #438) Tri des 188 tronçons suspects (33.11), édition par édition,
  contre l'image agrandie : km décalé d'un cran, graduation lue pour le
  point, homonyme, centre de commune loin du passage — ou profil
  réellement contradictoire, laissé tel quel avec une note. Protocole de
  transcription : `--legs` avant chaque PR d'édition, tout tronçon
  suspect justifié.
  - 1986 trié, sur un passage BRouter (un tronçon routé en voiture,
    la montée du Puy de Dôme, refusée par BRouter comme en 1988).
    Profils relus nom par nom (règle 18) : 14 noms omis ajoutés —
    Argenlieu et Hamel (1986/3), Gavray, Côte de Mesnil et Le Repas
    (1986/7), Notre-Dame-des-Langueurs (1986/8), Montgaillard (1986/14),
    Espondeilhan et Neffiès (1986/15), Les Granges (1986/16), Côte de
    Notre-Dame (1986/19), Saint-Chamond (2e passage) et Saint-Étienne
    (entrée) (1986/20), Côte de Chaynat (1986/21) ; les noms sans km
    imprimé sont notés à l'étape (règle 4). Placés (règle 21, recherche
    bornée, altitudes au MNT) : 25 points jusqu'ici non placés, dont
    Rebirechioulet,
    Pont-Sarrazin (arrêts de bus), la Croix de Chaubouret, Caumont-
    l'Éventé (village de la commune nouvelle), Nadaillat, Laschamps, La
    Font de l'Arbre, Chaynat et la Côte de Rochetaillée. Positions
    (règle 17) : Bressuire et La Condamine à leur mairie, leurs allers-
    retours disparaissent. Non placé : Châteauneuf-de-Chabre, jusqu'ici
    rattaché (le village, 544 m au MNT pour 650, règle 14). Refusés,
    notés : Forges (tronçon suspect créé), Pic Saint-Loup (sommet hors
    route).
    Relecture adverse — erreurs corrigées : 7 noms imprimés oubliés de
    plus (Surat, Courcelles, Intville-la-Guétard, Milly, Côte de Vidame,
    Côte de Bosc-Hyons « Nosc-Hyons », Belle), deux séries décalées d'un
    cran (règle 3) — Châtenay-Malabry imprimé deux fois en 1986/1 (la
    Porte-Trivaux n'a pas de km), La Fresquière sans km en 1986/17, ce
    qui faisait refuser Les Thuiles à tort ; refus mal mesurés
    (Argenlieu, Les Granges, Montgaillard, qui est Montgaillard-sur-Save) ;
    Beaulieu-sur-Loire et Saint-Auban à leur mairie (règle 17) ; notes
    « non trouvé » fausses — Fontchristianne, Pierrepin, Col d'Haltza,
    Monument Pershing, Mont-Valérien, Chauffour, Bourg placés, Col du
    Mortier refusé pour son altitude (règle 14) ; six côtes rattachées
    dont le point stocké est à l'altitude du sommet, placées (règle 14 :
    mesurer au point stocké — Guerbigny, Avranches, La Gaubretière,
    Pouzauges, Saint-Léger-des-Vignes, Châteaufort) ; noms sans km
    notés aux étapes 12, 13, 15, 16, 18.
    Bilan : 20 étapes sur 23 dans la tolérance (21
    avant) : 1986/20 sort à +13,7 % une fois la Côte de Rochetaillée
    placée (le tronçon final, court-circuité, compensait le reste —
    noté) ; 1986/1, 1986/2 et 1986/20 ont une note d'étape. 22 tronçons
    suspects (24 avant), notés avec leur contre-test voiture ; 4
    allers-retours sûrs (6 avant ; Clamart, incertain, devenu sûr une
    fois Châtenay corrigé) et aucun incertain (1 avant), notés.
  - 1988 trié, sur un passage BRouter (un seul tronçon routé en
    voiture, Col de la Moréno → Puy de Dôme : BRouter refuse la route du
    sommet, HTTP 400, à chaque passage). Profils relus nom par nom
    (règle 18) : aucun nom omis hors ceux déjà notés. Placés (règle 21,
    recherche bornée, altitudes au MNT) : Pont de Saint-Nazaire,
    Marœuil (« Mareuil » imprimé), Klingenthal, Pont d’Arbon
    et La Léchère (connus par leur arrêt ou leur gare), Longchamp, Le
    Rivier, Bouilly, La Chaise, Chatâin-Besson, La Grolle, Melin,
    Petit-Auxey (« Auxey-le-Petit »), le boulevard du 14-Juillet à
    Évreux et l'esplanade des Quinconces (adresses imprimées) ; côtes
    au centre d'un village proche de l'altitude du sommet (Barbonval
    à 30 m sous lui) : Barbonval,
    Châtillon-sur-Cluses, Beaubery, Cerny-en-Laonnois, Châteaufort.
    Positions (règle 17) : La Cluse sur son hameau, Cazaux-Layrisse
    sur le Pont de Cazaux et Cazaux-Larboust sur son village — leurs
    trois allers-retours disparaissent (1988/15 sans tronçon suspect) ;
    Villeneuve-d'Ascq et Versailles à leur hôtel de ville. Refusés,
    notés : Le Struthof (730 m au MNT pour 1 030), Territet (km
    contradictoire avec Vevey). Relecture adverse : mes notes « centre
    au pied » mesuraient le centroïde administratif, pas le point
    stocké — Saint-Romain placée à son église (1988/21 de −10,4 % à
    +5,8 %), Chavigny et Montesquieu-Volvestre placées ; seules
    Bouttencourt et Peyrat-le-Château sont vraiment au pied, les autres
    restent rattachées parce que placées elles allongent l'étape (noté).
    Notes « introuvable » fausses : Sainte-Quitterie (sanctuaire), La
    Main (hameau), Les Agets (arrêt de bus, pas l'homonyme de Bazougers)
    et Souligné-Flacé placés ; Pavé des Gardes connu par son arrêt mais
    sommet non démontré. Noms imprimés sans km notés : Santenay (pont),
    La Broque et Rothau, Souvenir Henri-Desgrange. Circuits finaux (règle 19) : Le Mans (11,5 km) et
    Bordeaux (8 km). Bilan : 18 étapes sur 22 dans la tolérance (18
    avant) ; les 4 hors tolérance (1988/6, 18, 21, 22) ont une note
    d'étape. 19 tronçons suspects (22 avant), 3 allers-retours sûrs (6
    avant) et aucun incertain, notés.
  - 1989 trié, sur un passage BRouter. Profils relus nom par nom
    (règle 18) : Prignac-et-Marcamps (1989/7, jusqu'ici « non repris »),
    Sortie Orcières et Les Veyers (1989/15), Souvenir Henri-Desgrange
    (1989/17) et l'entrée du circuit de L'Isle-d'Abeau (1989/20)
    ajoutés. Placés (règle 21, recherche bornée, altitudes au MNT) :
    13 points jusqu'ici non placés et 4 noms ajoutés, dont Regné, La Barre, Taizé, Étables, Le
    Grand-Breuil, Saint-Marcellin et La Brévière ; côtes à leur sommet
    connu — Laffrey à sa mairie (917 m au MNT pour 875 ; 1989/18 de
    −12,2 % à −1,3 %), Simacourbe, Le Rove, Saint-Nizier, la citadelle
    de Namur. Positions (règle 17) : Tandel sur son village (son
    aller-retour disparaît), Aniane et Lunel à leur mairie (leurs
    tronçons suspects disparaissent). Retirées : Côte de l'Auvestre,
    placée au-delà de Puimoisson (aller-retour de 2,5 km, règle 9),
    Côte de Fontenaille (village plus haut que le sommet imprimé).
    Refus notés : Aurensan et Châteauredon (village au pied).
    Relecture adverse — refus mal fondés, corrigés : Saint-Savin placée
    (pas d'aller-retour au centre du village), Bray et Berdorf placés
    avec leur tronçon suspect noté (règle 11 : un km contradictoire se
    note, il ne retire pas un lieu qui existe) ; notes « introuvable »
    fausses — Cazeaux-de-Larboust, Mompach, Notre-Dame du Peyrou, Les
    Quatres Routes (variantes d'orthographe), La Fresquière et
    Basse-Plaine (connues par leur arrêt de bus) placés ; arrivée de
    Blagnac placée avenue des Pins, adresse imprimée (son tronçon
    suspect disparaît) ; Côte de Régagnas retirée du pic (688 m au MNT
    pour 420) ; La Lustre remise dans la note d'étape. Le circuit de
    1989/21 revient sur 33.8, qui l'avait traité « sans circuit ». Circuits finaux (règle 19) :
    Luxembourg, Bordeaux, Pau, Marseille, Gap, L'Isle-d'Abeau, et
    l'aller-retour final sur les Champs-Élysées du contre-la-montre
    (1989/21). Contre-test voiture (règle 20) sur les tronçons
    suspects restants : OSRM donne à 1 km près la distance de BRouter,
    loin du profil — pas le routeur, cause non établie, noté. Bilan : 20 étapes sur 21 contrôlables dans la
    tolérance (15 avant) ; 1989/21 (−6,8 %) a une note d'étape. 11
    tronçons suspects (15 avant), aucun aller-retour sûr (2 avant) et
    1 incertain (2 avant), tous notés ; aucun tronçon routé en voiture.
  - 1990 trié, sur un passage BRouter. Profils relus nom par nom
    (règle 18) : Côte de la Flye et Vittel (entrée) (1990/6), Hauts
    des Champs-Élysées (1990/21) ajoutés, non placés. Relecture adverse : la Flye existe sous « La Flie »
    (Liverdun) mais sans sommet identifié, notes de Romans et de
    Mondeville (non placés, pas rattachés) et du prologue (6,3 km)
    corrigées, Ornans et Xertigny notés incompatibles avec le profil. Placés (règle 21,
    recherche bornée, altitudes contrôlées au MNT) : La Poirière,
    Parigny, Clairefontaine, Le Planet, Croix de Chaubouret, Côtes de
    Montbonnet, de la Vachellerie, des Gardilles et de Choizal,
    Tiergues, Moulin-Neuf, Saint-Sauveur, Notre-Dame-de-Piétat,
    Montflix (« Montfix » imprimé), Porchefontaine ; à leur adresse
    imprimée : pont Aristide-Briand (Nantes) et esplanade des
    Quinconces. Positions : Arrens sur son hameau (commune nouvelle
    Arrens-Marsous, son aller-retour disparaît), Bressuire-Saint-
    Porchaire sur Saint-Porchaire (1,9 km). Refusés, notés : Le
    Plessis-Hudelor (nom différent, 38 m au MNT pour 105), Romans à sa
    mairie (Saint-Lattier → Romans, 12,7 km à vol d'oiseau pour 9,5).
    Circuits finaux (règle 19) : Nantes (pont, 9 km avant l'arrivée),
    Besançon, Bordeaux, et la boucle Revel → Saint-Ferréol → Revel
    (1990/15 de −7,4 % à −2,5 %). Contre-test voiture (règle 20) :
    Écharcon → Mennecy, 2,9 km en vélo, 7,7 en voiture pour 8 — limite
    du routeur ; les autres tronçons suspects sont aussi longs en
    voiture. Bilan : 17 étapes sur 21 dans la tolérance (16 avant) ;
    les 4 hors tolérance (prologue, 1990/2, 1990/20, 1990/21) ont une
    note d'étape. 4 tronçons suspects (7 avant), 1 aller-retour sûr
    (Chasseneuil-du-Poitou, déjà à sa mairie, noté) et 1 incertain (2
    et 1 avant), tous notés ; aucun tronçon routé en voiture.
  - 1991 trié, sur un passage BRouter. Lieux-dits rattachés ou non
    placés que Nominatim connaît (règle 21) : Côte de Bellevue-Limonest,
    Genas-Azieu, Pont-de-Tancarville, Côte de Poulgrellec, Col de
    Soudet, Senegüé, Artouste, Pont de Chabestan, Livet, Col de la Joux
    Plane, Côte de Montflix, La Croix de Médavy,
    Liquisses Basses ; une recherche **bornée autour des deux voisins** en a
    trouvé onze de plus, que la recherche globale noyait sous les
    homonymes (Côte des Maris, Le Calvaire, La Mouline, Côte de
    Bessède, Moulin Neuf, Côte de Lavaur, Blanzy, Col de Saint-Jean-de-
    Sixt, Don, L'Étoile, Chevigny), et trois sous une variante
    d'orthographe (La Pallud → Palud d'Ornon, Pongivart → Pontgivart,
    Vaudrenant → Vaudrenand) ; altitudes contrôlées au MNT (règle 14).
    Côte de la Mure placée à la mairie de La Mure : rattachée, le
    tracé contournait la ville (aller-retour incertain de 5,7 km à
    Roizon). Refusés, notés : Côte de Giriat et Chindrieux (tronçon
    suspect), Val Louron (aller-retour à Armanteule, même à son
    église). Noms imprimés omis : Paris (entrée) et, en relecture,
    Hauts des Champs-Élysées (1991/22). Relecture adverse : Quet-en-
    Beaumont à sa mairie (757 m au MNT au centre pour 880 imprimés) —
    l'aller-retour que j'attribuais à la Côte des Égats venait de lui,
    les Égats sont placés ; Chevigny placé (son refus visait « Dijon
    (entrée) », retiré par le circuit) ; Côte de Lavey placée (connue
    par son seul arrêt de bus, mais 704 m pour 700 et 9 km routés pour
    9) ; Côte de Hautecourt remise rattachée (le village est le pied,
    354 m pour 450) ; 1991/21 : en voiture, −4,2 % — le routeur vélo
    fait la moitié de l'écart. Circuits finaux déclarés (règle 19) là où
    6 km ou plus séparent l’entrée de l’arrivée : Lyon, Dijon, Reims, Le
    Havre (Fontaine-la-Mallet → Le Havre : 7,8 km routés pour 17,5),
    Rennes, Alès, Gap. Contre-test voiture (règle 20) sur les quatre
    tronçons suspects plus longs que le profil : OSRM l'est aussi — pas
    le routeur, cause non établie. Bilan : 20 étapes sur 22 dans la
    tolérance (20 avant) ; 1991/1 (−21,9 %) et 1991/21 (−8,4 %) ont une
    note d'étape. 9 tronçons suspects (10 avant), aucun aller-retour sûr
    et 1 incertain (6 avant), tous notés ; aucun tronçon routé en
    voiture.
  - 1996 trié, premier passage avec les règles 18 et 21 appliquées
    d'emblée. Noms imprimés mais omis : Lécluse, Ferriera, Vernetto,
    Nazareth, Valence (entrée) et Paris (entrée) (non placées), Saint-
    Émilion (1er passage) ; la relecture adverse en a trouvé un de plus
    (Montée de Val d'Isère, 1996/8). Lieux placés à leur adresse : quai
    Louis XVIII, Versailles-Porchefontaine. Lieux-dits routés (règle
    21) : Nesles, Albens, Les Arcs, La Thuile, Lac Chambon, Veillac, Puy
    Pinçon, Hautacam, Col de Soudet, Alto de Ibañeta, Puerto Otxondo ;
    relecture — la règle n'avait pas été appliquée aux côtes au lieu
    connu : Saint-Anastaise, Mont de l'Enclus, Argenlieu, Fiolaz et
    Senoy routés, et deux cols écartés à tort comme homonymes : Col du
    Rousset (Drôme) et Col de la Chau placés. Positions : Livry
    (Livry-Louvercy), Besse (mairie, 1 124 m au MNT pour 1 040),
    Bellegarde (centre de Valserhône, 510 m pour 360) ; Alto de Garralda
    retiré (1 292 m au MNT pour 970, col non localisé). Lac de Madine
    laissé rattaché. Limite du routeur (règle 20) : Ibañeta → Saint-
    Jean-Pied-de-Port, 41 km en vélo, 25,9 en voiture pour 25,5 au
    profil (1996/18 à +8,3 %) ; Aurizberri → Erro, 15,1 en vélo, 11,1 en
    voiture. Bilan : 15 étapes sur 19 dans la tolérance (14 avant) ;
    1996/13 de −5,7 % à +0,1 %, 1996/20 de −15,1 % à −5,5 % ; 1996/14 à
    −5,0 %, à la limite (noté). Les 4 hors tolérance ont une note
    d'étape. 15 tronçons suspects, 1 aller-retour sûr (artefact du
    détour BRouter) et aucun incertain, tous notés ; aucun tronçon routé
    en voiture.
  - 1995 trié, sur un passage BRouter. Lieux-dits rattachés à leur
    commune, donc non routés, que Nominatim place (règle 21) : Pont de
    Normandie, Radôme de Pleumeur-Bodou, Trestel, Les Ponts-Neufs, Col
    de Soudet, Côte d'Issarbe au premier passage ; en relecture
    adverse, la règle n'avait été appliquée qu'aux cas repérés —
    Trigavou, Notre-Dame-du-Guildo, Sables-d'Or, Binic, L'Hermitage-
    Lorge, Plœuc-sur-Lié, Livarot (commune nouvelle, 5,7 km), La
    Plagne, Côte de la Forteresse, Vichez, Auphelle placés à leur tour ;
    Cap Fréhel, la Côte de la Reid, Cazaux-Layrisse et Luchon restent
    rattachés ou non placés (placés, ils créent un aller-retour —
    noté). Positions (relecture) : Reninge (centre de la commune Lo-
    Reninge), Vierset-Barse (262 m au MNT pour 140), Loudenvielle à sa
    mairie — son « aller-retour » disparaît. Noms imprimés : Montflix
    (mal orthographié, non placé), rond-point Terwagne, et en relecture
    Le Gué-Ory, Le Gontard, Rudeau, Les Trois-Cerisiers, Dunkerque
    (entrée) et Pau (entrée) — deux circuits finaux déclarés (règle
    19), Dourgne placé à 219,5 (« 119,5 » imprimé, faute évidente).
    Bilan : 12 étapes sur 20 dans la tolérance (11 avant) ; 1995/16 de
    −23,2 % à −0,8 %, 1995/20 de −33,4 % à −19,8 %, 1995/2 de −5,4 % à
    −3,8 % ; 1995/4 (+15,5 % → +5,3 %, détour du routeur vélo) et 1995/5
    (+0,3 % → +5,2 %, le circuit de Dunkerque compensait Valines →
    Abbeville) sortent de la tolérance. Les 8 hors tolérance ont une
    note d'étape. 16 tronçons suspects, aucun aller-retour sûr et 3
    incertains, tous notés ; aucun tronçon routé en voiture.
  - 1993 trié, sur un passage BRouter. Noms imprimés mais omis,
    ajoutés : Roussillon et Le Chaudan (1993/12), Mont-Rouault
    (1993/4), « Bordeaux - entrée » (1993/18, non placée — le circuit
    final de Bordeaux sort de la mesure, `circuit_km` 184,5), Côte des
    Glaciers et Côte de Perrier (1993/12, non placées). Positions :
    Lamballe au centre de la commune nouvelle Lamballe-Armor (2,6 km,
    règle 15) ; Pluvigner, Saint-Étienne-de-Cuines, La Condamine-
    Châtelard et Commensacq à leur mairie, leurs allers-retours
    disparaissent (règle 17). Relecture adverse — règles 17 et 20 non
    appliquées aux tronçons suspects hors aller-retour : Tourrettes-sur-
    Loup à sa mairie (2,4 km, le tronçon suspect disparaît), Saint-
    Martin-du-Var à sa mairie (233 m au MNT pour 115 imprimés, règle
    14), Le Château-d'Olonne à sa mairie annexe (il était au centre de
    la commune nouvelle Les Sables-d'Olonne, sur l'arrivée) ; Pontorson
    → Précey : 15,8 km en vélo, 12,8 en voiture pour 12 au profil —
    détour du routeur ; trois notes qui posaient une hypothèse comme un
    fait, reformulées. Limite du routeur : BRouter (vélo) fait 44 km
    entre Roussillon et Le Chaudan, 13,5 en voiture pour 14 au profil.
    Bilan : 14 étapes sur 20 dans la tolérance (15 avant : 1993/18 sort,
    +7,0 %, une fois le circuit de Bordeaux retiré — l'ancien écart le
    compensait) ; les 6 hors tolérance ont une note d'étape. 14
    tronçons suspects, 1 aller-retour sûr et 1 incertain, tous notés ;
    aucun tronçon routé en voiture.
  - 1994 trié, sur un passage BRouter. Noms imprimés mais omis à la
    transcription (règle 18) : 14 trouvés au premier passage (Hennuin,
    Lostebarne, Côte de Farlington Avenue, Newfound, Burmah, Portsmouth
    (entrée), Côte de Brighton Elmgrove ×2, Sprint du mémorial,
    Lamonzie-Montastruc « près », carrefour D.21/N.21, Bergerac
    (entrée), Montpellier (entrée), Essertet), 11 de plus en relecture
    adverse sur les étapes que je n'avais pas relues (Ferques « près »,
    Colincthun, Blackhouse Hill, White Hill, Côte de l'embranchement,
    Les Allas « près », Aulery, Belmont, Aventignan, Saint-Gérard,
    Malbuisson) et l'arrivée du Lac Saint-Point, absente de
    l'itinéraire ; ceux dont le lieu n'est pas sourcé restent non
    placés. Circuits finaux (règle 19) : Brighton et Portsmouth ;
    Montpellier non déclaré (Castelnau suit l'entrée — déclaré, il
    réduisait la mesure à la moitié de l'étape). Positions : Faverges et
    Atur (communes nouvelles, règle 15), La Léchère (1 315 m au MNT pour
    380 imprimés) et le Mont Ventoux (sur une piste, 1 653 m pour 1 909 ;
    son « aller-retour » disparaît) — ces deux derniers trouvés en
    relecture. Notes qui attribuaient l'écart à une côte non routée,
    démenties par une mesure, corrigées (Boulogne, 1994/10, Winchester,
    Crowborough). Bilan : 12 étapes sur 20 dans la tolérance (10 avant) ;
    1994/4 de −8,0 % à −1,9 %, 1994/5 de −7,4 % à −2,2 % ; 1994/20 de
    −14,4 % à −12,5 % une fois l'arrivée ajoutée. Les 8 hors tolérance,
    toutes trop courtes, ont une note d'étape. 15 tronçons suspects, 0
    aller-retour sûr et 3 incertains, tous notés ; aucun tronçon routé
    en voiture.
  - 1987 repris (33.12, règles 14 et 21 appliquées après coup, le premier
    tri de 1987 les précédait ; la règle 18, nom par nom, ne l'est pas
    encore pour 1987/1, 1987/2 (Berlin : une dizaine de places et
    quartiers imprimés omis), 1987/3 (Theodor Heuss Strasse) et 1987/20
    (Hewlett-Packard) — repris en 33.20). Placés en deux passes (recherche
    bornée, variantes d'orthographe, mairies, altitudes au MNT contrôlées
    à l'altitude imprimée) :
    - premier passage : 36 lieux-dits, villages, cols et côtes, dont les
      côtes allemandes de 1987/3 à 1987/5, Laffrey à sa mairie, le Col
      d'Haltza, Sainte-Colombe et Les Bruns (Ventoux), Sainte-Foy et
      Val-Suzon (Bas), quatre côtes de 1987/15 ;
    - relecture adverse : 22 de plus. Mairies au lieu du centroïde
      (règle 17) : Messigny-et-Vantoux (1987/24 de +11,6 % à +5,7 %), Les
      Essards (1987/23 de +5,1 % à +4,0 %), Birkenfeld et Confolens,
      refusés à tort au centroïde. Variantes d'orthographe ou arrêt de
      bus pour 13 points notés « non trouvé » à tort (Hertmannsweiler —
      1987/3 de −5,4 % à −5,0 % —, La Pénarie, Maruéjols-lès-Gardon, La
      Réglisserie, Sagournat — l'image imprime « SAGOURNAT » —, Croix de
      Villeroy, Les Agets, Col du Ranfolly, Pavillon de Rolland,
      Saint-Sauveur, Geneton, Palais de l'Europe, Nemours). Cinq côtes
      dont le point stocké est déjà à l'altitude imprimée (Sexfontaines,
      Marigny, Dourdan, Châteaufort, Brié ; règle 14).
    Nemours : km imprimé 115, colonne du profil à ~121,5, coquille
    vraisemblable, km retenu d'après la colonne (noté). Km relus à l'image :
    Plaisance-du-Touch 130 (129 avant ; rend le tronçon vers Colomiers
    suspect, noté), La Chapelle-en-Vercors 150 (149,5). Refus notés, lieu
    trouvé : Col de la Serreyrède (aller-retour créé), Strasbourg au km 105
    (deux tronçons suspects au centre). Cinq notes périmées réécrites
    (Schöllbronn, Stuttgart, Haueneberstein, Gavet, Darois), une note mal
    attribuée retirée (Ahuy sur le Dijon de départ). Tous les points non
    routés ont une note.
    Bilan : 19 étapes contrôlables sur 24 dans la tolérance (13 avant la
    reprise) ; 19 tronçons suspects (22 avant), dont 8 portent leur
    contre-test voiture dans la note ; 4 allers-retours sûrs et 2
    incertains, notés ; aucun tronçon routé en voiture.
  - 1987 trié (32 tronçons suspects stockés avant le tri, 10
    allers-retours sûrs au premier passage 33.14) : 10 erreurs de
    position corrigées — Troo (2 km), Asasp-Arros (hameau d'Arros),
    Saint-Pierre-d'Entremont (3,6 km), Villard-Bonnot (Lancey, libellé du
    profil), Grange-l'Évêque (homonyme), La Giettaz (2,5 km), Beynac
    (2,5 km), Salignac (centre de la commune fusionnée, 3,8 km ; 1987/12
    de +13,7 % à +8,1 %), Aime (limite historique, 2,3 km), Col de
    Soudet placé (panneau OSM ; l'aller-retour incertain de 11 km depuis
    Sainte-Engrâce disparaît, 1987/13 à −0,3 %). Retirés, avec une
    note : le passage dans Karlsruhe (centre-ville incompatible avec le
    profil) ; relecture adverse : « Chaumeil (village) », que le profil
    met à 530 m quand le bourg est vers 630 m (MNT) — lieu non
    identifié ; Soligny-les-Étangs, dont le « 50 » est vraisemblablement
    une graduation (règle 2). Les autres tronçons sont relus sur
    l'agrandissement et justifiés par une note : profil contradictoire
    (Contrexéville, étape 12), boucles et points non routés (Berlin,
    Stuttgart, Gavet, Darois), traversées de bourg, arrivée de Millau en
    haut d'une montée non sourcée. Remesure : 13 étapes dans la
    tolérance (12 avant) ; 1987/20 de −5,2 % à −5,6 % — les tronçons
    corrigés collent au profil (Saint-Christophe → Saint-Pierre-
    d'Entremont : 9,9 km routés pour 10, 14,9 avant) ; 1987/3 de −9,0 %
    à −11,5 % (Karlsruhe retiré). Restent 22 tronçons suspects, 4
    allers-retours sûrs et 4 incertains, tous notés ; 13 tronçons routés
    en voiture (BRouter par intermittence : deux passages ne donnent pas
    toujours le même aller-retour, Beynac/La Roque-Gageac n'apparaît
    qu'en voiture).
  - 1992 trié, sur un passage BRouter (le premier passage 33.14, routé
    presque entièrement en voiture faute de BRouter, donnait 10 étapes
    hors tolérance et 15 allers-retours). Noms imprimés sur le profil
    mais omis à la transcription, ajoutés : Mornex (1992/12), Montigaud
    et Frappe (1992/4 — son tronçon suspect disparaît ; Libourne (entrée)
    ajoutée non placée), Saint-Sébastien (entrée) et Côte de Point B.
    (non placées, lieu non sourcé). Arrivées imprimées : « Boulevard du
    Centenaire » à Bruxelles (Heysel ; Wemmel → arrivée n'est plus
    suspect) et « avenue de la Zurriola » à San Sebastián. Positions :
    Labrit, Langerwehe, Felletin et Varize au centre de leur commune,
    à l'écart de la route — placés à leur mairie, leur aller-retour
    disparaît (relecture adverse : la première version les notait
    « traversée de bourg », fausse cause) ; Bourg-Argental (648 m au MNT
    pour 510 imprimés) à sa mairie. Le Salève retiré (crête entière,
    point en bout de route) : sa montée n'est plus mesurée, noté.
    Restent justifiés par une note : traversées réelles (Zumaia, La
    Garde, Roubaix), Col du Wettstein bien placé mais le routeur repart
    par la route des Crêtes, côtes rattachées à leur village ou non
    placées (Échallon, Hallembaye, boucle du Limbourg, Waldesch,
    Reinthal, Georgat — les 5 allers-retours incertains), centres de
    ville loin du passage (Bègles, Villeneuve-d'Ascq, Grenoble). Bilan :
    16 étapes sur 20 dans la tolérance (16 avant) — 1992/8 passe hors
    tolérance (−5,3 %) une fois Langerwehe replacé, 1992/12 y entre
    (+2,0 %) ; les 4 hors tolérance ont une note d'étape. 15 tronçons
    suspects, 4 allers-retours sûrs et 5 incertains, aucun tronçon routé
    en voiture.
- [x] 33.15 Règle 21 (élargie aux côtes et cols, 1996) appliquée aux
  éditions déjà triées, 1986 à 1995 : 368 points rattachés à leur
  commune (`geocodeAs`, hors villes) passés à Nominatim (nom du lieu +
  commune). 181 réponses, dont 117 ne sont que la limite administrative
  de la commune éponyme (« Côte de Pouzauges » → Pouzauges) : pas plus
  précises que le point actuel, écartées. 64 lieux nommés à moins de
  8 km ; 5 écartés à la main (homonyme à 6,8 km, zone d'activités,
  sommet sans référence, village andorran, Côte de la Reid qui crée un
  aller-retour connu). Chaque candidat testé seul sur son étape, en
  vélo uniquement : placé seulement s'il ne crée ni aller-retour ni
  tronçon suspect. Relecture adverse : le critère ne comparait ni
  l'altitude ni le nom renvoyé — 4 placements retirés (Côte de
  Hallembaye et Côte de Pourville au pied de la côte, 116 et 103 m sous
  l'altitude imprimée ; Mont-Theux, Nominatim renvoyait un autre lieu ;
  Côte des Rousses, hameau hors de la route) ; 3 refus dus à un repli
  voiture relancés et placés (Mont des Alouettes, Mériadec, Uriage),
  et un lieu connu sous un autre nom ajouté (Les Prodains, arrivée de
  1991/18). Bilan : 45 placés (dont Gourette, Le Chinaillon, Pla
  d'Adet, Luz Ardiden, Mont Cassel, Mont Saint-Clair, Côte de
  Douaumont, Les Prodains, L'Alpe d'Huez ×4) ; refusés par le test :
  Côte de Berdorf, La Mouline, Val-Louron, Hautacam 1994, Côte de
  Mont-Ormel, Châteauneuf-de-Chabre (repli voiture) ; Avonnex et Le
  Pont des Gets non testables (1994/19 non contrôlable) ; Côte de Brié
  laissée rattachée (Brié Bas, le pied de la côte). Effet : 1993/8 de
  −4,8 % à 0,0 %, 1994/2 de −12,0 % à −8,3 %, 1994/10 de −5,4 % à
  −2,3 % et 1995/13 de −5,1 % à −4,7 % (entrent dans la tolérance).
  Éditions 1987 à 1995 : 2 étapes de plus dans la tolérance, aucune de
  moins, 1 tronçon suspect de moins, aucun tronçon routé en voiture.
  Première mesure des allers-retours (33.14) sur 1989, 1990 et 1991,
  jamais remesurées depuis : préexistants, aucun sur un point placé
  ici — à trier avec 33.12 pour ces éditions.
- [x] 33.13 Règles de curation lues avant tout premier tracé (demande
  utilisateur du 19/10) : `docs/CURATION-REGLES.md`, 13 règles tirées
  des erreurs réelles des éditions déjà curées (lecture du profil,
  placement, contrôle), dont l'interdiction des allers-retours dans une
  étape ; CLAUDE.md règle 16 rend la lecture obligatoire avant la
  première étape d'une édition, et toute erreur trouvée en relecture
  ajoute ou précise une règle.
- [x] 33.14 Détection automatique des allers-retours (demande utilisateur
  du 19/10 : « jamais un Tour ne fait un aller-retour sur une même
  étape ») : `check-itineraries --legs` mesure, pour chaque point, les km
  du tracé routé sortant qui reprennent la route du tracé entrant (à 30 m
  près, milieu de segment compris) ; 1 km ou plus est signalé
  (« aller-retour à … ») et compté dans `route_check.backtracks`. Un
  virage serré vers une autre vallée ne reprend aucune route : un premier
  essai sur l'angle aux points en signalait 37, presque tous des
  changements de vallée (Le Bourg-d'Oisans → Huez). Relecture adverse :
  un signalement sur trois enjambait un point retiré, où le routeur ne
  suit pas la vraie route — signalé à part, « incertain »
  (`backtracks_uncertain`), jamais compté comme sûr ; seuil appliqué à la
  valeur exacte (0,95 km passait pour 1,0) ; corde entre deux points du
  tracé exclue. Tests aux bornes du seuil et de la tolérance, en latitude
  comme en longitude ; chaque mutation relevée en relecture échoue.
  Premier passage sur les 245 étapes mesurées (avant les corrections de
  1987) : 80 allers-retours sûrs sur 65 étapes, 53 incertains — à trier
  édition par édition avec 33.12 (1992 : 15, 1987 : 10, 1993 : 9…).
- [x] Édition 1986 (PR #423) : 23 étapes en ligne sur 23 (prologue de Boulogne-
  Billancourt non transcrit), 532 points placés sur 560 (491 sur 539 avant le tri 33.12). Contrôlée à
  ±5 % avant PR : 21 étapes dans la tolérance, 2 hors, affichées comme
  telles — 1986/1 (−36,5 %, contre-la-montre en boucles dans les
  Hauts-de-Seine : Bois-Colombes → Asnières 6 km au profil pour 1,6 km à
  vol d'oiseau, le parcours zigzague entre les communes) et 1986/2
  (+12,1 %, Viroflay → Versailles 2 km au profil pour 3,4 à vol
  d'oiseau : centre de commune loin du passage).
  Premier passage d'édition sous le contrôle par tronçon (33.11) —
  erreurs trouvées et corrigées : Côte du Châtelet placée au sud de
  Sablons, à contresens de l'étape — retirée (1986/19 de +8,9 % à
  −1,2 %) ; Huez placé au centroïde IGN de sa commune, dans la station
  de l'Alpe d'Huez. Relecture adverse : le premier correctif (point de
  la relation administrative Nominatim « Huez ») tombait lui aussi dans
  la station (géocodage inverse : avenue du Moulin, L'Alpe d'Huez) ;
  OSM n'a pas de nœud place=village pour Huez, le vieux village est
  donc placé à son église Saint-Ferréol (45,0774 ; 6,0533), avec une
  note, dans les 7 occurrences (1986/18, 1987/20, 1988/12, 1989/17,
  1990/11, 1991/17, 1992/14). Toujours en relecture : 1986/23 décalé
  d'un cran (Les Granges-le-Roi 154, Côte de Dourdan 158 ajoutée, La
  Forêt-le-Roi sans km imprimé, non placée) ; 1986/12, Col de
  Marie-Blanque ajouté au km 170 lu sur la graduation (chiffre non
  imprimé) — l'étape passe de +6,4 % à +2,0 %. Deux points notés « non
  placé » gardaient leurs coordonnées et restaient tracés et routés
  (La Forêt-le-Roi, Le Champ du Feu 1987/6) : coordonnées retirées ;
  1987/6 passe de −1,7 % à −5,7 %, hors tolérance, avec une note
  d'étape (détour du Champ du Feu non routé). Restent 23 tronçons
  signalés, centres de commune loin du passage ou boucles en ville,
  laissés tels quels. Circuits retirés de la mesure : Bordeaux (1986/11)
  et Champs-Élysées (1986/23). 29 tronçons routés en voiture (BRouter
  par intermittence), affichés. `check-itineraries` accepte désormais
  une étape seule (`1986/23`) en plus d'une édition.
- [x] 33.7 Entités administratives larges (trouvé sur 1989) : Bastogne
  placée sur son arrondissement (« county » OSM), 9,2 km au nord de la
  ville. Le rang « subdivision » de 33.6 couvre désormais aussi county,
  state_district, state, region, province, country (test, échoue sans le
  correctif, chaque type testé). Balayage des points Nominatim : 7 sur une entité large —
  Arlon (1980/3, 3,0 km), Bastogne, Charleroi (1989/4, 3,5 km), Audenarde
  (1992/6, 2,7 km), Ypres (1994/2, 2,5 km) recalés sur la ville ;
  Euskirchen inchangée (même point) ; Anvers (1996/2) retirée avec une
  note — le seul candidat compatible est le centre de l'arrondissement,
  le centre-ville est à 13 km de Schilde pour 8 km de profil. Remesure
  des éditions touchées : 1994/2 de −13,5 % à −12,0 %, 1996/2 de +2,2 %
  à −1,5 %, aucune étape ne change de verdict hors 1989.
- [x] 33.8 (PR #417) Arrivées « Paris (Champs-Élysées) » : l'ancre
  `stage_towns` de Paris (48,859 ; 2,347) est au Châtelet, à 3,3 km des
  Champs-Élysées ; les 8 arrivées transcrites (1989/21 à 1996/21) et les
  entrées sur le circuit (Concorde 1992/21, « Champs-Élysées » 1991-1996)
  en héritaient. Fait : arrivées et entrées sur l'avenue (Nominatim
  « Champs-Élysées, Paris », tourism, 48,87076 ; 2,30533) ou à la Concorde
  (même point qu'en 1989/21), sans `geocodeAs` désormais. Les tours du
  circuit final ne se routent pas d'un point au suivant : champ
  `circuit_km` (km de l'entrée sur le circuit, lu sur le profil), la
  mesure s'arrête au dernier point routable avant, sa part de l'étape se
  publie (test, y compris le chemin de `main()`). Posé sur les 7
  arrivées à Paris avec circuit et, après relecture adverse, sur 1989/3
  (circuit de Spa, km 211) et 1996/1 (boucle de 's-Hertogenbosch, km
  134). Effets : 1989/3 de −12,8 % à −4,7 % ; 1990/21 de −34,8 % à
  −8,4 % (la mesure s'arrête à Sèvres, l'entrée dans Paris n'étant pas
  placée) ; 1992/21 de −45,0 % à +3,3 % ; 1996/1 de −34,5 % à −16,9 % ;
  1991/22 de −1,9 % à −4,9 %, 1993/20 de −1,0 % à −3,8 %, 1994/21 de
  −6,6 % à −8,5 % (tronçon Issy → avenue désormais mesuré) ; 1995/20
  −33,4 % (cause ailleurs : Arpajon → Angervilliers, 36 km de profil pour
  13,5 km à vol d'oiseau, non tranché). 1989/21 (contre-la-montre
  Versailles → Paris, sans circuit) passe de −14,5 % à −18,6 % : le
  parcours chronométré suivait vraisemblablement les quais, le routeur
  coupe au plus court (cause D). Bilan sur les 179 étapes : 127 dans la
  tolérance (125 avant), 49 hors, 3 non contrôlables. Limite connue : la
  recherche par lieu ignore `circuit_km` (interpolation du km le long du
  circuit, inchangée).
- [x] 33.6 (PR #415) Candidat Nominatim « city_district » : le géocodage retient un
  point de commune déléguée (Bonneval, Les Vignes en 1990 ; relecture :
  aussi Tarcenay, Morez, Celliers, Noirterre) au lieu du village
  homonyme listé juste après. Même cause que Pontorson (33.3),
  mais par le chemin Nominatim, que `snapToTown` ne couvre pas. À faire :
  écarter ou déclasser ce type de candidat, puis remesurer les éditions
  déjà transcrites.
  Fait : une subdivision OSM (city_district, suburb, quarter,
  neighbourhood, borough) passe après tout autre candidat Nominatim
  compatible ; seule compatible, elle reste retenue. Une commune IGN
  trouvée par préfixe (autre commune) est au même rang qu'elle, pour ne
  pas la battre d'office (relecture adverse). Balayage des points
  Nominatim (≈ 670) : 69 sur une subdivision, 56 avec une localité
  homonyme, re-géocodés — 49 déplacés de 0,1 à 2,4 km (Belgique surtout :
  Stavelot, Spa, Theux, Wavre, Tournai… ; Vendeuvre-du-Poitou,
  Noirterre, Celliers en 1990), les autres revenus au même point faute de
  village compatible ; Vielsalm mise sur le candidat village de Nominatim
  (la relance ne la replaçait plus). Bug trouvé en relançant le géocodage :
  il replaçait les points retirés volontairement (Gravere, Artouste,
  arrivées de 1990 sans position sourcée) — un point `non-place` portant
  une note n'est plus jamais re-géocodé. Tests : chaque type de
  subdivision, commune IGN et col connu devant un village, préfixe contre
  subdivision, garde « non-place + note » — chaque mutation de ces règles
  fait échouer un test. La relance a aussi placé deux points jamais
  placés : Fischbach (1980/3), sur l'homonyme au sud de Diekirch, à
  contresens de l'étape (+19,9 %) — remise non placée avec une note ; Le
  Bourg-d'Oisans (1992/14), au village, même point qu'en 1990/11.
  Remesure (10 éditions changent ; 1992 et 2002 remesurées une 2ᵉ fois
  pour éliminer des tronçons routés en voiture, 0 désormais) : 110
  étapes dans la tolérance sur 155 contrôlées (111 avant). Entre 1992/6
  (−5,1 → −2,6 %) ; 1990/2 passe de +14,6 % à +8,0 % ; sortent 1995/7
  (−4,4 → −6,8 %, Spa replacée sur la ville, 2,2 km) et 1992/14 (+4,0 →
  +5,2 %, Le Bourg-d'Oisans désormais placé). Écarts affichés, pas
  ajustés.
- [x] 33.4 (PR #411) Contrôle à ±5 % des itinéraires (demande du 18/10/2026 : « 5 %
  max de tolérance ») : `scripts/check-itineraries.js` route l'itinéraire
  point par point et compare au kilométrage du profil, avec
  DIST_TOLERANCE_PCT (±5 %). Premier tronçon exclu (le km 0 est le départ
  réel, après la zone neutralisée). Décision de l'utilisateur : mesurer et
  afficher — l'écart s'affiche dans la recherche par lieu, jamais masqué.
  Mesure du 18/10 sur 115 étapes (après relecture adverse) : 63 dans la
  tolérance, 50 hors, 2 non contrôlables. La part de l'étape contrôlée est
  publiée et affichée (83 étapes contrôlées sur moins de 95 % de leur
  longueur — premier tronçon et extrémités hors calcul). **Limite de la
  mesure** : BRouter (vélo) a refusé 333 tronçons (HTTP 403), routés en
  voiture par OSRM ; 33 étapes mesurées surtout en voiture, signalé à
  l'affichage. Causes des écarts observées :
  départ réel hors du km 0, circuits finaux (Champs-Élysées), côtes et
  hameaux exclus du calcul (route coupée, écart négatif), et vraies
  erreurs de position — à corriger une à une (33.5).

- [x] 33.5 Tri des étapes hors ±5 % (18/10/2026, PR #413) : `check-itineraries
  --legs` liste les tronçons suspects ; deux analyses ont classé chaque
  étape (A position fausse, B km mal transcrit, C circuit/points espacés,
  D routeur) — aucun cas B. 25 corrections (24 déplacements, 1 retrait),
  chacune sourcée et re-routée : cols jamais placés (Jaizkibel, Wettstein), centroïdes de
  commune au lieu du bourg (≈ 15 villes), Val-d'Isère à 2,5 km du village
  (1996/8 de +70,8 % à la tolérance), col de la Grosse Pierre au km 164
  de 1979/13 (était le col du Haut de la Côte ; la fiche nomme les deux
  cols au même km 164 sous un seul symbole, le pic à 955 m est la Grosse
  Pierre — le Haut de la Côte, 799 m, reste nommé ici mais n'est pas
  placé : un second point au même km fausserait le routage), Gravere
  (1996/10) retiré faute de position vérifiée — l'étape passe de +11,6 %
  à −0,1 %, surtout grâce au retour de BRouter (12 tronçons voiture → 0),
  les deux effets non séparés. stage_towns.json : 6
  occurrences fausses de Val-d'Isère et Villeneuve-sur-Lot corrigées.
  Mesure après tri, 1991 comprise : 137 étapes, 96 dans la tolérance, 39
  hors, 2 non contrôlables ; 11 tronçons sur 1 615 routés en voiture
  (BRouter de nouveau disponible). Les 39 restantes sont des causes C
  (circuits finaux, côtes et hameaux exclus du calcul qui coupent la
  route) ou D (détours du profil vélo ; 1995/4 : pont de Normandie
  interdit aux vélos) — pas d'erreur de donnée trouvée, écart affiché.
- [x] 33.16 (PR #468) Examen des pistes Wikidata, villes (`docs/WIKIDATA-RECOUPEMENT.md`,
  34.1) — critères : chacune des 41 lignes de villes signalées (32 villes
  distinctes, à plus de 10 km de la ville Wikidata) est classée « homonyme
  chez nous » (position corrigée dans `stage_towns_overrides.json`, source
  citée, étapes voisines re-contrôlées), « erreur ou date décalée côté
  Wikidata » (laissée, cause notée) ou « lieu de départ réel distinct de la
  ville-étape » (ex. 1903/1, Montgeron près de Villeneuve-Saint-Georges :
  à sourcer avant toute décision) ; aucune correction sans source
  (règle 12). Curation de données : CI verte, pas de relecture adverse
  dédiée (règle 11). Fait : classement dans `docs/WIKIDATA-EXAMEN.md`,
  17 lignes corrigées (Wikipédia cité par entrée), rapport régénéré de 41
  à 24 lignes, 1993/16 recontrôlée (inchangée, −1,8 %). Les distances et
  les dates, d'abord comptées dans cette story, passent en 33.17.
- [x] 33.17 (PR #470) Tri des 16 écarts de distance et des 28 dates décalées du
  recoupement Wikidata — critères : chaque ligne classée « notre donnée
  fausse » (corrigée, source citée), « Wikidata faux » (laissée, cause
  notée) ou « non tranché » (deux sources qui divergent, les deux citées) ;
  aucune correction sans source (règle 12) ; curation, pas de relecture
  adverse dédiée. Fait : classement dans `docs/WIKIDATA-EXAMEN.md`,
  fr.wikipedia en troisième source — distances : 8 fausses chez nous, 5
  côté Wikidata, 2 non tranchées, 1998/12 gardée (distance courue) ;
  dates : 15 fausses chez nous, 13 côté Wikidata. La correction, faute de
  mécanisme pour une distance ou une date officielle, passe en 33.19.
- [x] 33.19 (PR #471) Corrections officielles sourcées appliquées à l'import — un
  fichier de données (`pipeline/data/official_corrections.json`) porte,
  par « édition/étape », une distance, une date ou une ville de départ
  ou d'arrivée corrigée, chacune avec sa source ; critères : appliqué par
  l'import d'édition (`pipeline/wikipedia.js`, le tableau Wikipédia lu en
  direct) et par `scripts/build-stage-towns.js` ; une entrée sans source
  est refusée (test) ; la valeur Wikipédia d'origine reste visible
  quelque part (note de l'étape, ou champ de l'export), jamais effacée en
  silence (règle 12) ; les 8 distances et 15 dates « notre donnée fausse »
  de `docs/WIKIDATA-EXAMEN.md`, plus 1984/6 (Cergy-Pontoise, 33.18),
  saisies ; changement de code, donc relecture adverse.
- [x] 33.18 (PR #469) Libellé faux pris à un lien Wikipédia : 1984/6 part de
  « Louvroil » parce que en.wikipedia écrit `[[Louvroil|Cergy-Pontoise]]`
  — critères : `stage_towns_overrides.json` accepte un `label` facultatif
  par occurrence, refusé par libellé (testé, `applyOverrides`, réapplication
  sans effet) ; 1984/6 départ devient Cergy-Pontoise, source citée
  (arrivée de 1984/5, Wikidata) ; recherche dans les 113 tableaux
  en.wikipedia des liens dont le texte ne nomme pas la cible (liste dans la
  PR) ; le parseur (`pipeline/wikipedia.js`) n'est pas changé : préférer le
  texte affiché aurait déplacé 10 autres cellules, souvent à tort (1976,
  `[[Pla d'Adet|Saint-Lary-Soulan]]` : arrivée au sommet renvoyée dans la
  vallée) ; changement de code, donc relecture adverse.
- [x] 33.20 (PR #474) Règle 18 (nom par nom) sur 1987/1, 1987/2, 1987/3 et 1987/20,
  restée à faire après 33.12 — critères : chaque profil relu sur
  agrandissement (tiers ×4,5, sixièmes ×5) contre la transcription ; tout
  nom omis ajouté avec son km, placé seulement si une recherche bornée le
  trouve et qu'il est compatible avec ses voisins à vol d'oiseau (règle 7),
  sinon noté ; entrées de circuit final déclarées (règle 19) ;
  `check-itineraries --write --legs` sur les étapes touchées, sur un
  passage BRouter (`car_legs` à 0), chaque tronçon suspect trié (règle 20 :
  contre-test voiture avant « cause non établie ») ; curation de données
  pure, sans relecture adverse dédiée (CLAUDE.md, règle 11).
  Fait : 1987/1 (étape en ligne, et non contre-la-montre comme le disait
  sa note — en.wikipedia « Plain stage ») passe de 5 à 17 noms (12 ajoutés, dont 9
  placés par recherche bornée dans Berlin-Ouest ; 2 points jusqu'ici non
  placés le sont), Berliner Strasse (homonyme non
  tranché) et Boenig-Strasse (introuvable) notés, circuit final au 1er
  passage (km 97,5) ; contrôlable pour la première fois : −6,4 % — le
  tronçon Astern Platz → Mohriner Allee est un écart du routeur vélo
  (13,2 km en voiture pour 13,5). 1987/2 passe de 4 à 10 noms (6 ajoutés, tous placés), carrefour
  Potsdamer Chaussee / Ritterfelddamm placé sur le nœud OSM commun
  (Overpass), Spandau retiré (vieille ville incompatible, 5,6 km pour 4) :
  de −33,1 % à −1,2 %. 1987/3 : « Theodor Heuss Strasse (1er passage) »
  (km 207,5) ajouté, circuit final déclaré, libellés de départ et
  d'arrivée restaurés ; −5,6 % sur 85 % de l'étape. 1987/20 : aucun nom
  omis — « Hewlett-Packard » est le nom du sprint d'Eybens, pas un lieu.
- [x] 33.21 (PR #479) Ancre « Luchon » de `stage_towns.json` au centre de
  la commune, 5,6 km au sud-est de la ville et à 1 198 m au MNT (ville à
  629 m), sur 76 départs et arrivées (1910-1998) — trouvée par le contrôle
  de 1998/10 (col de Peyresourde → Luchon : 22,0 km routés pour 15,5).
  Critères : position vérifiée dans `stage_towns_overrides.json` avec sa
  source ; les 76 occurrences, et elles seules, déplacées (diff sémantique
  du fichier) ; `npm test` vert. Position : celle de « Bagnères-de-Luchon »
  (même ville, recalée en 33.10).
- [x] 33.22 (PR #498) Balayage des ancres hors IGN de `stage_towns.json` : le recalage
  sur le bourg OSM de 33.10 ne vise que les communes IGN ; 298 positions
  géocodées autrement (135 `geocode+nominatim`, 113
  `geocode-pays+nominatim`, 38 `nominatim`…) n'ont pas été recalées, et
  Luchon (33.21) montre qu'une relation de commune peut y donner le
  centre géographique. Critères : liste des positions à 3 km ou plus de
  leur localité OSM, chacune vérifiée (altitude MNT, voisins), corrections
  dans `stage_towns_overrides.json` avec source ; si le générateur change,
  relecture adverse.
  Fait (issue #497) : 299 positions distinctes ; 17 à 3 km ou plus de la
  localité OSM homonyme la plus proche, dont 8 sans erreur — l'homonyme est
  simplement ailleurs (West Berlin, Mont Saint-Michel, Hautacam, Felsberg,
  Puy Mary, Zeeland, La Défense, La Plagne : sites ou régions, pas des
  localités). 83 sans homonyme OSM (cols, stations, sites) : les 11 villes
  de la liste au nom ancien ou fusionné contrôlées aussi par géocodage
  inverse. Corrigées, chacune par géocodage inverse et MNT : Chamonix
  (12 occurrences, ancre à 2 271 m sur le massif), Escaldes-Engordany
  (2 122 m), Aime (1 743 m, commune nouvelle), Cuneo (centre de la
  province, 7,7 km), Colombey-les-Deux-Églises (sur Biernes), Rochefort
  (Éprave), Cosne-sur-Loire (Saint-Père), Livarot (commune nouvelle),
  Valkenburg (Berg en Terblijt) ; par occurrence, arrivées sourcées au
  Bettex (2016/19) et à Avoriaz (2010/8, le départ 2010/9 reste à
  Morzine). Vol d'oiseau des 26 étapes touchées : toutes sous 90 % de la
  longueur officielle. Générateur inchangé : pas d'agent dédié.
- [x] 33.23 (PR #480) Reprise de 1992 sur BRouter auto-hébergé, avec les
  règles 17, 20 et 24. Critères : 0 tronçon en voiture ; chaque
  aller-retour corrigé ou noté avec sa mairie ; chaque « cause non
  établie » passée au contre-test voiture. Fait : Livet (1992/15) placé au
  village, comme en 1997 et 1998 — le centre de la commune, près de
  Rioupéroux, raccourcissait Livet → Gavet de 3 km et cachait une partie
  de l'écart (+5,1 % → +7,0 %, règle 24) ; La Garde et Roubaix : point à
  la mairie, aller-retour noté (règle 17) ; Col de Wettstein → Schlucht :
  17,1 km en voiture pour 17 au profil, c'est le routeur vélo (règle 20) ;
  1992/15 et 1992/18 : « cause non établie » remplacée par le contre-test
  voiture (profil plus court que la route). Résultat : 16 étapes dans la
  tolérance, 4 hors (7, 8, 15, 18), toutes notées. Limite : les points de
  1992 ne portent pas leur altitude imprimée, le contrôle d'altitude
  (règle 14) n'a pas pu être rejoué.

- [x] 33.24 (issue #517, PR #518) Points placés à la main notés `ambiguous` : la
  recherche par lieu ne connaît que `ambigu`, et 118 points
  (éditions 2002 et 2005 à 2015) passaient pour sûrs. Critères : un résultat dont
  le point le plus proche est `ambiguous` affiche « position du point
  approchée », texte distinct de l'homonyme possible ; le test
  d'invariant de `stage_itineraries.json` refuse une valeur de
  `confidence` inconnue ; test vérifié en échec sans le correctif.
  Fait : `GEOCODE_WARN` reçoit `ambiguous` (« position du point approchée,
  voir la note de l'étape ») ; test d'invariant : valeurs permises
  {ok, ambigu, ambiguous, non-place}, et chacune des valeurs incertaines a
  son avertissement (le test échoue si l'une manque, relecture adverse).
  Vérifié à 1440 et 375 px sur la recherche « Mauvezin » (2015/11).

## Epic 34 — Idées venues d'autres dépôts (veille du 18/10/2026)

Veille open source (dépôts clonés, licences et derniers commits relevés,
Wikidata interrogé en direct). Seul le code MIT/BSD/Apache peut être repris
avec attribution ; AGPL/GPL (Dreeve, Endurain, FitTrackee, wanderer,
GoldenCheetah) : idées seulement.

Actionnables sans décision :
- [x] 34.1 (PR #464) Départs/arrivées par identifiant Wikidata (CC0, 2 428 étapes
  1903→2026, ville de départ P1427, d'arrivée P1444, distance P3157) pour
  recouper `stage_towns.json` : supprime les homonymes à la source —
  critères : `scripts/wikidata-crosscheck.js` interroge Wikidata édition par
  édition (étapes reliées par P361 à l'édition, libellé anglais exact ;
  User-Agent identifié, 1,5 s au moins entre deux requêtes, une nouvelle
  tentative sur 429/5xx, cache disque sans réponse vide) ; apparie par les
  villes (départ et arrivée à 10 km près) le même jour puis à ±2 jours —
  une date décalée est signalée comme telle, pas comme un homonyme — puis,
  à défaut, par date et distance la plus proche (demi-étapes, clés 13a/13b) ;
  signale sans rien modifier (règle 12) les villes placées à plus de 10 km
  de la ville Wikidata, les distances à plus de 5 % et 1 km, les dates
  décalées et les étapes sans correspondance ; rapport
  `docs/WIKIDATA-RECOUPEMENT.md` (118 éditions, aucune erreur de requête :
  41 lignes de villes pour 32 villes distinctes, 16 distances, 28 dates
  décalées, 0 sans correspondance) ; comparaison pure testée sans réseau
  (`test/wikidataTowns.test.js`). L'examen des pistes est la story 33.16.
- [x] 34.2 (PR #465) Calques IGN historiques (Carte 1950 `GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950`,
  état-major `…ETATMAJOR40`, photos aériennes 1950-1965) dans l'éditeur et la
  fiche — couches relevées dans le GetCapabilities ; licence à confirmer
  couche par couche. — critères : un sélecteur de fond sur la carte de la
  fiche et de l'éditeur propose le plan IGN actuel, OpenStreetMap et les
  trois fonds historiques (carte 1950 SCAN 50, carte de l'état-major
  1820-1866, photos aériennes 1950-1965), étiquetés « France » : leurs
  tuiles sont blanches ou absentes ailleurs ; sur la fiche, ils ne sont
  proposés que dans la boîte englobante `inFrance` (grossière : Barcelone ou
  Bruxelles y entrent), OSM par défaut hors de cette boîte ; identifiants,
  matrices de tuiles (PM_3_15, PM_6_15, PM_0_18, d'où `minZoom` 3, 6 et 0)
  et formats relevés dans le GetCapabilities de data.geopf.fr le
  20/10/2026 ; licence lue dans la fiche CSW de chaque couche
  (IGNF_SCAN-50-HISTO, IGNF_SCAN-EM-40K, IGNF_BD-ORTHO-HISTO : Licence
  Ouverte / Open License, aucune restriction d'accès) ; attribution avec
  lien vers la fiche de la couche et vers la licence (la Licence Ouverte
  demande source et date de mise à jour, ou un lien vers la source) ; une
  tuile réelle de chaque couche répond 200 (`test/historicLayers.test.js`,
  vérification Playwright avec les vraies tuiles).
- [x] 34.3 (PR #463) Heatmap géographique de toutes ses traces (idée derive / VeloViewer)
  — critères : `GET /api/traces/lines` renvoie le tracé simplifié (au plus
  400 points, `[lat, lon]`) de chaque trace importée (`tracks.router =
  'trace'`, comme le bilan) et écarte une trace au geojson illisible sans
  faire échouer la carte ; la section Exploration de Mes traces superpose
  toutes les traces en trait semi-transparent (les routes souvent
  parcourues foncent), infobulle échappée nom + date ; carte masquée sans
  trace ; pas de débordement à 390 px (`test/traceLines.test.js`,
  vérification Playwright). Pas une vraie heatmap par densité (pas de
  nouvelle dépendance) : superposition d'opacités.
- [x] 34.4 (PR #461) Nombre d'Eddington (distance et D+) dans le bilan (idée
  geo-activity-playground, MIT) — critères : deux tuiles du bilan de Mes
  traces donnent le plus grand E tel qu'au moins E jours roulés atteignent
  E km (distance) et E × 100 m (D+, tranche choisie ici et écrite dans le
  libellé, pas une norme), avec les jours qui manquent pour le palier
  suivant ; calcul sur les totaux par jour déjà fournis par
  `/api/traces/summary` (plusieurs sorties le même jour s'additionnent) ;
  valeurs absentes ou négatives ignorées, jamais comptées comme 0
  (`test/eddington.test.js`, vérification Playwright 1280 / 390 px).
- [x] 34.5 (PR #462) Indice FIETS à côté de la catégorie approchée (formule publique ;
  bonus d'altitude à trancher par un test) — critères : la fiche d'une côte
  affiche « indice FIETS » = H² / (D × 10) + max(0, (sommet − 1000) / 1000),
  H et D en mètres (`EFProfile.fietsIndex`) ; forme donnée par Runalyze
  (vérifiée sur runalyze.com/help/article/climb-score), le plancher à 0 du
  bonus sous 1000 m est un choix du dépôt ; d'autres variantes du bonus
  (T / 1000, partie entière) sont citées par la veille mais non
  revérifiées à la source ; formule affichée en infobulle, pas présentée
  comme officielle ; H pris sur le profil lissé (blocs de 1 km), pas sur
  le maximum brut du sommet ; donnée manquante ou côte qui ne monte pas : pas d'indice
  (jamais 0 m supposé) (`test/fietsIndex.test.js`, vérification Playwright).
  Au passage : score, indice d'irrégularité, points et facteur de fatigue
  de l'indice de douleur à la virgule décimale (oubli de la 35.19).
- [x] 34.6 (PR #466) Profil coloré par surface et par FC (données déjà présentes) —
  critères : au pied du profil de la fiche, une bande « Rev. » colore les
  tronçons non revêtus, non revêtus présumés et pavés (`track.surfaces`),
  une bande « FC » colore chaque portion selon sa zone de FC (Z1 à Z5,
  FC max saisie ; rien sous Z1 ni sans FC) ; teinte unique du clair au
  foncé pour les zones (grandeur ordonnée), couleurs distinctes pour les
  revêtements ; infobulle par portion, légende en texte sous le profil
  (jamais la couleur seule) ; bande absente sans donnée ; redessinée quand
  la FC max change (`test/profileStrips.test.js`, vérification Playwright
  1280 / 390 px sur une trace avec FC et revêtements).
- [x] 34.7 (PR #467) Zones de confidentialité autour du domicile dans les exports et
  mini-sites de traces (idée geo-activity-playground) — critères : jusqu'à
  5 zones (latitude, longitude, rayon de 100 à 5000 m), réglage de
  l'instance comme la FC max (`PUT /api/profile`, admin seul en mode
  public ; un champ absent est laissé tel quel, aucun champ → 400) ; les
  points d'une trace importée situés dans une zone sont retirés des exports
  JSON, GPX, TCX, KML, HTML autonome, du roadbook, du mini-site, de l'export
  et de la carte d'une édition à laquelle la trace est rattachée, du site
  statique (`scripts/build-site.js`) et de la carte « Toutes mes traces »,
  ainsi que les côtes, descentes, faux-plats et lignes du km par km qui
  recouvrent une portion masquée, et la commune de départ (`city_hint`)
  si le départ est masqué ; une zone stockée invalide est écartée seule,
  un réglage illisible fait retirer tous les points (jamais publier faute
  de savoir) ; les étapes historiques ne sont pas touchées ; la trace reste complète en base et dans la fiche de
  l'application ; formulaire « Confidentialité » dans Mes traces
  (`test/privacyZones.test.js`, vérification Playwright 1280 / 390 px).
  Limites, écrites ici : couper la trace révèle le bord de la zone, pas
  son centre ; en mode public, tout compte connecté voit encore la trace
  entière dans l'application (traces partagées par l'instance, sans
  propriétaire).

En attente de décision (proposées, non commencées) :
- 34.8 « Sur les traces du Tour » : part d'une étape historique déjà roulée,
  cols du Tour gravis (périmètre).
- 34.9 Tuiles explorateur z14 / plus grand carré (revient sur un choix noté
  dans `archives.js`).
- 34.10 Listes personnelles (« cols à faire »), alertes d'entretien du
  matériel, bilan annuel, charge d'entraînement TRIMP (choix du modèle).
- 34.11 Relief Mapterhorn hors de France (architecture, licences des données).
- 34.12 Nouvelles sources admises pour la curation : Gallica (*L'Auto*,
  itinéraires horaires d'avant 1950), itinéraires horaires ASO republiés par
  les collectivités (≥ 2010), LeTourDataSet (données issues de letour.fr,
  contraire à la règle actuelle du README).

## Epic 35 — Correctifs de la revue globale du 19/10/2026

Revue globale de `main` f0dd08e : chasse aux bugs backend/pipeline, QA
Playwright (desktop 1280×800, mobile 390×844), 37 personas. 908 tests verts
au moment de la revue : aucun des bugs ci-dessous n'était couvert. Chaque
story commence par un test qui échoue sans le correctif, et se termine par un
grep du même motif sur tout le dépôt (règles 1 et 10).

- [x] 35.1 (PR #439) Robustesse serveur — critères : deux inscriptions simultanées du
  même email donnent 200 + 409 sans arrêter le process (`/register` et
  `/login` passent par `wrap()`) ; un cookie voisin mal encodé (`other=50%`)
  ne donne plus 500 ; un waypoint hors [-90, 90] × [-180, 180] est refusé en
  400 à la création et à la modification, comme à l'import de sauvegarde ; un
  point de trace (GPX, FIT, Strava, Suunto) hors bornes est écarté ; une
  génération sur un waypoint déjà en base hors bornes échoue proprement au
  lieu de saturer la mémoire ; un clic sur une copie du monde dans l'éditeur
  donne une longitude ramenée dans [-180, 180) (`test/authRobustness.test.js`,
  `test/backupBounds.test.js`).
- [x] 35.2 (PR #443) Parseur GPX linéaire — critères : 60 000 `<trkpt>` jamais fermés
  (~1,8 Mo) et 200 000 `<name>` jamais fermés se lisent en moins de 2 s (avant :
  920 Ko figeaient le serveur 8,2 s) ; `lon` avant `lat`, guillemets simples et
  espaces autour de `=` sont acceptés ; la balise fermante d'un point n'est
  jamais cherchée au-delà du point suivant ; restent linéaires (< 2 s pour
  ~1 Mo) des `<trkpt ` sans `>`, un `<time>` non fermé suivi d'espaces, des
  commentaires non fermés ; `data-lat` n'est pas lu comme `lat`, seule une
  valeur décimale simple est acceptée, un point commenté ou en CDATA n'est
  pas un point (`test/parseGpxLinear.test.js`).
- [x] 35.3 (PR #440) Réimport d'une année — critères : un tour personnalisé de la même
  année n'est jamais supprimé (`is_custom = 0` dans la recherche) ; l'API
  refuse en 409 de réimporter une édition qui a des étapes générées ou en
  génération, sans rien effacer, sauf `replace: true` ; l'interface (bouton,
  vignettes mythiques, « défi du jour ») affiche le refus et un bouton
  « Réimporter quand même » à double confirmation ; le contrôle est refait
  dans la transaction qui supprime (une génération lancée pendant l'appel
  Wikipédia fait refuser l'import) ; le bouton « Importer toutes les
  éditions » laisse ces éditions intactes et les compte à part (`skipped`),
  tandis que le catalogue complet (`import-all-and-generate.js`) et la démo
  gardent le remplacement intégral pour reprendre une curation modifiée ;
  le message de l'interface est annoncé (`aria-live`) ; une année non
  entière (1903.7) est refusée en 400 (`test/reimportGuard.test.js`,
  vérification Playwright). La CLI et `agent-curate-stage.js` gardent le
  remplacement explicite.
- [x] 35.4 (PR #441) L'éditeur conserve la provenance des waypoints — critères :
  renommer une étape curée depuis l'éditeur garde à l'identique `source`,
  `altitude_hint_m`, `bonus_sec`, `country_hint` et `region_hint` de chaque
  point (POST et PUT écrivent tous ces champs, `bonus_sec` validé en liste
  de secondes) ; retaper le libellé d'un point efface sa provenance ; un PUT
  refusé en 400 n'écrit plus rien (validation avant écriture, transaction) ;
  choisir un tour dans l'éditeur n'est plus refusé (`edition_id` envoyé en
  nombre) (`test/waypointProvenance.test.js`, vérification Playwright).
- [x] 35.5 (PR #442) Arithmétique de l'altitude — critères : le « D+ cumulé » du
  dernier km égale le D+ de l'étape (segment à cheval sur deux km réparti au
  prorata ; démo : Paris → Lyon 1 592 m pour 1 592, contre 1 193 avant) ; un
  échantillon sans altitude n'est plus exporté à 0 m (GPX `<ele>` et TCX
  `<AltitudeMeters>` omis, KML `lon,lat` et tracé laissé au sol) ; une trace
  aux altitudes toutes aberrantes passe par les fournisseurs au lieu d'un
  profil à 0 m ; `fillNearestValid` prend vraiment le voisin le plus proche
  et refuse un tableau entièrement vide (`test/kmanalysisAscent.test.js`,
  `test/importTrackSentinel.test.js`, `test/exports.test.js`,
  `test/elevationGaps.test.js`).
- [x] 35.6 (PR #447) Validation des longueurs et des valeurs — critères : POST/PUT
  /api/stages refusent en 400 un nom ou un statut de plus de 200 caractères,
  un type de plus de 40, un libellé de waypoint de plus de 200, une date qui
  n'est pas un jour AAAA-MM-JJ réel (« 2026-02-30 » compris ; vide = pas de
  date), un `kind` hors start/via/col/sprint/finish, un `edition_id`
  inexistant (violation de clé étrangère en 500 avant) ; `?name=a&name=b`
  à l'import GPX/FIT et une ligne null dans une sauvegarde donnent 400 au
  lieu de 500 (un nom de fichier long est tronqué à 200, pas refusé) ; nom
  d'édition borné à 200 ; champs de l'éditeur en `maxlength`
  (`test/inputValidation.test.js`). Reste ouvert : l'import de sauvegarde ne
  revalide ni longueurs, ni dates, ni kinds.
- [x] 35.7 (PR #448) Couche réseau — critères : un corps de réponse qui ne finit
  jamais est abandonné au délai (`fetchWithTimeout` lit le corps sous le
  timer : httpJson, httpText, Strava, Suunto) ; les connexions OAuth Strava
  et Suunto émettent un `state` aléatoire à usage unique (10 min), et un
  callback sans `state` valide ne connecte aucun compte ; l'import par lien
  revérifie chaque redirection contre la liste blanche (une redirection vers
  169.254.169.254 est refusée) ; l'URL d'un webhook n'est plus écrite en
  entier dans les logs (`test/networkLayer.test.js`).
- [x] 35.8 (PR #444) Frontend — critères : la colonne « Max cat. » de la carte globale
  affiche la catégorie la plus dure (`maxCategory`) ; une fiche d'étape
  inexistante (404) affiche « Étape introuvable » et cesse de sonder (une
  vraie panne réseau reste retentée) ; les jours calendaires (« AAAA-MM-JJ »)
  et les mois ne reculent plus d'un jour en UTC− (`timeZone: 'UTC'`, 10
  occurrences dans traces.js et archives.js) ; les tuiles « Éditions
  explorées » sont identifiées par l'id d'édition et marquent Femmes
  (« 2022 F ») (`test/frontendReviewFixes.test.js`, vérification Playwright
  en fuseau America/New_York).
- [x] 35.9 (PR #445) Export TCX — critères : une date d'étape qui n'est pas un jour
  AAAA-MM-JJ valide (texte Wikipédia non lu, « 2026-13-45 ») ne fait plus
  planter l'export (repli sur la date conventionnelle) ; chaque `CoursePoint`
  de waypoint est daté à sa position sur le tracé (arrivée de 98,4 km à
  25 km/h : départ + 3 h 56 min) au lieu de l'heure du départ ; les
  `CoursePoint` sont triés par heure et le `<Notes>` du Course précède les
  `CoursePoint` (ordre du XSD TCX v2 : les TCX de la démo valident désormais
  contre le schéma Garmin avec xmllint) ; une date impossible (30 février)
  n'est plus décalée au 2 mars (`test/exports.test.js`).
- [x] 35.10 (PR #446) Wikipédia — critères : « Medium mountain » et « Intermediate
  stage » donnent `accidentée`, « Mountain time trial » garde `clm` ;
  `isColQuery` n'accepte plus le mot-clé qu'en tête du libellé ou d'un de ses
  segments (« / », « – », parenthèse), et un mot-clé suivi d'un trait
  d'union seulement pour Mont-Ventoux, Plateau-de-Beille et Puy-de-Dôme :
  Mont-de-Marsan, Le Mont-Dore, Mont-Saint-Père, Pagny-la-Blanche-Côte,
  Montélimar ne sont plus des cols (`test/colQueryType.test.js`). Audit sur
  les 5 048 libellés des données : aucun col de `historic_routes.json` ni de
  `stage_towns.json` (données de génération) perdu ; dans
  `stage_itineraries.json`, Mont-Theux, Mont-Rouault, La Grande-Côte et le
  `geocodeAs` Mont-Ormel ne seraient plus reconnus par leur nom, mais ces
  points portent leur `kind` explicite et ne passent pas par `isColQuery`.
  Saisie libre : séparateurs « - » espacé, « , », « → » ; noms composés
  « Col-de-… », « Alpe-d'Huez », « Côte-de-… » et une liste fermée de sommets
  (Mont-Ventoux, Puy-de-Dôme…) restent des reliefs.

- [x] 35.11 (PR #449) Textes faux ou surévalués — critères : `archives.html` ne dit plus
  qu'aucune édition Femmes n'est curée (2022 Femmes : étapes 2 à 8) et liste
  toutes les éditions curées de `historic_routes.json` (1992, 2002, 2015,
  2017, 2018, 2019, 2022 Femmes manquaient) ; l'écran d'accueil ne promet
  plus « n'importe quelle étape … à partir de sources vérifiées » (environ
  130 étapes curées) ; le temps fort 2017 ne dit plus qu'un CLM a été
  « remporté par Marseille » (une ville).
- [x] 35.12 (PR #450) Petits correctifs backend — critères : le cache de
  `/api/search/near` voit un renommage, un changement de date, d'édition ou
  de coordonnées ; un intervalle de sauvegarde au-delà de 596 h (ou négatif,
  ou illisible) ne déclenche plus une sauvegarde par milliseconde ; le nom du
  fichier exporté ne reprend que l'id entier (plus d'injection de
  `filename=`) ; `/api/status` ne donne plus les chemins absolus de la base
  et des sauvegardes en mode public ; PUT et DELETE d'une étape en cours de
  génération sont refusés en 409 ; un `stage_type` vide envoyé par
  l'éditeur n'efface plus le type stocké (`test/backendReviewFixes.test.js`).
- [x] 35.13 (PR #451) Petits correctifs frontend — critères : la page Archives
  demande les détails des éditions en parallèle et remplace la liste d'un
  bloc (plus de requêtes en série ni de liste vidée à chaque sondage) ;
  « Régénérer » demande une double confirmation et affiche l'erreur au lieu
  d'un rejet non géré ; les totaux et la tuile « distance reconstituée » de
  la carte globale ne portent que sur les étapes générées et le disent ; un
  bouton à double confirmation retrouve son libellé après une action en
  échec ; accords « 1 étape », « 1 générée » (`test/frontendReviewFixes.test.js`,
  vérification Playwright).
- [x] 35.14 (PR #452) Accessibilité — critères : le bouton ↻ des archives a un nom
  accessible (« Régénérer l'étape … ») ; les onglets Profil 2D / 3D
  exposent l'onglet actif (`aria-pressed`), le curseur de relief a un
  libellé ; les champs de chaque point de l'éditeur ont un libellé et les
  suggestions de géocodage se choisissent au clavier (↓/↑, Entrée, Échap ;
  `combobox`/`listbox`/`option`, focus conservé après le choix) ; les lignes du catalogue des cols sont
  atteignables et dépliables au clavier (Entrée, Espace, `aria-expanded`) ;
  une recherche de cols sans résultat affiche un message (vérification
  Playwright au clavier).
- [x] 35.15 (PR #453) Roadbook et étiquettes du profil — critères : un col au sommet
  d'une côte a la même altitude dans « Villes et points de passage » et
  dans « Côtes » (`summit_ele_m`), les autres points prennent l'altitude
  mesurée, « — » si elle manque (jamais 0 m) ; une arrivée au sommet
  s'affiche « Arrivée (col) » ; le tableau des côtes défile dans son cadre
  en mobile (390 px) sans couper l'impression ; sur le profil, l'étiquette
  d'arrivée n'est plus coupée au bord droit, une étiquette trop longue est
  raccourcie avec « … » en gardant l'altitude (texte complet en
  infobulle, pas de demi-emoji), et l'altitude des
  points de passage est la mesurée ; une côte nommée par géocodage inverse
  sur un relief ne s'appelle plus « Côte de Col du … » ; un col ne prend
  l'altitude que de la côte la plus proche dont le sommet est à moins de
  100 m de sa mesure (`test/roadbookProfileFixes.test.js`,
  vérification Playwright).
- [x] 35.16 (PR #454) Mes traces, boutons et CI — critères : après un import GPX/FIT
  (au moins un fichier réussi) ou par lien, le bilan de Mes traces est
  redemandé ; avec une seule semaine, la barre du graphique hebdomadaire
  ne dépasse pas 48 px et reste centrée ; les boutons des formulaires en
  ligne (Ajouter, Importer, Chercher) gardent leur taille et s'alignent sur
  le bas des champs ; le logo de la page de connexion reprend les couleurs
  du bandeau (jaune et blanc sur noir) ; `ci.yml` ne tourne plus deux fois
  par PR (push limité à main, pull_request sans filtre de base pour les PR
  empilées) (`test/tracesSummaryRefresh.test.js`, vérification Playwright).
  Vérifié sans défaut : `year=3000` répond déjà « attendu : un entier de
  1903 à 2100 ».
- [x] 35.17 (PR #455) Revalidation de l'import de sauvegarde — critères :
  `POST /api/backup/import` refuse un kind de waypoint ou une catégorie
  d'édition que l'appli n'écrit pas, et une colonne JSON mal formée que les
  pages relisent sans garde (`source`, `checks`, `progress`, `bonus_sec`,
  `geocode`, `geojson`, `approx_segments`, `km_blocks`) : 400 qui nomme
  table, ligne et colonne, base inchangée ; un texte au-delà des bornes des
  routes d'écriture est tronqué (sans couper un emoji) et compté dans
  `truncated_fields`, pas refusé ; une date en texte libre (import
  Wikipédia) reste acceptée ; le nom d'une trace importée (fichier GPX,
  Suunto, Strava, lien) est borné à 200 caractères ; la sauvegarde exportée
  telle quelle se réimporte (`test/backupRevalidation.test.js`,
  aller-retour sur la base de la démo).
- [x] 35.18 (PR #456) Lisibilité mobile et CSV — critères : le profil de la fiche et
  le comparateur règlent leur viewBox sur la largeur de l'écran (×1,2,
  entre 420 et 1080) : texte d'au moins 8 px à 390 px au lieu d'environ
  3 px ; légendes du comparateur l'une sous l'autre en étroit ; une
  étiquette du profil posée à l'horizontale ne recouvre pas une étiquette
  voisine et l'angle de l'encart distance / D+ reste libre ; le badge
  hors-ligne affiche « hors-ligne » en entier en mobile ; le CSV km par km
  utilise la virgule décimale avec le « ; » (convention d'Excel en
  français) (`test/mobileReadability.test.js`, vérification Playwright
  390 / 1280 px).
- [x] 35.19 (PR #458) Décimales homogènes — critères : les distances, vitesses et
  pentes affichées prennent la virgule décimale (« 460,3 km », plus de
  « 460.3 km » à côté de « 12,3 km ») : `EF.dec` (interface), `dec` de
  `profile.js` (aussi chargé seul dans les exports HTML), roadbook
  (`backend/exports.js`) et messages de contrôle générés par
  `pipeline/checks.js` (les messages déjà stockés gardent leur point
  jusqu'à la prochaine génération) ; pas de séparateur de milliers, les
  entiers ne changent pas ; aucun nombre à point décimal suivi de km, % ou
  m dans le texte des fiches, du catalogue des cols et du comparateur
  (`test/decimalComma.test.js`, attentes des tests d'affichage passées à la
  virgule, balayage Playwright de l'accueil, des fiches, du catalogue, du
  comparateur, du roadbook et de l'export HTML autonome). Les mini-sites
  autonomes reçoivent `frDec` avec `escHtml`. Hors périmètre : les formats
  de données (GPX, TCX, KML — y compris leurs champs de description —,
  JSON ; CSV déjà traité en 35.18).
- [x] 35.20 (PR #457) Dette : une source pour le rang des catégories et pour esc() —
  critères : le rang des catégories de côte n'existe plus qu'en
  `CATEGORY_RANK` (`pipeline/climbs.js`, repris par `apiHelpers` et
  `climbEfforts`) et `EFProfile.CAT_RANK` (repris par `cols.js` et
  `tourmap.js`), les deux tables restant identiques ; `esc()` côté Node
  n'est défini que dans `backend/exports.js`, et le site statique
  (`scripts/build-site.js`) l'utilise : sa copie locale n'échappait pas
  « " » dans un attribut `alt` (`test/singleSource.test.js`). Hors
  périmètre, volontairement : `EF.esc` (navigateur), l'`esc` de
  `profile.js`, chargé seul dans les exports HTML autonomes, et
  `CATEGORY_POINTS` (`pipeline/pain.js`), barème de l'indice de douleur aux
  mêmes valeurs aujourd'hui mais à pondération propre.
- [x] 35.21 (PR #459) Dates en JJ/MM/AAAA partout — critères : un jour AAAA-MM-JJ
  s'affiche JJ/MM/AAAA, comme Mes traces, sur la fiche, la liste des
  archives, la carte globale (popup et tableau), le roadbook et les
  mini-sites HTML autonomes (`EF.day`, `frDay`) ; lecture par chaînes, sans
  `Date` (aucun décalage de fuseau, testé en `America/New_York`) ; une date
  libre d'un import Wikipédia est rendue telle quelle ; les valeurs triées
  et exportées restent en ISO (`test/dayFormat.test.js`).
- [x] 35.22 (PR #460) Suites des 35.18 et 35.20 — critères : le profil de la fiche
  se redessine à la nouvelle largeur après un redimensionnement ou une
  rotation (viewBox 1080 → 420 → 1080 vérifié), y compris quand elle a
  lieu pendant que l'onglet 3D masque le profil (recalé au retour sur 2D,
  jamais redessiné à 1080 dans un conteneur de 316 px), sans perdre le survol
  profil ↔ carte ni dupliquer son guide ; le « Catégorie max » du
  comparateur utilise `EFProfile.CAT_RANK` au lieu d'une liste locale
  (vérification Playwright). Vérifié sans défaut : « 0 pays / 0 région »
  dans Mes traces vient du mode hors-ligne — le géocodage inverse simulé
  (`pipeline/simulator.js`) ne renvoie ni pays ni département ; en ligne,
  la Géoplateforme donne `country: 'France'` et le département.

En attente de décision (proposées, non commencées) : méthode de lissage
d'altitude (D+ et pente max sous-estimés en relief vallonné), export de la
base par tout compte en mode public, phrase « 100 % local » du README,
en-tête Content-Security-Policy (les pages ont des scripts et styles en
ligne : il faudrait soit les extraire, soit autoriser `'unsafe-inline'`,
ce qui en réduit l'intérêt) et compression HTTP (nouvelle dépendance
`compression`, à justifier selon docs/BRIEF.md).

## Epic 36 — Porte locale sous Windows (21/10/2026)

Le développement reprend sur un PC Windows (Node 24, le « LTS » que le
README fait installer). Premier constat, au clone de `main` (80ce220) :
`npm ci` échoue (better-sqlite3 11.10.0 ne publie aucun binaire pour
Node 24 sous Windows, et sans Visual Studio il ne se compile pas) ; avec
un Node 22, `npm test` donne 57 échecs, aucun sous Linux (CI).

- [x] 36.1 (PR #472) Installation et `npm test` sous Windows — critères :
  `npm ci` réussit sous Windows avec Node 24 sans compilateur
  (better-sqlite3 en 12.x, binaires publiés pour Node 20, 22 et 24 sous
  Linux et Windows) ; `npm test` sans échec sous Windows, dans un chemin
  qui contient un caractère accentué (`C:\Users\Moretti Cédric\…`) ;
  causes traitées une à une : base SQLite supprimée encore ouverte
  (52 échecs EBUSY, `closeDb()` dans 58 fichiers de test — et le
  serveur de test jamais fermé ensuite, qui bloque `editionCategory`),
  chemins comparés avec `/` (`singleSource`),
  `fs.cpSync` natif qui plante sur un chemin non ASCII (`build-site`),
  fins de ligne CRLF à l'extraction (`core.autocrlf=true`) qui changent
  l'empreinte des migrations — `.gitattributes` force LF ; CI verte sur
  Node 20 et 22 ; changement de code, donc relecture adverse.
  Fait : `npm test` 1 032 réussis, 0 échec sous Windows (Node 24) ;
  chaque correctif, remis dans son état de `main`, refait échouer son
  test. Relecture adverse : 3 trouvailles corrigées — better-sqlite3
  épinglé en `~12.9.0` (la 12.10 retire Node 20), test de `copyDir` dans
  un dossier accentué, décompte des fichiers corrigé.
- [x] 36.2 (PR #476) `fs.rmSync` muet sur un chemin non ASCII (Node 24, Windows) —
  constaté le 21/10 : sous Node 24.13, `fs.rmSync(p, { recursive: true,
  force: true })` ne supprime rien et ne lève rien quand `p` contient un
  caractère non ASCII (dossier comme simple fichier) ; Node 22.23,
  `unlinkSync`, `rmdirSync` et `fs.promises.rm` ne sont pas touchés.
  Conséquences dans un dépôt cloné sous `C:\Users\Moretti Cédric\…` :
  `scripts/build-site.js` ne vide plus `dist/` (d'anciens fichiers
  resteraient publiés), `scripts/import-all-and-generate.js` ne retire plus
  son marqueur de fin au démarrage. Critères : `removeSync` (lstat +
  unlink/rmdir) et `copyDir` dans un module partagé, utilisés par
  build-site, import-all-and-generate et les scripts de banc ; test :
  un `dist/` accentué contenant un fichier périmé est vidé par build-site
  (échoue avec `fs.rmSync` sous Node 24 Windows) ; test garde-fou : aucun
  `fs.rmSync` ni `fs.cpSync` dans `backend/`, `pipeline/`, `scripts/` ;
  après `npm test` avec un dossier temporaire dédié, aucun dossier
  `etapeforge-*` restant (4 aujourd'hui : copydir, deux db-index,
  towns) ; changement de code, donc relecture adverse.
  Fait : 1 036 tests, 0 dossier temporaire restant (4 avant) ; avec
  `fs.rmSync` remis, le test de build-site et celui de `removeSync`
  échouent sous Windows. Relecture adverse : course ENOENT pendant le
  parcours tolérée, garde-fou qui ne retire plus un « // » de chaîne ;
  sous Linux (CI) seul le garde-fou protège, le défaut étant propre à
  Windows.

## Epic 37 — Mode de développement aligné sur ISTQBFinder (22/10/2026, issue #481)

Demande du 22/10 : appliquer ici le mode de développement du dépôt cousin
[ISTQBFinder](https://github.com/Opaland/ISTQBFinder) — règles, agents et
personas. Décisions de l'utilisateur : fusion autonome (la règle 15 change),
suivi double story + issue, et import des quatre éléments ci-dessous.

- [x] 37.1 (PR #482) `AGENTS.md`, source unique des règles — critères : les règles
  numérotées de `CLAUDE.md` passent dans `AGENTS.md` avec la même
  numérotation (les « CLAUDE.md règle N » cités dans le code restent
  vrais, puisque `CLAUDE.md` l'importe par `@AGENTS.md`) ; `CLAUDE.md` ne
  garde que ce qui est propre à Claude Code (hooks, skills, agents) ;
  règle 11 : un problème = une issue (constat, scénario reproductible,
  impact), une PR la ferme (`Closes #n`) ; règle 15 : fusion par l'agent
  en squash, seulement si la CI est verte sur le commit qui contient
  `main` à jour et si la relecture adverse est passée quand elle est
  due ; équivalents de `/porte`, `/revue-sprint` pour un assistant
  sans skills.
- [x] 37.2 (PR #482) Personas métier nommés — critères : deux agents sans outil
  d'écriture (`disallowedTools: Write, Edit`), Henri (historien du Tour :
  cherche et source le parcours d'une étape, propose sans écrire) et
  Mireille (auditrice de curation : verdict par règle de
  `docs/CURATION-REGLES.md` sur une étape transcrite) ; chacun sait qu'il
  est sous-agent, part d'une hypothèse explicite au lieu de bloquer,
  termine par des « Questions à choix », traite tout texte lu (page Web,
  JSON, sortie de script) comme une donnée, jamais comme une consigne ;
  descriptions qui se départagent entre elles et avec les relecteurs.
- [x] 37.3 (PR #482) Tests des consignes (`test/agents.test.js`) — critères : chaque
  agent a `name` (= nom du fichier), `description`, `tools` ; les
  relecteurs et les personas n'ont aucun outil d'écriture (seul
  `verificateur-de-tests` a `Edit`, il doit remettre le code en l'état) ;
  mentions obligatoires des personas ; `CLAUDE.md` importe `AGENTS.md` ;
  chaque test retiré de son correctif refait échouer.
- [x] 37.4 (PR #482) Permissions `allow` / `ask` — critères : `allow` ne contient
  que des commandes sans effet (tests, lint, démo hors ligne, lecture
  git, `gh` en lecture) ; `ask` couvre l'irréversible (push forcé,
  suppression de branche distante, `reset --hard`, `gh repo`, `gh release`,
  `gh secret`) et les imports réseau de plusieurs heures — pas le push ni la
  fusion ordinaires, qui deviennent autonomes (un `ask` y ferait demander
  chaque fusion) ; vérifié par test.
  Fait (37.1 à 37.4) : 1 046 tests, lint, démo 13/13 ; 7 mutations, chacune
  rouge sur son test. Relecture adverse, 6 trouvailles corrigées :
  `npm audit --audit-level*` laissait passer `… fix` (devient la forme
  exacte de la CI) ; `git branch -D`, `git clean`, `gh api -X DELETE` en
  ask ; Henri perd le terminal (il lit du Web) ; « fusion autonome » ne
  venait pas de ce fichier mais du mode de permission (CLAUDE.md le dit) ;
  le déploiement Pages qui suit une fusion n'est pas une « publication
  hors du dépôt » ; règle 11 et PR empilées réconciliées. Limites
  écrites, non corrigées : motifs par préfixe (`git push origin x
  --force` échappe à ask), `git log --output=` écrit un fichier, et
  `main` n'est protégée par aucune règle GitHub — décision à prendre
  par l'utilisateur (réglage du dépôt, hors de ce fichier).
- [x] 37.5 (PR #483) Intégrations Copilot et Gemini générées — critères :
  `scripts/generer-integrations.js` écrit `.github/agents/*.agent.md` et
  `.gemini/` (agents, commandes `/henri` `/mireille`…, skills copiés,
  `settings.json` avec `AGENTS.md` en contexte et les seules commandes
  de `allow`) ; `--verifier` rend 1 si un fichier est absent, périmé ou
  orphelin ; un test échoue si les fichiers générés ne sont plus à jour ;
  les outils d'écriture d'un agent ne passent jamais dans sa version
  générée.
  Fait : 1 055 tests ; mutations rouges (Edit traduit, disallowedTools
  ignoré, orphelins ignorés, source modifiée, `npm audit` exact) — la
  dernière a révélé un test vide (regex sans antislashs), corrigé. Gemini
  compare par préfixe : seules les règles `allow` déjà en préfixe passent
  (`npm audit --audit-level=high` y couvrait `… fix`). Relecture adverse :
  préambule « terminal » donné à Henri qui n'en a pas, corrigé. Non
  vérifié : essai réel dans Copilot et Gemini CLI (aucun compte ici).
- [x] 37.6 (issue #484) `verificateur-de-tests` : stash ciblé — constat de la
  relecture de #483 (raisonné, non reproduit) : sans `Edit`, son
  préambule généré prescrit `git stash` / `git stash pop`, qui embarque
  aussi le travail non commité de l'utilisateur. Critères : la consigne
  générée cible le seul fichier du correctif (`git stash push -- <fichier>`)
  ou une copie jetable ; test sur le préambule généré.
  Fait : retrait à la main de préférence ; `git stash push -- <fichier>`
  seulement si le fichier est suivi et que `git diff -- <fichier>` ne montre
  que le correctif (sinon le travail de l'utilisateur sur ce fichier part
  aussi — relecture adverse, vérifié dans un dépôt jetable). `/porte` avait
  le même `git stash` nu : l'arbre propre se teste dans un `git worktree`.
  Test sur toutes les consignes (AGENTS, CLAUDE, agents, skills, fichiers
  générés) : aucun stash nu, `stash -u`, `restore .`, `checkout -- .`,
  `reset --hard` ; rouge avec l'ancien `/porte` et avec un stash nu ajouté.

## Epic 38 — Revue globale du 22/10/2026

Mesuré sans défaut : CI de `main` verte (CI et Pages) avant et après chaque
fusion ; `npm audit --omit=dev` 0 vulnérabilité ; 27 routes d'écriture
relues — aucun objet ou tableau n'atteint better-sqlite3 ; SSRF de
`/api/import/link` fermé (https, hôte en liste blanche revérifié à chaque
redirection) ; ~118 sinks HTML relus — hors les trois de 38.1, tous
échappés ou numériques ; JSON embarqué des exports neutralise `</script>` ;
positionnement « 100 % local / aucun compte » cohérent ; backlog #10 :
6 ouverts, 47 faits ; issue #342 (branches mortes) close, il ne reste que
`main` et les branches de PR ouvertes.

- [x] 38.1 (PR #487) XSS stockée par sauvegarde forgée (issue #486, règle 1) —
  critères : `POST /api/backup/import` refuse un `stages.state` hors de
  draft/generating/done/error, un `km_blocks` (climbs, descents) qui n'est
  pas un tableau d'objets aux champs numériques finis, un `progress` qui
  n'est pas un objet (`percent` nombre, `step` texte) ; côté affichage,
  `EF.stateBadge` n'insère jamais `state` brut (classe en liste blanche,
  texte échappé), `renderClimbSVG` n'insère `ele0` que s'il est un nombre,
  Archives n'insère `percent` que converti en nombre ; un test par couche,
  chacun rouge sans son correctif ; relecture adverse.
  Fait : 9 tests, chaque couche rouge sans son fichier (3 sinks, 5 refus
  d'import) ; 1 066 tests, lint, démo, e2e verts. Relecture adverse : plus
  aucune XSS sur 8 exports et tous les sinks clients (charge utile dans
  chaque champ JSON et TEXT) ; aucune sauvegarde légitime refusée
  (`git log -S` : km_blocks et state jamais d'un autre format) ; reste un
  défaut de disponibilité préexistant → 38.4.
- [x] 38.2 (PR #488) Skill `revue-globale` à jour — critères : le `grep` des routes
  d'écriture couvre `backend/routes/` et les routeurs (27 routes), le
  compte de dépendances est juste (5 directes, 6 en dev).
- [x] 38.3 (PR #493) Identifiant d'activité Strava/Suunto validé avant l'URL amont
  (issue #491) — critères : `..` et tout non-entier (Strava) / toute forme
  de clé inattendue ou non-chaîne (Suunto) refusés en 400 avant l'appel
  réseau ; test rouge sans le correctif ; relecture adverse.
  Fait : id Strava = entier positif (nombre sûr ou chaîne de chiffres),
  clé Suunto = chaîne `[A-Za-z0-9_-]{1,128}` ; 23 cas refusés sans appel
  réseau, 21 rouges sans le correctif. Relecture adverse : aucun faux refus
  de ce qu'envoie traces.js, aucun autre chemin d'URL amont construit d'une
  entrée ; trouvaille corrigée — une sortie Suunto sans clé est écartée de
  `GET /workouts` (le bouton envoyait "undefined"). Hypothèse non vérifiée
  (pas de compte Suunto) : aucune clé réelle ne contient `.` ni `:`.
- [x] 38.4 (PR #496) Forme des colonnes JSON validée à l'import de sauvegarde
  (issue #492) — critères : `tracks.geojson`, `approx_segments`,
  `surfaces`, `communes`, `stages.checks`, `source`, `waypoints.bonus_sec`,
  `geocode` refusés en 400 si leur forme diffère de ce que le code écrit ;
  plus aucune sauvegarde forgée ne rend un export 500 ; une sauvegarde
  exportée par l'appli passe toujours ; relecture adverse.
  Fait : `JSON_SHAPES` dans `checkBackupRow` (surfaces et communes par les
  gardes de lecture `parseSurfaces`/`parseCommunes`) ; 23 tests, 21 rouges
  sans le correctif, dont l'aller-retour d'une sauvegarde complète
  (geojson, segments, revêtement, communes, checks, sources, géocodage,
  bonifications) qui repasse et garde ses pages en 200. Fixture de
  test/gear.test.js corrigée (geojson '{}' que l'appli n'écrit jamais).
  Relecture adverse (serveur jetable, ~30 formes forgées × 14 routes) :
  aucun faux refus ; trois formes passaient encore, corrigées — source
  d'édition en JSON `null` (500 sur export.html), checks sans `items` et
  geojson de moins de 2 points (fiche plantée côté client).
- [ ] 38.5 Protection de `main` côté GitHub (issue #489) — **en attente de
  décision** de l'utilisateur (réglage du dépôt).
- [ ] 38.6 Essai réel des agents générés dans Copilot et Gemini CLI
  (issue #490) — bloquée : aucun compte dans la session.
- [x] 38.7 (PR #495) Dépendances sous le seuil de `npm audit` (issue #494) —
  critères : `npm audit --audit-level=high` sort en 0 ; seul
  `package-lock.json` change (`npm audit fix` sans `--force`) ; tests, lint
  et démo verts. Fait : body-parser 1.20.9 (production, via express), zod
  4.6.7 et fast-uri 3.1.9 (dev, Stryker) ; reste `qs` modéré sous
  typed-rest-client (Stryker, dev), sous le seuil. Mise à jour de version
  de correctif sans code : pas d'agent dédié (règle 11).

## Epic 24 — Bilan final

- [x] 24.1 Rapport de clôture par epic (17/10/2026), voir ci-dessous
- [x] 24.2 Liste de ce qui reste durablement ouvert, voir ci-dessous
- [x] 24.3 Remise à l'utilisateur (17/10/2026) : il a délégué le merge et les 9 décisions ; tout est mergé ou fermé, décisions consignées ci-dessus

### Bilan au 17/10/2026, fin de soirée (après délégation des merges et des décisions)

**Mergé ce jour** : 38 PR — les 29 de la pile en attente (#339 à #383, hors fermées)
puis les PR issues des décisions (et #391, suivi) — #384 (`laps`), #385 (profil par
étape), #386 et #392 (secrets : provenance puis chiffrement), #387 (1992/21),
#388 (rôle admin en mode public), #389 (jetons CSS), #390 (communes
traversées). Fermées sans merge : #354 à #360 (remplacées par #370), #364
(incluse dans #371). Chaque story de code est passée par au moins une
relecture adverse ; trois en ont eu deux (rôle admin) ou ont vu des
trouvailles majeures corrigées avant merge (clair résiduel du chiffrement,
inscription admin usurpable, course de régénération des communes).

**Les 9 décisions, telles que prises** : laps option A ; profil `shortest`
seulement là où il n'emprunte aucune piste (1975/22) ; communes à la
demande (B) ; secrets A puis B ; pas de parallélisation ; design option B ;
positionnement versé au dépôt, **aucune publication** (reste une action de
l'utilisateur) ; Playwright minimal en CI ; R1 livré, R5 et PWA hors ligne
différés.

**Reste ouvert, et pourquoi** :
- 12.3 : vérification contre le vrai geo.api.gouv.fr (réseau du bac à sable) ;
- 10.6 (2022-femmes/1) et 2002/20 : nombre de tours non sourcé ou contradictoire ;
- 2002/13 (+9,8 %) et 2002/19 (-6,6 %) : pas de source kilométrée accessible ;
- 28.5 (2020/2), 15.1 (La Flamme Rouge), 1.3 (branches mortes) : bloqués
  par des accès externes ;
- 26.5 (API `/v1`, PWA hors ligne) : différés faute de besoin exprimé.

### Où en est la feuille de route (17/10/2026)

**Mise à jour du 17/10/2026, après délégation :** toutes les PR listées ci-dessous sont mergées (ou fermées : #354 à #360 remplacées par #370, #364 incluse dans #371), et les 9 décisions sont prises (voir chaque epic). Texte d'origine conservé pour l'historique.

Tout ce qui pouvait avancer sans toi a avancé. Le goulot n'est plus le
développement, ce sont **les PR ouvertes non relues** et **les décisions
en attente**.

**Ordre de merge à respecter** (PR empilées ; la base de chaque PR est la
branche de celle dont elle dépend) :

1. #369 (schéma versionné) **avant** #366 et #348. Ces deux dernières
   ajoutent une colonne et des index : elles devront devenir les
   migrations 3 et 4. Je m'en charge au moment du rebase.
2. #340 (routeur mixte), puis #366 (revêtement), puis #368 (2024/9) et
   #372 (2022/5).
3. #369, puis #371 (découpage de `server.js`), puis #373 (liste allégée).
4. #361 (stratégie de tests), puis #367 (fumée E2E en CI).
5. #375 (Lautaret), puis #377 (1919/11).
6. PR indépendantes, dans n'importe quel ordre : #341, #349, #351, #362,
   #363, #364, #365, #370, #374, #376, #378, #380, #381, #382, #383.
   #352 et #353 sont des propositions : à lire, pas forcément à merger.

**Décisions qui débloquent du développement** (une ligne suffit pour chacune) :

| Epic | Question | Où | Ma recommandation |
|---|---|---|---|
| 8 | Étapes en circuit (tours) | issue #251 | option A |
| 9 | Profil de routage par étape | issue #243 | `shortest` pour 1903/3 et 1992/10 seulement |
| 12 | Communes traversées dans le roadbook | PR #382 | B : à la demande |
| 13 | Identifiants Suunto/Strava | issue #379 | A tout de suite, B avant exposition publique |
| 18 | Paralléliser la génération à froid | PR #381 | ne rien faire tant que personne ne s'en plaint |
| 20 | Design system | PR #352 | à ton goût |
| 21 | Positionnement / marketing | PR #353 | rien n'est diffusé sans toi |
| 25 | Automatisation des tests | PR #361 | Playwright minimal en CI (déjà prêt dans #367) |
| 26/27 | R1 rôle admin, R5 API à clés, PWA hors ligne | PR #362 | R1 avant toute exposition publique |

**Durablement bloqué, hors de ma portée** : suppression des branches
mortes (HTTP 403 du remote, #342) ; La Flamme Rouge (403 anti-bot) ;
Overpass API (contournée par BRouter, #350) ; 2020/2 sans source
détaillée ; parcours 2027 (attend l'annonce d'ASO) ; ravitaillements
historiques sans source ; profils ledicodutour en 403.
