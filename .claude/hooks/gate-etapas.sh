#!/usr/bin/env bash
# Gate obrigatório da triagem (CLAUDE.md, "Toda solicitação começa pela triagem").
# Bloqueia o gt-escritor enquanto não houver prova de que a triagem foi feita:
#   - docs/HANDOFF.md existe (trabalho Grande, planejado em etapas), ou
#   - .claude/triagem.local DO WORKTREE do hook (lib-raiz.sh; cada worktree tem a sua triagem) declara "pequena <assunto>" ou "media <assunto>" (arquivo pessoal, fora do git).
# "grande" no marcador NÃO libera: Grande exige o HANDOFF criado pela skill `planejar`.
entrada=$(cat)
case "$entrada" in
  *'"subagent_type"'*'gt-escritor'*) ;;
  *) exit 0 ;;
esac
projeto="${CLAUDE_PROJECT_DIR:-$(pwd)}"
raiz=$projeto
# shellcheck source=lib-raiz.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib-raiz.sh"
# A sessão roda no worktree da issue: o cwd do hook diz qual; fora do repositório, vale o projeto.
if command -v jq >/dev/null 2>&1; then
  cwd=$(printf '%s' "$entrada" | jq -r '(.cwd // "") | tostring' 2>/dev/null)
  [ -n "$cwd" ] && raiz=$(raiz_de_trabalho "${cwd%/}" "${projeto%/}") || raiz=$projeto
fi
[ -f "$raiz/docs/HANDOFF.md" ] && exit 0
if [ -f "$raiz/.claude/triagem.local" ] && grep -qiE '^(pequena|media|média)[[:space:]]+[^[:space:]]' "$raiz/.claude/triagem.local"; then
  exit 0
fi
cat >&2 <<'MSG'
GATE DE ETAPAS: escrita bloqueada. Faça a triagem do CLAUDE.md antes de delegar código.
- Pequena/Média: grave em .claude/triagem.local uma linha "pequena <assunto>" ou "media <assunto>" e siga.
- Grande (várias issues, fase, plano, não cabe numa sessão): rode a skill `planejar`, crie docs/HANDOFF.md e abra
  a central (modo fábrica: o "pode seguir" do dono já está dado); ela abre uma sessão por etapa. Não implemente na sessão de entrada.
- O marcador vale no worktree (ou na raiz) onde a sessão roda; outro worktree tem o seu.
MSG
exit 2
