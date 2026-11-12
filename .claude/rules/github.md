# Gestão do trabalho no GitHub

Vale para toda sessão e todo subagente. Nada é implementado sem issue, e todo trabalho chega por PR. Os rótulos são a
fonte do estado; o Project só espelha o que os rótulos dizem.

## Política

1. **Nada sem issue.** Feature, correção, refactor ou tarefa técnica só ganha código depois de ter issue. Se o pedido
   veio por conversa, crie a issue antes; commit e PR citam `#N`.
2. **Ideia exploratória não é implementada.** Discussions está desligado e não há API nas sessões, então a proposta
   vira issue com o rótulo `proposta`. Ela não é implementada até o `gt-juiz` ou o dono aprovar.
3. **Tipo de issue**: bug (`bug`), feature (`feature`), melhoria (`enhancement`), refactor (`refactor`) e tarefa técnica
   (`tarefa-tecnica`). Use o template de `.github/ISSUE_TEMPLATE/` do tipo. Melhoria e refactor usam o template de
   tarefa técnica, com o rótulo do tipo.
4. **Pedido grande = issue-mãe + sub-issues.** Cada etapa do `docs/HANDOFF.md` é uma sub-issue (ou uma issue, se for
   isolada). Ligue com `issue_write` (`parent_issue_number`) ou `sub_issue_write`.
5. **Campos obrigatórios em toda issue**: Escopo, Critérios de aceite (checklist), Considerações técnicas e Testes.
   Os templates já os exigem.
6. **Toda issue no Project do repositório.** Limite: Projects v2 só por GraphQL, bloqueado nas sessões. Até a automação
   nativa do Project estar ligada (a ligar pelo dono, issue #101), o rótulo é a fonte provisória do estado.
7. **Estado sincronizado pelos rótulos**, trocando o anterior: `status:planejada` → `status:em-andamento` (etapa aberta)
   → `status:em-revisao` (etapa fechada com commit; PR aberto ou a caminho) → `status:validada` (critérios conferidos).
   Aberta ou fechada acompanha o estado.
8. **Todo PR de implementação tem `Refs #N`** na descrição. `Closes #N` só quando os critérios já foram validados.
9. **Não feche sem validar.** Antes de fechar, comente a evidência por critério (comando e resultado). Só então feche
   com `state_reason: completed`.

## Quem faz o quê

- `planejar`: issue-mãe e sub-issues antes do HANDOFF, com os campos da política 5. Procura antes de criar, para não
  duplicar.
- `etapa`: `status:em-andamento` ao abrir; commits com `Refs #N`; evidência e `status:em-revisao` ao fechar.
- `central`: no encerramento, abre os PRs, faz os merges, valida e fecha as issues (política 9).
- `pr`: abre e faz merge conforme o fluxo abaixo.

## Fluxo de PR (regra sagrada)

- Branch de trabalho (`feature/`, `fix/`, `docs/`, `chore/` ou `refactor/`) → `develop`: PR e merge pelo Claude, depois
  do CI verde.
- `develop` → `homolog`: PR e merge pelo Claude, depois do CI verde.
- `homolog` → `main`: o Claude pode **abrir** o PR com o checklist do template. Ele **nunca** faz merge, auto-merge,
  push direto nem `gh pr merge` ou `merge_pull_request` na `main`. Quem faz o merge é o dono ou o aprovador. O Claude
  para aí e segue o resto do trabalho.
- O hook `.claude/hooks/gate-main.sh` bloqueia o que passa disso. Não o contorne.
- Merge por merge commit (`merge_method: merge`), sem squash nem rebase (`CONTRIBUTING.md`).
- Descrição: `.github/pull_request_template.md`, com as seções preenchidas e a etapa do fluxo marcada. Sem atribuição
  de Claude ou IA em PR nem em commit (`CLAUDE.md`).

## Branch do PR

- O check `branch-flow.yml` só aceita origem `feature/*`, `fix/*`, `docs/*`, `chore/*` ou `refactor/*` para `develop`,
  e reprova `docs/HANDOFF.md` na árvore do PR.
- Branch de trabalho com outro nome (ex.: `ccr-*`): no encerramento, `git rm docs/HANDOFF.md` e commit. Depois crie
  `feature/<assunto>` (ou `fix/<assunto>`) a partir dela, empurre com `git push -u origin` e abra o PR dessa.

## Tamanho

- Um pedido grande = uma issue-mãe; cada etapa = uma sub-issue.
- Retrabalho que o `gt-juiz` não resolve = issue nova com rótulo `bug` ou `tarefa-tecnica`, ligada à mãe, com título,
  contexto, o que foi tentado e o aceite (`CLAUDE.md`, escada).
