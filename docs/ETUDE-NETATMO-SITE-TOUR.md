# Étude : ce qu'ÉtapeForge peut reprendre de Netatmo, et un site sur le Tour

*10/11/2026. Demande de l'utilisateur : lire en entier le dépôt
[Opaland/Netatmo](https://github.com/Opaland/Netatmo) (mode de travail, CI,
gestion des données), dire ce qui s'en inspire, et étudier l'abandon de la
création d'étapes au profit d'un site consacré au Tour de France, avec
Claude ou d'autres services. **Étude seulement : aucune décision n'est prise
ici** (AGENTS.md, règle 15 ; décisions en fin de document).*

Dépôt lu au commit `86f4723` (716 fichiers) : `README.md`, `AGENTS.md`,
`CLAUDE.md`, `CONTRIBUTING.md`, `docs/PROJET.md`, `docs/APPRENTISSAGES.md`,
`docs/juridique.md`, les 12 workflows, `collector/insights.py`,
`web/vite.config.ts`, `web/package.json`, `scripts/commit-data.sh`.

## 1. Ce que fait Netatmo, en bref

- **Aucun serveur.** Une GitHub Action collecte chaque nuit les données de
  l'API Intuis/Netatmo, les **chiffre** (AES-256-GCM) et les commite dans
  `data/*.enc.json`. GitHub Pages sert une PWA statique (Vite + TypeScript,
  ECharts) qui déchiffre dans le navigateur. Le dépôt peut rester public.
- **Claude intégré proprement** (`collector/insights.py`) : une « analyse du
  mois » rédigée par Claude dans l'Action, jamais dans le navigateur.
  - Le **code calcule tous les chiffres**, le modèle n'écrit que le texte.
  - **Chaque nombre du texte est revérifié** contre les faits fournis
    (`unknown_numbers`) ; en cas d'écart, une seconde demande, puis le texte
    est marqué `verified: false`.
  - Pseudonymes à l'envoi, vrais noms remis en local ; coût et jetons
    stockés avec chaque texte ; repli serveur (`fallbacks: "default"`) et
    gestion du refus.
  - Une seule clé : le secret `ANTHROPIC_API_KEY`, facultatif. Sans lui,
    la fonction est simplement masquée.
- **Revue par agents à la demande** (`revue-agents.yml`) : l'action
  `anthropics/claude-code-action` en lecture seule, une seule clé,
  constats en JSON, issues ouvertes par un second job **sans** le modèle.
- **Une CI en couches** :
  - bloquante : lint + tests + build + **budget de taille** du premier
    écran + e2e Chromium + e2e **WebKit** (Safari iPhone) ;
  - de nuit : balayage complet (chaque route × 360 / 1 280 px × texte
    200 % × sombre × axe) ;
  - à la demande : mutation, sources publiques réelles (une issue s'ouvre
    seule si un format change, se ferme au retour au vert), smoke test sur
    les vraies données en mode muet.
- **Une porte locale qui lit ses étapes dans `ci.yml`** (`scripts/porte.mjs`) :
  impossible que la porte locale et la CI divergent.
- **Des tests sur la documentation** : `doc-chiffres.test.ts` tient d'accord
  les chiffres écrits dans les docs avec les fichiers ;
  `agents-md.test.ts` vérifie que chaque « AGENTS.md §n » cité existe.
