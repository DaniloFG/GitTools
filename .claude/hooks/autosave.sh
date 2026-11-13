#!/usr/bin/env bash
# Salvamento automático (issue #112): quando o limite de uso acaba, nenhum trabalho pode ficar só no disco.
# Hook de shell, sem tokens: se a branch de trabalho tem mudança pendente, commita com o prefixo `wip:` e envia
# para `origin`. A retomada lê o último commit `wip:` (hora, commit anterior e arquivos pendentes no corpo).
#   autosave.sh             Stop, SubagentStop, PreCompact e SessionEnd: salva sempre que houver o que salvar.
#   autosave.sh --limitado  PostToolUse: no máximo uma tentativa a cada 10 minutos (carimbo em .claude/autosave.stamp).
# NUNCA bloqueia o Claude: sai sempre com 0; o motivo de não ter salvado vai para .claude/autosave.log.
# Nunca usa --force nem --no-verify, nunca age em develop/homolog/main nem no meio de merge/rebase, não leva arquivo
# sensível nem grande, respeita o .gitignore e jamais mexe em docs/HANDOFF.md (só commita o que já está pendente).

LIMITE_SEGUNDOS=600
LOCK_SEGUNDOS=120
TAMANHO_MAXIMO=$((5 * 1024 * 1024))
LINHAS_LOG=200

limitado=0
[ "${1:-}" = "--limitado" ] && limitado=1

raiz="${CLAUDE_PROJECT_DIR:-}"
[ -z "$raiz" ] && raiz=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$raiz" ] && [ -d "$raiz" ] || exit 0

