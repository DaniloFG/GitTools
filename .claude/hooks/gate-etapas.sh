#!/usr/bin/env bash
# Gate obrigatório da triagem (CLAUDE.md, "Toda solicitação começa pela triagem").
# Bloqueia o gt-escritor enquanto não houver prova de que a triagem foi feita:
#   - docs/HANDOFF.md existe (trabalho Grande, planejado em etapas), ou
#   - .claude/triagem.local declara "pequena <assunto>" ou "media <assunto>" (arquivo pessoal, fora do git).
# "grande" no marcador NÃO libera: Grande exige o HANDOFF criado pela skill `planejar`.
entrada=$(cat)
case "$entrada" in
  *'"subagent_type"'*'gt-escritor'*) ;;
  *) exit 0 ;;
esac
raiz="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f "$raiz/docs/HANDOFF.md" ] && exit 0
if [ -f "$raiz/.claude/triagem.local" ] && grep -qiE '^(pequena|media|média)[[:space:]]+[^[:space:]]' "$raiz/.claude/triagem.local"; then
  exit 0
fi
cat >&2 <<'MSG'
GATE DE ETAPAS: escrita bloqueada. Faça a triagem do CLAUDE.md antes de delegar código.
- Pequena/Média: grave em .claude/triagem.local uma linha "pequena <assunto>" ou "media <assunto>" e siga.
- Grande (várias issues, fase, plano, não cabe numa sessão): rode a skill `planejar`, crie docs/HANDOFF.md e
  espere o "pode seguir" do dono; a central abre uma sessão por etapa. Não implemente na sessão de entrada.
MSG
exit 2
