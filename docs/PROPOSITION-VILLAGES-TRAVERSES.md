# Villages traversés dans le roadbook : coût mesuré et trois approches

**Ce document propose, il ne tranche pas.** C'est une décision de produit,
laissée à l'utilisateur (Epic 12, `docs/SPRINT-STATUS.md`). Il chiffre le
coût réel de la story 12.1 et propose trois approches (story 12.2).

## Le besoin, et ce qu'il ne couvre pas

La persona Marc (`docs/PERSONAS.md`), qui organise une cyclosportive entre amis, bute sur un manque : le roadbook
imprimable n'a pas la liste des villages traversés. Ce document ne parle que
de ces **villages** : quelles communes le tracé reconstitué traverse.

Les **ravitaillements**, eux, sont une donnée historique (où la course
ravitaillait réellement). Aucune source structurée n'a été trouvée, et
l'inventer reste exclu (CLAUDE.md règle 12). Ce point reste bloqué, quelle
que soit l'option retenue ici.

## Mesures (17/10/2026)

Étape test : Tour 2002, étape 18 (Cluses → Bourg-en-Bresse), sur son tracé
reconstitué de 171,6 km. Un point est échantillonné tous les *N* km le long
du tracé, puis chaque point est interrogé en séquence, avec 120 ms entre deux
requêtes (même courtoisie que les autres appels Géoplateforme du pipeline).

| Service | Pas | Requêtes | Durée | Réponses vides | Communes distinctes successives |
|---|---|---|---|---|---|
| Géoplateforme `geocodage/reverse` (déjà utilisé par le pipeline) | 1 km | 172 | 45,7 s | **68 (40 %)** | 36 |
| geo.api.gouv.fr `communes?lat=&lon=` (point dans polygone) | 0,5 km | 344 | 91,6 s | 0 | 48 |
| geo.api.gouv.fr | 1 km | 172 | 47,6 s | 0 | 44 |
| geo.api.gouv.fr | 3 km | 58 | 15,2 s | 0 | 39 |

Ce que ces chiffres disent :

- **Le reverse Géoplateforme ne convient pas.** Il cherche l'adresse la plus
  proche, et 40 % des points de route n'en ont aucune dans son rayon de
  recherche. Il a manqué 8 communes sur 44 au pas de 1 km.
- **geo.api.gouv.fr répond toujours** dans cet échantillon. Il renvoie la
  commune qui contient le point, pas la plus proche : c'est la bonne
  question pour savoir où passe la route.
- **Le pas compte.** Au pas de 1 km, on trouve 4 communes de moins qu'au pas
  de 0,5 km (44 contre 48, environ 8 %). Au pas de 3 km, on en trouve 9 de
  moins. Même à 0,5 km, rien ne garantit
  l'exhaustivité : une traversée de commune plus courte que le pas peut
  tomber entre deux points.
- **Commune traversée ne veut pas dire village traversé.** Le tracé peut
  couper le territoire d'une commune sans passer par son bourg. Un roadbook
  qui dirait « traverse Leyssard » serait exact au sens administratif, mais
  peut-être pas au sens du coureur.
- **Ordre de grandeur à l'échelle**, par extrapolation linéaire non mesurée :
  environ 47 s de plus par étape à froid au pas de 1 km. La génération à
  froid passerait ainsi d'environ 36 s à environ 83 s (voir
  `docs/PERF-PIPELINE.md`). Sur une base de 2 200 étapes (le scénario de
  `scripts/scale-bench.js`), cela représente environ 380 000 requêtes, soit
  environ 29 h en séquence.
- **France seulement.** geo.api.gouv.fr ne couvre que les communes
  françaises. Pour une étape à l'étranger, il faudrait passer par Nominatim
  (1,1 s par requête par courtoisie, soit environ 3 min par étape au pas de
  1 km), ou ne rien afficher.
