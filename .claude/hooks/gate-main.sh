#!/usr/bin/env bash
# Gate da main (issue #100): regra do dono, o Claude NUNCA faz merge, auto-merge nem push direto na `main`.
# Só `develop` e `homolog`. Hook PreToolUse: lê o JSON do hook no stdin (tool_name e tool_input).
#   exit 2 + mensagem no stderr = bloqueia; exit 0 = libera.
# Falha fechada: se não der para confirmar a base de um PR (gh falhou, resposta vazia, número ilegível), bloqueia.
# Promoção (issues #103 e #104): a homolog recebe a branch de trabalho, nunca a develop. Merge de PR com base
# `homolog` só passa se (a) a origem do PR não é a `develop`, (b) a ponta do PR já está na história da `develop`
# (compare develop...SHA = behind ou identical) e (c) o PR tem o rótulo `validada-develop` (skill `validar`).
# Consulta que falhou ou resposta ilegível em qualquer item bloqueia.
# QA (issue #110): merge de PR com base `develop` ou `homolog` só passa se o check-run `QA` da ponta (head sha)
# tem conclusão `success`. Consulta que falha, resposta vazia, sha ilegível, check ausente, `failure`, `in_progress`
# ou conclusão null bloqueiam. Na homolog o QA é consultado só depois da promoção.
# Branches protegidas (issue #116, defesa em profundidade da regra "o Claude não apaga branches"): apagar `main`,
# `develop` ou `homolog` bloqueia por `git push --delete`, `git push origin :ref`, `git branch -d/-D`,
# `git update-ref -d` e `gh api -X DELETE .../git/refs/heads/<ref>`. O ref pode vir como `heads/<ref>`, sem `refs/`
# (issue #124). O destino de apagar em variável (`git push origin :$VAR`) é bloqueado, porque não dá para conferir
# o valor (issue #124). O proxy já responde 403 ao DELETE; o hook barra antes, com a mensagem.
# Limites conhecidos (heurística sobre texto, não um parser de shell): `git push` sem destino com a main
# já checada fora, `gh pr edit --base main` e `gh api --input arquivo.json` não são inspecionados. Destino em variável
# que não apaga (`git push origin $BRANCH`, `HEAD:$X`) e `git update-ref -d $VAR` também não: o valor não é lido.
entrada=$(cat)

# Caminho comum: ferramenta que não é do GitHub MCP nem Bash sai aqui, sem abrir jq nem gh.
case "$entrada" in
  *mcp__github__*|*Bash*) ;;
  *) exit 0 ;;
esac

bloquear() {
  {
    printf 'GATE DA MAIN: bloqueado. %s\n' "$1"
    echo 'Regra do dono: o Claude nunca faz merge, auto-merge nem push na main; só develop e homolog.'
    echo 'A promoção para a main é feita pelo dono.'
  } >&2
  exit 2
}

eh_main() { [ "$1" = main ] || [ "$1" = refs/heads/main ]; }

# gh pode travar na rede: com `timeout` (coreutils) o hook não fica pendurado; sem ele, roda direto.
gh_cmd() {
  if command -v timeout >/dev/null 2>&1; then timeout 20 gh "$@"; else gh "$@"; fi
}

# Nomes de dono/repo vão para um caminho de API: só caracteres de nome (e as chaves do marcador {owner}/{repo}).
nome_valido() { [[ $1 =~ ^[A-Za-z0-9._{}-]+$ ]]; }

# Bloqueio da regra de promoção: mensagem própria, porque o motivo não é a main.
bloquear_validacao() {
  {
    printf 'GATE DE PROMOÇÃO: bloqueado. %s\n' "$1"
    echo 'A homolog recebe a branch de trabalho, já mergeada e validada na develop (skill validar), nunca a própria develop.'
  } >&2
  exit 2
}

# Bloqueio da regra de QA (issue #110): o check-run `QA` da ponta do PR precisa estar verde antes do merge.
bloquear_qa() {
  {
    printf 'GATE DE QA: bloqueado. %s\n' "$1"
    echo 'O job `QA` do workflow precisa estar verde na ponta do PR antes do merge.'
  } >&2
  exit 2
}

