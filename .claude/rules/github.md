# Gestão do trabalho no GitHub

Vale para toda sessão e todo subagente. Nada é implementado sem issue, e todo trabalho chega por PR. Os rótulos são a
fonte do estado; o Project só espelha o que os rótulos dizem.

## Política

0. **Todo pedido do dono vira issue ANTES de qualquer ação** (ajuste, correção, feature, o que for), estruturada com
   os campos da política 5. Duas camadas o impõem: o hook `UserPromptSubmit` `.claude/hooks/lembrete-issue.sh` lembra
   a cada prompt, e o gate `.claude/hooks/gate-issue.sh` bloqueia o `gt-escritor`, `Edit`, `Write` e `NotebookEdit` no
   projeto enquanto não houver issue ativa. Como gravar o marcador: crie a issue (`mcp__github__issue_write`) e escreva
   `#N` na **primeira linha** de `.claude/issue.local` (arquivo pessoal, fora do git; várias issues: `#N #M`). Sessão de
   etapa não usa o marcador: vale o `#N` no `docs/HANDOFF.md`. Se o `gh` confirmar que a issue não existe ou está
   fechada, o gate bloqueia; com o GitHub inacessível ele só avisa. Escrita fora do projeto (`/tmp`, scratchpad) e em
   `.claude/issue.local` e `.claude/triagem.local` não exige issue. Pedido grande: issue-mãe + sub-issues (política 4).
1. **Nada sem issue.** Feature, correção, refactor ou tarefa técnica só ganha código depois de ter issue. Se o pedido
   veio por conversa, crie a issue antes; commit e PR citam `#N`.
2. **Ideia exploratória não é implementada.** Discussions está desligado e não há API nas sessões, então a proposta
   vira issue com o rótulo `proposta`. Ela não é implementada até o `gt-juiz` ou o dono aprovar.
3. **Tipo de issue**: um rótulo de tipo da seção Classificação (abaixo). Use o template de `.github/ISSUE_TEMPLATE/`
   do tipo (`bug`, `feature`, `melhoria`, `debito-tecnico`, `spike`, `tarefa-tecnica`); `fix`, `refactor` e
   `documentation` usam o de tarefa técnica, com o rótulo do tipo.
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

## Classificação

Eixos dos rótulos. Uma issue tem **exatamente um rótulo de tipo**, 0..n de natureza, **uma prioridade** e 1..n áreas;
origem e maturidade entram quando se aplicam.

| Eixo | Rótulo | Significado e quando usar | Exclusivo? |
| --- | --- | --- | --- |
| Tipo | `bug` | Defeito de comportamento | Um só |
| Tipo | `fix` | Ajuste pontual que não é defeito (texto, config, detalhe) | Um só |
| Tipo | `feature` | Funcionalidade nova | Um só |
| Tipo | `enhancement` | Melhoria do que já funciona | Um só |
| Tipo | `refactor` | Reestruturação sem mudar comportamento | Um só |
| Tipo | `tarefa-tecnica` | Trabalho técnico sem mudança para o usuário (build, ferramentas) | Um só |
| Tipo | `documentation` | Só documentação | Um só |
| Natureza | `performance`, `seguranca`, `arquitetura`, `infra` | O que o trabalho melhora ou protege | Vários |
| Natureza | `debito-tecnico` | Trabalho adiado conscientemente que cobra juros | Vários |
| Origem | `descoberta` | Achado de passagem, fora do escopo em curso (skill `backlog`, B) | Opcional |
| Maturidade | `precisa-refinamento` | Issue incompleta ou travada ("needs refinement"); o `gt-planejador` a refina | Opcional |
| Maturidade | `spike` | Investigação de prazo curto para formar o conceito; uma pergunta | Opcional |
| Maturidade | `question` | Dúvida a responder antes de implementar | Opcional |
| Maturidade | `bloqueada` | Depende de algo externo ao código; fora da fila de `backlog` C | Opcional |
| Estado | `status:planejada` → `em-andamento` → `em-revisao` → `validada` (e `validada-develop` no PR) | Política 7 | Um só |
| Prioridade | `prioridade:alta`, `media`, `baixa` | Ordem de puxada | Um só |
| Área | `area:core`, `backend`, `interface`, `shared`, `plataforma`, `ci`, `claude`, `docs` | Onde o código mora (mapa do `CLAUDE.md`) | Vários |
| Proposta | `proposta` | Ideia exploratória, não implementada (política 2) | Opcional |

## Quem faz o quê

- `planejar`: issue-mãe e sub-issues antes do HANDOFF, com os campos da política 5. Procura antes de criar, para não
  duplicar; reaproveita as issues já prontas do backlog como sub-issues.
