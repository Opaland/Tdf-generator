# ÉtapeForge — guide pour Claude Code

Générateur d'étapes du Tour de France (Node.js + SQLite, 100 % local) :
éditeur, reconstruction historique 1903→2027, fiches côte par côte. Lire
`README.md`, puis `docs/SPRINT-STATUS.md` (stories BMAD) avant de reprendre.

## Commandes

```bash
npm test          # obligatoire avant tout commit (hook porte-avant-commit.sh)
npm run lint      # idem
npm run demo      # démo hors ligne auto-vérifiée, avant toute PR (/porte)
```

## Propre à Claude Code

- Hooks (`.claude/hooks/`) : `porte-avant-commit.sh` refuse un `git commit`
  si `npm test` ou eslint échoue ; `etat-deploiement.sh` affiche l'état de
  la CI de `main` au démarrage.
- Skills : `/porte` (avant toute PR), `/revue-sprint` (après chaque tâche),
  `/revue-globale` (fin de session).
- Agents : `relecteur-adverse`, `verificateur-de-tests`, `revue-personas`,
  et les personas métier `henri` (historien) et `mireille` (auditrice de
  curation). Un persona rend ses « Questions à choix » : les poser à
  l'utilisateur avec AskUserQuestion, une à la fois, seulement quand la
  réponse change ce qu'on fait — sinon retenir son hypothèse et avancer
  (règle 15).
- Permissions (`.claude/settings.json`) : lecture et vérifications en
  `allow` ; en `ask`, l'irréversible (push forcé ou suppression de branche
  distante, `reset --hard`, réglages du dépôt, releases, secrets) et les
  imports réseau de plusieurs heures. Le push et la fusion ordinaires n'y
  sont pas : la fusion est autonome (règle 15). Un refus ne se contourne
  jamais.

## Règles communes (Claude, Copilot, Gemini)

Les règles numérotées — citées dans le code comme « CLAUDE.md règle N » —
sont dans `AGENTS.md` (source unique, numérotation conservée), importé ici :

@AGENTS.md
