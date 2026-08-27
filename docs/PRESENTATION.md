# Document de présentation — ÉtapeForge

Préparé pour la présentation du projet (Sprint 10). Ne remplace aucun des
autres documents — condense l'architecture, les choix assumés et anticipe
les questions d'un public qui découvre le projet en une séance, avec
renvoi vers le document source pour chaque affirmation plutôt que de la
recopier sans référence (CLAUDE.md règle 9).

## En une phrase

**Générateur d'étapes du Tour de France** — 100 % local (Node.js + SQLite),
qui reconstruit automatiquement une étape (historique, ou imaginée) sur le
réseau routier actuel : donner une liste de lieux, obtenir un tracé routé,
une altimétrie échantillonnée et des côtes catégorisées HC (hors catégorie,
la plus dure) à 4 (la plus facile) — sans repasser chaque étape à la main.
Détail du positionnement et des concurrents étudiés : [`BRIEF.md`](./BRIEF.md).

## Architecture, en une image mentale

```
Utilisateur·rice (navigateur)
        │  JS vanilla + Leaflet, aucun framework (frontend/)
        ▼
Express (backend/server.js) ── mur d'accès optionnel (backend/auth.js)
        │
        ▼
Pipeline (pipeline/generate.js, orchestrateur)
  1. géocodage    (pipeline/geocode.js)    → IGN/Géoplateforme, repli Nominatim
  2. routage      (pipeline/routing.js)    → OSRM
  3. altimétrie   (pipeline/elevation.js)  → opentopodata
  4. côtes/descentes (pipeline/climbs.js, pipeline/descents.js) → géocodage
     inverse pour le nom (mêmes fournisseurs qu'à l'étape 1), catégorisation
     par calcul local
  5. analyse km/km   (pipeline/kmanalysis.js)                   → calcul local
  6. audits qualité  (pipeline/checks.js)                       → calcul local
        │
        ▼
SQLite (backend/db.js, better-sqlite3) — une seule base fichier, sauvegarde
automatique optionnelle (backend/backup.js)
```

Import historique : `pipeline/wikipedia.js` (parseur DOM réel,
`node-html-parser`) lit la liste d'étapes d'une année sur Wikipédia,
`pipeline/importer.js` crée les étapes + waypoints, puis le même pipeline
ci-dessus les génère une par une — **aucun chemin de code séparé** entre une
étape créée dans l'éditeur et une étape historique importée. **N'importe
quelle année depuis 1903 s'importe** (villes de départ/arrivée), mais les
points de passage intermédiaires sourcés (cols, villes d'époque vérifiées) —
donc une reconstitution fidèle plutôt qu'une ligne droite — n'existent que
pour **21 années curées à la main** (`pipeline/data/historic_routes.json` :
1903-1913-1919-1922-1926-1934-1947-1951-1952-1975-1989, et 2020→2026 en
détail). Une année non curée importe quand même — badge « reconstruction
partielle » affiché, jamais masqué (`frontend/archives.js`). Si le public
demande une année précise en direct, vérifier d'abord qu'elle est dans cette
liste avant de promettre un tracé détaillé.

**Offline-first, pas une option cachée** : `pipeline/http.js` bascule tout
appel réseau vers un simulateur déterministe (`ETAPEFORGE_OFFLINE=1`) —
c'est le mode utilisé par `npm run demo`, pas un mode dégradé secondaire.
La suite de tests (`npm test`) reste elle aussi sans dépendance réseau
réelle, par plusieurs mécanismes selon le fichier (voir la question « Ça
marche sans connexion Internet ? » ci-dessous pour le détail — pas un
mécanisme unique). `pipeline/rateLimiter.js` et `pipeline/cache.js`
protègent les APIs publiques gratuites en usage réel (pas de clé payante nulle
part, voir `docs/CONTINUITE-APIS.md`).

## Choix assumés (pas des manques)

Détail et justification complète : [`BRIEF.md`](./BRIEF.md#ce-quon-ne-fera-pas).

| Choix | Pourquoi |
|---|---|
| Pas de compte par défaut | Usage local/LAN visé en premier — le mur d'accès (`ETAPEFORGE_PUBLIC=1`) est une option pour qui veut exposer publiquement, jamais activé automatiquement (y compris en Docker, où `NODE_ENV=production` ne suffit pas — bug corrigé avant même d'être poussé) |
| Pas de dépendance cloud propriétaire | IGN/Géoplateforme, OSM/OSRM, opentopodata, Wikipédia — sources ouvertes uniquement, mises en cache localement |
| Pas de framework frontend | JS vanilla + Leaflet, 5 dépendances directes en tout, chacune évaluée avant adoption |
| Pas de base de cols généraliste | `/cols.html` reste un sous-produit des étapes déjà générées localement, jamais un référentiel mondial type climbfinder |
| Pas de navigation temps réel | ÉtapeForge reconstruit et documente une étape, il n'accompagne pas une sortie en cours (rôle d'un GPS vélo) |
| Authentification = mur d'accès, pas de cloisonnement | Les données restent partagées entre tous les comptes même en mode public — mise en garde explicite avant d'inviter qui que ce soit ([`DEPLOY-PUBLIC.md`](./DEPLOY-PUBLIC.md)) |

