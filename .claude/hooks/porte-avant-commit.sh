#!/usr/bin/env bash
# Porte rapide avant tout commit (voir CLAUDE.md, règle 11).
#
# npm test + eslint (les deux tiennent largement sous la minute). npm run
# demo et la vérification visuelle restent dans /porte, nettement plus
# lents (démo réseau simulée, Playwright) — les mettre ici rendrait chaque
# commit plus lent pour un gain marginal, et un garde-fou qu'on désactive
# parce qu'il gêne ne garde plus rien.
#
# Pas d'étape typecheck : ÉtapeForge n'a pas de TypeScript, contrairement
# au dépôt cousin Rando-generator dont ce hook s'inspire.
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

sortie_lint=$(npm run lint --silent 2>&1) || {
  raison="Porte avant commit : eslint en échec. Corriger avant de committer.

$(printf '%s' "$sortie_lint" | tail -30)"
  jq -nc --arg r "$raison" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

jq -nc '{systemMessage:"Porte avant commit : npm test et eslint au vert."}'
