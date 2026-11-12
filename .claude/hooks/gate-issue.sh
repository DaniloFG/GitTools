#!/usr/bin/env bash
# Gate de issue (issue #102): todo pedido do dono vira issue estruturada ANTES de qualquer ação.
# Hook PreToolUse: lê o JSON do hook no stdin (tool_name e tool_input). exit 2 + mensagem no stderr = bloqueia.
# Atua em: Agent com subagent_type gt-escritor; Edit, Write e NotebookEdit. Qualquer outra ferramenta sai com 0.
# Issue ativa =
#   (a) .claude/issue.local (arquivo pessoal, fora do git) com ao menos um #N na primeira linha; ou
#   (b) sem esse arquivo, docs/HANDOFF.md com ao menos um #N (sessões de etapa não têm o marcador).
# Com marcador, o gh confirma que a issue existe e está aberta. Só bloqueia se TODOS os números forem
# inexistentes ou fechados; se o GitHub estiver inacessível, avisa e libera (rede fora não pode travar a produção).
entrada=$(cat)

# Caminho comum: ferramenta que não é nenhuma das quatro sai aqui, sem abrir o jq.
case "$entrada" in
  *Agent*|*Edit*|*Write*|*NotebookEdit*) ;;
  *) exit 0 ;;
esac

raiz="${CLAUDE_PROJECT_DIR:-$(pwd)}"

bloquear() {
  printf 'GATE DE ISSUE: %s\n' "$1" >&2
  exit 2
}

mensagem_sem_issue() {
  bloquear 'todo pedido vira issue antes de qualquer ação. Crie a issue (escopo, critérios de aceite, considerações técnicas, testes) com `mcp__github__issue_write` e grave `#N` na primeira linha de .claude/issue.local (política: .claude/rules/github.md).'
}

command -v jq >/dev/null 2>&1 || bloquear 'o jq não está instalado; sem ele não dá para inspecionar a chamada.'

# Um jq só: campos separados por \u001f (não é espaço, então campo vazio é preservado).
campos=$(printf '%s' "$entrada" | jq -r '
  def s: (. // "") | tostring;
  [ (.tool_name | s), (.tool_input.subagent_type | s),
    ((.tool_input.file_path // .tool_input.notebook_path) | s) ] | join("\u001f")') \
  || bloquear 'não foi possível ler a chamada da ferramenta (JSON inválido).'
IFS=$'\x1f' read -r -d '' ferramenta subagente caminho <<<"$campos"

case "$ferramenta" in
  Agent) [ "$subagente" = gt-escritor ] || exit 0 ;;
  Edit|Write|NotebookEdit)
    # Normaliza (.., ./, relativo) para que "/tmp/../projeto/x" não passe por "fora do projeto".
    if command -v realpath >/dev/null 2>&1; then
      [ -n "$caminho" ] && [[ $caminho != /* ]] && caminho="$raiz/$caminho"
      caminho=$(realpath -m -- "$caminho" 2>/dev/null || printf '%s' "$caminho")
      raiz_abs=$(realpath -m -- "$raiz" 2>/dev/null || printf '%s' "$raiz")
    else
      raiz_abs=$raiz
    fi
    # Fora do projeto (scratchpad, /tmp): não é trabalho no código.
    case "$caminho" in
      "$raiz_abs"/*) ;;
      *) exit 0 ;;
    esac
    # Os marcadores precisam ser graváveis, senão não há como registrar a issue.
    case "$caminho" in
      "$raiz_abs/.claude/issue.local"|"$raiz_abs/.claude/triagem.local") exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac

marcador="$raiz/.claude/issue.local"
handoff="$raiz/docs/HANDOFF.md"

if [ ! -f "$marcador" ]; then
  if [ -f "$handoff" ] && grep -qE '#[0-9]+' "$handoff"; then exit 0; fi
  mensagem_sem_issue
fi

numeros=$(head -n 1 "$marcador" | grep -oE '#[0-9]+' | tr -d '#' | sort -un)
[ -n "$numeros" ] || mensagem_sem_issue

# --- Confirmação opcional no GitHub (qualquer dúvida de infraestrutura pula a verificação) ---
command -v gh >/dev/null 2>&1 || exit 0
url=$(git -C "$raiz" remote get-url origin 2>/dev/null) || exit 0
url=${url%/}
url=${url%.git}
repo=${url##*/}
resto=${url%/*}
dono=${resto##*[/:]}
[[ $dono =~ ^[A-Za-z0-9._-]+$ && $repo =~ ^[A-Za-z0-9._-]+$ ]] || exit 0

mortas=0
total=0
indeterminadas=0
for n in $numeros; do
  total=$((total + 1))
  err=$(mktemp) || exit 0
  if command -v timeout >/dev/null 2>&1; then
    estado=$(timeout 5 gh api "repos/$dono/$repo/issues/$n" --jq .state 2>"$err")
  else
    estado=$(gh api "repos/$dono/$repo/issues/$n" --jq .state 2>"$err")
  fi
  rc=$?
  saida_err=$(cat "$err" 2>/dev/null)
  rm -f "$err"
  if [ "$rc" -eq 0 ]; then
    [ "$estado" = open ] || mortas=$((mortas + 1))
  elif [[ $saida_err == *404* ]]; then
    mortas=$((mortas + 1))
  else
    indeterminadas=$((indeterminadas + 1))
  fi
done

if [ "$mortas" -eq "$total" ]; then
  bloquear "issue inexistente ou fechada ($(printf '#%s ' $numeros | sed 's/ $//')). Crie a issue do pedido e atualize a primeira linha de .claude/issue.local."
fi
if [ "$indeterminadas" -gt 0 ]; then
  echo 'GATE DE ISSUE: aviso: não foi possível confirmar a issue no GitHub (rede ou autenticação); seguindo sem a verificação.' >&2
fi
exit 0