# O PR tem a homolog como base. Exige, nesta ordem: origem diferente da develop, ponta já na história da develop e
# rótulo `validada-develop`. Qualquer dúvida bloqueia. Argumentos: dono repo origem sha tem_rotulo(true|false)
exigir_promocao() {
  local status
  if ! nome_valido "$1" || ! nome_valido "$2" || ! [[ $3 =~ ^[A-Za-z0-9._/-]+$ ]] \
    || ! [[ $4 =~ ^[0-9a-fA-F]{7,64}$ ]] || ! [[ $5 =~ ^(true|false)$ ]]; then
    bloquear_validacao "não foi possível confirmar a promoção (dono, repositório, origem, commit da ponta ou rótulo do PR inválido)."
  fi
  if [ "$3" = develop ]; then
    bloquear_validacao "a homolog recebe a branch de trabalho, nunca a develop (origem do PR: develop)."
  fi
  if ! status=$(gh_cmd api "repos/$1/$2/compare/develop...$4" --jq .status 2>/dev/null) || [ -z "$status" ]; then
    bloquear_validacao "não foi possível comparar o commit ${4:0:12} com a develop; na dúvida, bloqueia."
  fi
  case "$status" in
    behind|identical) ;;
    *) bloquear_validacao "a branch precisa estar mergeada e validada na develop: o commit ${4:0:12} não está na história da develop (compare: $status)." ;;
  esac
  if [ "$5" != true ]; then
    bloquear_validacao "a branch precisa estar mergeada e validada na develop (rótulo validada-develop, skill validar): o PR não tem o rótulo."
  fi
}

# Exige o check-run `QA` da ponta com conclusão `success` (issue #110). Falha fechada: consulta que falha, resposta
# vazia, sha ilegível, check ausente, `failure`, `in_progress` ou conclusão null bloqueiam. Argumentos: dono repo sha
# Issue #121: com vários check-runs `QA` no mesmo sha decide o de maior `id` (o mais recente), não a ordem da lista.
# Um QA antigo cancelado não esconde nem derruba o mais novo; se o mais novo está vermelho ou em andamento, bloqueia.
exigir_qa() {
  local conclusao
  if ! nome_valido "$1" || ! nome_valido "$2" || ! [[ $3 =~ ^[0-9a-fA-F]{7,64}$ ]]; then
    bloquear_qa "não foi possível confirmar o check QA (dono, repositório ou commit da ponta inválido)."
  fi
  # O jq devolve a conclusão do check QA de maior id (max_by, o mais recente); sem check, ou sem conclusão no mais
  # recente, sai vazio. Check sem id (null) perde para qualquer id numérico; entre checks todos sem id, o jq
  # desempata pelo último da lista (a API sempre manda id, então é só a rede de segurança).
  if ! conclusao=$(gh_cmd api "repos/$1/$2/commits/$3/check-runs?check_name=QA&filter=latest" \
    --jq '[.check_runs[] | select(.name=="QA")] | max_by(.id) | .conclusion // ""' 2>/dev/null); then
    bloquear_qa "não foi possível consultar o check QA do commit ${3:0:12} (o gh falhou); na dúvida, bloqueia."
  fi
  case "$conclusao" in
    success) ;;
    '') bloquear_qa "o check QA do commit ${3:0:12} está ausente, sem conclusão ou em andamento." ;;
    *) bloquear_qa "o check QA do commit ${3:0:12} não passou (conclusão: $conclusao)." ;;
  esac
}

