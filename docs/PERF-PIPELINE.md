# Performance de `pipeline/generate.js` — mesurée, pas supposée

CLAUDE.md règle 9 : toute affirmation de performance doit être vérifiée par
une commande, sinon elle se reformule en hypothèse. Aucune mesure n'existait
avant ce document — ni dans le code, ni dans un ticket, ni dans une doc.
`scripts/benchmark.js` (`npm run benchmark`) chronomètre `generateStage()`
phase par phase (géocodage, routage, altimétrie, côtes, analyse km par km,
puis « terminé » = audits qualité + persistance SQLite + rechargement de la
fiche complète) sur plusieurs scénarios.

## Ce que ce benchmark mesure — et ce qu'il ne mesure pas

**Mode hors-ligne forcé** (`ETAPEFORGE_OFFLINE`, simulateur déterministe) :
reproductible dans un bac à sable sans réseau, mais ça mesure uniquement le
**calcul et l'écriture SQLite** du pipeline — pas la latence des vraies APIs
(Géoplateforme, BRouter/OSRM, opentopodata, Wikipédia). En usage réel (`npm run
demo:online` ou un serveur en production), le temps perçu par
l'utilisateur·rice est dominé par ces appels réseau et leur rate-limiting
(voir `pipeline/rateLimiter.js`), pas par le pipeline lui-même — ce document
ne dit rien là-dessus, volontairement. Si une mesure de la latence réseau
réelle est utile un jour, `GET /api/diagnostic` sonde déjà chaque fournisseur
et affiche sa latence (voir `docs/CONTINUITE-APIS.md`).

## Résultats (mesurés le 24/08/2026, 20 runs/scénario après échauffement, poste de développement — voir « Reproduire » ci-dessous pour rejouer sur votre matériel)

