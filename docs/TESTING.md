# Stratégie de tests — ÉtapeForge

Ce que chaque type de test attrape, quand le lancer, et s'il bloque. Rien
de nouveau n'est inventé ici : ce document range ce qui tourne déjà dans le
dépôt (`package.json`, `.github/workflows/`, `.claude/hooks/`, skills
`/porte` et agents `.claude/agents/`), avec pour chacun un exemple réel de ce
qu'il a déjà trouvé. Les trous sont listés en fin de document.

## Vue d'ensemble

| Couche | Commande | Quand | Bloquant ? | Réseau |
|---|---|---|---|---|
| Unitaires / intégration | `npm test` (`node --test`, 68 fichiers dans `test/`) | avant chaque commit (hook `porte-avant-commit.sh`), en CI à chaque push/PR (Node 20 et 22) | **oui** | non (mocks HTTP locaux) |
| Lint | `npm run lint` (ESLint `eslint:recommended`) | hook avant commit, CI | **oui** | non |
| Audit dépendances | `npm audit --audit-level=high` | CI | **oui** | oui (registre npm) |
| Démo hors-ligne auto-vérifiée | `npm run demo` (`scripts/demo.js`, simulateur) | CI à chaque push/PR, `/porte` avant PR | **oui** | non |
| Image Docker + smoke test | `docker build` puis conteneur démarré | CI | **oui** | non |
| Vérification visuelle | Playwright, captures 1440px + 375px avant/après | `/porte`, seulement si le frontend change | oui pour la PR concernée (manuel) | non |
| Démo réseau réel | `npm run demo:online` | CI planifiée, tous les jours 5h UTC (`demo-online.yml`) | non (alerte) | **oui** |
| Démo spéculative 2027 | `npm run demo:2027` | CI planifiée, le 3 de chaque mois (`demo-2027.yml`) | non | **oui** |
| Parité réel / simulateur | `npm run parity` | à la main, quand on touche au simulateur | non | **oui** |
| Benchmark pipeline | `npm run benchmark` | à la main, avant/après un changement de performance | non | selon config |
| Monkey testing | `npm run monkey` (graines rejouables, `MONKEY_SEEDS=…`) | à la main, pour rejouer une trouvaille | non (exploratoire) | non |
| Mutation | `npm run mutation` (Stryker, 4 fichiers ciblés) | à la main, pour vérifier qu'un test discrimine | non (exploratoire) | non |
| Relecture adverse | agent `relecteur-adverse` | après tout changement de code/logique/sécurité, avant PR (CLAUDE.md règle 11) | oui par convention | non |
| Vérification d'un test | agent `verificateur-de-tests` | sur un test ajouté après coup | non | non |

## Ce que chaque couche a réellement attrapé

- **`npm test`** — garde-fous de régression écrits après chaque trouvaille :
  contraste WCAG verrouillé (`contrast.test.js`, `profileContrast.test.js`,
  voir `docs/DESIGN_SYSTEM.md`), échappement HTML des popups Leaflet
  (`leafletTooltipEscaping.test.js`), une seule altitude par col dans
  `historic_routes.json` (`historicRoutes.test.js` — a bloqué le 17/10/2026
  une curation qui fixait une altitude locale divergente pour le Col du
  Platzerwasel).
- **Monkey testing** — une deuxième XSS dans le mini-site exporté (évasion
  `</script>`, PR #15) et des 500 avec fuite de stack trace sur un type
  inattendu envoyé à better-sqlite3 (CLAUDE.md règles 1 et 8).
- **Démo réseau réel (nightly)** — la seule couche automatique qui exerce les
  vraies API (Géoplateforme, BRouter, altimétrie) : c'est là qu'une panne
  ou un changement de comportement amont se voit, pas dans `npm test`.
- **Relecture adverse** — a trouvé la XSS de `/api/backup/import` (PR #337)
  et deux défauts dans le premier correctif du « routeur mixte » (PR #340).

## La pyramide, et pourquoi elle a cette forme

- **Large base déterministe et hors-ligne** (`npm test`, démo simulateur) :
  bloquante, rapide (~20 s), reproductible, sans dépendance à des services
  tiers — cohérent avec `docs/BRIEF.md` (application locale).
- **Couche réseau réel non bloquante** (nightly, parité) : les services
  publics (BRouter, Nominatim, Géoplateforme) varient et limitent leur débit
  — constaté le 17/10/2026, BRouter renvoie des HTTP 403 par intermittence
  sous charge, avec repli OSRM leg par leg. Bloquer une PR sur ces services
  rendrait la CI instable sans rien dire du code de la PR.
- **Exploratoire à la demande** (monkey, mutation) : coûteux, gardés hors
  de la porte bloquante volontairement (voir README).

## Trous connus (ce qui n'est pas testé automatiquement)

- **Pas de test de bout en bout automatisé dans le navigateur en CI** : la
  vérification Playwright de `/porte` est manuelle et ponctuelle ; les
  audits applicatifs (Epic 6) ont été faits par scripts ad hoc, non
  versionnés.
- **La qualité des données historiques n'est vérifiée qu'à la curation** :
  chaque entrée de `pipeline/data/historic_routes.json` est mesurée par
  régénération réelle au moment où elle est écrite, puis plus jamais — une
  entrée peut dériver sans que rien ne le signale (cas réel : l'étape
  2023/20 annonçait +5,2 %, re-mesurée à +0,4 % le 17/10/2026 ; et 8
  entrées affichaient « OK » sous un seuil de tolérance qui avait changé
  depuis, voir PR #351). La démo réseau nocturne ne couvre que quelques
  étapes.
- **Pas de comparaison automatique au kilométrage de course** : quand un
  roadbook kilométré existe, la dérive point par point (et pas seulement la
  distance totale) a été mesurée à la main pendant les curations du
  17/10/2026 — un total dans la tolérance peut masquer ±10 km de dérive
  intermédiaire par compensation.
- **Pas de test de charge** sur un jeu de données à l'échelle (Epic 17).

## Pistes (non engagées)

Proposées, pas implémentées — chacune ajoute du code à maintenir et mérite
un arbitrage :

1. Une **régénération réelle périodique de toutes les étapes curées**, qui
   compare le résultat aux chiffres écrits dans leurs `confidence` et signale
   les dérives (même esprit que `demo-online.yml`, en plus large et plus
   espacé pour ménager les services publics).
2. Un champ optionnel `race_km` sur les vias curés depuis un roadbook, et un
   check qui compare la position reconstituée de chaque via à ce
   kilométrage — automatiser la mesure faite à la main ci-dessus.
3. Un **test Playwright minimal en CI** (chargement des 8 écrans, aucune
   erreur console, pas de débordement horizontal à 375px) sur la démo
   hors-ligne — sans réseau, donc stable.
