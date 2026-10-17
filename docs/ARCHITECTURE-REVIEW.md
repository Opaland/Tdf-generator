# Revue d'architecture — ÉtapeForge (Epic 26.1)

> Revue indépendante (persona architecte logiciel), lecture seule de `main`
> (commit `c9b83e2`), 17/10/2026. Chaque affirmation renvoie à un
> `fichier:ligne` ; ce qui n'a pas pu être vérifié dans le dépôt (CGU des
> fournisseurs, juridique) est marqué **à confirmer**. Les points les plus
> forts (§1.1, §2.2-3, §2.4, §3.1) ont été re-vérifiés à la main avant
> commit. **Ce document propose, il ne décide rien** : chaque recommandation
> est classée « décision produit » ou « dette objective » (§5).

## 0. Résumé

- **La PWA est une coquille d'installabilité, pas un mode hors-ligne** : le
  service worker ne cache rien et relaie chaque requête au réseau
  (`frontend/sw.js:21-23`). Hors-ligne, l'application ne fonctionne pas.
- **La « base partagée » existe déjà** : c'est le SQLite unique du serveur.
  La vraie question n'est pas « PWA vs base », c'est « veut-on de la
  **lecture hors-ligne** côté navigateur ? » — décision produit, avec une
  voie bon marché via `scripts/build-site.js`.
- **Une API à clés bute d'abord sur l'autorisation, pas sur la technique** :
  aujourd'hui toute route est ouverte à tout compte connecté, y compris les
  destructrices (restauration de sauvegarde, réimport, bascule hors-ligne
  globale). Ni isolation, ni rôles, ni quotas par client, ni mesure d'usage.
- **Ce qui empêche de passer à l'échelle n'est pas SQLite** mais les
  singletons en mémoire du process (files par hôte, jobs en cours, mode
  hors-ligne global).

## 1. PWA, base locale (IndexedDB/SQLite WASM) ou base partagée ?

### 1.1 Ce que fait la PWA aujourd'hui

| Élément | Constat | Réf. |
|---|---|---|
| Manifest | nom, `display: standalone`, 3 icônes, `start_url: /` | `frontend/manifest.json:1-16` |
| Enregistrement SW | sur chaque page via `initChrome()`, ignoré en démo GitHub Pages | `frontend/common.js:267-270` |
| `install` / `activate` | `skipWaiting()` + `clients.claim()`, **aucun precache** | `frontend/sw.js:13-19` |
| `fetch` | `event.respondWith(fetch(event.request))` — relais pur, aucun `caches.*` | `frontend/sw.js:21-23` |
| Choix assumé | « aucune mise en cache volontaire » pour ne jamais afficher une donnée périmée comme à jour | `frontend/sw.js:2-11` |
| Stockage navigateur | `localStorage` seulement (dernière version vue / notes de version) | `frontend/common.js:227-249` |
| Tuiles | IGN WMTS + OSM en direct, non cachées | `frontend/common.js:141-153` |

**Hors-ligne aujourd'hui** : tout échoue au niveau réseau. Le « mode
hors-ligne » documenté (`ETAPEFORGE_OFFLINE=1`, `pipeline/http.js:15`) est un
mode **serveur** (simulateur à la place des API amont), pas une consultation
sans réseau.

### 1.2 Options

