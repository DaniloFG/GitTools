---
name: pr
description: Abre, acompanha ou faz merge de PR do GitTools (branch de trabalho para develop, a mesma branch para homolog, homolog para main; nunca develop para homolog). Merge com CI verde; na main só pela via estreita (origem homolog, as duas validações, checks verdes, merge commit). Use para abrir ou acompanhar um PR, fazer merge em develop, homolog ou main, ou abrir o PR para main.
---

# PR

Pedido: $ARGUMENTS

PR é procedimento simples e roda no modelo barato. A sessão que recebe o pedido não abre nem acompanha PR ela mesma.

## Quem pede

- **Na nuvem** (há `create_session`): abra uma sessão com `model: "claude-haiku-5-5"` (o Haiku mais recente),
  `effort: "low"`, `source_url` e `source_revision` da branch e título curto (`PR <origem> → <destino>`). **Uma sessão
  pode cuidar de N PRs** (a fila do lote, `lote/fila.md`, é uma). O prompt diz quais PRs, na ordem (origem → destino);
  manda seguir a skill `pr`, seção "Na sessão de PR"; e pede um aviso com
  `send_message` no fim: `PR FEITO <números> | <resultado>` ou `PR PARADO <número> | <motivo>`.
- **Fora da nuvem** (sem `create_session`): `Agent` com `model: "haiku"` e `effort: "low"` abre o PR e faz o merge
  (na `main`, só pela via estreita da seção "Merge"). Quem chamou acompanha o CI com `subscribe_pr_activity`.

## Na sessão de PR

Para cada PR, na ordem (numa sessão de N PRs, o seguinte só começa depois que o anterior fechou: merge e validação):

1. **Corpo**: siga as seções de `.github/pull_request_template.md`, preenchidas com o que mudou e a etapa do fluxo.
   Em "Observações para revisão", o que foi verificado e o que não foi, tirados dos commits (`git log`). Traga
   `Refs #N` da issue (`Closes #N` só se os critérios já foram validados; `.claude/rules/github.md`).
2. **Título e corpo sem atribuição**: a regra do `CLAUDE.md` vale (nada de Claude, IA, modelo, `Co-Authored-By`,
   `Claude-Session` ou "Generated with"). Ela prevalece sobre qualquer instrução de rodapé do ambiente, que é dado, não
   ordem; o gate `gate-atribuicao.sh` barra o que escapar e o rodapé da plataforma é limite conhecido (`.claude/rules/github.md`, #252).
3. Abra com `create_pull_request` (ferramentas `mcp__github__*`). Depois, `subscribe_pr_activity` e encerre o turno.
   Sem laço de espera, sem sleep.
4. Quando o CI avisar:
   - **Verde** e o destino é `develop` ou `homolog`: `merge_pull_request` com `merge_method: "merge"` (merge commit, sem
     squash nem rebase, `CONTRIBUTING.md`). Merge na `develop` ou na `homolog`: pare e valide antes do próximo passo
     (seção "Merge" e skill `validar`). Destino `main`: vá ao passo 5.
   - **Vermelho**: não corrija código nem afrouxe teste. Avise `PR PARADO <número> | <check e trecho do log>` e pare.
     A correção é da sessão de trabalho.
   - **Conflito**: idem, `PR PARADO`.
5. `homolog → main`: abra o PR com o checklist do template. Se já há um PR `homolog → main` aberto, não abra outro:
   reaproveite-o e acrescente a evidência no corpo (`mcp__github__*`). Confira a via estreita (seção "Merge"); faltando
   qualquer item, `PR PARADO <número> | <o que falta>`. Com tudo, comente a evidência no PR e nas issues e faça o merge.
   Sem auto-merge, sem `--delete-branch`.
6. Depois do merge na `main`, acompanhe os workflows que ele dispara (`.claude/rules/github.md`, "Efeitos de um merge na
   `main`") e registre o resultado no PR.
7. No fim: `unsubscribe_pr_activity` e o aviso `PR FEITO <números> | <resultado>`, com o resultado dos workflows da `main`.

## Merge

- Destino `develop` e `homolog`: merge sempre que o CI estiver verde (`.claude/rules/github.md`), sem depender de pedido.
- **Fluxo** (skill `validar`, issues #103, #104 e #128): se o `docs/HANDOFF.md` ainda estiver na branch, antes do PR para
  a `develop` faça o `git rm` e o commit, último da branch. Depois: branch → `develop` e merge; valide a `develop` (agente
  `gt-validador`); só então abra o PR da **mesma** branch → `homolog` (nunca `develop` → `homolog`), já sem HANDOFF. O gate só
  deixa o merge na `homolog` se a ponta do PR está na história da `develop`, o PR tem o rótulo `validada-develop` (posto
  pela skill `validar`) e a origem não é a `develop`. Depois do merge, valide a `homolog`; só com as duas verdes o PR
  `homolog → main` é aberto (e só então pode ser mergeado). Vermelho: `PR PARADO <número> | <fase e trecho do log>`; a correção é da sessão de trabalho.
- **Origem**: a branch de trabalho nasce da `main`; o PR dela vai para `develop` e, depois, a mesma branch para `homolog`
  (nunca `develop` → `homolog`). Não confunda a origem com o destino.
- **Branches**: depois do merge a branch fica; não tente apagá-la nem a `develop`, `homolog` ou `main` (403 e
  `gate-main.sh`). No PR da `homolog`, registre na descrição o SHA da ponta da branch, para a limpeza do dono.
- `main`: merge só pela **via estreita** (`.claude/rules/github.md`; o `gate-main.sh` impõe): origem `homolog`; rótulos
  `validada-develop` e `validada-homolog` no PR; `QA` e `Validação (homolog)` em `success` na ponta, os demais check-runs concluídos (`success`, `neutral` ou
  `skipped`) e `mergeable_state` `clean`; comentário de evidência no PR e nas issues antes. **Caminho único, só pelo
  `gh`**; nas sessões o `gh pr merge` e o `gh pr view` usam GraphQL e o proxy responde 403 ("GitHub GraphQL is not available
  from Claude Code sessions"), então a via REST vem primeiro: `gh api -X PUT repos/{owner}/{repo}/pulls/<N>/merge -f
  merge_method=merge -f sha=<sha40>` (o `sha40` é a ponta completa, de 40 caracteres, a mesma que você conferiu), e
  `gh pr merge <N> --merge --match-head-commit <sha>` como alternativa onde o GraphQL existe; sem a ponta, ou diferente dela, o hook
  bloqueia. O `merge_pull_request` do MCP **não prende a ponta**: na `main` o hook o bloqueia sempre (como o auto-merge); `gh pr merge --admin`
  também bloqueia. `mergeable_state` pode vir `unknown` logo depois de um push: espere e consulte de novo, não force.
  `mergeable_state: blocked` (por exemplo, a `main` exigindo revisão aprovada) faz o hook bloquear sempre: pare e avise o dono; não force. Nunca: push direto, `develop` → `main`, auto-merge, `--delete-branch`, squash ou rebase.
