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
  - [ ] Lot Lorraine : 14 étapes (1970/9, 1978/20, 1979/12-13, 1980/2-3,
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
  - [ ] Édition 1992 : 19 nouvelles étapes, soit 20 sur 22 (prologue et 9e étape,
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
  - [ ] Édition 1993 : 20 étapes sur 21 (prologue du Puy du Fou, 6,8 km,
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
- [ ] 33.3 Bourg plutôt que centroïde : l'index IGN des communes donne le
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
- [ ] Édition 1994 : 21 étapes sur 22 (prologue de Lille, rues seulement),
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
- [ ] Édition 1995 : 20 étapes sur 21 (prologue de Saint-Brieuc non
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
- [ ] Édition 1996 : 20 étapes sur 22, 285 points placés sur 308.
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

- [ ] Édition 1991 : 22 étapes sur 23 (prologue de Lyon non transcrit),
  405 points placés sur 442. Contrôlée à ±5 % avant PR : 20 étapes dans la tolérance, 2
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
- [x] Édition 1990 (PR #414) : 21 étapes sur 22, 303 points placés sur 338 (1990/6,
  déjà transcrite dans le lot Lorraine, conservée ; 278 routables, les
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
- [ ] Édition 1989 : 21 étapes en ligne sur 21 + prologue (rues de
  Luxembourg seulement, gardé pour mémoire, non contrôlable), 300 points
  placés sur 345. Contrôlée à ±5 % avant PR : 15 étapes dans la
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
- [ ] Édition 1988 : 22 étapes sur 23 (prologue Pornichet → La Baule,
  3,8 km, sans profil publié), 381 points placés sur 419. Contrôlée à
  ±5 % avant PR : 18 étapes dans la tolérance, 4 hors, affichées comme
  telles — 1988/6 (+14,4 %, contre-la-montre par équipes : Villeneuve-
  d'Ascq → Croix, 7 km à vol d'oiseau pour 5 km de profil), 1988/11
  (+6,9 %, rive du Léman, Territet non placé), 1988/21 (−11,9 %,
  contre-la-montre, côte de Saint-Romain et deux lieux-dits hors du
  calcul), 1988/22 (+6,6 %, circuit des Champs-Élysées retiré de la mesure
  par `circuit_km` à la Concorde ; Jouy-en-Josas → Versailles 3 km de
  profil pour 5,5 à vol d'oiseau). Erreur trouvée dans `stage_towns` :
  « Puy de Dôme » (15 arrivées 1952-2023) était le centre du département,
  13,9 km au sud-est du sommet — recalé sur le volcan (Nominatim
  natural/volcano) ; 1988/19 de +6,4 % à +0,4 %. Saint-Nazaire (1988/1)
  non placé : centre-ville à 7,7 km de Montoir pour 4,5 km de profil.
  Libellés illisibles ou nommés sans km (Côte de Mamers, Saint-Amand-les-
  Eaux, Taninges, Saint-Yorre…) non repris, notés sur leur étape.
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
- [ ] 33.4 Contrôle à ±5 % des itinéraires (demande du 18/10/2026 : « 5 %
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

## Epic 34 — Idées venues d'autres dépôts (veille du 18/10/2026)

Veille open source (dépôts clonés, licences et derniers commits relevés,
Wikidata interrogé en direct). Seul le code MIT/BSD/Apache peut être repris
avec attribution ; AGPL/GPL (Dreeve, Endurain, FitTrackee, wanderer,
GoldenCheetah) : idées seulement.

Actionnables sans décision :
- [ ] 34.1 Départs/arrivées par identifiant Wikidata (CC0, 2 428 étapes
  1903→2026, ville de départ P1427, d'arrivée P1444, distance P3157) pour
  recouper `stage_towns.json` : supprime les homonymes à la source.
- [ ] 34.2 Calques IGN historiques (Carte 1950 `GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950`,
  état-major `…ETATMAJOR40`, photos aériennes 1950-1965) dans l'éditeur et la
  fiche — couches relevées dans le GetCapabilities ; licence à confirmer
  couche par couche.
- [ ] 34.3 Heatmap géographique de toutes ses traces (idée derive / VeloViewer).
- [ ] 34.4 Nombre d'Eddington (distance et D+) dans le bilan (idée
  geo-activity-playground, MIT).
- [ ] 34.5 Indice FIETS à côté de la catégorie approchée (formule publique ;
  bonus d'altitude à trancher par un test).
- [ ] 34.6 Profil coloré par surface et par FC (données déjà présentes).
- [ ] 34.7 Zones de confidentialité autour du domicile dans les exports et
  mini-sites de traces (idée geo-activity-playground).

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
