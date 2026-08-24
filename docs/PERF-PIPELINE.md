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

## Résultats (mesurés le 24/08/2026, 5 runs/scénario, poste de développement — voir « Reproduire » ci-dessous pour rejouer sur votre matériel)

| Scénario | Total (moyenne) | Phase la plus coûteuse |
|---|---|---|
| Plat court, 2 waypoints (Paris → Chartres) | 8.8 ms | « terminé » (37 %) |
| Montagne, 5 waypoints dont 2 cols (Pau → Hautacam) | 7.4 ms | « terminé » (51 %) |
| Longue étape, 8 waypoints (Paris → Toulouse) | 117.6 ms | « terminé » (60 %) |
| Historique réel — 1903, étape 1 Paris → Lyon (467 km officiels) | 20.9 ms | « terminé » (60 %) |

Détail de la longue étape (le scénario le plus lourd testé) :

```
    géocodage      0.2 ms  ( 0%)
    routage        1.3 ms  ( 1%)
    altimétrie     4.1 ms  ( 3%)
    côtes         33.2 ms  (28%)
    analyse        8.4 ms  ( 7%)
    terminé       70.4 ms  (60%)
```

## Ce que ça dit

- **Pas de point chaud qui justifie une optimisation aujourd'hui.** Même le
  scénario le plus lourd testé (8 waypoints, ~600 km simulés) reste sous
  120 ms tout compris, en mode hors-ligne. À cette échelle, rien ne justifie
  de sacrifier de la lisibilité pour de la vitesse.
- **« terminé » (audits + persistance SQLite + rechargement de la fiche)
  domine systématiquement**, et sa part grandit avec la longueur du parcours
  (37 % sur un trajet court, 60 % sur les plus longs) — cohérent avec
  `pipeline/generate.js` : cette phase insère une ligne par échantillon
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
npm run benchmark            # 5 runs/scénario par défaut
npm run benchmark -- --runs 20   # plus de runs pour lisser le bruit de mesure
```

Le script isole ses données dans un dossier temporaire dédié (même logique
d'isolation par process que `scripts/monkey.js`, voir CLAUDE.md règle 4) et
le nettoie en sortie. Aucune donnée existante n'est touchée.
