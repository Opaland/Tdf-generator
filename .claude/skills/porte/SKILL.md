---
name: porte
description: Lance la porte complète avant PR sur ÉtapeForge — tests, démo de validation, et vérification visuelle si le frontend a changé. À utiliser avant toute PR, et quand on veut savoir si l'arbre est sain.
---

# La porte complète

Le hook `PreToolUse` (`porte-avant-commit.sh`) ne couvre que `npm test`
(≈2 s) avant chaque commit. Cette procédure lance le reste, avant d'ouvrir
une PR.

## L'ordre, et pourquoi

```bash
npm test                    # tests unitaires (node:test)
npm run demo                # 10 vérifications de bout en bout, mode hors-ligne
npm run lint                # ESLint (eslint:recommended), en CI depuis le job « lint »
npm audit --audit-level=high
```

Si le changement touche `frontend/` (HTML/CSS/JS) : vérification visuelle
Playwright, pas une simple relecture du diff.

```bash
# Serveur local, données de démo, capture desktop (1440px) ET mobile (375px)
# des pages concernées — voir PR #24 pour le protocole de référence :
# scrollWidth === innerWidth sur mobile, interaction de bout en bout pour
# tout comportement nouveau (double-clic, formulaire, etc.), pas seulement
# une capture statique.
```

`npm run monkey` **reste volontairement hors de cette porte** — exploratoire,
non bloquant (voir README). À lancer séparément quand une graine mérite
d'être rejouée après un correctif, ou en fin de session sur une zone touchée.

## Trois pièges, tous mesurés sur ce dépôt

**Ne pas oublier de nettoyer `data/` avant `npm test`/`npm run demo`.** Une
base SQLite laissée par une session précédente peut fausser un test qui
suppose un état initial (`rm -rf data` avant de lancer).

**Le mode hors-ligne (`ETAPEFORGE_OFFLINE=1`, celui de `npm run demo` et de
`npm test`) ne teste jamais les vrais appels réseau.** Une régression sur
l'intégration Géoplateforme/OSRM/opentopodata/Wikipédia ne remonte que via
`scripts/demo-2027.js --online` (job mensuel séparé, `demo-2027.yml`) — ne
pas conclure « ça marche » d'un `npm run demo` vert si le changement touche
un appel réseau réel.

**Un changement d'interface vérifié seulement dans le code ment.** Corriger
le débordement de la nav mobile (PR #24) a révélé, une fois mesuré après
coup, deux causes additionnelles du même symptôme (ligne de waypoint,
tableau sans `overflow-x:auto`) invisibles en relisant le CSS. Toujours
mesurer après le premier correctif, pas seulement avant.

## Quand un test échoue

1. Le relancer **isolément** (`node --test test/<fichier>.test.js`).
2. `git stash` puis relancer la suite complète. Si l'arbre propre échoue
   aussi, le défaut préexiste ; sinon il est du dernier changement.
3. **Ne pas conclure « flaky » deux fois pour le même test.** La deuxième
   fois, chercher la cause.

## Ce que la porte ne dit pas

Elle ne dit pas que le travail est fini. Elle dit qu'il ne casse rien.
