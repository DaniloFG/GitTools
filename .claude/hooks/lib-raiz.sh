#!/usr/bin/env bash
# Biblioteca dos hooks (fábrica paralela, #199): descobre a RAIZ DE TRABALHO de uma chamada.
# Os hooks resolviam a raiz por $CLAUDE_PROJECT_DIR; com um worktree por issue, os marcadores
# (.claude/issue.local, .claude/triagem.local) colidiam e um worktree fora do diretório do projeto passava sem issue.
# Uso: source lib-raiz.sh; raiz=$(raiz_de_trabalho "<caminho absoluto normalizado>" "<diretório do projeto>")
# Imprime o topo do worktree que contém o alvo; status 1 quando o alvo não é deste repositório (não é trabalho nele).
# Caminho rápido, sem processo git: alvo dentro do projeto e fora de .claude/worktrees/ (o caso comum).
# Senão: o topo do worktree do alvo vale se o `--git-common-dir` for o mesmo do projeto (mesmo repositório).
# Em falha, $RAIZ_DIAGNOSTICO guarda os caminhos vistos (o autosave os registra no log).
# Tudo entre aspas; nada do alvo é interpretado pelo shell nem vira opção do git (vai só depois de `-C`).
# Caminho do Windows (C:\x\y, C:/x/y) vira o formato do Git Bash (/c/x/y); fora do Windows não muda nada.
# A letra do drive é minúscula para "C:" e "/c" compararem iguais, e "\" vira "/". É o formato ÚNICO dos hooks: tudo o
# que vem do git (`--show-toplevel`, `--git-common-dir` saem como "C:/...") e do Node passa por aqui antes de comparar.
para_posix() {
  local c=${1//\\//}
  if [[ $c =~ ^([A-Za-z]):(/.*)?$ ]]; then
    local d=${BASH_REMATCH[1]} resto=${BASH_REMATCH[2]}
    # Minúscula sem `${d,,}` (bash 4+; o macOS traz o 3.2) e sem processo: a letra do drive é uma só.
    case "$d" in
      A) d=a ;; B) d=b ;; C) d=c ;; D) d=d ;; E) d=e ;; F) d=f ;; G) d=g ;; H) d=h ;; I) d=i ;; J) d=j ;;
      K) d=k ;; L) d=l ;; M) d=m ;; N) d=n ;; O) d=o ;; P) d=p ;; Q) d=q ;; R) d=r ;; S) d=s ;; T) d=t ;;
      U) d=u ;; V) d=v ;; W) d=w ;; X) d=x ;; Y) d=y ;; Z) d=z ;;
    esac
    c="/$d$resto"
  fi
  printf '%s' "$c"
}

raiz_de_trabalho() {
  local alvo=${1%/} projeto=${2%/} dir topo comum comum_projeto
  [ -n "$alvo" ] && [ -n "$projeto" ] || return 1
  case "$alvo/" in
    "$projeto"/.claude/worktrees/*) ;;
    "$projeto"/*) printf '%s' "$projeto"; return 0 ;;
  esac
  # Sobe até o diretório existente mais próximo (o arquivo a criar ainda não existe).
  dir=$alvo
  while [ -n "$dir" ] && [ ! -d "$dir" ]; do
    case "$dir" in */*) dir=${dir%/*} ;; *) return 1 ;; esac
  done
  [ -n "$dir" ] || dir=/
  RAIZ_DIAGNOSTICO="alvo=$alvo projeto=$projeto dir=$dir"
  topo=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  comum=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  comum_projeto=$(git -C "$projeto" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  RAIZ_DIAGNOSTICO="$RAIZ_DIAGNOSTICO topo=$topo comum=$comum comum_projeto=$comum_projeto"
  topo=$(para_posix "$topo")
  comum=$(para_posix "$comum")
  comum_projeto=$(para_posix "$comum_projeto")
  [ -n "$topo" ] || return 1
  # Mesmo repositório = mesmo texto ou a mesma pasta (-ef: mesmo dispositivo e inode). No Windows o mesmo diretório sai
  # com grafias diferentes (nome curto 8.3 do tmpdir contra o longo do git); -ef não afrouxa nada, só compara identidade.
  [ "$comum" = "$comum_projeto" ] || { [ -d "$comum" ] && [ -d "$comum_projeto" ] && [ "$comum" -ef "$comum_projeto" ]; } || return 1
  printf '%s' "$topo"
}

# Caminho físico do alvo: resolve os links simbólicos do diretório existente mais próximo (`pwd -P`) e reanexa o resto.
# O componente final nunca é resolvido (um link no próprio marcador não leva a outro arquivo). No macOS o tmpdir fica em
# /var, link para /private/var, e o topo do worktree vem físico do git: sem isto o marcador não casava com a raiz.
caminho_fisico() {
  local alvo=${1%/} dir resto= fisico
  [ -n "$alvo" ] || return 1
  dir=$alvo
  while [ -n "$dir" ] && [ ! -d "$dir" ]; do
    case "$dir" in */*) resto="/${dir##*/}$resto"; dir=${dir%/*} ;; *) return 1 ;; esac
  done
  [ -n "$dir" ] || dir=/
  fisico=$(cd "$dir" 2>/dev/null && pwd -P) || return 1
  [ "$fisico" = / ] && fisico=
  printf '%s' "$fisico$resto"
}

# Verdadeiro se o caminho é o marcador (.claude/issue.local ou .claude/triagem.local) DA raiz. Compara o texto e, quando a
# pasta .claude existe dos dois lados, a identidade da pasta (-ef): cobre link simbólico e grafia curta/longa no Windows.
# Só esses dois nomes, só dentro de .claude da raiz; o componente final nunca é resolvido.
marcador_da_raiz() {
  local alvo=$1 raiz=${2%/} base pai
  base=${alvo##*/}
  pai=${alvo%/*}
  case "$base" in issue.local|triagem.local) ;; *) return 1 ;; esac
  [ "${pai##*/}" = .claude ] || return 1
  [ "$pai" = "$raiz/.claude" ] && return 0
  [ -d "$pai" ] && [ -d "$raiz/.claude" ] && [ "$pai" -ef "$raiz/.claude" ]
}

# Número(s) de issue no nome da branch do worktree (`<tipo>/<N>-<assunto>`); vazio se não casar.
# O nome vem do git e só o número validado (dígitos) sai daqui.
issue_da_branch() {
  local ramo
  ramo=$(git -C "$1" symbolic-ref --short -q HEAD 2>/dev/null) || return 0
  if [[ $ramo =~ ^(feature|fix|docs|chore|refactor)/([0-9]+)- ]]; then
    printf '%s' "${BASH_REMATCH[2]}"
  fi
}
