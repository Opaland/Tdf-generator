# PRD — ÉtapeForge

Dans quel ordre avancer, et à quoi voit-on qu'un sujet est fini. Ce qui est
décidé (positionnement, limites) est dans `BRIEF.md` ; la liste détaillée des
chantiers est dans [issue #10](https://github.com/Opaland/Tdf-generator/issues/10)
— ce document dit **dans quel ordre** les prendre, pas ce qu'ils contiennent.

## Definition of done

Un chantier n'est livré que si :

1. **`npm test` passe** (530 tests au moment d'écrire ces lignes — pipeline,
   parseur historique, régressions de sécurité) et **`npm run demo` passe**
   (10 vérifications de bout en bout, mode hors-ligne, reproductible partout).
2. **Une trouvaille de test manuel/exploratoire devient un test permanent**
   avant de fermer le sujet — jamais juste corrigée puis oubliée. Précédent :
   les deux bugs trouvés en monkey testing (validation d'entrée, évasion XSS
   `</script>`) ont chacun leur cas dans `test/serverFuzz.test.js` (PR #15).
3. **Un changement d'interface est vérifié visuellement**, pas juste relu
   dans le code — capture Playwright avant/après (desktop **et** mobile pour
   tout ce qui touche à la mise en page), interaction de bout en bout pour un
   comportement (ex. double-clic de confirmation testé clic par clic, pas
   supposé correct). Précédent : PR #24, où corriger le débordement de la nav
   a révélé deux causes additionnelles du même symptôme sur l'éditeur,
   invisibles sans re-mesurer après le premier correctif.
4. **Une affirmation sourcée reste vérifiable** : toute donnée historique
   (distance officielle, année d'apparition d'un col) cite sa source dans le
   JSON (`pipeline/data/historic_routes.json`), jamais en dur dans le code
   sans référence.
5. **CI verte avant merge**, toujours par squash, jamais de push direct sur
   `main`. Une PR qui touche la sécurité ou l'auth (mur d'accès, sessions,
   validation d'entrée) est relue avec l'œil sécurité avant merge, pas après.

Le build seul ne suffit pas — un `npm run demo` vert avec un mode hors-ligne
qui masque une vraie régression réseau ne compte pas comme testé (voir
l'item F du backlog sur `pages.yml` : le job en ligne actuel ne fait
qu'avertir, jamais échouer).

## Comment on décide de l'ordre

Le backlog (#10) est volontairement **sans ordre de priorité imposé** — les
sections A à F sont des thèmes, pas un classement. Mais tout n'est pas
équivalent : voici la logique de séquencement, à réévaluer à chaque session
plutôt qu'à suivre aveuglément.

### 1. Ce qui débloque le reste passe devant

- **Rigueur des données (section A)** avant tout enrichissement algorithmique
  qui en dépend : un score de côte plus fin (section C) ne vaut rien si les
  altitudes de référence qu'il compare ne sont pas centralisées et sourcées.
- **Couverture de tests manquante (section F)** avant d'empiler de la
  complexité dessus : `pipeline/geocode.js` (repli Nominatim) et
  `pipeline/wikipedia.js` (mini-parseur regex, casse silencieusement sur un
  changement de mise en page Wikipédia) sont les deux zones où une régression
  serait aujourd'hui invisible.

### 2. Les correctifs UI/UX P2 sont des quick wins isolés

Les [issues #20 à #23](https://github.com/Opaland/Tdf-generator/issues/20)
(a11y clavier, flash sans nav au chargement, mur de texte Archives,
affordance de scroll) ne dépendent de rien et ne bloquent rien — à picker
librement entre deux chantiers plus lourds, une PR par item comme d'habitude.

### 3. Le contenu (nouvelles années historiques) avance en parallèle

La section B (1913, 1922, Ventoux, années emblématiques 1919-1998) ne
partage aucune dépendance technique avec le reste — c'est le seul axe où
« avancer en même temps qu'autre chose » est réellement sans risque de
conflit ou de rework.

### 4. Les idées venues de l'étude concurrentielle (#14) s'évaluent au cas par
   cas contre `BRIEF.md`

Toute idée piochée chez un concurrent passe d'abord par la question « est-ce
que ça sert la reconstruction automatique par pipeline, ou est-ce qu'on
recopie une feature d'éditeur manuel qui n'a pas de raison d'être ici ? »
avant d'entrer dans le backlog actif — roadbook, marqueurs de sprint et
export TCX en sont des exemples déjà passés par ce filtre et livrés.

### 5. L'infra self-hosted (section E) attend un besoin exprimé, pas une
   anticipation

Sauvegarde automatique, notifications d'échec, dashboard de quotas : utiles,
mais à construire quand un usage réel en Docker/Synology le réclame, pas en
spéculant sur un besoin. Exception déjà traitée : le mur d'accès public
(PR #12) répondait à une demande explicite, pas à une anticipation.

## Ce qui a changé de statut récemment

- **Vérification mobile réelle** (item historique de la section D) : traitée
  par un audit UI/UX dédié (persona Design Lead / Ops Design) plutôt que
  cochée de tête — voir #16-#23 et la note dans #10.
- **Validation d'entrée sur l'API** et **tests pour `backend/server.js`/
  `backend/exports.js`** (section F) : traités par le monkey testing du
  19/08 (PR #15), pas anticipés en amont — la méthode (fuzzing d'API +
  fuzzing d'UI par persona) a trouvé plus vite que la relecture de code.