- **Gouvernance** : `docs/juridique.md` (conditions de chaque service, date
  de lecture, risque d'arrêt, licences des données), modèles d'issue
  (bug, récit, étude), modèle de PR, Dependabot, devcontainer, dépendances
  Python verrouillées avec empreintes.
- **`docs/APPRENTISSAGES.md`** au même format que le nôtre (le registre cite
  ÉtapeForge comme modèle), avec des entrées numérotées A1, A2…

## 2. Ce qu'ÉtapeForge peut reprendre (par ordre d'intérêt)

| # | Idée | Pourquoi ici | Effort |
|---|---|---|---|
| 1 | **Site 100 % statique** : données pré-calculées par une Action, publiées sur Pages | `pages.yml` publie déjà une démo pré-générée ; le serveur Express + SQLite ne sert plus que l'éditeur d'étapes | moyen |
| 2 | **Textes rédigés par Claude, chiffres vérifiés** (motif `insights.py`) | récit de chaque étape à partir des faits curés ; règle 12 tenue par la vérification | moyen |
| 3 | **Test de la documentation** (`doc-chiffres`) | nos docs citent des chiffres (éditions, points, tests) qui dérivent | faible |
| 4 | **Porte locale lue dans `ci.yml`** | notre `/porte` et `ci.yml` sont deux listes de la même règle | faible |
| 5 | **Workflow « sources publiques »** qui ouvre une issue | Nominatim, IGN, BRouter, OSRM, ledicodutour changent sans prévenir | faible |
| 6 | **e2e WebKit et balayage multi-largeurs avec axe** | un site grand public sera lu sur iPhone | moyen |
| 7 | **Budget de taille du premier écran** | Leaflet + 5 Mo de données : à charger à la demande | faible |
| 8 | **Cadre juridique** (sur le modèle de `docs/juridique.md`) | voir § 5 : marque, images du Dico, attributions | faible |
| 9 | **Revue par agents en workflow** (à la demande, moindre privilège) | remplace une partie des revues manuelles coûteuses | faible |
| 10 | Modèles d'issue / PR, Dependabot, devcontainer | hygiène, contributeurs | faible |

## 3. Le pivot proposé : un site sur le Tour de France

**Constat.** La création d'étapes (éditeur, routage, export GPX) est la partie
la plus coûteuse à maintenir (serveur, APIs de routage, comptes) pour un usage
limité. La valeur unique du dépôt est ailleurs : des données historiques
**curées et sourcées**.
- 118 éditions et 2 467 étapes dans `stage_towns.json`, de 1903 à 2026,
  Tour Femmes compris.
- **50 éditions détaillées village par village** : 18 410 points, dont
  16 561 placés, chacun relié à son profil source.
- 1 017 étapes curées, 42 cols de référence (`known_cols.json`), des écarts
  expliqués.

Aucun site grand public n'offre cela.

**Vision.** Un site statique, installable (PWA), sans compte :

- **Une page par édition** : carte du parcours village par village, profils,
  cols, chiffres (km, dénivelé), écarts entre la distance officielle et la
  reconstitution affichés (règle 12).
- **« Le Tour est-il passé chez moi ? »** : recherche par commune ou position
  (Epic 32, déjà en place), avec toutes les éditions et les km de passage.
- **Les cols** : fiches, ascensions par édition, records de passages.
- **Frise 1903 → aujourd'hui**, statistiques et comparaisons d'éditions.
- **Récits d'étapes rédigés par Claude** (§ 4), marqués comme tels.
- La création d'étapes **sort du site public**. Elle reste dans le dépôt (on
  ne supprime rien sans décision), comme outil local ou archivée.

**Architecture.** Le pipeline Node reste le moteur, mais seulement dans les
Actions : il produit des JSON par édition et des index (communes, cols). Le
site est servi par Pages, sans serveur ni base. Les données sont publiques :
pas de chiffrement, à la différence de Netatmo.

Le passage à Vite + TypeScript (comme Netatmo) est une option, pas un
préalable : le frontend actuel en JS natif peut évoluer page par page.

**Effet sur l'APK (Epic 40, #563).** L'enveloppe TWA d'une PWA suppose une
instance HTTPS publique : c'était le point bloquant de 40.1. Un site statique
sur Pages la fournit, ce qui ferait de la TWA la voie la plus simple vers les
stores.

## 4. Claude dans le site

**Ce qui est proposé : des récits d'étapes générés dans l'Action, jamais dans
le navigateur.**

1. Le code assemble les **faits** d'une étape : villes, km, cols et
   catégories, départements, écart officiel / reconstitué, sources.
2. Claude rédige 120 à 200 mots à partir de ces seuls faits, avec une
   consigne stricte : n'inventer aucun nom, aucun chiffre, aucun vainqueur ni
   anecdote absents des faits (règle 12).
3. **Vérification** : chaque nombre et chaque nom propre du texte doit figurer
   dans les faits. Sinon, une seconde demande ; à défaut, texte écarté ou
   marqué « non vérifié ».
4. Le texte est stocké en JSON avec le modèle, la date, les jetons et le coût.
   Il est regénéré seulement quand les faits de l'étape changent (empreinte
   des faits).

