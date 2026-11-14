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
# Limites (issue #226; o hook é heurística sobre texto, não um parser de shell). O valor de `-o`/`--push-option` (também
# agrupado, `-uo x`) e de `--repo`, `--receive-pack`, `--exec` é pulado antes de contar refspecs.
# Coberto na #226, tudo em expansão de bash (sem processo novo no caminho comum): CR no fim da base do PR e do branch atual;
# com CR no comando, uma segunda análise sem CR (bash com `igncr`); `\gh` e `\git`; wrappers nice, ionice e stdbuf;
# endpoint do `gh api` com `//`, `/./` (colapsados) e `..` (bloqueia); `curl`/`wget` escrevendo na API do GitHub;
# `gh alias set/import`, `git -c`, `--config-env`, `git config` e `GIT_CONFIG*=` em chaves de alias e de destino do push;
# `cd`/`pushd`/`popd`, `--git-dir`, `--work-tree`, `GIT_DIR=` e `GIT_WORK_TREE=` antes de um push sem destino ou de um
# `gh pr merge` sem `-R`; `builtin`, `env` com opções (`-i`, `-u X`, `--`, `-C`, `-S`) e aspas ou `\` no meio do token (`g\it`, `"gi"t`);
# `GH_HOST=` bloqueia; com `GH_REPO=` no comando e sem `-R` o hook não sabe se a variável chega ao gh (atribuição solta,
# `unset`, `env -u`), então confere os DOIS repositórios, o atual (`{owner}/{repo}`) e o do GH_REPO, e os dois passam
# (vale também para `gh api` com `{owner}/{repo}`); valor vazio ou com `$` bloqueia.
# Segue aceito, com o motivo (a defesa que fecha o resto é a proteção de branch do GitHub, issue #101):
# - alias e configuração JÁ gravados (`push.default=upstream`, `branch.<x>.merge` na main, alias do git): o hook não lê a
#   configuração persistida, e lê-la custaria um processo git em todo push.
# - variáveis no destino (`${x}in`, `$DST`, `git push origin "$SRC:$DST"`, `update-ref -d $VAR`, `branch -D $VAR`): o valor
#   não é lido. Um `refs/remotes/origin/<outra>` apagado por update-ref passa.
# - script em outra linguagem fazendo HTTP (python, node); `gh pr edit --base main` não é inspecionado.
# - a corrida entre a checagem e o merge: mitigada pela ponta exigida no merge da main (`--match-head-commit`, `-f sha=`).
# - sem o binário `timeout` o limite por chamada não vale: exigi-lo bloquearia o fluxo do macOS sem coreutils; o prazo
#   global segue valendo entre as chamadas.
# - NUL no comando com jq 1.5/1.6: o Node recusa NUL ao lançar o processo, então o hook nem o recebe.
# - `cd` cujo efeito vem de uma chamada anterior do Bash: o hook não sabe o diretório atual do shell.
# Prazo global (falha aberta se o hook estourar o `timeout` de 120 s do settings.json): o relógio (`SECONDS`) corre desde
# o início; passados `GATE_MAIN_PRAZO` s (padrão e TETO de 90: valor maior, não numérico, vazio, zero ou negativo vira 90;
# a variável existe para os testes), `gh_cmd` e `git_cmd` falham sem chamar o programa e todo chamador bloqueia ("prazo
# do hook esgotado"). Antes disso, cada chamada tem min(15, prazo + 10 - SECONDS) s (piso 1), então o total nunca passa de
# uns 100 s, qualquer que seja o número de segmentos (`a && b && c`). `GATE_MAIN_SECONDS_FAKE` soma segundos ao relógio
# (só os testes o usam, para simular o tempo passado sem esperar; só pode deixar o hook mais restritivo).
# Sem o binário `timeout` (coreutils; macOS sem ele) o gh/git roda sem limite próprio: o prazo só vale ENTRE as chamadas,
# e um gh pendurado ainda pode estourar os 120 s do settings.json (decisão aceita, ver os limites acima).
SECONDS=0
PRAZO=${GATE_MAIN_PRAZO:-90}
if [[ $PRAZO =~ ^[0-9]{1,4}$ ]]; then PRAZO=$((10#$PRAZO)); else PRAZO=90; fi
[ "$PRAZO" -ge 1 ] || PRAZO=90
[ "$PRAZO" -le 90 ] || PRAZO=90
ADIANTO=${GATE_MAIN_SECONDS_FAKE:-0}
if [[ $ADIANTO =~ ^[0-9]{1,4}$ ]]; then ADIANTO=$((10#$ADIANTO)); else ADIANTO=0; fi
entrada=$(cat)
# CR definido aqui, fora de qualquer `$(...)`: o bash do Git Bash (Windows) não faz o parse de `$'..'` dentro de `$(...)`.
CR=$'\r'

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
  # O gh do Windows pode devolver CRLF: `$(...)` só tira o LF, e `main`+CR não seria reconhecida como a main.
  base=${base%"$CR"}
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
  base=${base%"$CR"}  # mesmo cuidado com o CR do gh no Windows (ver verificar_pr)
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
# Issue #226: atribuições de ambiente que o hook procura no comando inteiro (prefixo do segmento, `export`, `env`).
re_env_dir='(^|[^[:alnum:]_])GIT_(DIR|WORK_TREE)='
re_env_git_config='(^|[^[:alnum:]_])GIT_CONFIG[[:alnum:]_]*='
re_env_gh_host='(^|[^[:alnum:]_])GH_HOST='
# Issue #226: `curl`/`wget` como palavra (também `/usr/bin/curl`, `curl.exe`; não `curl-config` nem `mycurl`) e a API do
# GitHub (`api.github.com`, GHE em `/api/v3`, `/api/graphql`). Classes de caractere no lugar de `nocasematch`, porque o
# `=~` do bash 3.2 pode não respeitá-lo.
re_cli_http='(^|[^[:alnum:]_.-])([cC][uU][rR][lL]|[wW][gG][eE][tT])([^[:alnum:]_-]|$)'
re_api_github='[aA][pP][iI]\.[gG][iI][tT][hH][uU][bB]\.[cC][oO][mM]|/[aA][pP][iI]/[vV]3|/[aA][pP][iI]/[gG][rR][aA][pP][hH][qQ][lL]'

# Issue #226: chaves de configuração que criam atalho para um comando (alias) ou mudam para onde um push vai (destino
# padrão, remoto, refspec, branch de upstream) ou que carregam outro arquivo de configuração. O git ignora a caixa da
# seção e do nome (`Push.Default`), então o casamento também ignora (`nocasematch`, que o `case` respeita no bash 3.2;
# o estado anterior é restaurado). Recebe `chave` ou `chave=valor`; status 0 = a chave é sensível.
chave_muda_destino() {
  local chave=${1%%=*} r=1 ligado=1
  shopt -q nocasematch && ligado=0
  shopt -s nocasematch
  case $chave in
    alias.*|remote.*.push|remote.*.mirror|remote.pushdefault|push.default|branch.*.merge|branch.*.remote|branch.*.pushremote|include.path|includeif.*) r=0 ;;
  esac
  [ "$ligado" = 0 ] || shopt -u nocasematch
  return $r
}

analisar_git() {
  local a=("$@") j=0 tok gc=()
  # Pula as opções globais (git -C dir push ...) até o subcomando; os `-C dir` ficam guardados para o git que
  # resolve o branch atual rodar no mesmo diretório que o push rodaria.
  while [ "$j" -lt "${#a[@]}" ]; do
    case "${a[j]}" in
      -C) gc+=(-C "${a[j+1]:-}"); j=$((j + 2)) ;;
      # Issue #226: `-c chave=valor` e `--config-env` valem só neste comando, mas trocam alias e destino do push sem
      # passar pela configuração gravada, então a chave sensível bloqueia (qualquer subcomando).
      -c|--config-env)
        if chave_muda_destino "${a[j+1]:-}"; then bloquear "git ${a[j]} ${a[j+1]}: configuração de alias ou de destino do push no próprio comando."; fi
        j=$((j + 2)) ;;
      --config-env=*)
        if chave_muda_destino "${a[j]#*=}"; then bloquear "git ${a[j]}: configuração de alias ou de destino do push no próprio comando."; fi
        j=$((j + 1)) ;;
      # `--git-dir` e `--work-tree` trocam o repositório: o branch atual do diretório do hook deixa de valer.
      --git-dir|--work-tree) MUDOU_DIR=1; j=$((j + 2)) ;;
      --git-dir=*|--work-tree=*) MUDOU_DIR=1; j=$((j + 1)) ;;
      --namespace) j=$((j + 2)) ;;
      -*) j=$((j + 1)) ;;
      *) break ;;
    esac
  done
  # Issue #226: `git config` de ESCRITA numa chave sensível (forma antiga `config [opções] chave valor` e `config set
  # chave valor`). Leituras (`--get*`, `-l`, `--list`, `get`, `list`) e `--unset*` passam; o valor das opções que levam
  # valor separado (`--file x`, `--type bool`) não é tomado por chave.
  if [ "${a[j]:-}" = config ]; then
    local pos_c=() so_leitura=0 k_c=0 chave_c="" rest_c=("${a[@]:j+1}")
    while [ "$k_c" -lt "${#rest_c[@]}" ]; do
      tok=${rest_c[k_c]}
      case "$tok" in
        --get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|-l|--list|--unset|--unset-all|--remove-section|--rename-section|-e|--edit) so_leitura=1 ;;
        -f|--file|--blob|--default|--type|-t|--comment) k_c=$((k_c + 1)) ;;
        -*) ;;
        *) pos_c+=("$tok") ;;
      esac
      k_c=$((k_c + 1))
    done
    case "${pos_c[0]:-}" in
      set) chave_c=${pos_c[1]:-} ;;
      get|list|unset|edit|remove-section|rename-section) ;;
      *) if [ "$so_leitura" = 0 ] && [ "${#pos_c[@]}" -ge 2 ]; then chave_c=${pos_c[0]}; fi ;;
    esac
    if [ -n "$chave_c" ] && chave_muda_destino "$chave_c"; then
      bloquear "git config gravando a chave $chave_c: alias e destino do push não são alterados pelo Claude."
    fi
    return 0
  fi
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
    # Issue #226: depois de `cd`, `pushd`, `popd`, `--git-dir`, `--work-tree`, `GIT_DIR=` ou `GIT_WORK_TREE=` o branch
    # atual é o de OUTRO diretório, que o hook não conhece: sem destino explícito não há o que conferir.
    if [ "$MUDOU_DIR" = 1 ]; then
      bloquear "git push sem destino na linha depois de trocar o diretório ou o repositório (cd, pushd, popd, --git-dir, --work-tree, GIT_DIR, GIT_WORK_TREE): o branch atual não dá para conferir; passe o destino explícito (git push origin <branch>)."
    fi
    # `-q`: HEAD destacado sai com status 1 e sem texto (não é a main, passa); qualquer outra falha (fora de um
    # repositório, git ausente, tempo ou prazo global esgotado: status 124) é dúvida e bloqueia.
    atual=$(git_cmd "${gc[@]}" symbolic-ref -q --short HEAD 2>/dev/null); st=$?
    atual=${atual%"$CR"}  # o git do Windows pode devolver CRLF: `main`+CR não seria reconhecida como a main
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
    # Issue #226: um alias do gh pode virar `pr merge --squash` sem que o hook veja o texto; criar ou importar bloqueia.
    alias)
      case "${pos[1]:-}" in
        set|import) bloquear "gh alias ${pos[1]}: um alias do gh esconde o comando real do hook; não crie nem importe alias." ;;
      esac
      ;;
    pr)
      if [ "${pos[1]:-}" = merge ]; then
        if [ "$f_admin" = 1 ]; then
          bloquear "gh pr merge --admin ignora as proteções da branch; o merge com --admin é bloqueado em qualquer base."
        fi
        # Issue #226: GH_HOST aponta o gh para outro servidor, e o hook consultaria o github.com.
        if [ "$GH_HOST_DEFINIDO" = 1 ]; then
          bloquear "GH_HOST no comando com gh pr merge: o gh falaria com outro servidor que não o consultado pelo hook."
        fi
        # Issue #226: sem -R o gh usa GH_REPO, mas o hook não sabe se a atribuição chega ao gh (solta num segmento, seguida
        # de `unset GH_REPO`, `env -u GH_REPO gh ...`): confere os DOIS repositórios, o atual e o do GH_REPO, e os dois
        # precisam passar (a segunda conferência vem depois da primeira, abaixo). Vazio ou com variável não dá para conferir.
        # O -R vale mais que o GH_REPO, como no gh.
        if [ -z "$repo" ] && [ "$GH_REPO_DEFINIDO" = 1 ]; then exigir_gh_repo_conferivel; fi
        # Issue #226: depois de `cd`/`pushd`/`popd` o repositório atual do gh não é o do hook; sem -R (ou URL completa) não
        # dá para saber qual PR é o `<N>`.
        if [ -z "$repo" ] && [ "$MUDOU_DIR" = 1 ] && ! [[ ${pos[2]:-} =~ ^https?://[^/]+/[^/]+/[^/]+/pull/[0-9]+ ]]; then
          bloquear "gh pr merge sem -R depois de trocar o diretório (cd, pushd, popd, GIT_DIR): o repositório atual não é o conferido; passe -R dono/repo ou a URL do PR."
        fi
        [ "$f_auto" = 1 ] && modo_pr=auto
        # Squash e rebase vencem o --merge: pedir os dois não é merge commit.
        if [ "$f_squash" = 1 ]; then metodo_pr=squash
        elif [ "$f_rebase" = 1 ]; then metodo_pr=rebase
        elif [ "$f_merge" = 1 ]; then metodo_pr=merge
        fi
        gh_pr_merge "${pos[2]:-}" "$repo" "$modo_pr" "$metodo_pr" "$f_apaga" "$match_sha"
        # Segunda conferência, no repositório do GH_REPO (só neste caso raro há uma consulta a mais).
        if [ -z "$repo" ] && [ "$GH_REPO_DEFINIDO" = 1 ]; then
          gh_pr_merge "${pos[2]:-}" "$GH_REPO_VALOR" "$modo_pr" "$metodo_pr" "$f_apaga" "$match_sha"
        fi
      fi
      ;;
    api)
      if [ "$GH_HOST_DEFINIDO" = 1 ]; then
        bloquear "GH_HOST no comando com gh api: o gh falaria com outro servidor, e o hook confere os endpoints do github.com."
      fi
      # Sem -X, o gh api usa POST quando há campos ou corpo; é o que ele realmente enviaria.
      if [ -z "$metodo" ]; then
        if [ "${#campos[@]}" -gt 0 ] || [ "$tem_input" = 1 ]; then metodo=POST; else metodo=GET; fi
      fi
      metodo=$(printf '%s' "$metodo" | tr '[:lower:]' '[:upper:]')
      gh_api "${pos[1]:-}" "$metodo" "${campos[@]}"
      ;;
  esac
}