| Option | Apporte | Coût | Risque |
|---|---|---|---|
| **A. Statu quo** | installabilité | 0 | « PWA » devient un abus de langage |
| **B. Cache de lecture SW** (coquille + `GET /api/stages/:id` consultés, network-first) | revoir hors-ligne une étape déjà ouverte | S-M | données périmées → bandeau « copie du JJ/MM » obligatoire (respecte l'esprit de `sw.js:6-8`) |
| **C. Paquet JSON statique** — `scripts/build-site.js` produit déjà `data/stage-N.json`, `edition-N.json`, `mapdata-N.json` (`scripts/build-site.js:89-110`), et le routage `staticApi` existe (`frontend/common.js:47-60`) | « télécharger une édition pour le hors-ligne » sans nouveau format | M | taille (~55 Ko/étape, `backend/server.js:35`) ; tuiles hors périmètre |
| **D. IndexedDB / SQLite WASM** | requêtes et écriture hors-ligne | L | synchro/conflits inexistants aujourd'hui (la restauration « remplace tout, pas de fusion », `backend/server.js:920-929`) ; double schéma |
| **E. Base serveur partagée** | existe déjà (`backend/db.js:179-207`) | — | — |

La génération a besoin des API amont (`pipeline/generate.js:8-14`) : une base
locale ne servirait qu'à la **lecture**, que B/C couvrent sans moteur de
synchronisation. **D est déconseillée.** Les **tuiles** sont le vrai verrou
d'une carte hors-ligne : leur préchargement massif est vraisemblablement
interdit par les politiques OSM/IGN (**à confirmer**).

- **Décision produit** : le cyclosportif (`docs/BRIEF.md`) doit-il consulter
  une étape sans réseau (en montagne) ? Oui → C puis B. Non → assumer A et
  ne plus présenter la PWA comme « hors-ligne ».
- **Dette objective** : aucune, le choix de `sw.js` est documenté et cohérent.

## 2. Monétisation par clé API

### 2.1 Les 38 routes de `backend/server.js` (+ routeurs Strava/Suunto), classées

| Classe | Routes | Exposable ? |
|---|---|---|
| **Lecture de données dérivées stockées** | `GET /api/stages`, `/api/stages/:id`, `/:id/similar`, `/api/editions`, `/:id`, `/:id/mapdata`, `/api/climbs`, `/api/editions/highlights`, exports json/gpx/tcx/kml | **Oui** — le cœur de valeur d'une base historique remplie ; demande pagination + versionnage d'abord (§2.2) |
| **Relais des API amont** | `GET /api/geocode`, `GET /api/reverse` | **Non** — reviendrait à revendre la capacité de Géoplateforme/Nominatim |
| **Calcul/écriture déclenchant l'amont** | `POST /api/stages/:id/generate`, `/api/editions/import(-all)`, `/api/import/{gpx,fit,link}` | seulement avec quota strict et file persistante ; à éviter en v1 |
| **Administration** | `/api/backup/*`, `POST /api/offline`, `/api/diagnostic`, `/api/quota`, `/api/strava/*`, `/api/suunto/*` | **Jamais** |

### 2.2 Ce qui manque (constaté)

1. **Aucune authentification par clé** : `requireAuth` ne lit qu'un cookie de
   session et ne fait rien hors mode public (`backend/auth.js:167-173`).
2. **Aucune isolation** : aucune table de données n'a de `user_id`
   (`backend/db.js:14-147`), par choix (`db.js:149-152`). Les jetons OAuth
   Strava/Suunto sont **globaux à l'instance** (`backend/settings.js:9-25`).
3. **Aucun rôle** : `users` = email + hash (`db.js:153-158`), inscription
   libre. Conséquence vérifiée : en mode public, **tout compte inscrit** peut
   `POST /api/backup/import` avec `confirm: true` et remplacer toutes les
   données (`backend/server.js:930-935`, derrière le seul `requireAuth` de
   `server.js:138`), réimporter une édition (supprime ses étapes générées,
   `pipeline/importer.js:57-61`), ou basculer **tout le serveur** sur le
   simulateur (`server.js:140-143`). `docs/DEPLOY-PUBLIC.md` le reconnaît
   déjà.
4. **Rate limiting** limité à login/register, en mémoire, par IP
   (`auth.js:136-163`).
5. **Usage mesuré par hôte amont, pas par client**, en mémoire, remis à zéro
   au redémarrage (`pipeline/apiUsage.js:12`) — non facturable.
6. **Pas de pagination** : `/api/stages`, `/api/climbs` renvoient toute la
   table (`server.js:175-192`, `605-633`) ; better-sqlite3 étant synchrone,
   à ~2 200 étapes cela bloque la boucle d'événements.
7. **Pas de versionnage** (`/api/...` sans `/v1`), ni `Cache-Control`/`ETag`.
8. **Erreurs incohérentes** : `wrap()` renvoie `err.message` brut en 500
   (`server.js:81`) alors que le gestionnaire global le masque
   (`server.js:993`) ; les erreurs amont incluent l'URL (`pipeline/http.js:118`).

### 2.3 API amont : coûts et conditions

Fait vérifié : aucune clé ni coût dans le code, délais de courtoisie en dur.

| Hôte | Délai | Réf. | Conditions (**à confirmer**) |
|---|---|---|---|
| `data.geopf.fr` | 120 / 250 ms | `geocode.js:360`, `elevation.js:55` | service public IGN, licence ouverte, usage commercial vraisemblablement permis avec attribution |
| `brouter.de` | 1 000 ms | `routing.js:48` | « sans politique de débit publiée » (`routing.js:14-17`) ; serveur personnel |
| `router.project-osrm.org` | 700 ms | `routing.js:87` | serveur de démo, vraisemblablement interdit en production |
| `nominatim.openstreetmap.org` | 1 100 ms | `geocode.js:431` | politique OSMF : 1 req/s, pas d'usage intensif |
| `api.opentopodata.org` | 1 100 ms | `elevation.js:96` | API publique plafonnée |
| Wikipédia REST | 600 ms | `wikipedia.js:530` | contenu CC BY-SA |

**Conséquence** : une API payante ne doit **jamais** déclencher d'appel amont
synchrone pour un client — elle ne sert que du pré-calculé, sinon chaque
client consomme la capacité gratuite d'un tiers. Et ces délais sont **par
process** (`pipeline/rateLimiter.js:4`) : N process ⇒ N req/s vers Nominatim.

### 2.4 Licences

- **CC BY-SA** (`historic_routes.json`, `NOTICE.md`) : vendre l'*accès* ou le
  *service* est vraisemblablement compatible, mais la redistribution ne peut
  être interdite et l'attribution doit suivre chaque réponse (**à confirmer
  juridiquement**). On vendrait fraîcheur/disponibilité/calcul, pas
  l'exclusivité de la donnée.
