---
name: pr
description: Abre, acompanha ou faz merge de PR do GitTools (feature para develop, develop para homolog, homolog para main). Merge só até a homolog, com CI verde; a main recebe PR aberto e nunca merge. Use para abrir ou acompanhar um PR, fazer merge em develop ou homolog, ou abrir o PR para main.
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
     squash nem rebase, `CONTRIBUTING.md`). Siga para o próximo PR da cadeia. Destino `main`: nunca merge; vá ao passo 5.
   - **Vermelho**: não corrija código nem afrouxe teste. Avise `PR PARADO <número> | <check e trecho do log>` e pare.
     A correção é da sessão de trabalho.
   - **Conflito**: idem, `PR PARADO`.
5. `homolog → main`: abra o PR com o checklist do template e **pare**. Sem merge, sem auto-merge, sem `gh pr merge`.
   Avise `PR ABERTO <n> (aguarda dono)`; o merge é do dono ou do aprovador.
6. No fim: `unsubscribe_pr_activity` e o aviso `PR FEITO <números> | <resultado>` (se houve `main`, o aviso de
   `PR ABERTO` vai junto).

## Merge

- `develop` e `homolog`: merge sempre que o CI estiver verde (`.claude/rules/github.md`), sem depender de pedido.
- `main`: **nunca** faz merge nem auto-merge, nem `merge_pull_request` nem `gh pr merge` com destino `main`. Quem faz é
  o dono ou o aprovador.