- `backlog` (skill): travou → `precisa-refinamento`, nunca volta ao dono; registra descoberta de passagem; puxa a
  próxima issue pronta; higiene de fechamento.
- `gt-planejador` (agente, `sonnet`, só leitura): refina a issue travada ou incompleta e devolve o texto; quem grava na
  issue é o orquestrador.
- `etapa`: `status:em-andamento` ao abrir; commits com `Refs #N`; evidência e `status:em-revisao` ao fechar.
- `central`: no encerramento, abre os PRs, faz os merges, valida e fecha as issues (política 9).
- `pr`: abre e faz merge conforme o fluxo abaixo.

## Fluxo de PR (regra sagrada)

- Branch de trabalho → `develop`: PR e merge pelo Claude, depois do CI verde. A `develop` é o ambiente livre e aceita
  qualquer branch (`ccr-*`, com `docs/HANDOFF.md`, mistura de outros agentes). Merge feito: validação completa na `develop`.
- A **mesma** branch de trabalho → `homolog`: PR e merge pelo Claude, depois do CI verde, da branch já mergeada na
  `develop`, da validação VALIDADO e do último commit `git rm docs/HANDOFF.md`. A `develop` **nunca** é promovida para a
  `homolog` (pode ter mistura): a `homolog` leva só o que a branch fez. Merge feito: a mesma validação completa na `homolog`.
- `homolog` → `main`: o Claude pode **abrir** o PR com o checklist do template e as duas evidências. Ele **nunca** faz merge, auto-merge,
  push direto nem `gh pr merge` ou `merge_pull_request` na `main`. Quem faz o merge é o dono ou o aprovador. O Claude
  para aí e segue o resto do trabalho.
- O hook `.claude/hooks/gate-main.sh` bloqueia o que passa disso. Não o contorne.
- Merge por merge commit (`merge_method: merge`), sem squash nem rebase (`CONTRIBUTING.md`).
- Descrição: `.github/pull_request_template.md`, com as seções preenchidas e a etapa do fluxo marcada. Sem atribuição
  de Claude ou IA em PR nem em commit (`CLAUDE.md`).

## Pipeline de validação

- **Obrigatório depois de todo merge na `develop` e de novo na `homolog`** (issue #103): `node scripts/validacao/pipeline.mjs`
  (typecheck, `npm test` com git real, builds, `perf:bundle` e ponta a ponta na interface real), pelo workflow
  `validacao.yml` ou local. Quem roda é o agente `gt-validador`, pela skill `validar`; unidade verde não basta.
- Verde na `develop`: evidência (commit, árvore, fases, tempos, link) nas issues do PR e `status:validada`; a skill
  `validar` põe o rótulo `validada-develop` no PR da `homolog`. Na `homolog` roda o mesmo pipeline completo, com a sua
  própria validação. Só com as duas verdes o PR `homolog → main` é aberto, com as duas evidências, e fica ao dono.
- Vermelho: issue de correção (`bug`, ligada à mãe), conserto antes de qualquer outro merge, sem promover.
- O `gate-main.sh` só deixa o merge na `homolog` se a ponta do PR está na história da `develop`, o PR tem o rótulo
  `validada-develop` e a origem não é a `develop`.
- O check obrigatório de PR se chama `QA` (workflow `qa.yml`, job `QA`): gate de cobertura de cenários e pipeline. O
  `gate-main.sh` só deixa o merge em `develop` e `homolog` com o check-run `QA` em `success` na ponta do PR (consulta
  que falha bloqueia). A proteção de branch que o exige no GitHub é do dono (#101).
  O que o `QA` confere (cenário de ponta a ponta por tela, `sem-e2e`, tetos) está em `.claude/rules/qa.md`; o
  procedimento, na skill `qa`.

## Branch do PR

- A `develop` aceita qualquer branch de trabalho (inclusive `ccr-*` e com `docs/HANDOFF.md`); a `homolog` aceita qualquer
  uma, menos `develop` e `main`. O check `branch-flow.yml` barra `docs/HANDOFF.md` na `homolog` e na `main`.
- Não é preciso renomear a branch. O HANDOFF só sai antes do PR para a `homolog`: `git rm docs/HANDOFF.md` e commit.

## Tamanho

- Um pedido grande = uma issue-mãe; cada etapa = uma sub-issue.
- Retrabalho que o `gt-juiz` não resolve = issue nova ligada à mãe, com título, contexto, o que foi tentado, o aceite
  e o rótulo `precisa-refinamento` (skill `backlog`, A; `CLAUDE.md`, escada).