# Fábrica paralela (#200): com um worktree por issue, a pendência é do worktree da sessão (o diretório em que o hook
# roda), não da raiz do projeto. Sem isto o `wip:` sairia na branch da raiz e o trabalho do worktree ficaria solto.
# Só vale se o diretório for do mesmo repositório (lib-raiz.sh); senão fica a raiz do projeto, como antes.
# shellcheck source=lib-raiz.sh
# O diretório do script sai de expansão pura do bash (sem processo: isto roda a cada PostToolUse, antes do limitador). Não
# vale `${BASH_SOURCE[0]%/*}` sozinho: no Windows o Node passa `C:\x\autosave.sh` (sem `/`), o `%/*` devolvia o caminho
# inteiro, a lib não era achada e o worktree era ignorado em silêncio (CI do Windows, #200). Por isso `\` vira `/` antes.
caminho_script=${BASH_SOURCE[0]//\\//}
case "$caminho_script" in
  */*) dir_hooks=${caminho_script%/*} ;;
  *) dir_hooks=. ;;
esac
if [ -f "$dir_hooks/lib-raiz.sh" ]; then
  . "$dir_hooks/lib-raiz.sh"
  atual=$(pwd -P 2>/dev/null) || atual=
  raiz_projeto=$(cd "$raiz" 2>/dev/null && pwd -P)
  RAIZ_DIAGNOSTICO=
  if [ -n "$atual" ] && [ -n "$raiz_projeto" ] && trabalho=$(raiz_de_trabalho "$atual" "$raiz_projeto"); then
    [ -d "$trabalho" ] && raiz=$trabalho
  else
    # O subshell de $(...) não leva a variável de volta: refaz a consulta só para registrar os caminhos vistos.
    # Só quando a sessão está num worktree do projeto (onde a resolução deveria ter dado certo): fora disso é o caso comum.
    case "$atual/" in "$raiz_projeto"/.claude/worktrees/*) raiz_de_trabalho "$atual" "$raiz_projeto" >/dev/null 2>&1 ;; *) RAIZ_DIAGNOSTICO=sem ;; esac
    [ "$RAIZ_DIAGNOSTICO" = sem ] || diagnostico="raiz do worktree não resolvida: atual=$atual raiz_projeto=$raiz_projeto ${RAIZ_DIAGNOSTICO:-}"
  fi
else
  diagnostico="lib-raiz.sh não encontrada em $dir_hooks"
fi

# AUTOSAVE_DEBUG=1 (só diagnóstico, os testes do Windows): registra no log o contexto e o motivo de cada saída antecipada.
[ -n "${AUTOSAVE_DEBUG:-}" ] && diagnostico="${diagnostico:-} contexto: bash=$BASH_VERSION CLAUDE_PROJECT_DIR=${CLAUDE_PROJECT_DIR:-} pwd=$(pwd) atual=${atual:-} raiz_projeto=${raiz_projeto:-} raiz=$raiz RAIZ_DIAGNOSTICO=${RAIZ_DIAGNOSTICO:-}"

carimbo="$raiz/.claude/autosave.stamp"
registro="$raiz/.claude/autosave.log"

# Limitador primeiro, antes de qualquer chamada ao git: no PostToolUse isto roda a cada ferramenta e precisa ser barato.
agora=$(date +%s)
if [ "$limitado" = 1 ] && [ -f "$carimbo" ]; then
  ultimo=$(head -n 1 "$carimbo" 2>/dev/null)
  if [[ $ultimo =~ ^[0-9]+$ ]] && [ $((agora - ultimo)) -lt "$LIMITE_SEGUNDOS" ]; then
    exit 0
  fi
fi

# Log curto: acima de ~200 linhas guarda só as 100 últimas, para nunca crescer sem fim.
log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$registro" 2>/dev/null || return 0
  local n
  n=$(wc -l < "$registro" 2>/dev/null) || return 0
  if [ "${n:-0}" -gt "$LINHAS_LOG" ]; then
    tail -n 100 "$registro" > "$registro.tmp" 2>/dev/null && mv -f "$registro.tmp" "$registro" 2>/dev/null
  fi
  return 0
}

# Saída antecipada em modo depuração: grava o motivo (cria .claude se faltar, senão o log nem nasce).
dbg() {
  [ -n "${AUTOSAVE_DEBUG:-}" ] || return 0
  mkdir -p "$raiz/.claude" 2>/dev/null
  log "debug: $*"
}

[ -n "${diagnostico:-}" ] && { [ -z "${AUTOSAVE_DEBUG:-}" ] || mkdir -p "$raiz/.claude" 2>/dev/null; log "$diagnostico"; }

# Rede e commit com prazo: o hook não pode pendurar o Claude. Sem `timeout` (coreutils), roda direto.
com_prazo() {
  local segundos=$1
  shift
  if command -v timeout >/dev/null 2>&1; then timeout "$segundos" "$@"; else "$@"; fi
}

cd "$raiz" || { dbg "cd $raiz falhou"; exit 0; }

# Nunca pedir senha nem abrir editor: o hook roda sem terminal.
export GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true GIT_MERGE_AUTOEDIT=no

branch=$(git branch --show-current 2>/dev/null)
[ -n "$branch" ] || { dbg "HEAD solto em $raiz"; exit 0; } # HEAD solto
case "$branch" in
  develop | homolog | main) dbg "branch protegida: $branch"; exit 0 ;;
esac

# Merge, rebase ou cherry-pick em andamento: commitar no meio estragaria a operação.
for estado in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD; do
  caminho_estado=$(git rev-parse --git-path "$estado" 2>/dev/null)
  [ -n "$caminho_estado" ] && [ -e "$caminho_estado" ] && { dbg "operação em andamento: $estado"; exit 0; }
done

git remote get-url origin >/dev/null 2>&1 || { dbg "sem remoto origin em $raiz"; exit 0; }

# Arquivos do próprio autosave nunca contam como mudança (em repositório sem o .gitignore do projeto eles apareceriam).
proprio() {
  case "$1" in
    .claude/autosave.log | .claude/autosave.log.tmp | .claude/autosave.stamp) return 0 ;;
  esac
  return 1
}

# Arquivo que não vai para o commit: nome sensível ou mais de 5 MB. Imprime o motivo e devolve 0 se deve ficar de fora.
sensivel() {
  local caminho=$1 base tamanho
  base=${caminho##*/}
  local antigo
  antigo=$(shopt -p nocasematch)
  shopt -s nocasematch
  local achou=1
  case "$base" in
    .env* | *.pem | *.key | id_rsa* | *secret* | *.p12 | *credential*) achou=0 ;;
  esac
  # Pasta chamada secrets/ ou credentials/ também vale.
  case "$caminho" in
    *secret* | *credential*) achou=0 ;;
  esac
  eval "$antigo"
  if [ "$achou" = 0 ]; then
    echo "nome sensível"
    return 0
  fi
  if [ -f "$caminho" ] && [ ! -L "$caminho" ]; then
    tamanho=$(wc -c < "$caminho" 2>/dev/null | tr -d ' ')
    if [ "${tamanho:-0}" -gt "$TAMANHO_MAXIMO" ]; then
      echo "maior que 5 MB"
      return 0
    fi
  fi
  return 1
}

