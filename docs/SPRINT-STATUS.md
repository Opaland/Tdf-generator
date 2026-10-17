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
entier (pas seulement cette session). La Partie B (Epics 1-27, 25 à 27 ajoutés le 17/10/2026)
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

## Partie B — Feuille de route active (Epics 1-27)

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
- [ ] 2.5 **backlog** — PR #340 en attente de revue humaine

## Epic 3 — Sprint 2 : resynchronisation documentaire

- [x] 3.1 `README.md` (3 mentions OSRM/BRouter périmées)
- [x] 3.2 `docs/PRESENTATION.md` (schéma + tableau)
- [x] 3.3 `docs/PERF-PIPELINE.md`, `SYNOLOGY.md`, `DEPLOY-PUBLIC.md`
- [x] 3.4 `backend/exports.js` (attribution d'export)
- [ ] 3.5 **backlog** — PR #341 en attente de revue humaine

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
- [ ] 5.7 **backlog** — PR #348 en attente de revue humaine

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

- [ ] 8.1 Chiffrer l'ampleur du changement de schéma/pipeline
- [ ] 8.2 Proposer 2-3 options à l'utilisateur
- [ ] 8.3 Implémenter l'option choisie (si approuvée)
- [ ] 8.4 Tests + revue adverse

## Epic 9 — Décision + implémentation : profil de routage par étape (issue #243)

- [ ] 9.1 Chiffrer l'ampleur (champ par étape vs config globale)
- [ ] 9.2 Proposer à l'utilisateur
- [ ] 9.3 Implémenter si approuvé
- [ ] 9.4 Appliquer aux 4 étapes concernées (1903/2, 1903/3, 1992/4, 1992/10)

## Epic 10 — Tour de France Femmes : données réelles

- [x] 10.1 Récupérer une fixture Wikipédia réelle — `pipeline/fixtures/wikipedia_2022_femmes_en.html`, déjà fait avant ce fichier
- [x] 10.2 Curer les points de passage d'au moins une édition Femmes — 2022-femmes : étapes 7, 8 (montagnes finales, avant ce fichier) et 3 (Reims → Épernay, 17/10, PR #354)
- [x] 10.3 Vérifier import/génération avec cette donnée réelle — vérifié par régénération réelle (réseau live) à chaque étape curée
- [x] 10.4 Documenter dans `historic_routes.json` avec `confidence` — fait pour les 3 étapes curées, honnêtement hors tolérance pour toutes (voir détail de chaque entrée)
- [x] 10.5 Étapes 2, 4, 5, 6 curées (PR #358, #357, #356, #355) et étape 3 refaite (PR #354), toutes depuis le roadbook ASO complet trouvé sur dimensionsvelo.com — étapes 2-5 dans la tolérance (-3,5 % à +3,0 %), étape 6 à -9,8 % mais fidèle à 0,3 km près jusqu'au premier passage à Rosheim (écart entièrement dans la boucle finale, décrite seulement par des numéros de carrefour). Trouvailles transverses : (a) les entrées de roadbook codées comme carrefour (« Piney (D43-D79) ») désignent la route qui frôle la commune, pas le village — viser le centre ajoute 1,5-5,6 km par tronçon ; (b) un total dans la tolérance peut masquer une dérive intermédiaire de ±10 km par compensation — mesuré point par point à chaque étape, documenté dans les confidence ; (c) BRouter renvoie des HTTP 403 par intermittence sous charge (repli OSRM leg par leg), invisible sans la PR #340
- [ ] 10.6 **backlog** — Étape 1 (circuit parisien à 12 tours) bloquée sur Epic 8 (mécanisme "laps"), pas une curation ordinaire
- [x] 10.7 Étapes 7 et 8 refaites depuis leur roadbook ASO (PR #359, #360) : -10,0 % → +4,3 % et -10,2 % → +3,6 %. Trouvailles : « Col du Platzerwasel » résolu sur un autre col (Hilsenfirst, ~4 km) sur main, check « col atteint » passant quand même ; Mélisey (étape 8), ajoutée par la curation précédente comme « commune évidente non sourcée », n'est pas sur le parcours réel.
- [ ] 10.8 **backlog** — Consolider la note d'édition `2022-femmes` une fois #354-#360 mergées (chacune la modifie partiellement)

## Epic 11 — Détection de surface non goudonnée (Overpass API)

- [x] 11.1 Revérifier l'accès réseau à `overpass-api.de` — toujours bloqué (`Connection reset by peer`, proxy d'egress), voir issue #350
- [x] 11.1b Re-testé le 17/10/2026 : `overpass-api.de` toujours bloqué, mais des miroirs répondent depuis ce sandbox — `maps.mail.ru/osm/tools/overpass` renvoie du JSON valide par intermittence (sinon « server too busy »), `overpass.kumi.systems` répond en HTTP 500
- [x] 11.2 Prototype de faisabilité : **Overpass inutile** — la réponse GeoJSON de BRouter porte déjà `WayTags` (dont `surface=`) et `Distance` par segment, vérifié en direct avec le profil `fastbike` (détail et conception : commentaire sur l'issue #350)
- [x] 11.4 Résumé « km non revêtus / pavés » par étape depuis les `WayTags` BRouter — PR #366 (empilée sur #340) ; mesuré en réel sur 2024/9 : 98 % classés
- [x] 11.5 2024/9 recurée sur les 14 secteurs de chemins blancs — PR #368 (empilée sur #366) : 206,8 km (+3,9 %), 28,3 km non revêtus mesurés sur 32,2 km réels
- [ ] 11.3 **blocked** — Évaluer le coût/la complexité : reporté avec 11.2

## Epic 12 — Décision produit : ravitaillement/villages traversés

- [ ] 12.1 Chiffrer le coût de géocodage inverse à l'échelle
- [ ] 12.2 Proposer 2-3 approches à l'utilisateur

## Epic 13 — Sécurité : identifiants Suunto stockés

- [ ] 13.1 Évaluer le risque réel (LAN strict vs exposition)
- [ ] 13.2 Proposer un chiffrement at-rest
- [ ] 13.3 Implémenter si validé par l'utilisateur

## Epic 14 — Décision : programme partenaire Suunto

- [ ] 14.1 Peser "usage personnel vs organisation" avec l'utilisateur

## Epic 15 — Vérification concurrentielle directe (La Flamme Rouge)

- [ ] 15.1 Tenter un accès direct depuis cette session
- [ ] 15.2 Mettre à jour issue #14 avec le résultat

## Epic 16 — Recherche concurrentielle élargie (rando/ski)

- [x] 16.1 Lister les apps candidates (AllTrails, Visorando, Skitourenguru, etc.)
- [x] 16.2 Rechercher chacune
- [x] 16.3 Synthèse 3 colonnes (idées / à vérifier / différenciant confirmé) — issue #345
- [x] 16.4 Soumis à l'utilisateur (issue #345) — aucune implémentation engagée depuis

## Epic 17 — Performance : pagination

- [ ] 17.1 Obtenir ou générer un jeu de données à l'échelle réelle
- [ ] 17.2 Mesurer le temps de réponse réel de `/api/editions` et `/api/stages`
- [ ] 17.3 Décider si une pagination est justifiée
- [ ] 17.4 Implémenter si justifié

## Epic 18 — Performance : parallélisation (réseau réel)

- [ ] 18.1 Profiler une génération d'étape réelle de bout en bout
- [ ] 18.2 Identifier les attentes réellement indépendantes
- [ ] 18.3 Paralléliser prudemment sans casser le biais de proximité du géocodage

## Epic 19 — Revue UI/UX globale

- [x] 19.1 Relire les 8 écrans à partir de l'audit Playwright (recoupé avec Epic 6/7 : aucune régression fonctionnelle à re-vérifier)
- [x] 19.2 Vérifier la cohérence avec `docs/DESIGN_SYSTEM.md` — doc à jour sur les couleurs, muet sur l'espacement/rayon/typographie réels
- [x] 19.3 Lister les incohérences concrètes (pas des opinions) — `docs/UI-UX-REVIEW.md` (PR #352) : 8 valeurs de `border-radius`, 17 de `font-size`, 14 d'espacement, mesurées par grep, aucune jeton CSS équivalent à la palette couleur

## Epic 20 — Proposition design system

- [x] 20.1 Chiffrer le coût d'un changement (dépendances, maintenance) — `docs/UI-UX-REVIEW.md`
- [x] 20.2 Proposer 2-3 options avec compromis — A (statu quo) / B (tokeniser l'existant, recommandée) / C (refonte visuelle)
- [ ] 20.3 **backlog** — Attendre la décision de l'utilisateur (PR #352 ouverte, propose sans trancher)

## Epic 21 — Stratégie marketing/positionnement

- [x] 21.1 Rédiger l'angle de positionnement (reconstruction fidèle, locale, vérifiable) — `docs/MARKETING.md` (PR #353)
- [x] 21.2 Captures d'écran : 8 existent déjà (`docs/captures/`) ; identifié ce qui manque réellement (mobile/PWA, GIF du pipeline) plutôt que tout refaire
- [x] 21.3 Rédiger un texte de présentation court — 2 variantes (technique/non technique), non validées
- [ ] 21.4 **backlog** — Soumis à l'utilisateur (PR #353 ouverte) ; aucune diffusion sans validation explicite

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
- [ ] 25.3 **backlog** — Arbitrer les 3 pistes proposées (régénération périodique, champ `race_km`, Playwright minimal en CI) : décision utilisateur

## Epic 26 — Revue d'architecture (persona architecte logiciel)

- [x] 26.1 Revue de l'architecture actuelle (couplage, points de défaillance, évolutivité SQLite/PWA, monétisation par clé API) — `docs/ARCHITECTURE-REVIEW.md` (PR #362), propositions seulement
- [x] 26.2 R4 attributions/licences : BRouter cité, redistribution réelle de la démo Pages documentée (PR #363, complète #341)
- [x] 26.3 Bug trouvé par la revue : étape bloquée en `generating` après un crash → remise en erreur au démarrage (PR #364)
- [ ] 26.4 **backlog** — R1 (rôle admin sur les routes destructrices), R2 (schéma versionné), R3 (découpage de `server.js`) : dette objective, mais R1 implique un modèle de rôles à valider par l'utilisateur
- [ ] 26.5 **backlog** — R5 (API `/v1` à clés), lecture hors-ligne PWA : décisions produit

## Epic 27 — Dette technique issue de la revue d'architecture (règle 15 : autonomie)

- [x] 27.1 Schéma SQLite versionné (`PRAGMA user_version`, migrations numérotées, `settings` dans `db.js`) — PR #369 ; base réelle de `main` migrée v0→v2 sans perte
- [ ] 27.2 **backlog** — R3 : découper `backend/server.js` en routeurs (`stages`, `editions`, `exports`, `traces`, `admin`). Critères : routes et réponses identiques (tests existants verts sans modification) ; `server.js` < 300 lignes
- [x] 27.3 Test E2E navigateur en CI (8 écrans × 1440/375 px, contenu rendu exigé, erreurs tardives, débordement) — PR #367 (empilée sur #361), job `e2e` vert sur GitHub Actions
- [ ] 27.4 **en attente de décision** — R1 : rôle admin sur les routes destructrices (modèle de rôles à valider)

## Epic 24 — Bilan final

- [ ] 24.1 Rapport de clôture par epic
- [ ] 24.2 Liste de ce qui reste durablement ouvert (ex. parcours 2027 bloqué sur l'annonce ASO)
- [ ] 24.3 Remise à l'utilisateur