# Confere a base de um PR pela API. Qualquer dúvida bloqueia.
verificar_pr() { # dono repo numero
  local base dados ref sha rotulo
  if ! nome_valido "$1" || ! nome_valido "$2" || ! [[ $3 =~ ^[0-9]+$ ]]; then
    bloquear "não foi possível confirmar a base do PR (dono, repositório ou número ausente ou inválido)."
  fi
  if ! base=$(gh_cmd api "repos/$1/$2/pulls/$3" --jq .base.ref 2>/dev/null) || [ -z "$base" ]; then
    bloquear "não foi possível confirmar a base do PR #$3 (o gh falhou ou veio vazio); na dúvida, bloqueia."
  fi
  if eh_main "$base"; then
    bloquear "o PR #$3 tem a main como base."
  fi
  if [ "$base" = homolog ]; then
    # Uma consulta só para origem, ponta e rótulo (campos separados por tab; nome de branch não tem tab nem espaço).
    if ! dados=$(gh_cmd api "repos/$1/$2/pulls/$3" \
      --jq '[.head.ref, .head.sha, (((.labels // []) | map(.name) | index("validada-develop")) != null)] | @tsv' 2>/dev/null) \
      || [ -z "$dados" ]; then
      bloquear_validacao "não foi possível obter origem, ponta e rótulos do PR #$3 (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    IFS=$'\t' read -r ref sha rotulo <<<"$dados"
    exigir_promocao "$1" "$2" "$ref" "$sha" "$rotulo"
    # Depois da promoção: o QA só é consultado para um PR que já passou nela.
    exigir_qa "$1" "$2" "$sha"
  fi
  if [ "$base" = develop ]; then
    # A base veio sem a ponta: uma consulta a mais, só para o sha do QA.
    if ! sha=$(gh_cmd api "repos/$1/$2/pulls/$3" --jq .head.sha 2>/dev/null) || [ -z "$sha" ]; then
      bloquear_qa "não foi possível obter a ponta do PR #$3 (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    exigir_qa "$1" "$2" "$sha"
  fi
}

# Mesma checagem quando não há número (ramo ou PR do ramo atual) ou o -R não é "dono/repo".
verificar_pr_por_seletor() { # seletor repo
  local base dados ref sha rotulo dono_r repo_r args=(pr view)
  [ -n "$1" ] && args+=("$1")
  [ -n "$2" ] && args+=(-R "$2")
  if ! base=$(gh_cmd "${args[@]}" --json baseRefName --jq .baseRefName 2>/dev/null) || [ -z "$base" ]; then
    bloquear "não foi possível confirmar a base do PR (o gh falhou ou veio vazio); na dúvida, bloqueia."
  fi
  if eh_main "$base"; then
    bloquear "o PR tem a main como base."
  fi
  if [ "$base" = homolog ]; then
    if ! dados=$(gh_cmd "${args[@]}" --json headRefName,headRefOid,labels \
      --jq '[.headRefName, .headRefOid, (((.labels // []) | map(.name) | index("validada-develop")) != null)] | @tsv' 2>/dev/null) \
      || [ -z "$dados" ]; then
      bloquear_validacao "não foi possível obter origem, ponta e rótulos do PR (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    IFS=$'\t' read -r ref sha rotulo <<<"$dados"
    if [ -z "$2" ]; then
      exigir_promocao '{owner}' '{repo}' "$ref" "$sha" "$rotulo"
      exigir_qa '{owner}' '{repo}' "$sha"
    elif [[ $2 =~ ^([^/]+)/([^/]+)$ ]]; then
      dono_r=${BASH_REMATCH[1]} repo_r=${BASH_REMATCH[2]}  # copiado antes: as checagens seguintes sobrescrevem BASH_REMATCH
      exigir_promocao "$dono_r" "$repo_r" "$ref" "$sha" "$rotulo"
      exigir_qa "$dono_r" "$repo_r" "$sha"
    else
      bloquear_validacao "não foi possível confirmar a promoção (repositório '$2' fora do formato dono/repo)."
    fi
  elif [ "$base" = develop ]; then
    # Sem a ponta na consulta de base: pede o headRefOid. Mesma forma de dono/repo que a homolog usa acima.
    if [ -z "$2" ]; then
      dono_r='{owner}' repo_r='{repo}'
    elif [[ $2 =~ ^([^/]+)/([^/]+)$ ]]; then
      dono_r=${BASH_REMATCH[1]} repo_r=${BASH_REMATCH[2]}
    else
      bloquear_qa "não foi possível confirmar o check QA (repositório '$2' fora do formato dono/repo)."
    fi
    if ! sha=$(gh_cmd "${args[@]}" --json headRefOid --jq .headRefOid 2>/dev/null) || [ -z "$sha" ]; then
      bloquear_qa "não foi possível obter a ponta do PR (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    exigir_qa "$dono_r" "$repo_r" "$sha"
  fi
}