# Pendências, em formato estável para máquina (-z): "XY caminho\0"; renomeação traz ainda "origem\0".
pendentes=0
excluir=()
pular=0
while IFS= read -r -d '' entrada; do
  if [ "$pular" = 1 ]; then
    pular=0
    continue
  fi
  xy=${entrada:0:2}
  caminho=${entrada:3}
  case "$xy" in
    R? | C? | ?R | ?C) pular=1 ;;
  esac
  if proprio "$caminho"; then
    continue
  fi
  pendentes=$((pendentes + 1))
  if motivo=$(sensivel "$caminho"); then
    excluir+=(":(exclude,literal)$caminho")
    ficaram="${ficaram:-}${caminho} (${motivo}); "
  fi
done < <(git status --porcelain -z --untracked-files=all 2>/dev/null)

dbg "raiz=$raiz branch=$branch pendentes=$pendentes"
[ "$pendentes" -gt 0 ] || exit 0

# Trava contra dois salvamentos ao mesmo tempo (mkdir é atômico). Trava com 120 s ou mais é de um processo morto.
trava=$(git rev-parse --git-path autosave.lock 2>/dev/null)
[ -n "$trava" ] || { dbg "sem caminho de trava"; exit 0; }
if ! mkdir "$trava" 2>/dev/null; then
  criada=$(stat -c %Y "$trava" 2>/dev/null || stat -f %m "$trava" 2>/dev/null)
  if [[ $criada =~ ^[0-9]+$ ]] && [ $((agora - criada)) -ge "$LOCK_SEGUNDOS" ]; then
    rmdir "$trava" 2>/dev/null
    mkdir "$trava" 2>/dev/null || { dbg "trava presa: $trava"; exit 0; }
  else
    dbg "trava ativa: $trava"
    exit 0
  fi
fi
dbg "trava obtida: $trava"
trap 'rmdir "$trava" 2>/dev/null; exit 0' EXIT

# A partir daqui houve tentativa de salvar: só agora o carimbo anda.
mkdir -p "$raiz/.claude" 2>/dev/null
date +%s > "$carimbo" 2>/dev/null

if [ -n "${ficaram:-}" ]; then
  log "aviso: fora do commit: ${ficaram%; }"
fi

if ! saida=$(git add -A -- . ':(exclude,literal).claude/autosave.log' ':(exclude,literal).claude/autosave.stamp' "${excluir[@]}" 2>&1); then
  log "erro no git add: $saida"
  exit 0
fi

# Rede de segurança: algo sensível que já estava no índice (git add feito à mão) também não pode sair.
while IFS= read -r -d '' preparado; do
  if motivo=$(sensivel "$preparado"); then
    git reset -q -- "$preparado" >/dev/null 2>&1
    log "aviso: tirado do índice: $preparado ($motivo)"
  fi
done < <(git diff --cached --name-only -z 2>/dev/null)

if git diff --cached --quiet 2>/dev/null; then
  log "nada a commitar depois de excluir os arquivos sensíveis"
  exit 0
fi

anterior=$(git log -1 --format='%h %s' 2>/dev/null)
[ -n "$anterior" ] || anterior="(nenhum)"
resumo=$(git status --short -- . ':(exclude,literal).claude/autosave.log' ':(exclude,literal).claude/autosave.stamp' 2>/dev/null)
total=$(printf '%s\n' "$resumo" | wc -l | tr -d ' ')
lista=$(printf '%s\n' "$resumo" | head -n 30)
if [ "$total" -gt 30 ]; then
  lista="$lista
… e mais $((total - 30))"
fi
titulo="wip: salvamento automático ($(date -u '+%Y-%m-%d %H:%M') UTC)"
corpo="Último commit antes: $anterior
Branch: $branch

$lista"

# Commit normal, com os hooks do repositório: se algum falhar, registra e deixa como está (nada é forçado).
if ! saida=$(com_prazo 120 git commit -q -m "$titulo" -m "$corpo" 2>&1); then
  log "erro no git commit: $saida"
  exit 0
fi

# Envio sem --force. Rejeitado (remoto andou): busca, rebase na ponta remota e uma nova tentativa.
if saida=$(com_prazo 60 git push origin HEAD 2>&1); then
  exit 0
fi
log "push recusado: $saida"

if ! saida=$(com_prazo 60 git fetch origin "$branch" 2>&1); then
  log "erro no git fetch (commit wip mantido local): $saida"
  exit 0
fi

if ! saida=$(git rebase "origin/$branch" 2>&1); then
  git rebase --abort >/dev/null 2>&1
  log "conflito: commit wip mantido local ($saida)"
  exit 0
fi

if ! saida=$(com_prazo 60 git push origin HEAD 2>&1); then
  log "push falhou depois do rebase (commit wip mantido local): $saida"
fi
exit 0
