---
name: pr
description: Abre, acompanha ou faz merge de PR do GitTools (feature para develop, develop para homolog, homolog para main). Use quando o dono pedir para abrir um PR, esperar o CI de um PR, fazer merge ou promover develop para homolog e main.
---

# PR

Pedido: $ARGUMENTS

PR é procedimento simples e roda no modelo barato. A sessão que recebe o pedido não abre nem acompanha PR ela mesma.

## Quem pede

- **Na nuvem** (há `create_session`): abra uma sessão com `model: "claude-haiku-5-5"` (o Haiku mais recente),
  `effort: "low"`, `source_url` e `source_revision` da branch e título curto (`PR <origem> → <destino>`). O prompt diz
  quais PRs, na ordem (origem → destino), e se faz merge; manda seguir a skill `pr`, seção "Na sessão de PR"; e pede
  um aviso com `send_message` no fim: `PR FEITO <números> | <resultado>` ou `PR PARADO <número> | <motivo>`.
- **Fora da nuvem** (sem `create_session`): `Agent` com `model: "haiku"` e `effort: "low"` abre o PR e, se o pedido
  tem merge, faz o merge. Quem chamou acompanha o CI com `subscribe_pr_activity`.

## Na sessão de PR

Para cada PR, na ordem:

1. **Corpo**: siga as seções de `.github/pull_request_template.md`, preenchidas com o que mudou e a etapa do fluxo.
   Em "Observações para revisão", o que foi verificado e o que não foi, tirados dos commits (`git log`).
2. **Título e corpo sem atribuição**: a regra do `CLAUDE.md` vale (nada de Claude, IA, modelo, `Co-Authored-By`,
   `Claude-Session` ou "Generated with").
3. Abra com `create_pull_request` (ferramentas `mcp__github__*`). Depois, `subscribe_pr_activity` e encerre o turno.
   Sem laço de espera, sem sleep.
4. Quando o CI avisar:
   - **Verde** e o pedido tem merge: `merge_pull_request` com `merge_method: "merge"` (merge commit, sem squash nem
     rebase, `CONTRIBUTING.md`). Siga para o próximo PR da cadeia.
   - **Vermelho**: não corrija código nem afrouxe teste. Avise `PR PARADO <número> | <check e trecho do log>` e pare.
     A correção é da sessão de trabalho.
   - **Conflito**: idem, `PR PARADO`.
5. `develop → homolog` e `homolog → main` só entram se o pedido incluir.
6. No fim: `unsubscribe_pr_activity` e o aviso `PR FEITO <números> | <resultado>`.

## Merge

Merge só quando o pedido disse merge. Sem isso, a skill só abre e acompanha o PR.