re_protegida='^(refs/heads/|origin/|refs/remotes/origin/)?(main|develop|homolog)$'
# Issue #124: o refspec de push aceita o ref sem `refs/` (`heads/develop`). Só o push ganha `heads/`: `git branch -D
# heads/develop` apaga uma branch local com esse nome, que não é a protegida, então segue com `re_protegida`.
re_protegida_push='^(refs/heads/|heads/|origin/|refs/remotes/origin/)?(main|develop|homolog)$'
# Issue #124: `update-ref -d` pede o nome completo da ref; `refs/remotes/origin/<protegida>` é a cópia remota.
re_ref_protegida='^(refs/)?(heads/)?(main|develop|homolog)$|^refs/remotes/origin/(main|develop|homolog)$'
# Issue #124: destino de apagar em variável (`:$VAR`, com `+` opcional). O valor não é lido, então não se confere.
re_apaga_variavel='^\+?:\$'

bloquear_apagar() {
  {
    printf 'GATE DE BRANCHES: bloqueado. %s\n' "$1"
    echo 'O Claude não apaga branches (develop, homolog e main nunca são apagadas); a limpeza é do dono (.claude/rules/github.md).'
  } >&2
  exit 2
}

re_destino_main='^\+?([^:]*:)?(refs/heads/)?main$'
re_base_json='(^|[^[:alnum:]_])base(RefName)?:[[:space:]]*(refs/heads/)?main([^[:alnum:]_./-]|$)'

analisar_git() {
  local a=("$@") j=0 tok
  # Pula as opções globais (git -C dir push ...) até o subcomando.
  while [ "$j" -lt "${#a[@]}" ]; do
    case "${a[j]}" in
      -C|-c|--git-dir|--work-tree|--namespace) j=$((j + 2)) ;;
      -*) j=$((j + 1)) ;;
      *) break ;;
    esac
  done
  if [ "${a[j]:-}" = branch ]; then
    local apaga=0
    for tok in "${a[@]:j+1}"; do
      if [[ $tok == --delete || $tok =~ ^-[a-zA-Z]*[dD][a-zA-Z]*$ ]]; then apaga=1; fi
    done
    if [ "$apaga" = 1 ]; then
      for tok in "${a[@]:j+1}"; do
        if [[ $tok =~ $re_protegida ]]; then bloquear_apagar "git branch apagando a branch protegida $tok."; fi
      done
    fi
    return 0
  fi
  # Issue #124: `update-ref -d` apaga a ref sem passar pelo push; qualquer argumento protegido bloqueia.
  if [ "${a[j]:-}" = update-ref ]; then
    local apaga_ref=0
    for tok in "${a[@]:j+1}"; do
      if [[ $tok == --delete || $tok =~ ^-[a-zA-Z]*d[a-zA-Z]*$ ]]; then apaga_ref=1; fi
    done
    if [ "$apaga_ref" = 1 ]; then
      for tok in "${a[@]:j+1}"; do
        if [[ $tok =~ $re_ref_protegida ]]; then bloquear_apagar "git update-ref -d na branch protegida $tok."; fi
      done
    fi
    return 0
  fi
  [ "${a[j]:-}" = push ] || return 0
  local apaga_push=0
  for tok in "${a[@]:j+1}"; do
    if [[ $tok == --delete || $tok =~ ^-[a-zA-Z]*d[a-zA-Z]*$ ]]; then apaga_push=1; fi
  done
  for tok in "${a[@]:j+1}"; do
    case "$tok" in
      -*) ;;
      *)
        if [[ $tok =~ $re_apaga_variavel ]]; then bloquear_apagar "git push apagando por variável ($tok): o destino não dá para conferir."; fi
        if [[ ${tok#+} =~ ^:(refs/)?(heads/)?(main|develop|homolog)$ ]]; then bloquear_apagar "git push apagando a branch protegida (${tok#*:})."; fi
        if [ "$apaga_push" = 1 ] && [[ $tok =~ $re_protegida_push ]]; then bloquear_apagar "git push --delete na branch protegida $tok."; fi
        ;;
    esac
  done
  for tok in "${a[@]:j+1}"; do
    case "$tok" in
      --all|--mirror) bloquear "git push $tok pode atualizar a main." ;;
      -*) ;;
      *)
        # Fronteira exata: `main`, `HEAD:main`, `:refs/heads/main`, `+main`; `maintenance` e `feature/main-menu` passam.
        if [[ $tok =~ $re_destino_main ]]; then bloquear "git push com destino na main ($tok)."; fi
        ;;
    esac
  done
}