## FAQ anticipée

**Ça marche sans connexion Internet ?**
Le mode démo (`npm run demo`) tourne en mode hors-ligne (simulateur
déterministe, `ETAPEFORGE_OFFLINE=1`) — reproductible partout, y compris
pour la présentation elle-même. La suite de tests (`npm test`) ne dépend du
réseau non plus, par plusieurs mécanismes selon le fichier (simulateur
hors-ligne, `fetch` mocké, ou serveur HTTP local monté pour le test) — jamais
un vrai appel vers une API externe. La génération réelle (vrais tracés,
vraie altimétrie) a besoin d'un accès aux APIs publiques citées ci-dessus.

**Mes données partent quelque part ?**
Tout est stocké dans un seul fichier SQLite local. En usage par défaut, les
seuls appels sortants sont vers les fournisseurs de géocodage/routage/
altimétrie ci-dessus (coordonnées/requêtes de lieux, pas de donnée
personnelle) — visibles en direct sur `GET /api/diagnostic`
([`docs/CONTINUITE-APIS.md`](./CONTINUITE-APIS.md)). Deux intégrations
**opt-in**, désactivées tant qu'elles ne sont pas explicitement configurées,
font exception : la connexion Suunto (`backend/suunto.js`, OAuth2 vers
`suunto.com`, pour importer ses propres activités) et un webhook de
notification vers une URL au choix (`backend/notify.js`, Slack/Discord/ntfy).

**Combien de temps prend la génération d'une étape ?**
Mesuré, pas supposé (CLAUDE.md règle 9) : le pipeline lui-même (calcul +
écriture SQLite) reste de l'ordre de 100 ms même sur l'étape la plus longue
testée, en mode hors-ligne. En usage réel, le temps perçu dépend surtout de
la latence des APIs externes, pas du pipeline — détail, chiffres exacts et
méthodologie dans [`docs/PERF-PIPELINE.md`](./PERF-PIPELINE.md).

**Les données historiques sont-elles fiables ?**
Chaque affirmation historique (distance officielle, année d'apparition d'un
col) cite sa source dans `pipeline/data/historic_routes.json` — l'écart entre
distance officielle et reconstitution s'affiche toujours sur la fiche
d'étape, jamais masqué pour paraître plus précis que la donnée ne l'est
(CLAUDE.md règle 12).

**C'est testé comment ?**
530 tests au moment d'écrire ces lignes (`npm test`, bloquant avant chaque
commit) — pipeline, sécurité
(pas de dialogue navigateur natif, secrets Suunto jamais renvoyés par
l'API — le stockage en base reste une limite connue, voir la question sur
ce qui manque encore — contraste WCAG AA vérifié par calcul réel, pas
recopié), parseur historique. En
complément, volontairement hors CI : monkey testing (`npm run monkey`,
persona qui clique vite et teste des entrées hostiles) et tests de mutation
(`npm run mutation`, vérifie que les tests détectent vraiment un bug plutôt
que de juste exécuter la ligne).

