#!/usr/bin/env bash
# Biblioteca dos hooks (fábrica paralela, #199): descobre a RAIZ DE TRABALHO de uma chamada.
# Os hooks resolviam a raiz por $CLAUDE_PROJECT_DIR; com um worktree por issue, os marcadores
# (.claude/issue.local, .claude/triagem.local) colidiam e um worktree fora do diretório do projeto passava sem issue.
# Uso: source lib-raiz.sh; raiz=$(raiz_de_trabalho "<caminho absoluto normalizado>" "<diretório do projeto>")
# Imprime o topo do worktree que contém o alvo; status 1 quando o alvo não é deste repositório (não é trabalho nele).
# Caminho rápido, sem processo git: alvo dentro do projeto e fora de .claude/worktrees/ (o caso comum).
# Senão: o topo do worktree do alvo vale se o `--git-common-dir` for o mesmo do projeto (mesmo repositório).
# Tudo entre aspas; nada do alvo é interpretado pelo shell nem vira opção do git (vai só depois de `-C`).
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
  topo=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  comum=$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  comum_projeto=$(git -C "$projeto" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ -n "$topo" ] && [ "$comum" = "$comum_projeto" ] || return 1
  printf '%s' "$topo"
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
