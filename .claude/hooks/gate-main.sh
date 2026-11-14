#!/usr/bin/env bash
# Gate da main (issues #100 e #224): a main só recebe, pelo Claude, o merge da homolog com as duas validações e checks
# verdes; push direto, outra origem, squash/rebase, auto-merge: bloqueados. Hook PreToolUse: lê o JSON do hook no
# stdin (tool_name e tool_input).
#   exit 2 + mensagem no stderr = bloqueia; exit 0 = libera.
# Falha fechada: se não der para confirmar a base de um PR (gh falhou, resposta vazia, número ilegível), bloqueia.
# Via estreita da main (issue #224, `.claude/rules/github.md`): merge de PR com base `main` só passa se TODAS valem:
# (1) origem (head.ref) é exatamente `homolog` e do próprio repositório, não de fork (head.repo.full_name igual ao do
# base; no `gh pr view`, isCrossRepository false); (2) rótulos `validada-develop` e `validada-homolog`; (3) mergeable_state
# `clean` (no `gh pr view`, mergeStateStatus CLEAN); (4) check-run `QA` da ponta em success e todos os check-runs da
# ponta completos com success/neutral/skipped (total_count > 0 e dentro da primeira página, senão bloqueia);
# (5) método explícito merge commit (`gh pr merge --merge`, `gh api -f merge_method=merge`);
# (6) auto-merge e `gh pr merge --delete-branch` na main bloqueiam sempre (também com `=valor`). `gh api --input` na
# main bloqueia (o corpo do arquivo decide o método). Consulta que falha bloqueia.
# Ainda na via estreita: o check-run `Validação (homolog)` precisa existir na ponta com success (QA e ele: só success);
# o merge traz a ponta conferida (`--match-head-commit`, `-f sha=`) igual à ponta atual do PR; `gh pr merge --admin`
# bloqueia em qualquer base. O GitHub MCP não prende a ponta: `merge_pull_request` e `enable_pr_auto_merge` com base
# `main` bloqueiam sempre (em develop e homolog seguem como antes); o caminho único é o gh com a ponta.
# Tempo: o hook roda no máximo 4 `gh` de 15 s na via da main; o `.claude/settings.json` dá 120 s às duas entradas do
# gate-main (hook morto por tempo deixa a ferramenta seguir: falha aberta).
# Escrita direta: `git push` com destino `heads/main`, sem refspec ou com destino `HEAD`/`@`/vazio estando na main (um
# `git symbolic-ref -q --short HEAD` no diretório do hook, ou no do `-C`; falha da consulta bloqueia, HEAD destacado
# passa), com refspec curinga ou `:`; `\` no fim da linha é juntado antes de segmentar; `gh api` em /merges (base main, de arquivo ou ausente) e em
# /contents (PUT/DELETE sem `branch=` ou com `branch=` main ou de arquivo); GraphQL createCommitOnBranch, updateRef(s)
# e createRef.
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
# (issue #124). O proxy já responde 403 ao DELETE; o hook barra antes, com a mensagem.
# Apagar com destino em variável é bloqueado (issue #124), porque o valor não dá para conferir: `git push origin
# :$VAR` (com `+` opcional), qualquer argumento com `$` num `git push --delete`/`-d` e `gh api -X DELETE` cujo
# endpoint de branch (`/git/refs/heads`) tem `$`.
# Limites conhecidos (heurística sobre texto, não um parser de shell): `gh pr edit --base main` não é inspecionado
# (`gh api --input` na main bloqueia). Também fora: `\gh`, wrappers raros (nice, stdbuf), `push.default=upstream` ou
# `branch.<x>.merge` apontando para a main com o checkout em outro branch, e a corrida entre a checagem e o merge (a
# sessão de PR passa `--match-head-commit`, ver skill `pr`). Também fora, por serem evasão deliberada: `curl` com
# `$(gh auth token)` na API, `gh alias`/`git alias`, `GH_REPO=` ou `cd` para outro clone antes de `gh pr merge` sem
# número, `git -c remote.origin.push=...` e `//` no meio do endpoint.
# Também não são verificados, porque o valor da variável não é lido: `git push origin "$SRC:$DST"` (apaga DST se
# SRC estiver vazio, sem `--delete`), destino em variável que não apaga (`git push origin $BRANCH`, `HEAD:$X`),
# `git update-ref -d $VAR` e `git branch -D $VAR`. Um `refs/remotes/origin/<outra>` apagado por update-ref passa.
# Também fora, vistos na revisão: `cd <checkout na main> && git push` e `git --git-dir=`/`--work-tree` (o branch atual é
# resolvido no diretório em que o hook roda, ou no do `-C`; um `cd` ou `--git-dir` no mesmo comando não é seguido, então
# um `git push` sem destino passa se o checkout do hook não for a main). O valor de `-o`/`--push-option` (também em
# opções curtas agrupadas, `-uo x`; e de `--repo`, `--receive-pack`, `--exec`) é pulado antes de contar refspecs; antes
# disso `git push -o x origin` contava `origin`
# como refspec e deixava passar um push sem destino com o checkout na main.
# Prazo global (falha aberta se o hook estourar o `timeout` de 120 s do settings.json): o relógio (`SECONDS`) corre desde
# o início; passados `GATE_MAIN_PRAZO` s (padrão e TETO de 90: valor maior, não numérico, vazio, zero ou negativo vira 90;
# a variável existe para os testes), `gh_cmd` e `git_cmd` falham sem chamar o programa e todo chamador bloqueia ("prazo
# do hook esgotado"). Antes disso, cada chamada tem min(15, prazo + 10 - SECONDS) s (piso 1), então o total nunca passa de
# uns 100 s, qualquer que seja o número de segmentos (`a && b && c`). `GATE_MAIN_SECONDS_FAKE` soma segundos ao relógio
# (só os testes o usam, para simular o tempo passado sem esperar; só pode deixar o hook mais restritivo).
# Limite: o limite POR CHAMADA vem do binário `timeout` (coreutils). Sem ele (macOS sem coreutils) o gh/git roda sem
# limite próprio: o prazo só vale ENTRE as chamadas, e um gh pendurado ainda pode estourar os 120 s do settings.json.
SECONDS=0
PRAZO=${GATE_MAIN_PRAZO:-90}
if [[ $PRAZO =~ ^[0-9]{1,4}$ ]]; then PRAZO=$((10#$PRAZO)); else PRAZO=90; fi
[ "$PRAZO" -ge 1 ] || PRAZO=90
[ "$PRAZO" -le 90 ] || PRAZO=90
ADIANTO=${GATE_MAIN_SECONDS_FAKE:-0}
if [[ $ADIANTO =~ ^[0-9]{1,4}$ ]]; then ADIANTO=$((10#$ADIANTO)); else ADIANTO=0; fi
entrada=$(cat)

# Caminho comum: ferramenta que não é do GitHub MCP nem Bash sai aqui, sem abrir jq nem gh.
case "$entrada" in
  *mcp__github__*|*Bash*) ;;
  *) exit 0 ;;
esac

# Acrescenta à mensagem de bloqueio o motivo real quando o que falhou foi o prazo global (ver o cabeçalho).
nota_prazo() {
  if [ $((SECONDS + ADIANTO)) -ge "$PRAZO" ]; then
    echo "Prazo do hook esgotado ($((SECONDS + ADIANTO)) s de $PRAZO s): as consultas seguintes não rodam e a chamada é bloqueada; divida o comando em chamadas menores."
  fi
}

bloquear() {
  {
    printf 'GATE DA MAIN: bloqueado. %s\n' "$1"
    echo 'A main só recebe, pelo Claude, o merge da homolog com as duas validações e checks verdes; push direto, outra origem, squash/rebase e auto-merge ficam bloqueados.'
    echo 'Fora da via estreita (.claude/rules/github.md), a promoção para a main é feita pelo dono.'
    nota_prazo
  } >&2
  exit 2
}

# Bloqueio da via estreita da main (issue #224): mesma sigla do gate da main, mas diz o que a via exige.
bloquear_main_promocao() {
  {
    printf 'GATE DA MAIN: bloqueado. %s\n' "$1"
    echo 'Via estreita da main (.claude/rules/github.md): só o merge da homolog, com validada-develop e validada-homolog, mergeable_state clean, checks verdes e merge commit.'
    echo 'Auto-merge, --delete-branch, squash, rebase e outra origem ficam bloqueados; fora dessa via, a promoção para a main é do dono.'
    nota_prazo
  } >&2
  exit 2
}

eh_main() { [ "$1" = main ] || [ "$1" = refs/heads/main ]; }

# Tempo que ainda cabe a UMA chamada: no máximo 15 s e, perto do fim do prazo, o que resta até prazo + 10 s (piso 1).
# Assim a soma de todas as chamadas do hook, em qualquer número de segmentos, fica abaixo do `timeout` de 120 s das
# duas entradas do gate-main no .claude/settings.json (hook morto por tempo deixa a ferramenta seguir: falha aberta).
tempo_da_chamada() {
  local t=$((PRAZO + 10 - SECONDS - ADIANTO))
  [ "$t" -gt 15 ] && t=15
  [ "$t" -lt 1 ] && t=1
  echo "$t"
}

# gh pode travar na rede: com `timeout` (coreutils) o hook não fica pendurado. SEM o binário `timeout` (macOS sem
# coreutils) o gh roda sem limite próprio: o prazo global só vale entre as chamadas (ver o cabeçalho). Esgotado o prazo
# global, falha (status 124, como o timeout) sem chamar o gh, e todo chamador bloqueia. A via da main faz no máximo 4
# chamadas por PR (base, origem/rótulos/estado, QA, todos os check-runs); um teste confere a conta.
gh_cmd() {
  if [ $((SECONDS + ADIANTO)) -ge "$PRAZO" ]; then return 124; fi
  if command -v timeout >/dev/null 2>&1; then timeout "$(tempo_da_chamada)" gh "$@"; else gh "$@"; fi
}

# Mesmo cuidado para o git que resolve o branch atual (um processo só, local). O status 124 do prazo esgotado NÃO é o
# 1 do HEAD destacado, então o chamador bloqueia em vez de deixar passar.
git_cmd() {
  if [ $((SECONDS + ADIANTO)) -ge "$PRAZO" ]; then return 124; fi
  if command -v timeout >/dev/null 2>&1; then timeout "$(tempo_da_chamada)" git "$@"; else git "$@"; fi
}

# Nomes de dono/repo vão para um caminho de API: só caracteres de nome (e as chaves do marcador {owner}/{repo}).
nome_valido() { [[ $1 =~ ^[A-Za-z0-9._{}-]+$ ]]; }

# Bloqueio da regra de promoção: mensagem própria, porque o motivo não é a main.
bloquear_validacao() {
  {
    printf 'GATE DE PROMOÇÃO: bloqueado. %s\n' "$1"
    echo 'A homolog recebe a branch de trabalho, já mergeada e validada na develop (skill validar), nunca a própria develop.'
    nota_prazo
  } >&2
  exit 2
}

# Bloqueio da regra de QA (issue #110): o check-run `QA` da ponta do PR precisa estar verde antes do merge.
bloquear_qa() {
  {
    printf 'GATE DE QA: bloqueado. %s\n' "$1"
    echo 'O job `QA` do workflow precisa estar verde na ponta do PR antes do merge.'
    nota_prazo
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

# Via estreita da main (issue #224), parte local: não consulta nada. Argumentos: modo(merge|auto|mcp) metodo
# apaga(0|1) sha_esperado. Pelo MCP (modo mcp), auto-merge e apagar a branch de origem (que seria a homolog) nunca
# passam; o método tem de ser explicitamente merge; e o merge tem de trazer a ponta conferida (--match-head-commit,
# sha=), para que um push depois da conferência não entre sem checagem (a comparação com a ponta atual está em
# exigir_promocao_main).
exigir_metodo_main() {
  # O merge_pull_request do servidor MCP do GitHub não prende a ponta (não existe um expectedHeadSha de verdade) e o
  # enable_pr_auto_merge é auto-merge: pelo MCP, a main fica bloqueada sempre. O caminho único é o gh com a ponta.
  if [ "$1" = mcp ]; then
    bloquear_main_promocao "o merge na main não passa pelo GitHub MCP (ele não prende a ponta conferida): use gh pr merge <N> --merge --match-head-commit <sha> (ou gh api -X PUT repos/o/r/pulls/N/merge -f sha=<sha> -f merge_method=merge)."
  fi
  if [ "$1" = auto ]; then
    bloquear_main_promocao "auto-merge em PR com a main como base é sempre bloqueado."
  fi
  if [ "$3" = 1 ]; then
    bloquear_main_promocao "--delete-branch em PR com a main como base apagaria a homolog."
  fi
  if [ "$2" != merge ]; then
    bloquear_main_promocao "o merge na main exige o método explícito merge commit (recebido: ${2:-ausente})."
  fi
  if [ -z "$4" ]; then
    bloquear_main_promocao "o merge na main exige informar a ponta do PR: passe a ponta conferida em --match-head-commit (gh pr merge) ou -f sha= (gh api)."
  fi
}

# Exige que TODOS os check-runs da ponta estejam completos e com success, neutral ou skipped (issue #224). Falha
# fechada: consulta que falha, total_count ausente ou zero, paginação (total_count maior que os itens da primeira
# página de 100) e qualquer check pendente, cancelado, failure ou sem conclusão bloqueiam. Os obrigatórios, `QA` e
# `Validação (homolog)` (job do validacao.yml), valem só com `success` (skipped e neutral não) e, havendo mais de um
# com o mesmo nome, decide o de maior id; o `Validação (homolog)` ausente ou em andamento também bloqueia.
# Argumentos: dono repo sha
exigir_checks_verdes() {
  local dados total itens ruins validacao
  if ! dados=$(gh_cmd api "repos/$1/$2/commits/$3/check-runs?filter=latest&per_page=100" \
    --jq 'def ok: . == "success" or . == "neutral" or . == "skipped";
      ["QA", "Validação (homolog)"] as $obr
      | (.check_runs // []) as $r
      | [(.total_count // 0), ($r | length),
         ([($r[] | .name as $n | select(($obr | index($n)) == null)
             | select(.status != "completed" or ((.conclusion // "") | ok | not))),
           ($obr[] as $o | [$r[] | select(.name == $o)] | (if length == 0 then {} else max_by(.id) end)
             | select(.status != "completed" or .conclusion != "success"))] | length),
         ([$r[] | select(.name == "Validação (homolog)")] | (if length == 0 then null else max_by(.id) end)
             | if . == null then "ausente" elif .status != "completed" then "em-andamento" else (.conclusion // "sem-conclusao") end)
        ] | @tsv' \
    2>/dev/null) || [ -z "$dados" ]; then
    bloquear_qa "não foi possível consultar todos os check-runs do commit ${3:0:12} (o gh falhou ou veio vazio); na dúvida, bloqueia."
  fi
  IFS=$'\t' read -r total itens ruins validacao <<<"$dados"
  if ! [[ $total =~ ^[0-9]+$ ]] || ! [[ $itens =~ ^[0-9]+$ ]] || ! [[ $ruins =~ ^[0-9]+$ ]]; then
    bloquear_qa "resposta ilegível na consulta dos check-runs do commit ${3:0:12}."
  fi
  if [ "$total" -le 0 ]; then
    bloquear_qa "o commit ${3:0:12} não tem check-runs."
  fi
  if [ "$total" -gt "$itens" ]; then
    bloquear_qa "os check-runs do commit ${3:0:12} não cabem numa página (total $total, recebidos $itens); na dúvida, bloqueia."
  fi
  if [ "$validacao" != success ]; then
    bloquear_qa "o check-run 'Validação (homolog)' do commit ${3:0:12} precisa existir com conclusão success (situação: ${validacao:-ausente})."
  fi
  if [ "$ruins" -gt 0 ]; then
    bloquear_qa "$ruins check-run(s) do commit ${3:0:12} estão pendentes, cancelados ou falharam; todos precisam de success, neutral ou skipped (QA e Validação (homolog): só success)."
  fi
}

# Via estreita da main (issue #224), parte que depende do PR. Qualquer dúvida bloqueia, na ordem barata para cara:
# origem (nome e repositório), rótulos, mergeable_state, QA e todos os check-runs. Argumentos: dono repo origem sha
# rotulo_develop rotulo_homolog estado(em minúsculas) mesmo_repo(true|false: a origem não é de fork; ausente = false)
# sha_esperado (a ponta que o chamador conferiu; tem de ser igual à ponta atual do PR, sem abreviar)
exigir_promocao_main() {
  local esperado atual
  if ! nome_valido "$1" || ! nome_valido "$2" || ! [[ $3 =~ ^[A-Za-z0-9._/-]+$ ]] \
    || ! [[ $4 =~ ^[0-9a-fA-F]{7,64}$ ]] || ! [[ $5 =~ ^(true|false)$ ]] || ! [[ $6 =~ ^(true|false)$ ]] \
    || ! [[ $8 =~ ^(true|false)$ ]]; then
    bloquear_main_promocao "não foi possível confirmar a promoção (dono, repositório, origem, commit da ponta, rótulos ou repositório de origem do PR inválidos)."
  fi
  if [ "$3" != homolog ]; then
    bloquear_main_promocao "a main só recebe a homolog (origem do PR: $3)."
  fi
  # Um fork pode ter uma branch chamada homolog; só a homolog do próprio repositório vale.
  if [ "$8" != true ]; then
    bloquear_main_promocao "a origem do PR é de outro repositório (fork) ou não deu para confirmar o repositório de origem."
  fi
  if [ "$5" != true ]; then
    bloquear_main_promocao "o PR não tem o rótulo validada-develop."
  fi
  if [ "$6" != true ]; then
    bloquear_main_promocao "o PR não tem o rótulo validada-homolog."
  fi
  if [ "$7" != clean ]; then
    bloquear_main_promocao "o PR não está limpo para merge (mergeable_state: $7; precisa ser clean)."
  fi
  # Comparação exata, em minúsculas: um push novo depois da conferência muda a ponta e o merge não passa.
  esperado=$(printf '%s' "${9:-}" | tr '[:upper:]' '[:lower:]')
  atual=$(printf '%s' "$4" | tr '[:upper:]' '[:lower:]')
  if [ -z "$esperado" ] || [ "$esperado" != "$atual" ]; then
    bloquear_main_promocao "a ponta informada (${esperado:0:12}) não é a ponta atual do PR (${atual:0:12}); passe a ponta conferida (--match-head-commit ou -f sha=)."
  fi
  exigir_qa "$1" "$2" "$4"
  exigir_checks_verdes "$1" "$2" "$4"
}

# Confere a base de um PR pela API. Qualquer dúvida bloqueia.
# Argumentos: dono repo numero modo(merge|auto) metodo_de_merge apaga_branch(0|1) sha_esperado; os quatro últimos só
# valem na main.
verificar_pr() {
  local base dados ref sha rotulo rot_hom estado mesmo_repo
  if ! nome_valido "$1" || ! nome_valido "$2" || ! [[ $3 =~ ^[0-9]+$ ]]; then
    bloquear "não foi possível confirmar a base do PR (dono, repositório ou número ausente ou inválido)."
  fi
  if ! base=$(gh_cmd api "repos/$1/$2/pulls/$3" --jq .base.ref 2>/dev/null) || [ -z "$base" ]; then
    bloquear "não foi possível confirmar a base do PR #$3 (o gh falhou ou veio vazio); na dúvida, bloqueia."
  fi
  if eh_main "$base"; then
    exigir_metodo_main "$4" "$5" "$6" "$7"
    # Uma consulta só para origem, ponta, os dois rótulos e o estado de merge (campos separados por tab; o jq troca
    # campo ausente por "-" porque o tab é separador de espaço em branco e juntaria campos vazios). O último campo diz
    # se a origem é do mesmo repositório da base (fork não vale); repositório ausente ou null dá false.
    if ! dados=$(gh_cmd api "repos/$1/$2/pulls/$3" \
      --jq '((.labels // []) | map(.name)) as $l
        | [(.head.ref // "-"), (.head.sha // "-"), (($l | index("validada-develop")) != null),
           (($l | index("validada-homolog")) != null), (.mergeable_state // "-"),
           ((.head.repo.full_name // null) as $h | (.base.repo.full_name // null) as $b | ($h != null and $h == $b))] | @tsv' 2>/dev/null) \
      || [ -z "$dados" ]; then
      bloquear_main_promocao "não foi possível obter origem, ponta, rótulos e estado do PR #$3 (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    IFS=$'\t' read -r ref sha rotulo rot_hom estado mesmo_repo <<<"$dados"
    exigir_promocao_main "$1" "$2" "$ref" "$sha" "$rotulo" "$rot_hom" "$estado" "$mesmo_repo" "$7"
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
# Argumentos: seletor repo modo(merge|auto) metodo_de_merge apaga_branch(0|1) sha_esperado; os quatro últimos só valem
# na main.
verificar_pr_por_seletor() {
  local base dados ref sha rotulo rot_hom estado mesmo_repo dono_r repo_r args=(pr view)
  [ -n "$1" ] && args+=("$1")
  [ -n "$2" ] && args+=(-R "$2")
  if ! base=$(gh_cmd "${args[@]}" --json baseRefName --jq .baseRefName 2>/dev/null) || [ -z "$base" ]; then
    bloquear "não foi possível confirmar a base do PR (o gh falhou ou veio vazio); na dúvida, bloqueia."
  fi
  if eh_main "$base"; then
    exigir_metodo_main "$3" "$4" "$5" "$6"
    if [ -z "$2" ]; then
      dono_r='{owner}' repo_r='{repo}'
    elif [[ $2 =~ ^([^/]+)/([^/]+)$ ]]; then
      dono_r=${BASH_REMATCH[1]} repo_r=${BASH_REMATCH[2]}
    else
      bloquear_main_promocao "não foi possível confirmar a promoção (repositório '$2' fora do formato dono/repo)."
    fi
    # mergeStateStatus do gh equivale ao mergeable_state da API (CLEAN = clean); o jq já o põe em minúsculas.
    # isCrossRepository só vale como "mesmo repositório" se for exatamente false (ausente ou null bloqueia).
    if ! dados=$(gh_cmd "${args[@]}" --json headRefName,headRefOid,labels,mergeStateStatus,isCrossRepository \
      --jq '((.labels // []) | map(.name)) as $l
        | [(.headRefName // "-"), (.headRefOid // "-"), (($l | index("validada-develop")) != null),
           (($l | index("validada-homolog")) != null), ((.mergeStateStatus // "-") | ascii_downcase),
           (.isCrossRepository == false)] | @tsv' 2>/dev/null) \
      || [ -z "$dados" ]; then
      bloquear_main_promocao "não foi possível obter origem, ponta, rótulos e estado do PR (o gh falhou ou veio vazio); na dúvida, bloqueia."
    fi
    IFS=$'\t' read -r ref sha rotulo rot_hom estado mesmo_repo <<<"$dados"
    exigir_promocao_main "$dono_r" "$repo_r" "$ref" "$sha" "$rotulo" "$rot_hom" "$estado" "$mesmo_repo" "$6"
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

# Aceita o ref sem `refs/` (`heads/main`): o git expande `heads/main` para `refs/heads/main` no destino do push.
re_destino_main='^\+?([^:]*:)?(refs/heads/|heads/)?main$'
re_base_json='(^|[^[:alnum:]_])base(RefName)?:[[:space:]]*(refs/heads/)?main([^[:alnum:]_./-]|$)'

analisar_git() {
  local a=("$@") j=0 tok gc=()
  # Pula as opções globais (git -C dir push ...) até o subcomando; os `-C dir` ficam guardados para o git que
  # resolve o branch atual rodar no mesmo diretório que o push rodaria.
  while [ "$j" -lt "${#a[@]}" ]; do
    case "${a[j]}" in
      -C) gc+=(-C "${a[j+1]:-}"); j=$((j + 2)) ;;
      -c|--git-dir|--work-tree|--namespace) j=$((j + 2)) ;;
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
        # Issue #124 (revisão): com --delete/-d, qualquer argumento com `$` (remoto ou ref) não dá para conferir.
        if [ "$apaga_push" = 1 ] && [[ $tok == *'$'* ]]; then bloquear_apagar "git push --delete/-d com variável ($tok): o nome da branch não dá para conferir."; fi
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
  # Destino que o texto não diz: sem refspec (`git push`, `git push origin`, `-u origin`) ou com destino `HEAD`, `@` ou
  # vazio (`HEAD:`) o push vai para o branch atual, e com o checkout na main isso é push direto na main. Refspec com
  # curinga (`refs/heads/*:refs/heads/*`) e `:` (todas as branches de mesmo nome) não dá para conferir e bloqueiam.
  # O valor separado de `-o`/`--push-option`, `--repo`, `--receive-pack` e `--exec` não é refspec: é pulado (na forma
  # `--opção=valor` ele já é um token só, que começa com `-`).
  local npos=0 resolve=0 so_info=0 spec dest atual st k=0 b=("${a[@]:j+1}")
  while [ "$k" -lt "${#b[@]}" ]; do
    tok=${b[k]}
    case "$tok" in
      # `-o` também no fim de opções curtas agrupadas (`-uo x`): a letra `o` por último leva o valor seguinte.
      -o|-[a-zA-Z]*o|--push-option|--repo|--receive-pack|--exec) k=$((k + 1)) ;;
      --tags|--help|-h) so_info=1 ;;
      -*) ;;
      *)
        npos=$((npos + 1))
        if [[ $tok == *'*'* ]]; then bloquear "git push com refspec curinga ($tok): não dá para conferir se atinge a main."; fi
        spec=${tok#+}
        if [ "$spec" = : ]; then bloquear "git push com o refspec ':' (todas as branches de mesmo nome) pode atualizar a main."; fi
        if [[ $spec == *:* ]]; then dest=${spec#*:}; else dest=$spec; fi
        case "$dest" in HEAD|@|'') resolve=1 ;; esac
        ;;
    esac
    k=$((k + 1))
  done
  if [ "$npos" -le 1 ] && [ "$apaga_push" = 0 ] && [ "$so_info" = 0 ]; then resolve=1; fi
  if [ "$resolve" = 1 ]; then
    # `-q`: HEAD destacado sai com status 1 e sem texto (não é a main, passa); qualquer outra falha (fora de um
    # repositório, git ausente, tempo ou prazo global esgotado: status 124) é dúvida e bloqueia.
    atual=$(git_cmd "${gc[@]}" symbolic-ref -q --short HEAD 2>/dev/null); st=$?
    if [ "$st" = 0 ] && [ -n "$atual" ]; then
      if eh_main "$atual"; then bloquear "git push com o checkout na main (destino implícito ou HEAD)."; fi
    elif [ "$st" != 1 ] || [ -n "$atual" ]; then
      bloquear "não foi possível resolver o branch atual para conferir o destino do git push; na dúvida, bloqueia."
    fi
  fi
}

analisar_gh() {
  local a=("$@") j=0 tok repo="" metodo="" tem_input=0 pos=() campos=()
  local f_merge=0 f_squash=0 f_rebase=0 f_auto=0 f_apaga=0 f_admin=0 modo_pr=merge metodo_pr="" match_sha=""
  while [ "$j" -lt "${#a[@]}" ]; do
    tok=${a[j]}
    case "$tok" in
      -R|--repo) repo=${a[j+1]:-}; j=$((j + 2)); continue ;;
      --repo=*) repo=${tok#*=} ;;
      # Valor colado (-Rdono/repo): as letras do valor não são opções curtas. O pflag aceita `=` logo depois da
      # opção curta (-R=dono/repo, -X=PUT, -f=campo=valor): um `=` inicial sai do valor.
      -R?*) repo=${tok#-R}; repo=${repo#=} ;;
      -X|--method) metodo=${a[j+1]:-}; j=$((j + 2)); continue ;;
      --method=*) metodo=${tok#*=} ;;
      -X?*) metodo=${tok#-X}; metodo=${metodo#=} ;;
      -f|-F|--field|--raw-field) campos+=("${a[j+1]:-}"); j=$((j + 2)); continue ;;
      --field=*|--raw-field=*) campos+=("${tok#*=}") ;;
      # Valor colado à opção curta (-fmerge_method=squash): entra nos campos como se estivesse separado.
      -f?*|-F?*) tok=${tok:2}; campos+=("${tok#=}") ;;
      # O corpo do arquivo (ou do stdin) decide o método e a base, e o hook não o lê: na main isso bloqueia, porque
      # o campo sentinela nunca é `merge`. Fora da main o campo não é usado.
      --input) tem_input=1; campos+=("merge_method=--input"); j=$((j + 2)); continue ;;
      --input=*) tem_input=1; campos+=("merge_method=--input") ;;
      # Opções que levam valor: o valor não pode ser tomado por argumento posicional.
      -b|--body|--body-file|-t|--subject|--template|-A|--author-email|-H|--header|-q|--jq|--hostname|--cache|-p|--preview)
        j=$((j + 2)); continue ;;
      # A ponta conferida do `gh pr merge` (o último vale, como no gh).
      --match-head-commit) match_sha=${a[j+1]:-}; j=$((j + 2)); continue ;;
      --match-head-commit=*) match_sha=${tok#*=} ;;
      # --admin ignora as proteções da branch: bloqueia em qualquer base (ver abaixo).
      --admin|--admin=*) f_admin=1 ;;
      # Opções de `gh pr merge` que decidem o método e o destino da branch (issue #224).
      --merge) f_merge=1 ;;
      --squash|--squash=*) f_squash=1 ;;
      --rebase|--rebase=*) f_rebase=1 ;;
      # Booleana com `=valor` (inclusive `=false`): na dúvida vale como ligada; já `--merge=*` não vale como merge.
      --auto|--auto=*) f_auto=1 ;;
      --delete-branch|--delete-branch=*) f_apaga=1 ;;
      --merge=*) ;;
      -[a-zA-Z]*)
        # Curtas agrupadas (`-sd`): cada letra vale como a opção sozinha.
        case "$tok" in *m*) f_merge=1 ;; esac
        case "$tok" in *s*) f_squash=1 ;; esac
        case "$tok" in *r*) f_rebase=1 ;; esac
        case "$tok" in *d*) f_apaga=1 ;; esac
        ;;
      -*) ;;
      *) pos+=("$tok") ;;
    esac
    j=$((j + 1))
  done

  case "${pos[0]:-}" in
    pr)
      if [ "${pos[1]:-}" = merge ]; then
        if [ "$f_admin" = 1 ]; then
          bloquear "gh pr merge --admin ignora as proteções da branch; o merge com --admin é bloqueado em qualquer base."
        fi
        [ "$f_auto" = 1 ] && modo_pr=auto
        # Squash e rebase vencem o --merge: pedir os dois não é merge commit.
        if [ "$f_squash" = 1 ]; then metodo_pr=squash
        elif [ "$f_rebase" = 1 ]; then metodo_pr=rebase
        elif [ "$f_merge" = 1 ]; then metodo_pr=merge
        fi
        gh_pr_merge "${pos[2]:-}" "$repo" "$modo_pr" "$metodo_pr" "$f_apaga" "$match_sha"
      fi
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