- **ODbL** : les tracés routés et géocodages forment vraisemblablement une
  base dérivée d'OSM ; leur publication peut déclencher le partage à
  l'identique (**à confirmer**).
- **Écart constaté** : `NOTICE.md` (tableau « En résumé ») dit que les
  réponses géocodage/routage/altimétrie ne sont **pas** redistribuées, or
  `scripts/build-site.js:89` publie `data/stage-N.json` (`loadStageFull` :
  tracé + waypoints géocodés) sur GitHub Pages.
- **Attribution périmée** : `ATTRIBUTIONS` cite « Routage OSRM », pas BRouter
  (`backend/exports.js:449-453`, idem `NOTICE.md`), alors que BRouter est le
  routeur principal depuis le 31/08/2026 (`pipeline/routing.js:2-7`).

### 2.5 Architecture cible minimale (si la décision produit est prise)

Table `api_keys` (hash sha256, même modèle que `sessions`, `auth.js:57-59`) +
`plan` + `quota_jour` → middleware `requireApiKey` monté **uniquement** sur un
routeur `/api/v1` en lecture seule → compteur d'usage **persistant** par
clé/jour → pagination `limit/offset` + `ETag`. Variante moins chère : servir
`/api/v1` depuis les JSON statiques de `build-site.js` derrière un CDN qui
vérifie la clé — zéro charge sur Node.

## 3. Points de défaillance et couplage

### 3.1 Singletons en mémoire

| État | Réf. | Effet |
|---|---|---|
| connexion SQLite | `backend/db.js:11` | liée à l'env au premier `require` (CLAUDE.md règle 4) |
| `forcedOffline` | `pipeline/http.js:15` | **global à tous les comptes**, modifiable par tout compte (`server.js:140`), basculé aussi par `autoOffline` (`http.js:128-129`) |
| files par hôte | `pipeline/rateLimiter.js:4` | non partagées entre process |
| `running` | `server.js:75` | perdu au redémarrage |
| `importAllJob` | `server.js:758` | un seul import en masse, hypothèse mono-utilisateur assumée |
| `attempts` (login) | `auth.js:136` | contournable en multi-process |
| compteur d'usage | `pipeline/apiUsage.js:12` | remis à zéro au redémarrage |

**Défaillance constatée** : `state = 'generating'` est écrit en base
(`pipeline/generate.js:74`, `pipeline/importTrack.js:102`) mais rien ne le
remet à zéro au démarrage (grep : aucune autre écriture). Après un crash en
pleine génération, l'étape reste vraisemblablement « en cours » jusqu'à
relance manuelle (déduit du code, non reproduit).

### 3.2 Dépendance aux services publics gratuits

6 hôtes, replis Géoplateforme→Nominatim et BRouter→OSRM
(`routing.js:115-129`), cache 180 j (`pipeline/cache.js:20`). Seuls les deux
routeurs ont une URL configurable (`routing.js:27-28`) ; géocodage,
altimétrie et Wikipédia sont **codés en dur** — pas d'auto-hébergement sans
modifier le code. Le repli BRouter→OSRM n'émet qu'un `console.warn`
(`routing.js:128`) — voir PR #340.

### 3.3 Taille de `server.js` et frontières de modules

- `backend/server.js` : 1 004 lignes, 38 routes — validateurs, logique métier
  (similarité, bilan des traces ~145 lignes), validation de restauration et
  état des jobs mélangés. Le bon modèle existe : `suuntoRouter`/`stravaRouter`
  (`server.js:598-601`).
- **Dépendances inversées** : `pipeline/` importe `backend/db`
  (`pipeline/cache.js:12`, `generate.js:7`), `backend/exports.js` lit
  `frontend/profile.js` sur disque (`exports.js:469`).
- **Schéma dispersé** : `settings` créée à la demande hors de `db.js`
  (`settings.js:10`).

### 3.4 Migrations SQLite