**Si j'ouvre ça sur Internet, c'est sécurisé ?**
Mur d'accès optionnel (email/mot de passe, hachage scrypt, sessions
`httpOnly`) — mais **pas d'isolation par utilisateur** : toutes les données
restent partagées entre tous les comptes, à ne partager qu'avec des
personnes de confiance. Détail complet : [`DEPLOY-PUBLIC.md`](./DEPLOY-PUBLIC.md).

**Qu'est-ce qui manque encore, volontairement ou pas ?**
Détail complet, item par item avec sa raison : [issue #10](https://github.com/Opaland/Tdf-generator/issues/10)
(backlog vivant, pas un engagement de calendrier). Deux catégories, à ne pas
confondre :
- **Bloqué, pas oublié** — la plupart des items encore ouverts butent sur le
  même obstacle : ce sandbox de développement n'a pas de sortie réseau vers
  les APIs externes du projet (test de parité simulateur vs vraies APIs,
  détection de surface non goudonnée). La vérification croisée périodique
  en CI existe : `demo-online.yml` tourne déjà chaque nuit sans repli
  (backlog #10 section F), et sonde désormais aussi Nominatim/opentopodata
  (`pipeline/diagnostic.js`, réutilisé de `GET /api/diagnostic`) — les deux
  seuls des 5 services externes que la route 1903 (entièrement française)
  n'exerçait jamais. Le chemin d'échec est vérifié depuis ce sandbox (réseau
  coupé ici, détecté proprement, `allOk: false` avec le détail par hôte) ;
  le chemin de succès tourne sur l'infrastructure GitHub Actions, pas ici —
  son premier résultat réel reste à observer après fusion.
  Le Tour de France Femmes n'a plus ce blocage d'architecture : `editions`
  porte désormais une colonne `category` (hommes | femmes), et
  `importEdition(year, { category })` écrase l'édition existante de la même
  année **et catégorie**, jamais l'autre catégorie. Reste bloqué par le même
  obstacle réseau que le reste de cette liste : aucune fixture Wikipédia ni
  parcours curé Femmes n'existe encore dans ce dépôt (rien à scraper depuis
  ce sandbox) — l'import y échoue proprement, sans donnée inventée, en
  attendant un accès réseau pour le peupler. Le **vrai parcours 2027**
  (`scripts/demo-2027.js` reste hypothétique) attend l'annonce officielle
  ASO, pas encore sortie — pas un blocage technique, un calendrier externe.
- **Décision volontairement laissée à l'utilisateur, pas prise en autonome**
  — durcissement des identifiants Suunto stockés en clair en base (acceptable
  en LAN strict, à revoir si l'app est un jour exposée au-delà), points de
  ravitaillement/villages traversés (coût d'un géocodage inverse à
  l'échelle), candidature au programme partenaire Suunto (implique un usage
  au-delà du strictement personnel).

**Pourquoi pas React/Vue/un framework moderne ?**
Choix assumé, pas un oubli : cohérent avec « aucune dépendance inutile »
(5 dépendances directes en tout). Le détail de ce que ça implique pour le
design (duplication volontaire de certaines valeurs CSS plutôt qu'une
abstraction prématurée) est dans [`docs/DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

**Le code est disponible, sous quelle licence ?**
Oui — [github.com/Opaland/Tdf-generator](https://github.com/Opaland/Tdf-generator),
licence [MIT](../LICENSE). Les données historiques importées de Wikipédia
(`pipeline/data/historic_routes.json`, `pipeline/fixtures/`) restent sous
leur licence d'origine CC BY-SA, distincte du code — détail dans
[`NOTICE.md`](../NOTICE.md).
