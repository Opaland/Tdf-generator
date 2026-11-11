# Apprentissages de l'agent — à lire en premier

Ce fichier recense les **erreurs de méthode** de l'agent (Claude, Copilot,
Gemini) sur ÉtapeForge, pour ne pas les refaire. Il se lit **avant toute
autre chose** au début de chaque session et de chaque routine quotidienne,
avant `AGENTS.md` et avant `docs/CURATION-REGLES.md`.

Ce n'est pas un doublon :
- `AGENTS.md` porte les règles de développement (numérotées, citées dans le
  code) ;
- `docs/CURATION-REGLES.md` porte les règles de **données** (comment placer
  un point, lire un profil) ;
- ici : **comment l'agent travaille** — les faux pas de procédure, d'outil
  ou d'enchaînement.

**Entretien.** Chaque erreur nouvelle de méthode s'ajoute ici, dans la PR
qui la corrige, avec sa date, ce qui s'est passé et la conduite à tenir.
Une entrée qui devient une règle de données migre vers
`CURATION-REGLES.md` (on laisse ici un renvoi). On ne supprime pas une
entrée : on la marque « absorbée par … ».

---

## Git, commits, CI

1. **Ne jamais contourner le hook de commit** (09/11/2026). Un commit
   d'étape fait avec `--no-verify` a sauté `npm test`. Même pour un commit
   intermédiaire : laisser le hook tourner, ou ne pas committer.
2. **Committer avant de fusionner `main`** (08/11/2026). Une fusion de
   `main` a avorté sur des modifications non committées. Ordre :
   `git add` + commit, puis `git merge origin/main`.
3. **Le dépôt principal peut être en retard** (08/11/2026). Les worktrees
   de travail sont à jour, `/home/user/Tdf-generator` non : lire les
   données depuis le worktree de la tâche, ou `git fetch` d'abord.
4. **Créer l'issue avant de citer son numéro** (09/11/2026). Un numéro
   d'issue deviné dans SPRINT-STATUS peut tomber à côté : créer l'issue,
   lire son numéro, puis l'écrire.
5. **Un job CI rouge sur un fichier qu'on n'a pas touché se diagnostique**
   (09/11/2026). Le job `docker` a échoué sur `better-sqlite3` (« No
   prebuilt binaries found », pas de Python pour compiler) dans une PR de
   données. Lire le log, relancer **une** fois ; si l'échec revient, c'est
   une vraie panne de l'image (version de Node, binaires précompilés) à
   corriger dans sa propre PR — jamais « flaky » sans preuve. (Ici, la
   relance a suffi : le binaire précompilé n'avait pas été téléchargé.)
   Même conduite pour le déploiement GitHub Pages (10/11/2026) : build
   vert, déploiement expiré côté service (« syncing_files » puis timeout) ;
   une relance l'a fait passer.

## Commandes et processus

6. **Lancer en arrière-plan avec l'outil, pas avec `&`** (08/11/2026). Un
   `&` en fin de commande perd la notification de fin.
7. **Un refus de permission ne se contourne pas** (07/11/2026). `pkill` et
   `rm -rf` sur un glob relatif ont été refusés : chercher une autre façon
   légitime (fichier précis, attente de fin), jamais une variante de la
   même commande.
8. **Ne pas écrire un fichier qu'un script d'arrière-plan lit ou écrit**
   (règle de la routine). `stage_itineraries.json` ne se modifie pas pendant
   un `--write`, un géocodage ou une recherche bornée en cours : préparer
   les corrections dans un fichier à part, les appliquer à la fin.
9. **Une requête Nominatim à la fois — y compris les requêtes « rapides »**
   (09/11/2026). Trois requêtes manuelles ont tourné pendant qu'un lot de
   recherches bornées interrogeait déjà Nominatim. Avant toute requête
   manuelle : vérifier qu'aucun lot réseau ne tourne.

## Données et curation (renvois)

10. **Un remplacement mécanique de texte casse les notes** (08/11/2026).
    Un `sed` sur « limite de commune » a produit des phrases fausses et une
    cause erronée. Réécrire chaque note à la main, à partir de la version
    de `main`.
11. **Un script de construction se vérifie sur sa sortie** (08/11/2026).
    `build.py` de 1981 décalait les `source_url` d'une image à partir de
    l'étape 13. Après construction, comparer chaque `source_url` à la
    planche des titres (→ `CURATION-REGLES.md`, règle 1).
12. **La passe automatique ne prouve pas le lieu** (09/11/2026). Le
    géocodeur a posé Gripp sur une rivière, Sylvéréal sur un canal, Anéran
    sur un centroïde de commune nouvelle. Lire la classe OSM de chaque
    candidat dans le cache (→ règle 21).
    **La classe ne suffit pas, le nom non plus ne se suppose pas**
    (10/11/2026) : en 1979, trois points de classe « place » portaient un
    autre nom que celui cherché (« La Côte Renault » pour la côte
    d'Yffiniac, « Côte Chevalier » pour la côte de la Boisse, « Près du
    Petit Moulin » pour Beaufort-en-Vallée), et j'avais écrit dans une note
    « côte placée au bourg » sans le vérifier. Comparer, pour chaque point
    placé automatiquement, les mots du nom renvoyé à ceux du libellé.
13. **Un point repris d'une autre édition se revérifie pour l'époque**
    (09/11/2026). L'hôtel de ville de Montpellier de 2011 a été repris pour
    une arrivée de 1980 (→ règle 22).
14. **Une correction de lieu se propage à toutes les éditions**
    (09/11/2026). Les Lucs-sur-Boulogne corrigé ailleurs était resté faux en
    1981/8 : chercher le libellé dans tout le fichier (→ règle 6).
15. **« Aucun lieu compatible » ne s'écrit qu'après la recherche bornée**
    (09/11/2026). L'audit a trouvé 5 faux négatifs sur 6 sondés : la note
    « non placé » nomme ce qui a été essayé (→ règle 21).

## Enchaînement de la routine

16. **Un audit persona trouve presque toujours quelque chose** (07–09/11).
    Prévoir le temps de l'audit Mireille et de ses corrections dans la
    journée ; ne pas ouvrir la PR avant.
17. **Les sous-agents se trompent avec assurance.** Toute relecture qu'ils
    proposent se vérifie sur l'image ou par une requête avant d'être
    appliquée ; leurs « choix par défaut » sont des propositions.
18. **Une règle de données s'applique telle qu'écrite, pas par analogie**
    (11/11/2026). En 1978/8, j'ai gardé Lussac malgré un aller-retour en
    invoquant Zumaia (règle 17), parce que l'étape « tombait juste » avec
    lui ; la règle 24 l'interdit précisément (audit Mireille). De même,
    j'ai écrit « chiffre vraisemblablement fautif » sur des altitudes sans
    regarder la courbe (→ règle 14 précisée). Avant de garder un point en
    exception, relire la règle qui l'exclut.
19. **Le test d'invariant tranche avant l'audit** (11/11/2026).
    `placeSearch.test.js` a refusé Pontarlier et Les Hôpitaux-Vieux placés
    ensemble (km imprimé incompatible) : lancer `npm test` dès les
    corrections appliquées, pas seulement avant le commit.
20. **Committer avant une mutation de test** (11/11/2026). Pour vérifier
    qu'un test échoue sans son correctif, j'ai cassé le code puis restauré
    le fichier par `git checkout` : cela a aussi effacé le correctif non
    encore committé (route des récits, à réappliquer). Committer d'abord,
    ou restaurer depuis une copie du fichier, jamais depuis git.
