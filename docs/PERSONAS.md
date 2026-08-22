# Personas — ÉtapeForge

Six personnes suivies pas à pas dans l'application, et l'endroit exact où
chacune s'arrête aujourd'hui. Inspiré du même exercice chez
[Rando-generator](https://github.com/Opaland/Rando-generator)
(`docs/PERSONAS.md`), dont l'usage a directement fait remonter des bugs
qu'une relecture de code n'aurait pas trouvés.

État reflété : après PR #24 (correctifs P0/P1 de l'audit UI/UX). Les P2
restants ([#20](https://github.com/Opaland/Tdf-generator/issues/20)-[#23](https://github.com/Opaland/Tdf-generator/issues/23))
sont notés explicitement là où ils touchent le parcours d'une persona — ce
document n'a pas vocation à rester vrai éternellement, à revérifier après
tout gros chantier UI.

## Fatiha — cyclosportive amatrice pressée, sur mobile

Prépare sa sortie du week-end sur son téléphone, entre deux tâches. Ouvre
l'éditeur, tape « Pau → Hautacam », ajoute le col du Soulor en route, clique
Générer.

**Ça marche** : la nav mobile (menu ☰ depuis PR #24) ne déborde plus, le
formulaire est utilisable sur 375 px, le résultat s'affiche avec profil et
côtes catégorisées. Import direct depuis un lien Suunto/Sports-Tracker si
elle a un lien plutôt qu'un fichier GPX (PR #24, section « Mes traces »).

**Ça bloque encore** : sur l'écran Archives, si elle voulait comparer avec
une étape historique, un paragraphe méthodologique dense précède le champ
d'import ([#22](https://github.com/Opaland/Tdf-generator/issues/22), pas
encore traité) — elle scrolle plus qu'elle ne devrait pour une simple
consultation répétée.

## Camille — passionnée d'histoire du Tour

Veut voir le Cercle de la mort de 1910 sur une vraie carte. Va dans Archives,
tape « 1910 », importe l'année.

**Ça marche** : 1903, 1905, 1910, 1911, 1952 et 2020-2026 ont des points de
passage d'époque sourcés (`pipeline/data/historic_routes.json`) — le tracé
se reconstitue avec l'écart affiché entre distance officielle et
reconstitution actuelle, jamais présenté comme la vérité absolue.

**Ça bloque encore** : une année hors de cette liste (1913, la fourche
cassée d'Eugène Christophe ; 1922, première apparition de l'Izoard) n'a pas
de points de passage curés — l'import récupère la liste des étapes depuis
Wikipédia mais la reconstruction reste approximative sans repères d'époque
vérifiés. Backlog section B ([#10](https://github.com/Opaland/Tdf-generator/issues/10)),
pas encore traité — Camille ne le devine pas avant d'essayer.

## Marc — organise une cyclosportive privée entre amis

Veut un parcours réaliste, avec un vrai profil et des cols vérifiés, à
partager par lien.

**Ça marche** : crée un tour personnalisé (« + nouveau tour… », encart
inline depuis PR #24 — plus de `prompt()` natif), ajoute ses étapes, exporte
la fiche en GPX pour son compteur, ou le mini-site HTML autonome pour ses
amis (`/api/editions/:id/site`).

**Ça bloque encore** : pas de roadbook imprimable (villes, km, cols,
ravitaillements, horaires estimés dans un document dédié) — l'export HTML
existe mais c'est une page web, pas une feuille de route à imprimer. Idée
notée en [#14](https://github.com/Opaland/Tdf-generator/issues/14), pas
construite.

## Yannick — auto-héberge sur un Synology NAS, usage familial

Suit le README section NAS/Docker, veut que ça tourne en LAN, sans compte,
sans rien qui sorte de chez lui au-delà des appels de géocodage/routage déjà
documentés.

**Ça marche** : le mode local par défaut n'a jamais eu besoin de compte,
même avec `NODE_ENV=production` dans le conteneur Docker — le mur d'accès ne
s'active que sur `ETAPEFORGE_PUBLIC=1` explicite, jamais déduit de
`NODE_ENV` (bug potentiel auto-détecté et corrigé avant d'être poussé,
PR #12). `ETAPEFORGE_OFFLINE=1` s'il veut couper tout appel réseau externe.

**Ça bloque encore** : pas de sauvegarde automatique de la base SQLite —
s'il perd le volume Docker, il perd ses étapes. Backlog section E, pas
construit.

## Sophie — administre un déploiement public sur VPS

A suivi `docs/DEPLOY-PUBLIC.md`, activé `ETAPEFORGE_PUBLIC=1` avec un reverse
proxy Caddy, ouvert l'inscription libre à son cercle de coureurs.

**Ça marche** : hachage `scrypt`, sessions en cookie `httpOnly`, rate
limiting login/register, en-têtes de sécurité de base — tout documenté,
zéro nouvelle dépendance.

**Ça bloque encore** : le modèle est **données partagées entre tous les
comptes connectés** (pas d'isolation par utilisateur) — Sophie doit le
comprendre et ne donner l'accès qu'à des gens de confiance malgré
l'inscription libre. C'est un choix assumé et documenté (`DEPLOY-PUBLIC.md`),
pas un oubli, mais une personne qui saute la doc peut être surprise.

## Théo — a une trace mais pas de fichier

Sa montre Suunto lui donne un lien `api.sports-tracker.com/...` plutôt qu'un
fichier à télécharger quand il choisit l'export GPX.

**Ça marche** : champ « Import par lien » sur l'écran Mes traces (PR #24) —
colle le lien, le serveur va chercher le contenu à sa place (le navigateur ne
peut pas, `sports-tracker.com` n'autorisant pas les requêtes cross-origin).
Liste blanche stricte sur le domaine avant tout appel réseau sortant, pour
qu'un lien collé par erreur ne serve jamais de point d'entrée SSRF.

**Ça bloque encore** : rien d'identifié pour ce parcours précis à l'heure où
ce document est écrit — à revérifier à la prochaine session, comme les
autres personas.