analisar_gh() {
  local a=("$@") j=0 tok repo="" metodo="" tem_input=0 pos=() campos=()
  while [ "$j" -lt "${#a[@]}" ]; do
    tok=${a[j]}
    case "$tok" in
      -R|--repo) repo=${a[j+1]:-}; j=$((j + 2)); continue ;;
      --repo=*) repo=${tok#*=} ;;
      -X|--method) metodo=${a[j+1]:-}; j=$((j + 2)); continue ;;
      --method=*) metodo=${tok#*=} ;;
      -X?*) metodo=${tok#-X} ;;
      -f|-F|--field|--raw-field) campos+=("${a[j+1]:-}"); j=$((j + 2)); continue ;;
      --field=*|--raw-field=*) campos+=("${tok#*=}") ;;
      --input) tem_input=1; j=$((j + 2)); continue ;;
      --input=*) tem_input=1 ;;
      # Opções que levam valor: o valor não pode ser tomado por argumento posicional.
      -b|--body|--body-file|-t|--subject|--template|--match-head-commit|-A|--author-email|-H|--header|-q|--jq|--hostname|--cache|-p|--preview)
        j=$((j + 2)); continue ;;
      -*) ;;
      *) pos+=("$tok") ;;
    esac
    j=$((j + 1))
  done

  case "${pos[0]:-}" in
    pr)
      [ "${pos[1]:-}" = merge ] && gh_pr_merge "${pos[2]:-}" "$repo"
      ;;
    api)
      # Sem -X, o gh api usa POST quando há campos ou corpo; é o que ele realmente enviaria.
      if [ -z "$metodo" ]; then
        if [ "${#campos[@]}" -gt 0 ] || [ "$tem_input" = 1 ]; then metodo=POST; else metodo=GET; fi
      fi
      metodo=$(printf '%s' "$metodo" | tr '[:lower:]' '[:upper:]')
      gh_api "${pos[1]:-}" "$metodo" "${campos[@]}"
      ;;
  esac
}