**Coût estimé.** Tarifs publics vérifiés le 10/11/2026 : Claude Opus 5.5 à
4 $ / 20 $ le million de jetons en entrée / sortie, et l'API Batch à −50 %.
Hypothèse par étape : environ 2 500 jetons en entrée et 500 en sortie, soit
environ 0,02 $.

| Périmètre | Standard | Batch |
|---|---|---|
| Étapes curées (1 017) | ≈ 20 $ | ≈ 10 $ |
| Toutes les étapes (2 467) | ≈ 50 $ | ≈ 25 $ |

Ce sont des estimations, à confirmer sur un échantillon de 10 étapes avant
tout lancement complet. Ensuite, seules les étapes modifiées sont regénérées
(quelques centimes par jour avec la routine).

**Autres usages possibles**, à discuter :
- **Revue par agents** en workflow à la demande, sur le modèle de Netatmo.
- **Aide à la curation** : relecture d'une transcription par Claude Vision
  contre l'image du profil. Cela réduirait les erreurs de lecture d'un chiffre,
  mais l'audit Mireille et la règle 4 restent la référence.

**Ce qui est déconseillé : un chatbot en direct sur le site.** Il demande un
serveur pour cacher la clé, coûte à chaque visite et peut inventer de
l'histoire. Il est contraire à l'architecture statique et à la règle 12.

## 5. Points juridiques à écrire (compléter `NOTICE.md`, qui a déjà les attributions)

- **« Tour de France »** est une marque d'Amaury Sport Organisation (ASO).
  Le site garde son nom propre (ÉtapeForge ou autre) et n'utilise ni logo, ni
  charte, ni maillot. Il porte la mention « site indépendant, non affilié à
  ASO ». *Hypothèse de travail, à vérifier : je n'ai pas lu les conditions
  d'ASO.*
- **Profils du Dico du Tour** (ledicodutour.com) : le site cite les liens
  (`source_url`) et ne republie aucune image. Les faits transcrits (km, noms,
  altitudes) ne sont pas les images. *À confirmer avec le site source avant
  une ouverture large.*
- **Licences** : `NOTICE.md` couvre déjà Wikipédia (CC BY-SA, pour
  `stage_towns.json`), l'IGN et OpenStreetMap (ODbL). Il reste à afficher ces
  attributions sur chaque carte du site public, et à ajouter les conditions des
  serveurs publics BRouter et OSRM utilisés par le pipeline.

## 6. Ce qu'il faut renseigner

| Quoi | Où | Obligatoire ? |
|---|---|---|
| `ANTHROPIC_API_KEY` | GitHub → Settings → Secrets and variables → Actions | **Seulement si les récits Claude sont retenus.** Clé à créer sur console.anthropic.com (service payant). Fixer une limite de dépense mensuelle dans la console. |
| Nom de domaine (fichier `CNAME`) | Settings → Pages → Custom domain | Facultatif. Utile pour l'image et pour isoler le stockage du navigateur des autres sites `opaland.github.io` (apprentissage A1 de Netatmo). |
| Aucune autre variable | — | Le site statique n'a besoin ni de compte, ni de base, ni de clé Nominatim ou IGN au moment de la visite. |

Aucun secret n'est demandé pour l'instant. Tout ce qui précède attend les
décisions ci-dessous.

## 7. Décisions à prendre (par l'utilisateur)

1. **Pivot** : faire d'ÉtapeForge un site sur le Tour (création d'étapes
   retirée du site public), oui ou non ?
2. **Sort de la création d'étapes** : outil local gardé dans le dépôt, ou
   archivé (branche, tag) puis retiré du code ?
3. **Récits Claude** : oui ou non. Si oui :
   - quel périmètre (étapes curées ou toutes) ;
   - quel modèle : Opus 5.5 par défaut, ou Sonnet 5.5, deux fois moins cher ;
   - quelle limite de dépense ;
   - ajout de `ANTHROPIC_API_KEY`.
4. **Nom et domaine** du site.
5. **Frontend** : garder le JS natif et le faire évoluer, ou passer à
   Vite + TypeScript comme Netatmo ?

En attendant, la routine quotidienne continue la curation des éditions : ces
données sont le cœur du site, quel que soit le choix.