`CREATE TABLE IF NOT EXISTS` + `ensureColumn()` (ajout de colonnes seulement,
`db.js:174-205`), **aucun numéro de version** (aucun `user_version` dans le
dépôt). Impossible de renommer/supprimer une colonne, ajouter une contrainte
ou un backfill proprement. La sauvegarde porte `version: 1` figé
(`server.js:917`). Commentaires dérivés : `router TEXT -- osrm | simulateur`
(`db.js:71`) alors que les valeurs réelles incluent `brouter` et `trace`.
Ajouter `owner_id`/`api_keys` est précisément ce que ce mécanisme gère mal.

### 3.5 Scalabilité

WAL (`db.js:183`), ~55 Ko/étape × ~2 200 étapes ≈ 120 Mo (extrapolation,
jamais mesurée) : **pas** une limite. Les vraies limites : routes non
paginées synchrones (`/api/climbs` fait un `JSON.parse` par ligne,
`server.js:618-631` ; `mapdata` charge chaque étape, `server.js:797` ;
`/similar` charge toutes les côtes, `server.js:351`), et les singletons §3.1
qui interdisent le multi-process. La sauvegarde à chaud `db.backup()`
(`backend/backup.js:36`) est correcte.

## 4. Recommandations prioritaires

| # | Recommandation | Coût | Risque | Débloque | Nature |
|---|---|---|---|---|---|
| **R1** | Fermer les routes destructrices en mode public : rôle admin (ex. `ETAPEFORGE_ADMIN_EMAILS`) pour `/api/backup/*`, `POST /api/offline`, `/api/editions/import*`, `DELETE /api/stages/:id` ; option « inscription sur invitation » | S | faible (en local `requireAuth` reste sans effet) | inviter des tiers sans risque d'effacement ; prérequis de toute API | **Dette** (sécurité) — mais le modèle de rôles est un choix à valider |
| **R2** | Versionner le schéma : `PRAGMA user_version` + migrations numérotées transactionnelles ; rapatrier `settings` dans `db.js` | S-M | moyen (tester sur une copie de base Synology réelle) | `owner_id`, `api_keys`, index, renommages | **Dette** |
| **R3** | Découper `server.js` en routeurs (`stages`, `editions`, `exports`, `traces`, `admin`) + module d'état ; jobs persistés ; remise à zéro de `generating` au démarrage | M | faible si les tests couvrent les routes | API `/v1` séparée, multi-process à terme, plus d'étapes bloquées | **Dette** |
| **R4** | Licences/attributions : BRouter dans `ATTRIBUTIONS` et `NOTICE.md`, corriger « non redistribué », attribution CC BY-SA/ODbL dans chaque export | S | nul | tout partage public de données | **Dette** (conformité) |
| **R5** | API `/api/v1` lecture seule à clés, servie uniquement depuis la base/les JSON statiques, pagination + ETag + quota persistant | M-L | moyen, surtout juridique (§2.4) et CGU amont (§2.3) | monétisation | **Décision produit** |

Hors top 5 : cache de lecture PWA (B/C, §1.2), S-M, **décision produit**.

## 5. Décision produit vs dette technique

| Sujet | Nature | Commentaire |
|---|---|---|
| Lecture hors-ligne (PWA B/C) vs statu quo | Produit | le code actuel est cohérent avec son choix documenté |
| IndexedDB / SQLite WASM | Produit, déconseillé | aucun besoin actuel non couvert par B/C |
| Monétiser, et quoi (accès, fraîcheur, calcul) | Produit | `BRIEF.md` exclut les clés payantes **en amont**, pas en aval |
| Isolation par utilisateur | Produit | nécessaire seulement si les clients API *écrivent* |
| Auto-héberger BRouter/Nominatim/altimétrie | Produit (coût d'exploitation) | prérequis vraisemblable d'une API à fort trafic |
| Rôles / routes destructrices (R1) | Dette | faille ouverte dès `ETAPEFORGE_PUBLIC=1` |
| Migrations (R2), découpage (R3), attributions (R4) | Dette | indépendantes de toute décision produit |
| URLs amont en dur, `forcedOffline` global | Dette | à traiter avec R3 |
| `docs/PRESENTATION.md:29` dit encore « routage → OSRM » | Dette (docs) | avec R4 |

## 6. Non vérifié (hypothèses)

- CGU et plafonds réels de Nominatim, OSRM démo, opentopodata, brouter.de,
  Géoplateforme, tuiles OSM/IGN.
- Portée exacte CC BY-SA / ODbL pour des données servies par une API payante
  (avis juridique nécessaire).
- Comportement du frontend face à une étape bloquée en `generating` après
  redémarrage (déduit du code, non reproduit).
- Taille réelle de la base au catalogue complet (extrapolée, jamais mesurée).
