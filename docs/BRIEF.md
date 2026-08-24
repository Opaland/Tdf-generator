# Brief — ÉtapeForge

Quel problème, pour qui, contre qui — et ce qu'on ne fera pas.

## Le problème

Reconstituer une étape du Tour de France (historique ou imaginée) sur le
réseau routier **actuel**, avec un tracé, une altimétrie et des côtes
catégorisées fiables, demande aujourd'hui soit de le faire à la main
(éditeur de parcours généraliste, un waypoint à la fois, sans détection de
côte ni catégorisation), soit de se contenter d'une carte tracée sur
Wikipédia sans profil ni distance vérifiable.

Personne ne fait la reconstruction **automatiquement** : donner une liste de
villes et de cols d'une année, obtenir un tracé routé, une altimétrie
échantillonnée et des côtes catégorisées HC/1/2/3/4, avec l'écart affiché
entre distance officielle d'époque et distance reconstituée sur le réseau
d'aujourd'hui.

## Pour qui

- Le passionné d'histoire du Tour qui veut *voir* le Cercle de la mort de
  1910 ou le premier Galibier de 1911 sur une vraie carte, avec un vrai
  profil — pas juste lire un nom de col sur une page Wikipédia.
- Le cyclosportif qui prépare une sortie et veut savoir, avant de partir, où
  sont exactement les cols, leur pente réelle km par km, et si le tracé
  choisi tient la route (au sens propre).
- Qui auto-héberge : le kit Docker/Synology vise quelqu'un qui veut garder
  ses données chez lui, sans compte ni service tiers, et qui sait ce que
  « exposer un port LAN uniquement » veut dire.

## Contre qui, et pourquoi ce créneau est libre

Étude complète : [issue #14](https://github.com/Opaland/Tdf-generator/issues/14).
Résumé, avec la mise en garde qu'elle porte elle-même : recherche web
uniquement (WebFetch indisponible dans le sandbox où elle a été menée), à
recouper avant d'agir dessus en cas de doute.

- **la-flamme-rouge.eu** est l'app la plus proche en apparence (parcours,
  profils, cols) — mais c'est un **éditeur manuel**. Roadbook, marqueurs de
  sprint/bonification et overlay météo y existent déjà ; ÉtapeForge ne les a
  pas. La vraie différence n'est pas une liste de fonctionnalités, c'est le
  mode de production : eux, on trace à la souris ; ici, on donne une liste de
  lieux et le pipeline géocode, route, échantillonne l'altimétrie, détecte et
  catégorise les côtes tout seul. *(Le README affiche encore l'ancienne
  formulation « ce que la-flamme-rouge.eu ne fait pas », identifiée comme
  datée par #14 — à reformuler autour de ce vrai différenciateur plutôt que
  d'une liste de features qui a changé sous nos pieds.)*
- **climbfinder, cols-cyclisme.com, myCols** sont des bases de données de
  cols (des dizaines de milliers, avec photos et avis) — pas de génération
  d'étape. Le catalogue `/cols.html` d'ÉtapeForge n'essaie pas de rivaliser :
  il ne liste que les côtes détectées dans des étapes déjà générées
  localement, jamais un référentiel mondial. **Choix de scope assumé, pas un
  manque** — à ne pas « corriger » un jour en aspirant climbfinder.
- **Strava, Komoot, RideWithGPS** sont généralistes, excellents sur
  l'enregistrement et la navigation, sans angle historique Tour de France.
  Aucune reconstruction automatisée trouvée nulle part sur la période
  1903→aujourd'hui.
- **VeloViewer** a inspiré l'habillage visuel (profils denses,
  catégorisation façon pastille, comparateur) — cité dans le README depuis
  le début, pas un concurrent direct (c'est un outil d'analyse Strava, pas un
  générateur d'étapes).

## Ce qu'on ne fera pas

Écrit ici pour ne pas y revenir à chaque session — inspiré du même exercice
chez [Rando-generator](https://github.com/Opaland/Rando-generator), le dépôt
cousin qui a le sien dans `docs/FEUILLE_DE_ROUTE.md`.

- **Pas de base de données de cols généraliste.** `/cols.html` reste un
  sous-produit des étapes générées, jamais un référentiel autonome
  (voir « climbfinder » ci-dessus).
- **Pas de compte obligatoire en usage local.** Le mur d'accès email/mot de
  passe (`ETAPEFORGE_PUBLIC=1`, voir `docs/DEPLOY-PUBLIC.md`) reste optionnel
  et pensé pour l'exposition publique volontaire, jamais activé par défaut —
  y compris en Docker, où `NODE_ENV=production` ne doit **jamais** suffire à
  l'activer (bug auto-détecté et corrigé avant même d'être poussé, PR #12).
- **Pas de navigation vocale ni de guidage temps réel.** ÉtapeForge
  reconstruit et documente des étapes, il n'accompagne pas une sortie en
  cours (ce rôle-là, c'est celui d'un GPS de vélo ou d'une app comme
  Komoot/Strava en navigation).
- **Pas de dépendance cloud propriétaire.** Toutes les données externes
  (géocodage, routage, altimétrie, historique) passent par des sources
  ouvertes (IGN/Géoplateforme, OSM/OSRM, opentopodata, Wikipédia) mises en
  cache localement — jamais un service tiers à clé API payante en
  fonctionnement normal.
- **Pas de framework frontend.** JS vanilla + Leaflet, cohérent avec
  l'esprit « aucune dépendance inutile » du projet (5 dépendances directes
  en tout — chacune évaluée avant adoption, voir par exemple la revue de
  `node-html-parser` dans l'historique git de ce fichier). Voir
  `docs/DESIGN_SYSTEM.md` pour ce que ce choix implique.

## Ce qui reste ouvert

Le backlog détaillé (données, algorithmes, frontend, infra, tests) vit dans
[issue #10](https://github.com/Opaland/Tdf-generator/issues/10) — mis à jour
au fil des sessions plutôt que dupliqué ici. Les dix items P2 de l'audit
UI/UX ([issues #20 à #23](https://github.com/Opaland/Tdf-generator/issues/20))
restent ouverts après le traitement des P0/P1 (PR #24).