- geo.api.gouv.fr ne publie pas de limite de débit : sa page de CGU,
  consultée le 17/10/2026, n'en mentionne aucune. Elle prévoit seulement un
  refus d'accès « en cas d'usage abusif ». Une courtoisie équivalente à celle
  de la Géoplateforme reste donc de mise.

## Trois approches

### A. Calcul à la génération, pour chaque étape

Ajouter une phase « villages » à `pipeline/generate.js`, qui interroge
geo.api.gouv.fr au pas de 1 km et stocke la liste des communes avec leur km.

- Pour : toujours disponible, y compris dans le mini-site et la démo Pages.
- Contre : la génération à froid fait plus que doubler (+47 s par étape),
  même pour une étape dont personne n'ouvrira le roadbook. On ajoute aussi
  un **nouveau fournisseur externe**, et un hôte de plus à documenter dans
  `docs/CONTINUITE-APIS.md` et dans l'inventaire réseau du kit NAS (persona
  Yannick).

### B. Calcul à la demande, depuis le roadbook (recommandée)

Ajouter un bouton « Calculer les villages traversés » sur la fiche ou le
roadbook. Il appelle une route serveur qui fait le même calcul que A, puis
le met en cache dans la base.

- Pour : on ne paie que pour les étapes réellement consultées, la génération
  ne change pas, et l'action est explicite, ce qui suit le même esprit
  « rien qui sort sans raison » que la persona NAS.
- Contre : il faut attendre environ 45 s au premier clic, ce qui demande un
  indicateur de progression. La démo Pages statique n'en profite pas, sauf
  à précalculer ses quelques étapes au moment du build.

### C. Jeu de données des communes embarqué, sans réseau

Embarquer les contours simplifiés des communes françaises (par exemple ADMIN
EXPRESS COG de l'IGN, sous Licence Ouverte) et faire le test point dans
polygone en local.

- Pour : aucun appel réseau, fonctionne hors ligne et dans la démo,
  instantané.
- Contre : le dépôt et l'image Docker grossissent nettement (poids exact non
  mesuré, à chiffrer avant toute décision). Il faut aussi mettre le jeu à
  jour à chaque fusion de communes, ce qui touche directement les homonymes
  de communes fusionnées déjà rencontrés en curation (Val-d'Arc,
  Les Deux Alpes). Enfin, cela va contre l'esprit « aucune dépendance
  inutile » de `docs/BRIEF.md`.

## Décision (17/10/2026)

**B retenue** (décision déléguée par l'utilisateur). Implémentée :
`pipeline/communes.js`, `POST /api/stages/:id/communes`, colonne
`tracks.communes` (migration 6, remise à NULL à chaque régénération),
section « Communes traversées » sur la fiche et dans le roadbook. Testée
contre une réponse simulée au format relevé en réel le 17/10/2026 ; la
vérification de bout en bout contre le vrai service reste à faire (hôte
injoignable depuis le bac à sable au moment de l'implémentation).

## Recommandation

**B**, au pas de 1 km, limitée à la France. Pour une étape à l'étranger, on
écrirait explicitement « non disponible hors de France » plutôt que de faire
un repli Nominatim lent. Le libellé affiché serait « communes traversées »,
pas « villages », pour ne pas promettre plus que la donnée.

Le choix revient à l'utilisateur : A, B, C ou ne rien faire. Rien n'est
implémenté tant qu'il n'a pas tranché.

## Reproduire

Il suffit d'échantillonner le tracé d'une étape générée (`loadStageFull(id).track.geojson`)
tous les *N* km, puis d'appeler pour chaque point
`https://geo.api.gouv.fr/communes?lat=<lat>&lon=<lon>&fields=nom`
(ou `https://data.geopf.fr/geocodage/reverse?lat=<lat>&lon=<lon>&limit=1`)
en séquence, avec 120 ms entre deux appels. On compte ensuite les réponses
vides et les changements de commune successifs.