**Correction (même jour) :** la première version de ce document citait des
chiffres produits sans run d'échauffement — le tout premier `generateStage()`
du process absorbait un coût de démarrage (JIT V8, premiers `require()`,
premières requêtes SQL préparées) qui gonflait artificiellement le scénario
mesuré en premier (jusqu'à ×3-4 sur sa phase « côtes »), sans rapport avec sa
complexité réelle. Trouvé par relecture adverse, en relançant le script
plusieurs fois et en comparant le premier run à froid aux suivants. Corrigé
par un run d'échauffement jeté avant la boucle de mesure
(`scripts/benchmark.js`) ; les chiffres ci-dessous sont les résultats
corrigés, stables sur plusieurs relances indépendantes (variation < 15 %
d'une relance à l'autre à `--runs 20`).

| Scénario | Total (moyenne) | Phase la plus coûteuse |
|---|---|---|
| Plat court, 2 waypoints (Paris → Chartres) | 4.5 ms | « terminé » (58 %) |
| Montagne, 5 waypoints dont 2 cols (Pau → Hautacam) | 6.1 ms | « terminé » (57 %) |
| Longue étape, 8 waypoints (Paris → Toulouse) | 97.8 ms | « terminé » (69 %) |
| Historique réel — 1903, étape 1 Paris → Lyon (467 km officiels) | 19.6 ms | « terminé » (71 %) |

Détail de la longue étape (le scénario le plus lourd testé) :

```
    géocodage      0.2 ms  ( 0%)
    routage        0.9 ms  ( 1%)
    altimétrie     3.4 ms  ( 3%)
    côtes         21.0 ms  (21%)
    analyse        4.8 ms  ( 5%)
    terminé       67.5 ms  (69%)
```

## Ce que ça dit

- **Pas de point chaud qui justifie une optimisation aujourd'hui.** Même le
  scénario le plus lourd testé (8 waypoints, ~600 km simulés) reste sous
  120 ms tout compris, en mode hors-ligne. À cette échelle, rien ne justifie
  de sacrifier de la lisibilité pour de la vitesse.
- **« terminé » (audits + persistance SQLite + rechargement de la fiche)
  domine systématiquement**, et sa part grandit avec la longueur du parcours
  (57-58 % sur les deux scénarios courts, 69-71 % sur les deux plus longs) —
  cohérent avec `pipeline/generate.js` : cette phase insère une ligne par échantillon
  d'altimétrie (`elevation_samples`), dont le nombre croît avec la distance,
  puis relit tout via `loadStageFull()` (plusieurs `SELECT` + calculs dérivés
  comme l'indice de pénibilité). C'est le candidat naturel si un jour un
  scénario nettement plus long (une étape de 300+ km réelle, ou une
  génération en lot de toute une édition) montre un ralentissement senti —
  mais ce n'est pas mesuré comme un problème aujourd'hui, seulement identifié
  comme la phase qui absorbe la croissance.
- **Géocodage/routage/altimétrie sont négligeables en mode hors-ligne**
  (< 5 ms cumulés dans tous les scénarios) — logique, ce sont des calculs
  synthétiques déterministes sans I/O réseau dans ce mode. Ce chiffre ne dit
  rien sur leur coût réel en ligne, où c'est l'inverse : ces trois étapes
  sont les seules à faire des appels réseau, donc les seules dominées par la
  latence en production.

## En réseau réel : une génération profilée requête par requête (17/10/2026)

Le benchmark ci-dessus ne dit rien du réseau. Pour combler ce trou (story
18.1, Epic 18), **une** génération réelle a été chronométrée à froid, sur
une base neuve sans cache : Tour 2002, étape 18 (Cluses → Bourg-en-Bresse,
15 points de passage, 14 legs BRouter, 171,6 km). Chaque requête HTTP a été
horodatée par une instrumentation temporaire de `pipeline/http.js`, posée
dans une copie jetable du dépôt et jamais commitée (voir « Reproduire »).
C'est **un seul run sur une seule étape**, et la latence des API publiques
varie d'un moment à l'autre. L'ordre de grandeur est fiable, pas les
dixièmes de seconde.

| Phase | Durée | Requêtes | Latence réseau cumulée | Ce qui domine |
|---|---|---|---|---|
| Géocodage | 7,1 s | 16 (Géoplateforme : 11 recherches, 5 altitudes de cols) | ~3,7 s | requêtes séquentielles ; chaque point est biaisé par la proximité du précédent |
| Routage | 15,7 s | 14 (brouter.de) | 2,6 s | **délai de courtoisie de 1 s par leg** (`minDelayMs: 1000`, `pipeline/routing.js`) |
| Altimétrie | 6,4 s | 5 lots (Géoplateforme RGE ALTI) | 5,4 s | latence réelle de l'API (0,7 à 1,5 s par lot) |
| Nommage des côtes et descentes | 6,5 s | 10 Géoplateforme (reverse) + 6 Nominatim | 1,6 s | **délai Nominatim de 1,1 s par requête** (`minDelayMs: 1100`) |
| **Total à froid** | **35,8 s** | 51 | ~13 s | |
| Même étape, à chaud (tout en cache SQLite) | 0,14 s | 0 | 0 | |

À froid, environ **20 s sur 36** sont de l'attente volontaire : les délais
de courtoisie envers brouter.de (≈ 14 s) et Nominatim (≈ 6 s). La latence
réseau effective ne pèse qu'environ 13 s. Le calcul local (détection des
côtes, analyse km par km, audits, SQLite) reste de l'ordre de 0,1 s, comme
le mesure le benchmark hors-ligne.

Les 6 appels Nominatim sont des **replis** : pour 6 des 10 points à nommer,
le reverse Géoplateforme n'a renvoyé aucune adresse. On l'a vérifié en
comptant les entrées `null` dans `geocode_cache` après le run : 6 valeurs
`null`, et 6 noms fournis par Nominatim (Arjon, La Palud, Merloz,
Les Mouilles, Gruent, Sénissiat). Hypothèse non vérifiée : ces points
(sommets, forêts) n'ont pas d'adresse dans le rayon par défaut du reverse
Géoplateforme.

### Ce qui pourrait se recouvrir (story 18.2) — leviers, pas décisions

Le rate-limiter (`pipeline/rateLimiter.js`) sérialise les requêtes **par
hôte**. Paralléliser plusieurs requêtes vers le même service ne gagnerait
donc rien sans réduire les délais de courtoisie. Réduire ces délais engage
la relation avec des services publics gratuits, et ce n'est pas une
décision technique. En revanche, des hôtes différents pourraient travailler
en même temps sans toucher à ces délais :

1. **Géocodage → routage en flux.** Le leg *i* ne dépend que des points *i*
   et *i+1*. Il pourrait partir dès que ces deux points sont géocodés, sans
   attendre la fin du géocodage. L'ordre du géocodage, donc le biais de
   proximité, resterait intact. Gain plafonné par la phase la plus courte,
   soit environ 6 à 7 s ici.
2. **Routage → altimétrie en flux.** On pourrait échantillonner l'altitude
   d'un leg pendant que les suivants se routent. Gain possible de quelques
   secondes, mais l'échantillonnage porte aujourd'hui sur le tracé complet
   (pas régulier sur toute la distance). Il faudrait le refaire leg par leg,
   ce qui change le découpage du profil : à ne pas faire sans tests
   d'équivalence.
3. **Moins de replis Nominatim.** Chaque repli coûte environ 1,1 s. Demander
   au reverse Géoplateforme un résultat même lointain, ou l'index POI,
   réduirait ces replis, mais changerait les noms affichés des côtes. C'est
   un choix de produit, pas une optimisation neutre.

Aucun de ces leviers ne touche une génération à chaud (0,14 s). Ils ne
servent que la première génération d'une étape ou d'une édition. À titre
d'ordre de grandeur, une édition de 21 étapes comparables à celle-ci prend
environ 12 minutes à froid. C'est une extrapolation linéaire, non mesurée.

## Reproduire

Profil réseau réel (ci-dessus) : dans une copie jetable du dépôt (`git
archive origin/main | tar -x -C <dossier>`), ajouter juste avant le `fetch`
de `httpJson()` (`pipeline/http.js`) une ligne qui journalise l'horodatage,
la durée, l'hôte et le statut de chaque requête dans un fichier. Lancer
ensuite `node pipeline/cli.js --import 2002` puis `node pipeline/cli.js
--stage <id>` avec `ETAPEFORGE_DATA_DIR` pointé vers un dossier vide, pour
obtenir un run à froid. Ne jamais faire cette instrumentation dans le dépôt
de travail.

Benchmark hors-ligne :

```bash
npm run benchmark            # 10 runs/scénario par défaut, après échauffement
npm run benchmark -- --runs 20   # plus de runs pour lisser encore le bruit de mesure
```

Le script isole ses données dans un dossier temporaire dédié (même logique
d'isolation par process que `scripts/monkey.js`, voir CLAUDE.md règle 4), lance
un run d'échauffement jeté avant de commencer à chronométrer (voir la
correction ci-dessus), et nettoie son dossier temporaire en sortie. Aucune
donnée existante n'est touchée.

## API à l'échelle du catalogue complet (Epic 17, 17/10/2026)

`node scripts/scale-bench.js` construit une base synthétique de **2 200 étapes**
(110 éditions × 20, simulateur hors-ligne, ~48 s), puis chronomètre les routes
qui lisent une table entière (5 requêtes par route, médiane). Mesures sur le
bac à sable cloud :

| Route | Avant (commit parent : `git stash` du correctif pour rejouer) | Après (liste allégée) |
|---|---|---|
| `GET /api/stages` | 251 ms, **5,2 Mo** | 90 ms, 680 Ko |
| `GET /api/climbs` | 26 ms, 347 Ko | inchangé |
| `GET /api/editions` | 14 ms, 21 Ko | inchangé |
| `GET /api/editions/:id/mapdata` | 170 ms, 724 Ko (une édition de 20 étapes) | inchangé |
| `GET /api/stages/:id` | 15 ms, 115 Ko | inchangé |
| `GET /api/stages/:id/similar` | 17 ms | inchangé |

- **Seul point chaud réel : la liste des étapes**, dont 87 % du poids était le
  détail des audits qualité (~2 Ko par étape, (5,2 Mo − 680 Ko) / 2 200), alors que les écrans de liste
  n'en lisent que `checks.ok`. Corrigé en renvoyant un résumé `{ ok, offline }`
  (le détail reste dans `GET /api/stages/:id`) — **pas de pagination** : à
  90 ms et 680 Ko pour le catalogue complet, elle ajouterait du code sans
  besoin mesuré.
- **Taille de base : 243 Mo, soit ~113 Ko par étape** — deux fois l'estimation
  de ~55 Ko écrite dans `backend/server.js` (mesurée sur 7 étapes réelles plus
  courtes). Les étapes synthétiques font ~150-200 km ; la taille dépend
  surtout de `elevation_samples`, donc de la longueur.
- Limite : étapes synthétiques (simulateur), pas les vraies étapes du
  catalogue ; peu de côtes détectées, d'où un `/api/climbs` sans doute sous-estimé.
