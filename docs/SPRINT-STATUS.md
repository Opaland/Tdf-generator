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

- [ ] 10.1 Récupérer une fixture Wikipédia réelle
- [ ] 10.2 Curer les points de passage d'au moins une édition Femmes
- [ ] 10.3 Vérifier import/génération avec cette donnée réelle
- [ ] 10.4 Documenter dans `historic_routes.json` avec `confidence`

## Epic 11 — Détection de surface non goudonnée (Overpass API)

- [ ] 11.1 Revérifier l'accès réseau à `overpass-api.de` depuis cette session
- [ ] 11.2 Si accessible, prototyper le map-matching sur une étape gravel connue
- [ ] 11.3 Évaluer le coût/la complexité avant d'engager plus

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

- [ ] 16.1 Lister les apps candidates (AllTrails, Visorando, Skitourenguru, etc.)
- [ ] 16.2 Rechercher chacune
- [ ] 16.3 Synthèse 3 colonnes (idées / à vérifier / différenciant confirmé)
- [ ] 16.4 Soumettre à l'utilisateur avant toute implémentation

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

- [ ] 19.1 Relire les 8 écrans à partir de l'audit Playwright
- [ ] 19.2 Vérifier la cohérence avec `docs/DESIGN_SYSTEM.md`
- [ ] 19.3 Lister les incohérences concrètes (pas des opinions)

## Epic 20 — Proposition design system

- [ ] 20.1 Chiffrer le coût d'un changement (dépendances, maintenance)
- [ ] 20.2 Proposer 2-3 options avec compromis
- [ ] 20.3 Attendre la décision de l'utilisateur

## Epic 21 — Stratégie marketing/positionnement

- [ ] 21.1 Rédiger l'angle de positionnement (reconstruction fidèle, locale, vérifiable)
- [ ] 21.2 Lister les captures d'écran à produire
- [ ] 21.3 Rédiger un texte de présentation court
- [ ] 21.4 Soumettre à l'utilisateur avant toute publication

## Epic 22 — Resynchroniser l'issue #10

- [ ] 22.1 Corriger la mention périmée sur #16/#17 (déjà clos, texte pas à jour)

## Epic 23 — Revue globale de fin de session

- [x] 23.1 Sécurité : grep `innerHTML`/`eval`/`new Function` sur tout `frontend/`+`backend/` (~70 occurrences) — toutes passent par `esc()`/`EF.esc()`, `npm audit --omit=dev` : 0 vulnérabilité
- [x] 23.2 Validation d'entrée : spot-check `POST /api/stages` — `requireString`/`optionalString`/`optionalNumber`/`assertLatLonPaired` systématiques, conforme au motif déjà établi
- [x] 23.3 Dette du backlog : issue #10 recomptée — 44 items clos / 6 ouverts (sur 50 suivis), chacun des 6 relié à une issue de suivi dédiée (pas un flou générique)
- [x] 23.4 Cohérence des textes : grep positionnement (« 100% local », « aucun compte »...) — cohérent, pas de contradiction trouvée
- [x] 23.5 Poids et dépendances : 5 dépendances directes (`better-sqlite3`, `express`, `fit-file-parser`, `leaflet`, `node-html-parser`), chacune déjà justifiée dans son historique d'adoption — rien de nouveau

## Epic 24 — Bilan final

- [ ] 24.1 Rapport de clôture par epic
- [ ] 24.2 Liste de ce qui reste durablement ouvert (ex. parcours 2027 bloqué sur l'annonce ASO)
- [ ] 24.3 Remise à l'utilisateur
