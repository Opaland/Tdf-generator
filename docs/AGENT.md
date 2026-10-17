# Agent de curation (outil de développement)

Automatise la partie recherche de la curation d'étape — exactement ce que
cette session a fait à la main sur ~90 étapes — sans toucher à l'app ni à
ce qu'un utilisateur final exécute.

## Pourquoi un script, pas une fonctionnalité de l'app

`docs/BRIEF.md` (« Ce qu'on ne fera pas ») interdit « un service tiers à
clé API payante en fonctionnement normal ». Un agent Claude embarqué dans
le backend serait exactement ça. Un script de développement, lancé à la
main par un mainteneur avec sa propre clé, n'en fait jamais partie — même
principe que `scripts/calibrate-gpx-stage.js`, qui existe déjà hors du
chemin d'exécution normal de l'app.

## Ce que l'agent fait — et ne fait pas

**Fait** : pour une étape donnée (édition + numéro) hors tolérance,
propose une liste de vias plausibles (villes, cols) avec une justification
sommaire, à partir de ce que le modèle sait du parcours historique réel.

**Ne fait jamais** :
- Écrire directement dans `historic_routes.json` — le script affiche une
  proposition, le mainteneur l'édite et la commite à la main.
- Affirmer un écart de distance. Le % officiel vs reconstruit n'est
  **jamais** calculé par le modèle — toujours par le pipeline réel
  (`pipeline/geocode.js` → `pipeline/generate.js` → `pipeline/checks.js`),
  rejoué sur la proposition avant de l'afficher. Un modèle de langage ne
  sait pas calculer une distance de routage réelle ; seul le pipeline le
  sait.
- Inventer un via sans le signaler : toute proposition non vérifiable par
  le modèle (pas de source citable) est explicitement marquée comme telle
  dans la sortie, jamais présentée avec la même confiance qu'un via sourcé.

## Flux

1. `node scripts/agent-curate-stage.js --year 1992 --stage 13`
2. Le script lit l'état actuel de l'étape dans `historic_routes.json`
   (start/finish/distance officielle/vias déjà présents).
3. Si `ANTHROPIC_API_KEY` n'est pas défini : message clair, sortie non
   nulle, aucun appel réseau. Jamais de repli silencieux.
4. Appel à l'API Anthropic (fetch brut, pas de nouvelle dépendance —
   cohérent avec `pipeline/http.js`) : demande une liste de vias plausibles
   avec leur justification et leur niveau de confiance.
5. Chaque via proposé est géocodé et injecté dans une **copie temporaire**
   de l'étape, puis régénéré par le vrai pipeline (réseau réel ou cache) :
   distance reconstruite, écart %, avertissements `checks.items` — les
   mêmes qu'un `npm run demo` normal.
6. Sortie : la proposition + le résultat **vérifié**, jamais une estimation
   du modèle. Le mainteneur décide d'accepter, d'ajuster ou de rejeter —
   puis suit le protocole habituel (une PR, les tests, la revue adverse si
   le diff touche du code).

## Ce qui reste à faire (hors scope de ce premier scaffold)

- Le prompt exact envoyé au modèle (contexte minimal : nom de l'édition,
  ville de départ/arrivée, distance officielle, vias déjà connus d'étapes
  voisines pour calibrer le format attendu).
- Format de sortie structuré (JSON) pour que le script puisse générer
  automatiquement le bloc `vias` à copier-coller, plutôt que du texte libre
  à retranscrire à la main.
- Décider si le coût (clé API du mainteneur, pas de l'utilisateur) justifie
  d'automatiser aussi la partie "recherche de sources tierces" (actuellement
  cyclingstage.com/Wikipédia consultés à la main) — probablement hors
  scope v1 : un agent qui invente une URL de source serait pire que l'absence
  d'agent.
