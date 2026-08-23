#!/usr/bin/env bash
# Porte rapide avant tout commit (voir CLAUDE.md, règle 10).
#
# Ne contient QUE npm test (~2 s au moment d'écrire ces lignes, 75 tests).
# npm run demo et la vérification visuelle restent dans /porte — les mettre
# ici rendrait chaque commit plus lent pour un gain marginal, et un
# garde-fou qu'on désactive parce qu'il gêne ne garde plus rien.
#
# Pas d'étape lint/typecheck ici : ÉtapeForge n'a ni ESLint configuré ni
# TypeScript (voir backlog, issue #10, section F) — contrairement au dépôt
# cousin Rando-generator dont ce hook s'inspire, qui en a besoin.
set -uo pipefail

# Le filtre `if` de settings.json n'est pas honoré partout : on relit la
# commande nous-mêmes. Sans cela la porte se déclenchait sur CHAQUE commande
# bash — et bloquer pendant le rouge casse le rouge-puis-vert du TDD.
entree=$(cat 2>/dev/null || echo '{}')
commande=$(printf '%s' "$entree" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
case "$commande" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 0
[ -f package.json ] || exit 0

# Une base laissée par une session précédente peut fausser un test qui
# suppose un état initial (voir /porte).
rm -rf data 2>/dev/null || true

sortie=$(npm test 2>&1) || {
  # `tail` seul rate le détail : node --test place le bloc "not ok" au
  # moment de l'échec, souvent bien avant la fin d'une suite de 70+ tests.
  # On extrait chaque bloc "not ok" (avec son contexte) plus le résumé final.
  echecs=$(printf '%s' "$sortie" | grep -A 12 "^not ok")
  resume=$(printf '%s' "$sortie" | tail -8)
  raison="Porte avant commit : npm test en échec. Corriger avant de committer.

${echecs}

${resume}"
  jq -nc --arg r "$raison" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

jq -nc '{systemMessage:"Porte avant commit : npm test au vert."}'