# Issue #226: o valor do GH_REPO vira o segundo repositório conferido; vazio ou com `$` não dá para conferir.
exigir_gh_repo_conferivel() {
  if [ -z "$GH_REPO_VALOR" ] || [[ $GH_REPO_VALOR == *'$'* ]]; then
    bloquear "GH_REPO vazio ou com variável ('$GH_REPO_VALOR'): não dá para conferir em que repositório o gh age."
  fi
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
  # Issue #226: `//` e `/./` no meio não mudam o destino (o servidor os normaliza), mas quebrariam os casamentos abaixo
  # (`repos/o/r//pulls/N/merge`, `repos/o//r/merges`): colapsa até estabilizar. Um segmento `..` ou `.` final o hook não
  # resolve (seria caminho relativo), então bloqueia: falha fechada.
  local dupla='//' barra='/' ponto='/./'
  while [[ $ep == *//* || $ep == */./* ]]; do ep=${ep//"$dupla"/"$barra"}; ep=${ep//"$ponto"/"$barra"}; done
  if [[ $ep =~ ^\.\.(/|$) || $ep == */../* || $ep == */.. || $ep == */. ]]; then
    bloquear "gh api com segmento '.' ou '..' no endpoint ($ep): o hook não resolve caminho relativo."
  fi
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
      # Issue #226: o gh expande `{owner}`/`{repo}` com o GH_REPO, que o hook não sabe se chega ao gh: com GH_REPO no
      # comando, confere também o repositório dele (os dois precisam passar).
      if [ "$GH_REPO_DEFINIDO" = 1 ] && { [ "$dono_a" = '{owner}' ] || [ "$repo_a" = '{repo}' ]; }; then
        exigir_gh_repo_conferivel
        if [[ $GH_REPO_VALOR =~ ^([^/]+)/([^/]+)$ ]]; then
          dono_a=${BASH_REMATCH[1]} repo_a=${BASH_REMATCH[2]}
          verificar_pr "$dono_a" "$repo_a" "$num_a" "$modo_a" "$mm_a" 0 "$sha_a"
        else
          bloquear "GH_REPO '$GH_REPO_VALOR' fora do formato dono/repo: não dá para conferir o PR."
        fi
      fi
    else
      bloquear "não foi possível confirmar a base do PR em '$ep'."
    fi
  fi
}

# Issue #226: `curl`/`wget` escrevendo na API do GitHub escapam do gh, que é o que o hook sabe conferir. Confere o COMANDO
# INTEIRO, não o segmento: o `$(gh auth token)` do cabeçalho de autorização quebra o curl em vários segmentos. Só
# expansões de bash (nenhum processo): a palavra `curl`/`wget`, a API do GitHub e uma indicação de escrita (método que não
# é GET/HEAD, ou dados, formulário, arquivo, JSON). Opções curtas agrupadas (`-sSX PUT`) são lidas letra a letra até a
# primeira que leva valor; `-d`, `-F` e `-T` valem como escrita também no wget (falso positivo aceito: bloqueia).
verificar_http_api() {
  local q=$CMD_INTEIRO w=() k=0 tok v c i
  [[ $q =~ $re_cli_http ]] || return 0
  q=${q//\'/}
  q=${q//\"/}
  [[ $q =~ $re_api_github ]] || return 0
  read -r -d '' -a w <<<"$q"
  while [ "$k" -lt "${#w[@]}" ]; do
    tok=${w[k]}
    v=""
    case "$tok" in
      --request|--method) v=${w[k+1]:-} ;;
      --request=*|--method=*) v=${tok#*=} ;;
      --data*|--form*|--upload-file*|--json*|--post-data*|--post-file*|--body-data*|--body-file*)
        bloquear "curl/wget escrevendo na API do GitHub ($tok): use o gh (gh api ...), que o hook consegue conferir." ;;
      --*) ;;
      -?*)
        c=${tok#-}
        i=0
        while [ "$i" -lt "${#c}" ]; do
          case "${c:i:1}" in
            d|F|T) bloquear "curl/wget escrevendo na API do GitHub ($tok): use o gh (gh api ...), que o hook consegue conferir." ;;
            X)
              v=${c:i+1}
              [ -n "$v" ] || v=${w[k+1]:-}
              break ;;
            [HouAebcwmrKxyzCDEQU]) break ;;
          esac
          i=$((i + 1))
        done ;;
    esac
    if [ -n "$v" ]; then
      case "$v" in
        GET|HEAD|get|head) ;;
        *) bloquear "curl/wget com o método $v na API do GitHub: use o gh (gh api ...), que o hook consegue conferir." ;;
      esac
    fi
    k=$((k + 1))
  done
}

