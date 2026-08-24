# Un backend pour la gestion des données — état des lieux et pistes

Ce document répond à une question posée en session (24/08/2026) : faut-il un
« backend pour la gestion des données » ? C'est une **réflexion**, pas une
décision — aucune des pistes ci-dessous n'est implémentée. Un choix
d'architecture qui change la façon dont les données de référence sont
maintenues mérite un feu vert explicite avant d'être construit, pas une
initiative unilatérale en pleine session autonome.

## Où en sont les données aujourd'hui

Deux familles de données, deux mécanismes de gestion complètement différents :

1. **Données utilisateur** (étapes créées/éditées, imports GPX/FIT, éditions
   personnalisées) : dans SQLite (`backend/db.js`), via l'API REST
   (`backend/server.js`). CRUD complet, validé côté serveur
   (`requireString`/`optionalNumber`…), sauvegardé automatiquement
   (`backend/backup.js`). **Ce chemin a déjà un backend de gestion des
   données** — c'est celui-là.

2. **Données de référence curées** (`pipeline/data/historic_routes.json`,
   `pipeline/data/known_cols.json`) : fichiers JSON versionnés dans le dépôt,
   édités à la main, chargés une fois au démarrage (`require()`). Aucune
   route API ne les lit ni ne les écrit — `reconstructionWaypoints()`
   (`pipeline/wikipedia.js`) les consulte en mémoire.

Le deuxième mécanisme est probablement ce que la question visait : chaque
étape historique ajoutée cette session (1913, 1919, 1922, 1926, 1934, 1947,
1951, 1975, 1989, plus les enrichissements 2020-2026) a suivi le même
chemin — éditer le JSON à la main, `npm test` pour valider la structure
(`test/historicRoutes.test.js`), ouvrir une PR, attendre la CI, merger. Une
dizaine de PR pour une dizaine d'étapes : ça fonctionne, mais ça ne passe pas
à l'échelle si quelqu'un d'autre que ce qui tourne dans cette session veut
curer une étape.

## Pourquoi ce n'est pas déjà en base

Ce n'est pas un oubli. Le fichier JSON en git donne trois choses qu'une
table SQLite éditée par une UI n'a pas gratuitement :

- **Revue avant publication** — chaque ajout de côte/sprint/bonification
  passe par une PR relisible (diff clair, CI qui vérifie la structure), pas
  un bouton qui écrit directement en base de production.
- **Traçabilité de la source** — le champ `confidence` (`status`,
  `level`, `detail`) et les commentaires de commit documentent *pourquoi*
  une valeur est retenue (ex. l'altitude du Puy de Dôme marquée `UNSURE`,
  PR #63/#65) ; c'est le mécanisme qui a permis d'appliquer CLAUDE.md règle 9
  sur chaque étape ajoutée.
- **Rejouabilité** — `git log` sur `historic_routes.json` est l'historique
  complet de chaque correction (ex. le bug Markstein 2022/2023/2024 corrigé
  trois fois avant que `test/historicRoutes.test.js` ne l'empêche de
  revenir, cf. l'en-tête de ce test).

Un CRUD classique (formulaire → écriture directe en base) perdrait les
trois sans un gros effort de remplacement (workflow d'approbation,
changelog structuré, etc.) — c'est-à-dire qu'on referait, en moins bien,
ce que git + PR + CI donnent déjà gratuitement.

## Pistes, avec leur coût réel

### A. Ne rien changer, réduire juste la friction d'édition

Un script `scripts/curate.js` (CLI interactif ou formulaire local minimal
qui **génère le JSON à coller** dans `historic_routes.json`, structure
validée avant collage) au lieu d'éditer le JSON brut à la main. Zéro
migration, zéro nouvelle route API, le fichier reste la source de vérité en
git. Coût : faible (quelques heures). Ne résout que l'ergonomie d'édition,
pas la question « qui peut curer sans passer par une session Claude Code ou
un accès git ».

### B. Admin UI qui écrit dans une table SQLite, JSON généré en sortie

Une vraie interface web (`/admin/curation.html` + routes API dédiées,
protégées par `requireAuth` — déjà en place) qui édite des lignes dans une
nouvelle table `curated_stages`, avec un bouton « exporter vers
historic_routes.json » qui régénère le fichier à committer. Garde le fichier
JSON comme artefact publié (donc la CI/les tests structurels continuent de
le valider), mais l'édition elle-même devient une UI, pas un éditeur de
texte. Coût : moyen — nouvelle table, nouvelles routes CRUD, UI de saisie
avec les mêmes contraintes que `historic_routes.json` (kind valide,
bonus_sec numérique, etc., déjà exprimées dans
`test/historicRoutes.test.js` — à porter en validation serveur). Garde la
revue humaine (le JSON exporté passe quand même en PR) mais retire l'étape
manuelle d'édition de texte.

### C. Migration complète : la base devient la source de vérité

`historic_routes.json` disparaît, `reconstructionWaypoints()` lit en base.
Coût : élevé, et **perd la propriété la plus utile** (revue par PR avant que
la donnée n'affecte une reconstruction) sauf à reconstruire un workflow
d'approbation par-dessus (état `draft`/`published`, table d'audit) — soit
sensiblement le travail que fait déjà git, réimplémenté à la main dans
l'app. À ne considérer que si la curation doit se faire à un volume qui rend
git/PR réellement bloquant (pas le cas aujourd'hui : ~20 éditions curées en
plusieurs mois).

## Recommandation

**B**, si ce chantier est retenu : garde le mécanisme de revue qui a
structurellement empêché des erreurs de données cette session (badges
« sourcé »/« position approximative », champ `confidence`, tests
structurels) tout en retirant la friction réelle (éditer du JSON à la
main). **A** est le choix pragmatique si le besoin est juste "moins
pénible à éditer soi-même" plutôt que "permettre à quelqu'un d'autre de
curer sans repasser par git".

Aucune des deux n'est implémentée par ce document — à confirmer avant
tout chantier de ce type.

---
_Généré par [Claude Code](https://claude.ai/code), en réponse à une question
posée en session le 24/08/2026. Réflexion, pas une implémentation — voir la
recommandation ci-dessus pour la suite si retenue._
