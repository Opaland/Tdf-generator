#!/usr/bin/env bash
# État du dernier déploiement de main, au démarrage de session (voir
# CLAUDE.md, règle 11 : « main rouge » vaut arrêt).
#
# Repris du dépôt cousin Rando-generator : une consigne qu'on peut oublier
# finit par être oubliée si elle dépend d'y penser soi-même. Ici, elle
# arrive sans qu'on la demande.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 0

message() { jq -nc --arg m "$1" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}}'; }

depot=$(git config --get remote.origin.url 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
[ -n "$depot" ] || exit 0

# `gh` n'est pas disponible dans une session Claude Code Remote (les outils
# GitHub MCP le remplacent) : sans lui, on le dit au lieu de laisser croire
# que tout va bien.
if ! command -v gh >/dev/null 2>&1; then
  message "État de main : non vérifié au démarrage (gh absent — utiliser les outils GitHub MCP, ex. mcp__github__pull_request_read method=get_status, ou vérifier via l'interface GitHub avant de committer)."
  exit 0
fi

etat=$(gh run list --repo "$depot" --branch main --limit 3 \
  --json name,conclusion,headSha,createdAt 2>/dev/null) || etat=""

if [ -z "$etat" ] || [ "$etat" = "[]" ]; then
  message "État de main : indisponible. À vérifier à la main."
  exit 0
fi

rouge=$(printf '%s' "$etat" | jq -r '[.[] | select(.conclusion != null and .conclusion != "success")] | length')
resume=$(printf '%s' "$etat" | jq -r '.[] | "\(.name): \(.conclusion // "en cours")"' | paste -sd' · ' -)

if [ "$rouge" -gt 0 ]; then
  message "⚠ main EN ÉCHEC — $resume. Ne rien empiler dessus : corriger d'abord (voir CLAUDE.md, règle 11)."
else
  message "État de main : $resume"
fi