# Cada segmento (separado por ; | & parênteses ou crase) é analisado à parte; aspas saem antes de separar.
# Duas análises quando o comando tem CR (ver o caso Bash): por isso o estado do comando é zerado aqui, a cada chamada.
analisar_comando() {
  local cmd=$1 t i n nl=$'\n' prog tem_git=0
  local segmentos
  # Estado do comando inteiro (issue #226). MUDOU_DIR: um `cd`/`pushd`/`popd`, `--git-dir`, `--work-tree`, `GIT_DIR=` ou
  # `GIT_WORK_TREE=` (o branch atual ou o repositório atual do gh deixou de ser o do diretório do hook). GH_REPO_*: o
  # último `GH_REPO=` visto (prefixo do segmento ou `export`). GH_HOST_DEFINIDO e GIT_CONFIG_VISTO: variável de ambiente
  # que muda o servidor do gh ou a configuração do git, procuradas no comando inteiro.
  MUDOU_DIR=0 GH_REPO_DEFINIDO=0 GH_REPO_VALOR="" GH_HOST_DEFINIDO=0 GIT_CONFIG_VISTO=0
  # `\` no fim da linha continua o comando na seguinte: junta antes de segmentar, senão `git push \<nl> origin main`
  # vira dois segmentos e nenhum é visto inteiro.
  cmd=${cmd//\\"$nl"/ }
  # O comando inteiro, antes de quebrar em segmentos: o gh_api confere as mutações GraphQL por ele.
  CMD_INTEIRO=$cmd
  if [[ $cmd =~ $re_env_dir ]]; then MUDOU_DIR=1; fi
  if [[ $cmd =~ $re_env_gh_host ]]; then GH_HOST_DEFINIDO=1; fi
  if [[ $cmd =~ $re_env_git_config ]]; then GIT_CONFIG_VISTO=1; fi
  verificar_http_api
  # Aspas e `\` saem antes de separar: o bash tira a `\` sem aspas (`g\it`, `m\ain` são `git` e `main`); vem DEPOIS da
  # junção de `\`+LF acima, que precisa da `\`.
  segmentos=$(printf '%s\n' "$cmd" | tr -d "'\"\\\\" | tr '&;|()`' '\n')
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
        nice|ionice|stdbuf)
          # Issue #226: wrappers que só mudam prioridade ou buffer. Pula o wrapper, as opções (`-n5`, `-oL`, `-10`,
          # `--adjustment=5` são um token só) e o valor das que levam valor separado (`nice -n N`, `ionice -c N -n N`,
          # `stdbuf -o L`), no estilo do `timeout`.
          prog=${t[i]}
          i=$((i + 1))
          while [ "$i" -lt "$n" ]; do
            case "$prog ${t[i]}" in
              "nice -n"|"nice --adjustment"|"ionice -c"|"ionice -n"|"ionice -p"|"ionice -P"|"ionice -u"|"ionice --class"|"ionice --classdata"|"ionice --pid"|"ionice --pgid"|"ionice --uid"|"stdbuf -i"|"stdbuf -o"|"stdbuf -e"|"stdbuf --input"|"stdbuf --output"|"stdbuf --error") i=$((i + 2)) ;;
              *" -"*) i=$((i + 1)) ;;
              *) break ;;
            esac
          done
          ;;
        env)
          # Issue #226: `env [opções] [VAR=valor] comando`: pula as opções (`-i`, `--`, `-uX`) e o valor separado de
          # `-u`/`--unset` (`-S` separado pula só a si: as aspas já saíram e o próximo token é o programa); `-C`/`--chdir` troca o diretório do comando (liga MUDOU_DIR). Os `VAR=valor` que vêm
          # depois voltam ao laço de fora.
          i=$((i + 1))
          while [ "$i" -lt "$n" ]; do
            case "${t[i]}" in
              -C|--chdir) MUDOU_DIR=1; i=$((i + 2)) ;;
              -C?*|--chdir=*) MUDOU_DIR=1; i=$((i + 1)) ;;
              -u|--unset) i=$((i + 2)) ;;
              # `-S` recebe o comando inteiro como um argumento só; as aspas já saíram, então o token seguinte é o próprio
              # programa e o `-S` pula só a si mesmo. Colado (`-Sgit`, `--split-string=git`), o resto é o programa.
              -S|--split-string) i=$((i + 1)) ;;
              -S?*) t[i]=${t[i]#-S}; break ;;
              --split-string=*) t[i]=${t[i]#--split-string=}; break ;;
              -*) i=$((i + 1)) ;;
              *) break ;;
            esac
          done
          ;;
        GH_REPO=*) GH_REPO_DEFINIDO=1; GH_REPO_VALOR=${t[i]#GH_REPO=}; i=$((i + 1)) ;;
        *=*|export|builtin|sudo|command|time|nohup|exec|eval|bash|sh|zsh|-c|-lc|-ec|-e|-x|-xc|-ic|'{'|if|then|do|else|while|until|'!'|xargs|'$') i=$((i + 1)) ;;
        *) break ;;
      esac
    done
    [ "$i" -lt "$n" ] || continue
    # `\gh` e `\git` (barra invertida no começo) chamam o mesmo programa, só sem alias: o nome perde a `\`.
    prog=${t[i]##*/}
    while [[ $prog == \\* ]]; do prog=${prog#\\}; done
    case "$prog" in
      git) tem_git=1; analisar_git "${t[@]:i+1}" ;;
      gh) analisar_gh "${t[@]:i+1}" ;;
      cd|pushd|popd) MUDOU_DIR=1 ;;
    esac
  done <<<"$segmentos"
  # Issue #226: `GIT_CONFIG_COUNT/KEY_n/VALUE_n`, `GIT_CONFIG_GLOBAL` e afins trocam a configuração (alias, destino do
  # push) só para este comando; qualquer atribuição `GIT_CONFIG*=` com git no comando bloqueia.
  if [ "$GIT_CONFIG_VISTO" = 1 ] && [ "$tem_git" = 1 ]; then
    bloquear "variável GIT_CONFIG* no comando com git: ela troca a configuração (alias, destino do push) que o hook não lê."
  fi
}

