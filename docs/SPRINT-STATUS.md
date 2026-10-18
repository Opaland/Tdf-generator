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
- [ ] 30.5 Décidé le 18/10/2026 : FC max **saisie** par l'utilisateur, 5 zones en % de la FC max (50-60, 60-70, 70-80, 80-90, 90-100) ; temps passé par zone sur la fiche d'une trace horodatée avec FC (dépend de 31.2)

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
- [ ] 31.3 Option A : temps de montée de chaque côte d'une trace horodatée, côtes appariées entre sorties par la position du sommet, meilleur temps et historique par côte dans « Mes traces » ; une trace importée avant 31.2 est signalée « sans temps », jamais estimée

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