gh_pr_merge() { # seletor repo   (cobre `gh pr merge` com ou sem --auto)
  local sel=$1 repo=$2
  if [[ $sel =~ ^https?://[^/]+/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    verificar_pr "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
  elif [[ $sel =~ ^#?([0-9]+)$ ]]; then
    local n=${BASH_REMATCH[1]}
    if [ -z "$repo" ]; then
      verificar_pr '{owner}' '{repo}' "$n"  # o próprio gh troca os marcadores pelo repositório atual
    elif [[ $repo =~ ^([^/]+)/([^/]+)$ ]]; then
      verificar_pr "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$n"
    else
      verificar_pr_por_seletor "$sel" "$repo"
    fi
  else
    verificar_pr_por_seletor "$sel" "$repo"
  fi
}

gh_api() { # endpoint metodo [campos...]
  local ep=${1%%\?*} metodo=$2 c
  shift 2
  # GraphQL não expõe a base na linha de comando: as mutações de merge são bloqueadas de saída.
  if [ "$ep" = graphql ] && [[ $SEG =~ mergePullRequest|enablePullRequestAutoMerge ]]; then
    bloquear "mutação GraphQL de merge de PR."
  fi
  if [ "$ep" = graphql ] && [[ $SEG =~ deleteRef ]]; then
    bloquear_apagar "mutação GraphQL deleteRef (apagar branch)."
  fi
  # Apagar branch protegida pela API de refs (inclui o `/` codificado como %2F).
  if [ "$metodo" = DELETE ] && [[ $ep =~ /git/refs/(heads(/|%2[Ff]))(main|develop|homolog)$ ]]; then
    bloquear_apagar "gh api DELETE na branch protegida ${BASH_REMATCH[3]}."
  fi
  case "$metodo" in PUT|POST|PATCH) ;; *) return 0 ;; esac
  # (d) mudar a base para a main, por campo (-f base=main) ou por JSON ("base": "main").
  for c in "$@"; do
    if [[ $c =~ ^base(RefName)?=(refs/heads/)?main$ ]]; then bloquear "gh api mudando a base para a main."; fi
  done
  if [[ $SEG =~ $re_base_json ]]; then bloquear "gh api mudando a base para a main."; fi
  # (c) merge e auto-merge de PR: confere a base do PR.
  if [[ $ep =~ (merge|auto_merge)$ ]]; then
    if [[ $ep =~ ^/?repos/([^/]+)/([^/]+)/pulls/([0-9]+)/ ]]; then
      verificar_pr "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    else
      bloquear "não foi possível confirmar a base do PR em '$ep'."
    fi
  fi
}

# Cada segmento (separado por ; | & parênteses ou crase) é analisado à parte; aspas saem antes de separar.
analisar_comando() {
  local cmd=$1 t i n
  local segmentos
  segmentos=$(printf '%s\n' "$cmd" | tr -d "'\"" | tr '&;|()`' '\n')
  while IFS= read -r SEG; do
    read -ra t <<<"$SEG"
    n=${#t[@]}
    i=0
    # Pula o que vem antes do comando de verdade: variáveis de ambiente, sudo, bash -c, then/do...
    while [ "$i" -lt "$n" ]; do
      case "${t[i]}" in
        *=*|sudo|command|env|time|nohup|exec|eval|bash|sh|zsh|-c|-lc|if|then|do|else|while|until|'!'|xargs|'$') i=$((i + 1)) ;;
        *) break ;;
      esac
    done
    [ "$i" -lt "$n" ] || continue
    case "${t[i]##*/}" in
      git) analisar_git "${t[@]:i+1}" ;;
      gh) analisar_gh "${t[@]:i+1}" ;;
    esac
  done <<<"$segmentos"
}

command -v jq >/dev/null 2>&1 || bloquear "o jq não está instalado; sem ele não dá para inspecionar a chamada."

# Um jq só: campos separados por \u001f (não é espaço, então campo vazio é preservado); o comando vai por último.
campos=$(printf '%s' "$entrada" | jq -r '
  def s: (. // "") | tostring;
  [ (.tool_name | s), (.tool_input.owner | s), (.tool_input.repo | s), (.tool_input.pullNumber | s),
    (.tool_input.branch | s), (.tool_input.base | s), (.tool_input.command | s) ] | join("\u001f")') \
  || bloquear "não foi possível ler a chamada da ferramenta (JSON inválido)."
IFS=$'\x1f' read -r -d '' ferramenta dono repo numero ramo base_nova comando <<<"$campos"

case "$ferramenta" in
  mcp__github__merge_pull_request|mcp__github__enable_pr_auto_merge)
    verificar_pr "$dono" "$repo" "$numero"
    ;;
  mcp__github__create_or_update_file|mcp__github__push_files|mcp__github__delete_file)
    if eh_main "$ramo"; then bloquear "escrita direta na branch main pelo GitHub MCP."; fi
    ;;
  mcp__github__update_pull_request)
    if eh_main "$base_nova"; then bloquear "mudança da base do PR para a main."; fi
    ;;
  Bash)
    # Só entra no analisador (e só então no gh) quando o comando fala de git ou gh.
    case "$comando" in
      *git*|*gh*) analisar_comando "$comando" ;;
    esac
    ;;
esac
exit 0
