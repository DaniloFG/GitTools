---
name: pr
description: Abre, acompanha ou faz merge de PR do GitTools (branch de trabalho para develop, a mesma branch para homolog, homolog para main; nunca develop para homolog). Merge só até a homolog, com CI verde; a main recebe PR aberto e nunca merge. Use para abrir ou acompanhar um PR, fazer merge em develop ou homolog, ou abrir o PR para main.
---

# PR

Pedido: $ARGUMENTS

PR é procedimento simples e roda no modelo barato. A sessão que recebe o pedido não abre nem acompanha PR ela mesma.

## Quem pede

- **Na nuvem** (há `create_session`): abra uma sessão com `model: "claude-haiku-5-5"` (o Haiku mais recente),
  `effort: "low"`, `source_url` e `source_revision` da branch e título curto (`PR <origem> → <destino>`). O prompt diz
  quais PRs, na ordem (origem → destino); manda seguir a skill `pr`, seção "Na sessão de PR"; e pede um aviso com
  `send_message` no fim: `PR FEITO <números> | <resultado>`, `PR ABERTO <n> (aguarda dono)` ou `PR PARADO <número> | <motivo>`.
- **Fora da nuvem** (sem `create_session`): `Agent` com `model: "haiku"` e `effort: "low"` abre o PR e, se o destino é
  `develop` ou `homolog`, faz o merge. Quem chamou acompanha o CI com `subscribe_pr_activity`.

## Na sessão de PR

Para cada PR, na ordem:

1. **Corpo**: siga as seções de `.github/pull_request_template.md`, preenchidas com o que mudou e a etapa do fluxo.
   Em "Observações para revisão", o que foi verificado e o que não foi, tirados dos commits (`git log`). Traga
   `Refs #N` da issue (`Closes #N` só se os critérios já foram validados; `.claude/rules/github.md`).
2. **Título e corpo sem atribuição**: a regra do `CLAUDE.md` vale (nada de Claude, IA, modelo, `Co-Authored-By`,
   `Claude-Session` ou "Generated with").
3. Abra com `create_pull_request` (ferramentas `mcp__github__*`). Depois, `subscribe_pr_activity` e encerre o turno.
   Sem laço de espera, sem sleep.
4. Quando o CI avisar:
   - **Verde** e o destino é `develop` ou `homolog`: `merge_pull_request` com `merge_method: "merge"` (merge commit, sem
     squash nem rebase, `CONTRIBUTING.md`). Merge na `develop` ou na `homolog`: pare e valide antes do próximo passo
     (seção "Merge" e skill `validar`). Destino `main`: nunca merge; vá ao passo 5.
   - **Vermelho**: não corrija código nem afrouxe teste. Avise `PR PARADO <número> | <check e trecho do log>` e pare.
     A correção é da sessão de trabalho.
   - **Conflito**: idem, `PR PARADO`.
5. `homolog → main`: abra o PR com o checklist do template e **pare**. Sem merge, sem auto-merge, sem `gh pr merge`.
   Avise `PR ABERTO <n> (aguarda dono)`; o merge é do dono ou do aprovador.
6. No fim: `unsubscribe_pr_activity` e o aviso `PR FEITO <números> | <resultado>` (se houve `main`, o aviso de
   `PR ABERTO` vai junto).

## Merge

- Destino `develop` e `homolog`: merge sempre que o CI estiver verde (`.claude/rules/github.md`), sem depender de pedido.
- **Fluxo** (skill `validar`, issues #103, #104 e #128): se o `docs/HANDOFF.md` ainda estiver na branch, antes do PR para
  a `develop` faça o `git rm` e o commit, último da branch. Depois: branch → `develop` e merge; valide a `develop` (agente
  `gt-validador`); só então abra o PR da **mesma** branch → `homolog` (nunca `develop` → `homolog`), já sem HANDOFF. O gate só
  deixa o merge na `homolog` se a ponta do PR está na história da `develop`, o PR tem o rótulo `validada-develop` (posto
  pela skill `validar`) e a origem não é a `develop`. Depois do merge, valide a `homolog`; só com as duas verdes o PR
  `homolog → main` é aberto. Vermelho: `PR PARADO <número> | <fase e trecho do log>`; a correção é da sessão de trabalho.
- **Origem**: a branch de trabalho nasce da `main`; o PR dela vai para `develop` e, depois, a mesma branch para `homolog`
  (nunca `develop` → `homolog`). Não confunda a origem com o destino.
- **Branches**: depois do merge a branch fica; não tente apagá-la nem a `develop`, `homolog` ou `main` (403 e
  `gate-main.sh`). No PR da `homolog`, registre na descrição o SHA da ponta da branch, para a limpeza do dono.
- `main`: **nunca** faz merge nem auto-merge, nem `merge_pull_request` nem `gh pr merge` com destino `main`. Quem faz é
  o dono ou o aprovador.
