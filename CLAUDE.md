# Travailler sur ÉtapeForge

Ce fichier porte les règles qu'aucune machine ne peut vérifier à ma place.
Ce qui est mécanique est dans `.claude/hooks/` et s'exécute tout seul ; ce
qui relève du jugement est ici, et repose sur ma discipline.

Chaque règle vient d'un raté réel, daté, sur ce dépôt précis. Ce ne sont pas
des principes généraux, ce sont des cicatrices. (Format et esprit repris du
dépôt cousin [Rando-generator](https://github.com/Opaland/Rando-generator),
dont le `CLAUDE.md` a le même but — le contenu, lui, est entièrement propre
à ÉtapeForge.)

---

## 1. Une faille corrigée à une couche ne l'est pas forcément à une autre

La revue croisée du 18/08 (PR #11) a corrigé une XSS stockée dans le mini-site
HTML exporté (`stage.name`/`date`/`stage_type` concaténés dans `innerHTML`/
`bindPopup` sans échappement, côté sink DOM). Le monkey testing du 19/08
(PR #15) a trouvé une **deuxième** XSS dans le même fichier
(`backend/exports.js`) : un nom d'étape contenant `</script>` fermait
prématurément la balise `<script>` qui embarque les données JSON — évasion au
niveau du *parseur HTML*, avant que le moindre JavaScript client (donc le
premier correctif) ne s'exécute.

**Corriger le vecteur qu'on a trouvé ne ferme pas la classe de bug.** Pour
toute donnée utilisateur qui finit dans du HTML généré côté serveur : lister
explicitement chaque couche où elle transite (concaténation HTML directe,
JSON embarqué dans un `<script>`, attribut, DOM sink côté client) et vérifier
chacune séparément.

## 2. Un flag pratique en dev peut s'élargir tout seul en prod

En construisant le mur d'accès public (PR #12), la première version testée
activait `AUTH_REQUIRED` sur `ETAPEFORGE_PUBLIC=1` **ou** `NODE_ENV ===
'production'`. Repéré avant le premier commit : le `Dockerfile` force
`NODE_ENV=production` sur **tous** les déploiements, y compris le kit
Synology/LAN historique qui n'a jamais eu besoin d'un compte. Ce flag aurait
activé un mur d'accès sans mot de passe existant sur des installations qui
n'en demandaient pas.

**Avant d'utiliser une variable d'environnement générique (`NODE_ENV`, etc.)
comme condition d'un nouveau comportement, chercher partout où elle est déjà
forcée ailleurs dans le dépôt** (`Dockerfile`, `docker-compose.yml`, CI) —
pas seulement dans le fichier qu'on modifie.

## 3. Un format de date inventé casse une comparaison sans jamais planter

`pipeline/cache.js` compare des timestamps stockés au format SQLite
(`datetime('now')` → `"YYYY-MM-DD HH:MM:SS"`, espace, pas de millisecondes,
pas de `Z`). Utiliser `toISOString()` (séparateur `T`, millisecondes, `Z`)
sans le reformater produit une comparaison lexicographique qui ne plante
jamais — elle donne juste silencieusement le mauvais résultat à chaque appel.

**Un format de date/heure ne se suppose jamais compatible entre deux couches
(JS ↔ SQLite, ou toute autre paire) : on vérifie une valeur réelle des deux
côtés avant d'écrire la comparaison.**

## 4. Un module-singleton lié à une variable d'environnement ne se réinitialise pas en la réassignant

`backend/db.js` met sa connexion SQLite en cache dans une variable de module,
liée à `ETAPEFORGE_DATA_DIR` lu **au premier `require`**. En concevant
`scripts/monkey.js` (plusieurs graines reproductibles), enchaîner deux
graines avec des `ETAPEFORGE_DATA_DIR` différents dans le **même process
Node** aurait fait écrire la 2ᵉ graine dans la base de la 1ʳᵉ dès qu'un
module intermédiaire (`pipeline/generate.js`, etc.) garde une référence à
l'ancien module `backend/db` en cache — `delete require.cache[...]` sur le
point d'entrée ne suffit pas, il faudrait invalider tout le graphe de
dépendances. Repéré à la conception, jamais expédié comme bug : chaque graine
tourne dans son propre processus enfant.

**Un état mis en cache au premier `require()` et lié à une variable
d'environnement n'est fiable qu'une fois par process.** Isoler par processus
plutôt que de réassigner la variable et espérer.

## 5. Un helper partagé doit être mis à jour quand un nouvel appelant en a besoin autrement, pas supposé déjà compatible

Le helper `wrap()` (`backend/server.js`) renvoyait toujours 500 avec
`err.message`, quel que soit `err.status`. Ça convenait à toutes les routes
existantes (qui ne posaient jamais `err.status`) jusqu'à la route d'import
par lien (PR #24), qui en avait besoin pour distinguer une URL invalide (400)
d'une vraie panne réseau amont (500). Repéré en écrivant les tests de la
nouvelle route, pas en l'écrivant elle-même.

**Un helper transverse qui a toujours suffi jusqu'ici n'est pas une preuve
qu'il suffira pour le prochain appelant — le relire à chaque nouvel usage,
pas seulement le réutiliser.**

## 6. Un mock global intercepte aussi les appels innocents qui partagent ce global

En testant `POST /api/import/link` (`test/importLink.test.js`), remplacer
`global.fetch` pour simuler la réponse d'`api.sports-tracker.com` a d'abord
intercepté **aussi** les appels du test lui-même vers le serveur local de
test — faussant les résultats jusqu'à ce que le stub vérifie explicitement
l'hôte de chaque appel et délègue au vrai `fetch` pour tout ce qui n'est pas
l'hôte simulé.

**Un mock posé sur un global partagé (`fetch`, `Date`, `Math.random`…) doit
distinguer explicitement ce qu'il simule de ce qu'il laisse passer — ne
jamais supposer qu'il ne sera invoqué que par le code qu'on veut tester.**

## 7. Après un squash-merge, la branche locale ne se resynchronise pas toute seule

En enchaînant deux tâches sur la même session (PR #24 puis PR #25), committer
sur l'ancienne branche locale — dont le dernier commit venait d'être
squash-mergé sur `main` sous un **autre** SHA — a produit une PR au diff
gonflé et trompeur (9 fichiers, 394 lignes, montrant des changements déjà
mergés en plus des nouveaux). Repéré avant le merge (`mergeable_state` restait
cohérent, mais les chiffres ne collaient pas), corrigé par
`git rebase --onto origin/main <ancien-commit>`.

**Avant de committer une nouvelle tâche sur une branche de travail existante :
`git log --oneline origin/main..HEAD`, pas seulement `git status`.** Si le
dernier commit de la branche apparaît déjà dans l'historique de `main`
(sous un autre SHA après squash), redémarrer la branche avant de continuer.

## 8. better-sqlite3 ne rejette pas silencieusement un mauvais type — il plante bruyamment

`.run()` n'accepte que `number | string | bigint | Buffer | null` comme
paramètre lié. Un objet/tableau/booléen envoyé par un client (erreur ou
hostile) fait planter la requête en exception non gérée — 500, avec la page
d'erreur HTML par défaut d'Express qui expose la stack trace complète
(donc les chemins de fichiers du serveur) tant qu'aucun middleware d'erreur
dédié n'est en place. Trouvé par monkey testing (PR #15), pas par relecture.

**Toute route qui écrit en base valide le type de chaque champ avant
l'écriture SQL** (`requireString`/`optionalString`/`optionalNumber`,
`backend/server.js`) — et un middleware d'erreur global (4 arguments) reste
le filet de sécurité, jamais le premier rempart.

## 9. Ce qu'on affirme dans une PR ou une doc, on l'a vérifié

La description de la fonctionnalité d'import par lien (PR #24) affirme que
« sports-tracker.com n'autorise pas les requêtes cross-origin depuis
d'autres sites » pour justifier un fetch côté serveur plutôt que navigateur —
affirmation jamais vérifiée par une requête réelle depuis un navigateur,
seulement déduite du fait que c'est le comportement CORS le plus probable.

**Si une phrase de commit, de PR ou de doc commence par « n'autorise pas »,
« garantit », « fonctionne » ou équivalent, soit il y a une commande ou un
test qui le prouve, soit la phrase se reformule en hypothèse** (« vraisembla-
blement », « à confirmer »).

## 10. JS coerce `null` en `0` dans l'arithmétique sans jamais planter — et le même bug se recopie ailleurs sans qu'on le sache

La revue globale du 25/08 (PR #102) a trouvé qu'un trou de couverture
altimétrique (Géoplateforme RGE ALTI ou opentopodata, réponse sans donnée)
était coercé en `0 m` au lieu de rester `null`
(`Math.round(s.ele * 10) / 10` avec `s.ele` = `null`/`undefined` → `0`/`NaN`
selon le chemin). Deux mécanismes distincts, tous deux silencieux :
`sum += null` ⇒ `sum += 0` (biaise toute une moyenne glissante qui recouvre
le trou, pas seulement l'échantillon manquant) et `Math.max(x, null)` ⇒
`Math.max(x, 0)` (inoffensif si `x` est positif, mais transforme un
minimum réel négatif en faux `0` — exactement ce qui arrive dans
`pipeline/descents.js`, qui réutilise `detectClimbs` sur un profil
d'altitude inversé, donc négatif).

Le correctif dans `pipeline/elevation.js` n'a fermé qu'un seul chemin.
`pipeline/importTrack.js` réimplémentait la même logique en ligne pour son
repli réseau — même bug, code dupliqué jamais touché. `pipeline/climbs.js`
avait le même `Math.max` gardé seulement sur `samples[0].eleRaw`, pas
chaque échantillon — trouvé par relecture adverse sur le premier
correctif. `pipeline/checks.js` avait un troisième `Math.max(measured,
s.eleRaw)` non gardé, trouvé par un grep de suivi (`grep -rn
"Math\.\(max\|min\)(.*eleRaw"`) après les deux premiers correctifs.

**Un correctif de coercion `null`→`0` en arithmétique (`+=`, `Math.max`,
`Math.min`) n'est terminé qu'après un grep du même motif sur tout le dépôt,
pas seulement le fichier où le bug a été trouvé** — trois autres
occurrences existaient déjà, deux non détectées par la première relecture.
Et pour tester qu'un tel garde-fou fonctionne vraiment : si le domaine réel
de la donnée est toujours positif (altitudes de cols), `Math.max(x, 0)`
n'est jamais discriminant dans les tests — il faut sortir du domaine
réaliste (profil négaté, valeur négative synthétique) pour que le test
échoue vraiment sans le correctif.

## 11. Le protocole de développement

Un item cohérent par PR. Commits en français, footer
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Jamais de push
direct sur `main`.

**Avant tout commit** : `npm test` (le hook `porte-avant-commit.sh` le
vérifie). **Avant toute PR** : `/porte` — `npm test` + `npm run demo`, et si
le changement touche le frontend, une vérification Playwright visuelle
avant/après (voir `docs/PRD.md`, definition of done). `npm run monkey` et
`npm run mutation` restent exploratoires, volontairement hors de la porte
bloquante (voir README) — à lancer à part, le premier quand une trouvaille
récente mérite d'être rejouée, le second pour vérifier qu'un test ajouté
discrimine vraiment (même esprit que l'agent `verificateur-de-tests`, à
l'échelle du fichier plutôt que d'un seul test).

## 12. Ce qui vaut arrêt

- `main` rouge (CI en échec) : ne rien empiler dessus, corriger d'abord.
- Une régression de sécurité qui repasse (validation d'entrée, échappement
  HTML/JS, authentification) : reprendre depuis la règle 1, pas juste patcher
  le symptôme trouvé.
- Une donnée historique affichée comme certaine sans source citée dans
  `pipeline/data/historic_routes.json` — l'écart entre distance officielle et
  reconstitution s'affiche toujours, jamais masqué pour paraître plus précis
  que la donnée ne l'est.

## 13. Après chaque tâche, une revue ; en fin de session, une revue globale

`/revue-sprint` relit le diff en cherchant ce qu'il a cassé, pas ce qu'il a
réparé. `/revue-globale` regarde le dépôt dans son ensemble (sécurité, dette,
cohérence des docs, état du déploiement) — pas une revue transversale des
diffs récents, qui ne trouverait rien que `/revue-sprint` n'ait déjà couvert.
