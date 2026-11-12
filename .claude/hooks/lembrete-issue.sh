#!/usr/bin/env bash
# Lembrete de issue (issue #102): a cada prompt do dono injeta no contexto a obrigação de abrir a issue antes de agir.
# Hook UserPromptSubmit: lê o JSON no stdin (campo prompt) e imprime o additionalContext. Sempre sai com 0.
# Notificações do sistema ("[SYSTEM NOTIFICATION...") e prompts vazios não são pedido do dono: nada é injetado.
entrada=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
prompt=$(printf '%s' "$entrada" | jq -r '(.prompt // "") | tostring' 2>/dev/null) || exit 0
[ -n "${prompt//[[:space:]]/}" ] || exit 0
case "$prompt" in
  '[SYSTEM NOTIFICATION'*) exit 0 ;;
esac
texto='OBRIGATÓRIO: este pedido do dono (ajuste, correção, feature, qualquer coisa) deve virar issue estruturada ANTES de qualquer ação: crie a issue, grave `#N` em .claude/issue.local e só então siga (gate-issue.sh bloqueia escrita sem issue). Pedido grande: issue-mãe + sub-issues. Política em .claude/rules/github.md.'
jq -n --arg t "$texto" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $t}}'
exit 0
