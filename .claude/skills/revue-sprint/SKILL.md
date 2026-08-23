---
name: revue-sprint
description: Relit le diff d'une tâche d'ÉtapeForge en cherchant ce qu'on y a cassé plutôt que ce qu'on y a réparé. À lancer après chaque tâche/PR, avant de passer à la suivante.
---

# Revue de sprint

**Le but n'est pas de vérifier que ça marche — `/porte` le fait déjà. Le but
est de trouver ce que j'ai cassé en réparant.**

## La méthode

Prendre le diff complet depuis le point de départ de la tâche :

```bash
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat
git diff origin/main..HEAD | grep -E '^[+-]' | grep -v '^[+-][+-]'
```

Puis, pour chaque changement, poser **la question inverse** de celle qu'on
s'est posée en l'écrivant : qu'est-ce que ce correctif a pu retirer ou
laisser ouvert ?

## Les angles qui ont payé sur ce dépôt

| Angle | Ce qu'il a trouvé |
|---|---|
| **Une faille corrigée à une couche l'est-elle à toutes ?** | L'évasion `</script>` après le fix DOM-sink (PR #11 → #15) |
| **Un flag générique (`NODE_ENV`…) est-il déjà forcé ailleurs ?** | `NODE_ENV=production` dans le `Dockerfile`, sur tous les déploiements |
| **Un format de date est-il vérifié des deux côtés (JS ↔ SQLite) ?** | `toISOString()` vs `datetime('now')`, comparaison silencieusement fausse |
| **Un état mis en cache au premier `require()` survit-il à un changement d'env var ?** | `backend/db.js` et `ETAPEFORGE_DATA_DIR` dans `scripts/monkey.js` |
| **Un helper transverse a-t-il été relu, pas juste réutilisé ?** | `wrap()` ignorait `err.status` jusqu'à la route d'import par lien |
| **Un mock global déborde-t-il sur des appels qu'il ne devrait pas toucher ?** | `global.fetch` interceptant aussi les appels du test vers le serveur local |
| **La branche locale est-elle vraiment synchronisée avec `main` ?** | Diff de PR gonflé après un squash-merge non resynchronisé |

## Vérifier avant de rapporter

**Mesurer, puis rapporter.** Un faux positif dans une revue coûte la
confiance dans les vrais — vérifier chaque hypothèse par une commande ou un
test avant de l'écrire comme une trouvaille.

## La sortie

Une note qui dit, sans enjoliver :

- ce qui a été trouvé, et que c'était du fait de cette tâche ;
- ce qui a été vérifié sans suite, avec la mesure ;
- ce qui reste ouvert (en issue si ça dépasse le scope de la tâche).
