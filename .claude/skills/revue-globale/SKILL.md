---
name: revue-globale
description: Revue d'ÉtapeForge dans son ensemble — sécurité, dette, cohérence des docs, déploiement — et non des diffs récents. À lancer en fin de session, après les revues de sprint.
---

# Revue globale

**Une revue globale n'est pas une revue transversale des diffs récents.**
Ce qui se trouve ici ne se trouve nulle part ailleurs, parce que ça porte
sur des fichiers qu'aucune tâche récente n'a touchés.

## Le passage obligé

### Déploiement

L'état des dernières exécutions CI sur `main` (workflow `ci.yml`). À faire
**en premier** : le reste ne vaut rien si `main` est rouge.

### Sécurité

```bash
grep -rn "innerHTML\|\.html(\|eval(\|new Function" frontend/ backend/
grep -rn '\${' backend/exports.js frontend/*.js | grep -v '// '
npm audit --omit=dev
```

Pour chaque point d'injection trouvé (surtout tout gabarit qui embarque du
JSON dans un `<script>`, comme `backend/exports.js`), vérifier que **toutes**
les interpolations sont échappées — pas seulement celles qu'on a en tête.
La deuxième XSS d'`exports.js` (évasion `</script>`, PR #15) a survécu à une
revue de sécurité qui avait corrigé la première.

### Validation d'entrée

```bash
grep -rn "app\.\(post\|put\|delete\)(" backend/server.js
```

Pour chaque route qui écrit en base, vérifier que chaque champ passe par
`requireString`/`optionalString`/`optionalNumber` (ou équivalent) avant
l'écriture SQL — better-sqlite3 plante en 500 avec fuite de stack trace sur
un type inattendu sans cette garde.

### Dette du backlog

```bash
gh issue view 10 --repo Opaland/Tdf-generator --json body -q .body | grep -c '^\- \[ \]'
gh issue view 10 --repo Opaland/Tdf-generator --json body -q .body | grep -c '^\- \[x\]'
```

(Si `gh` est indisponible dans cet environnement, utiliser les outils GitHub
MCP à la place.) Comparer au chiffre de la session précédente si connu —
une dette qui grossit se rapporte avec son compte, pas avec un adjectif.

### Cohérence des textes

C'est là qu'était la phrase de positionnement du README identifiée comme
datée par l'étude concurrentielle (issue #14, jamais corrigée depuis).
Chercher les formules, pas les fichiers :

```bash
grep -rn "ce que.*ne fait pas\|100 % local\|aucune dépendance cloud\|aucun compte" README.md docs/
```

### Poids et dépendances

```bash
cat package.json | grep -A6 '"dependencies"'
```

4 dépendances directes au moment d'écrire ces lignes (`better-sqlite3`,
`express`, `fit-file-parser`, `leaflet`) + `playwright` en dev — toute
nouvelle dépendance se justifie explicitement (voir `docs/BRIEF.md`,
« ce qu'on ne fera pas » : pas de dépendance cloud propriétaire, pas de
framework frontend).

## Le piège de l'outil qu'on vient d'écrire

**Vérifier à la main le premier résultat de tout script de revue avant d'en
rapporter quoi que ce soit.** Un grep de sécurité trop large (ou trop
étroit) rapporte des faux positifs/négatifs aussi facilement qu'un vrai bug
— relire chaque ligne trouvée dans son contexte avant de la citer.

## La sortie

- Les trouvailles réelles, corrigées ou ouvertes en issue.
- Ce qui a été mesuré **sans** trouver de défaut — ça vaut d'être dit.
- Les chiffres de la session (items de backlog traités, PR mergées).