command -v jq >/dev/null 2>&1 || bloquear "o jq não está instalado; sem ele não dá para inspecionar a chamada."

# Um jq só: campos separados por \u001f (não é espaço, então campo vazio é preservado); o comando vai por último.
# O jq do Windows escreve o stdout em modo texto e troca cada LF por CR+LF (medido no CI, issue #224: `\`+LF chega como
# `\`+CR+LF). Não dá para saber qual CR veio do jq e qual estava no comando, e adivinhar errado abre falso negativo
# (`\`+CR+LF não é continuação no bash de verdade). Por isso o jq troca CR (\u001e) e LF (\u001d) por marcadores, a saída
# não tem quebra nenhuma, e o hook restaura os bytes exatos do comando, no Windows e no Linux. split/join, sem regex.
# Os marcadores (e o separador \u001f) são bytes de controle reservados: se o próprio comando já os traz, o jq falha e o hook
# bloqueia (falha fechada), senão o 0x1d do comando viraria LF e o hook veria linhas que o bash não vê.
campos=$(printf '%s' "$entrada" | jq -r '
  def s: (. // "") | tostring
    | if contains("\u001d") or contains("\u001e") or contains("\u001f") then error("byte reservado") else . end
    | split("\r") | join("\u001e") | split("\n") | join("\u001d");
  [ (.tool_name | s), (.tool_input.owner | s), (.tool_input.repo | s), (.tool_input.pullNumber | s),
    (.tool_input.branch | s), (.tool_input.base | s), (.tool_input.command | s) ] | join("\u001f")') \
  || bloquear "não foi possível ler a chamada da ferramenta (JSON inválido ou com os bytes de controle 0x1d a 0x1f)."
# Todo CR que sobrou na saída do jq é do modo texto dele (os do comando viraram marcadores): sai. Depois os marcadores
# voltam a ser LF e CR. Sem construção bash 4+ e sem `$'..'` dentro de `$(...)` (o bash do Windows não faz o parse).
case $campos in *$'\r'*) campos=${campos//$'\r'/} ;; esac
campos=${campos//$'\x1d'/$'\n'}
campos=${campos//$'\x1e'/$'\r'}
IFS=$'\x1f' read -r -d '' ferramenta dono repo numero ramo base_nova comando <<<"$campos"

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
    # Issue #226: com CR no comando, duas análises. Uma com os bytes exatos (bash normal: `\`+CR+LF não continua a
    # linha) e outra com todo CR apagado (bash com `set -o igncr`, Cygwin/MSYS: `ma`+CR+`in` é `main` e `\`+CR+LF
    # continua). Qualquer uma que bloqueia, bloqueia. Sem CR, uma análise só, sem custo.
    sem_cr=$comando
    case "$comando" in *"$CR"*) sem_cr=${comando//"$CR"/} ;; esac
    # O filtro olha também o texto sem aspas nem `\` (`g\it`, `"gi"t` e `'g'h` são `git` e `gh` para o bash).
    sem_aspas=${comando//\'/}
    sem_aspas=${sem_aspas//\"/}
    sem_aspas=${sem_aspas//\\/}
    case "$comando$sem_cr$sem_aspas" in
      *git*|*gh*|*[cC][uU][rR][lL]*|*[wW][gG][eE][tT]*)
        analisar_comando "$comando"
        if [ "$sem_cr" != "$comando" ]; then analisar_comando "$sem_cr"; fi
        ;;
    esac
    ;;
esac
exit 0
