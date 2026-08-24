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
(Géoplateforme, OSRM, opentopodata, Wikipédia). En usage réel (`npm run
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

## Reproduire

```bash
npm run benchmark            # 10 runs/scénario par défaut, après échauffement
npm run benchmark -- --runs 20   # plus de runs pour lisser encore le bruit de mesure
```

Le script isole ses données dans un dossier temporaire dédié (même logique
d'isolation par process que `scripts/monkey.js`, voir CLAUDE.md règle 4), lance
un run d'échauffement jeté avant de commencer à chronométrer (voir la
correction ci-dessus), et nettoie son dossier temporaire en sortie. Aucune
donnée existante n'est touchée.