gh_pr_merge() { # seletor repo modo metodo_de_merge apaga sha_esperado   (cobre `gh pr merge` com ou sem --auto)
  local sel=$1 repo=$2 modo=$3 mm=$4 apaga=$5 esperado=$6
  if [[ $sel =~ ^https?://[^/]+/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    verificar_pr "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "$modo" "$mm" "$apaga" "$esperado"
  elif [[ $sel =~ ^#?([0-9]+)$ ]]; then
    local n=${BASH_REMATCH[1]}
    if [ -z "$repo" ]; then
      verificar_pr '{owner}' '{repo}' "$n" "$modo" "$mm" "$apaga" "$esperado"  # o próprio gh troca os marcadores pelo repositório atual
    elif [[ $repo =~ ^([^/]+)/([^/]+)$ ]]; then
      verificar_pr "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$n" "$modo" "$mm" "$apaga" "$esperado"
    else
      verificar_pr_por_seletor "$sel" "$repo" "$modo" "$mm" "$apaga" "$esperado"
    fi
  else
    verificar_pr_por_seletor "$sel" "$repo" "$modo" "$mm" "$apaga" "$esperado"
  fi
}

gh_api() { # endpoint metodo [campos...]
  local ep=${1%%\?*} ep_bruto=$1 metodo=$2 c v
  shift 2
  # Barra final não muda o endpoint (`pulls/N/merge/`): sai antes de casar. O endpoint também pode vir como URL
  # completa (`https://api.github.com/repos/...`, `https://ghe/api/v3/repos/...`) ou com barras iniciais: tudo isso
  # sai antes de qualquer casamento (merge, auto_merge, merges, contents, git/refs, graphql).
  # Caixa e `./` também não mudam o destino (`GraphQL`, `./graphql`): o endpoint é casado em minúsculas.
  ep=$(printf '%s' "$ep" | tr '[:upper:]' '[:lower:]')
  while [[ $ep == */ ]]; do ep=${ep%/}; done
  if [[ $ep =~ ^https?://[^/]+/(.*)$ ]]; then ep=${BASH_REMATCH[1]}; fi
  while [[ $ep == /* || $ep == ./* ]]; do ep=${ep#/}; ep=${ep#./}; done
  ep=${ep#api/v3/}
  while [[ $ep == /* || $ep == ./* ]]; do ep=${ep#/}; ep=${ep#./}; done
  while [[ $ep == */ ]]; do ep=${ep%/}; done
  # GraphQL não expõe a base na linha de comando: as mutações são conferidas pelo texto do COMANDO INTEIRO (o
  # `analisar_comando` quebra em `(` e `)`, então `mutation($input: X!) { createRef(input: $input) }` não cabe num
  # segmento só), e o que o hook não consegue ler bloqueia.
  if [ "$ep" = graphql ] && [[ $CMD_INTEIRO =~ mergePullRequest|enablePullRequestAutoMerge ]]; then
    bloquear "mutação GraphQL de merge de PR."
  fi
  # Escrever commit ou ref pelo GraphQL é push direto, e a mutação não deixa conferir a branch.
  if [ "$ep" = graphql ] && [[ $CMD_INTEIRO =~ createCommitOnBranch|updateRef|createRef ]]; then
    bloquear "mutação GraphQL que escreve commit ou ref (createCommitOnBranch, updateRef, updateRefs, createRef)."
  fi
  if [ "$ep" = graphql ] && [[ $CMD_INTEIRO =~ deleteRef ]]; then
    bloquear_apagar "mutação GraphQL deleteRef (apagar branch)."
  fi
  # Permissão estreita para o GraphQL (a lista de nomes acima só ajuda a mensagem): o hook não lê o texto de uma
  # mutação montada por variável, crase, arquivo ou stdin, então só passa consulta literal de leitura. No COMANDO
  # INTEIRO: sem `$` (variável do shell ou do GraphQL, que o hook não distingue), crase, `<(`, `@` (arquivo),
  # `--input` nem a palavra `mutation` em qualquer caixa. No segmento do gh: exatamente um campo `query=` com valor
  # literal não vazio que começa por `query` ou `{` (valor com espaço à frente, entre aspas, vem vazio e bloqueia).
  if [ "$ep" = graphql ]; then
    local cmd_min n_query=0 q_val="" re_leitura='^(query|[{])'
    cmd_min=$(printf '%s' "$CMD_INTEIRO" | tr '[:upper:]' '[:lower:]')
    if [[ $CMD_INTEIRO == *'$'* || $CMD_INTEIRO == *'`'* || $CMD_INTEIRO == *'<('* || $CMD_INTEIRO == *@* \
      || $CMD_INTEIRO == *--input* || $cmd_min == *mutation* ]]; then
      bloquear "o GraphQL só é aceito como consulta literal de leitura: sem \$, crase, <(, @arquivo, --input nem a palavra mutation."
    fi
    for c in "$@"; do
      if [[ $c =~ ^query=(.*)$ ]]; then n_query=$((n_query + 1)); q_val=${BASH_REMATCH[1]}; fi
    done
    if [ "$n_query" != 1 ] || [ -z "$q_val" ] || ! [[ $q_val =~ $re_leitura ]]; then
      bloquear "o GraphQL só é aceito como consulta literal de leitura: exatamente um query= literal, não vazio, que comece por query ou {."
    fi
  fi
  # Apagar branch protegida pela API de refs (inclui o `/` codificado como %2F).
  if [ "$metodo" = DELETE ] && [[ $ep =~ /git/refs/(heads(/|%2[Ff]))(main|develop|homolog)$ ]]; then
    bloquear_apagar "gh api DELETE na branch protegida ${BASH_REMATCH[3]}."
  fi
  # Issue #124 (revisão): DELETE de ref com variável no endpoint (`refs/heads/$B`) não dá para conferir o nome.
  if [ "$metodo" = DELETE ] && [[ $ep == */git/refs/heads* ]] && [[ $ep == *'$'* ]]; then
    bloquear_apagar "gh api DELETE com variável no endpoint de branch ($ep)."
  fi
  # Escrever arquivo pela API de conteúdo (PUT cria ou atualiza, DELETE apaga) comita na `branch` do corpo; sem ela, na
  # branch padrão, que é a main. Só passa com `branch=` de outra branch, dado na linha de comando: `main`,
  # `refs/heads/main`, `heads/main`, valor de arquivo (`@x`), variável, valor vazio, `--input` ou sem o campo bloqueiam.
  if { [ "$metodo" = PUT ] || [ "$metodo" = DELETE ]; } && [[ $ep =~ ^/?repos/[^/]+/[^/]+/contents(/.*)?$ ]]; then
    local tem_branch=0
    if [[ $ep_bruto == *branch=* ]]; then bloquear "gh api $metodo em contents com a branch na query string do endpoint: não dá para conferir."; fi
    for c in "$@"; do
      if [ "$c" = "merge_method=--input" ]; then bloquear "gh api $metodo em contents com o corpo vindo de arquivo (--input): não dá para conferir a branch."; fi
      if [[ $c =~ ^branch=(.*)$ ]]; then
        tem_branch=1
        v=${BASH_REMATCH[1]}
        if [ -z "$v" ] || [[ $v =~ ^(refs/)?(heads/)?main$ ]] || [[ $v == @* ]] || [[ $v == *'$'* ]]; then
          bloquear "gh api $metodo em contents com branch '$v' (main, de arquivo, variável ou vazia): escreve na main."
        fi
      fi
    done
    if [ "$tem_branch" = 0 ]; then bloquear "gh api $metodo em contents sem branch= escreve na branch padrão, que é a main."; fi
  fi
  case "$metodo" in PUT|POST|PATCH) ;; *) return 0 ;; esac
  # Merge direto de uma branch em outra pela API (POST /merges): a base não pode ser a main nem ficar fora da linha de
  # comando (arquivo, --input, variável) nem faltar.
  if [[ $ep =~ ^/?repos/[^/]+/[^/]+/merges$ ]]; then
    local tem_base=0
    for c in "$@"; do
      if [ "$c" = "merge_method=--input" ]; then bloquear "gh api $metodo em merges com o corpo vindo de arquivo (--input): não dá para conferir a base."; fi
      if [[ $c =~ ^base=(.*)$ ]]; then
        tem_base=1
        v=${BASH_REMATCH[1]}
        if [ -z "$v" ] || [[ $v =~ ^(refs/)?(heads/)?main$ ]] || [[ $v == @* ]] || [[ $v == *'$'* ]]; then
          bloquear "gh api $metodo em merges com base '$v' (main, de arquivo, variável ou vazia): merge direto na main."
        fi
      fi
    done
    if [ "$tem_base" = 0 ]; then bloquear "gh api $metodo em merges sem base= não dá para conferir a base."; fi
  fi
  # Atualizar a ref da main pela API de refs é push direto (inclui o `/` codificado como %2F).
  if [[ $ep =~ /git/refs/heads(/|%2[Ff])main$ ]]; then
    bloquear "gh api $metodo na ref da main (push direto pela API)."
  fi
  # (d) mudar a base para a main, por campo (-f base=main) ou por JSON ("base": "main").
  for c in "$@"; do
    if [[ $c =~ ^base(RefName)?=(refs/heads/)?main$ ]]; then bloquear "gh api mudando a base para a main."; fi
  done
  if [[ $SEG =~ $re_base_json ]]; then bloquear "gh api mudando a base para a main."; fi
  # (c) merge e auto-merge de PR: confere a base do PR.
  if [[ $ep =~ (merge|auto_merge)$ ]]; then
    if [[ $ep =~ ^/?repos/([^/]+)/([^/]+)/pulls/([0-9]+)/ ]]; then
      local dono_a=${BASH_REMATCH[1]} repo_a=${BASH_REMATCH[2]} num_a=${BASH_REMATCH[3]} modo_a=merge mm_a="" visto=0
      local sha_a="" visto_sha=0
      if [[ $ep == */auto_merge ]]; then modo_a=auto; fi
      # Método de merge: campo `merge_method=`; valores diferentes entre si, ou o método na query string do
      # endpoint (que o hook não confere), viram "conflito" e bloqueiam na main. Sem o campo, fica vazio e bloqueia.
      # A ponta conferida vem do campo `sha=`, com a mesma regra de conflito.
      for c in "$@"; do
        if [[ $c =~ ^merge_method=(.*)$ ]]; then
          v=${BASH_REMATCH[1]}
          if [ "$visto" = 0 ]; then mm_a=$v; visto=1; elif [ "$v" != "$mm_a" ]; then mm_a=conflito; fi
        elif [[ $c =~ ^sha=(.*)$ ]]; then
          v=${BASH_REMATCH[1]}
          if [ "$visto_sha" = 0 ]; then sha_a=$v; visto_sha=1; elif [ "$v" != "$sha_a" ]; then sha_a=conflito; fi
        fi
      done
      if [[ $ep_bruto == *merge_method* ]]; then mm_a=conflito; fi
      if [[ $ep_bruto == *sha=* ]]; then sha_a=conflito; fi
      verificar_pr "$dono_a" "$repo_a" "$num_a" "$modo_a" "$mm_a" 0 "$sha_a"
    else
      bloquear "não foi possível confirmar a base do PR em '$ep'."
    fi
  fi
}

# Cada segmento (separado por ; | & parênteses ou crase) é analisado à parte; aspas saem antes de separar.
analisar_comando() {
  local cmd=$1 t i n nl=$'\n'
  local segmentos
  # `\` no fim da linha continua o comando na seguinte: junta antes de segmentar, senão `git push \<nl> origin main`
  # vira dois segmentos e nenhum é visto inteiro.
  cmd=${cmd//\\"$nl"/ }
  # O comando inteiro, antes de quebrar em segmentos: o gh_api confere as mutações GraphQL por ele.
  CMD_INTEIRO=$cmd
  segmentos=$(printf '%s\n' "$cmd" | tr -d "'\"" | tr '&;|()`' '\n')
  while IFS= read -r SEG; do
    read -ra t <<<"$SEG"
    n=${#t[@]}
    i=0
    # Pula o que vem antes do comando de verdade: variáveis de ambiente, sudo, bash -c, then/do...
    while [ "$i" -lt "$n" ]; do
      case "${t[i]}" in
        timeout)
          # `timeout [opções] DURAÇÃO comando`: pula as opções (-k e -s levam valor) e a duração (60, 1.5, 2m...).
          i=$((i + 1))
          while [ "$i" -lt "$n" ]; do
            case "${t[i]}" in
              -k|-s|--kill-after|--signal) i=$((i + 2)) ;;
              -*) i=$((i + 1)) ;;
              *) break ;;
            esac
          done
          if [ "$i" -lt "$n" ] && [[ ${t[i]} =~ ^[0-9]+([.][0-9]+)?[smhd]?$ ]]; then i=$((i + 1)); fi
          ;;
        *=*|sudo|command|env|time|nohup|exec|eval|bash|sh|zsh|-c|-lc|-ec|-e|-x|-xc|-ic|'{'|if|then|do|else|while|until|'!'|xargs|'$') i=$((i + 1)) ;;
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
# DIAGNÓSTICO TEMPORÁRIO (#224, CRLF no Windows): com GATE_MAIN_DIAG=1 despeja em stderr os bytes que o hook vê. Opt-in.
diag_crlf() {
  [ "${GATE_MAIN_DIAG:-}" = 1 ] || return 0
  local rotulo=$1 c=$2 v
  {
    echo "=== DIAG $rotulo | BASH_VERSION=$BASH_VERSION | jq=$(jq --version 2>&1) | tem CR: $([[ $c == *$'\r'* ]] && echo sim || echo nao)"
    echo "-- comando (od -c)"; printf '%s' "$c" | od -c | head -8
    v=${c//$'\r\n'/$'\n'}; echo "-- A: CRLF->LF"; printf '%s' "$v" | od -c | head -8
    v=${c//$'\r'/}; echo "-- B: remove CR"; printf '%s' "$v" | od -c | head -8
    v=$(printf '%s' "$c" | tr -d '\r'); echo "-- C: tr -d CR"; printf '%s' "$v" | od -c | head -8
    v=${c//\\$'\n'/ }; echo "-- D: junta backslash+LF (cru)"; printf '%s' "$v" | od -c | head -8
    v=${c//$'\r'/}; v=${v//\\$'\n'/ }; echo "-- E: B depois D"; printf '%s' "$v" | od -c | head -8
    v=$(printf 'a\r\nb\r'); echo "-- \$(printf a CR LF b CR)"; printf '%s' "$v" | od -c | head -3
    echo "-- entrada bruta (od -c)"; printf '%s' "$entrada" | od -c | head -12
    echo "-- jq -r .tool_input.command direto (od -c)"; printf '%s' "$entrada" | jq -r '.tool_input.command' | od -c | head -8
  } >&2
}
# Fim de linha do Windows: o jq do Windows escreve CRLF no lugar de cada `\n`, então `\` + quebra chega como `\`+CR+LF e
# a continuação não era juntada (o push com `\` e quebra antes de main passava). CRLF vira LF e CR solto vira espaço
# (separa palavras: o excesso só gera falso positivo, nunca falso negativo). Sem construção bash 4+.
diag_crlf antes "${campos##*$'\x1f'}"
campos=${campos//$'\r\n'/$'\n'}
campos=${campos//$'\r'/ }
IFS=$'\x1f' read -r -d '' ferramenta dono repo numero ramo base_nova comando <<<"$campos"
diag_crlf depois-do-read "$comando"

case "$ferramenta" in
  # Na main, o MCP é bloqueado sempre (modo mcp em exigir_metodo_main); em develop e homolog segue como antes.
  mcp__github__merge_pull_request|mcp__github__enable_pr_auto_merge)
    verificar_pr "$dono" "$repo" "$numero" mcp "" 0 ""
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
