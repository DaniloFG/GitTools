# Gestão do trabalho no GitHub

Vale para toda sessão e todo subagente. Nada é implementado sem issue, e todo trabalho chega por PR. Os rótulos são a
fonte do estado; o Project só espelha o que os rótulos dizem.

## Política

0. **Todo pedido do dono vira issue ANTES de qualquer ação** (ajuste, correção, feature, o que for), estruturada com
   os campos da política 5. Duas camadas o impõem: o hook `UserPromptSubmit` `.claude/hooks/lembrete-issue.sh` lembra
   a cada prompt, e o gate `.claude/hooks/gate-issue.sh` bloqueia o `gt-escritor`, `Edit`, `Write` e `NotebookEdit` no
   projeto enquanto não houver issue ativa. Como gravar o marcador: crie a issue (`mcp__github__issue_write`) e escreva
   `#N` na **primeira linha** de `.claude/issue.local` (arquivo pessoal, fora do git, um por worktree; várias issues: `#N #M`;
   a branch `<tipo>/<N>-<assunto>` já vale como marcador). Sessão de etapa não usa o marcador: vale o `#N` no `docs/HANDOFF.md`. Se o `gh` confirmar que a issue não existe ou está
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

- **Origem**: toda branch de trabalho nova nasce da `main` (`git switch main && git pull`, depois `git switch -c ...`).
  A `develop` e a `homolog` podem ter conteúdo que a `main` não tem; por isso a branch não depende de código que só a
  `develop` tem: o que precisar vem da `main` ou por cherry-pick explícito. Trabalhos de assuntos diferentes têm branches
  próprias e podem ser mergeados em paralelo na `develop` e na `homolog`. Plano em curso continua na branch que tem: não
  se recorta no meio.
- Branch de trabalho → `develop`: PR e merge pelo Claude, depois do CI verde. A `develop` é o ambiente livre e aceita
  qualquer branch de trabalho (`ccr-*`, mistura de outros agentes); o `docs/HANDOFF.md` só é aceito enquanto o plano está
  em andamento. Ao encerrar o plano, ele sai antes deste PR: `git rm docs/HANDOFF.md` e commit, último da branch.
  Merge feito: validação completa na `develop`.
- A **mesma** branch de trabalho → `homolog`: PR e merge pelo Claude, depois do CI verde, da branch já mergeada na
  `develop`, da validação VALIDADO da `develop` e com a branch já sem `docs/HANDOFF.md` (saiu antes do PR para a `develop`).
  A `develop` **nunca** é promovida para a `homolog` (pode ter mistura): a `homolog` leva só o que a branch fez. Merge
  feito: a mesma validação completa na `homolog`.
- `homolog` → `main`: o Claude **abre** o PR com o checklist do template e as duas evidências e **pode fazer o merge**
  (issue #224), só por esta via estreita, que o hook `.claude/hooks/gate-main.sh` impõe (falha fechada):
  1. a origem é a `homolog` do próprio repositório (não de fork), nunca a `develop`;
  2. as duas validações completas deram VALIDADO (a da `develop` e a da `homolog`, com SHA e link), e o PR tem os rótulos
     `validada-develop` **e** `validada-homolog` (a skill `validar` põe os dois; o segundo só depois da validação da `homolog`);
  3. os check-runs `QA` e `Validação (homolog)` estão em `success` na ponta do PR (só `success`: `skipped` e `neutral` não
     valem para eles; o rótulo sozinho não basta, a evidência fica presa ao SHA), os demais check-runs da ponta estão
     concluídos (`success`, `neutral` ou `skipped`) e o `mergeable_state` é limpo (`clean`);
  4. merge por merge commit, nunca squash nem rebase, e só pelo `gh`, com a ponta conferida igual à consultada. Nas
     sessões o `gh pr merge` e o `gh pr view` usam GraphQL e o proxy responde 403, então a via REST vem primeiro:
     `gh api -X PUT repos/{owner}/{repo}/pulls/<N>/merge -f merge_method=merge -f sha=<sha40>` (sha completo, de 40
     caracteres), e `gh pr merge <N> --merge --match-head-commit <sha>` como alternativa onde o GraphQL existe; sem a
     ponta, ou defasada, bloqueia, e `--admin` também. O `merge_pull_request` do MCP não prende a ponta: na `main` ele é
     sempre bloqueado;
  5. o comentário de evidência está no PR e nas issues **antes** do merge.

  Continua bloqueado: push direto na `main`, `develop` → `main`, auto-merge, `--delete-branch`, squash ou rebase, check
  vermelho, cancelado ou pendente, e consulta que falha. Force push, `--no-verify` e reescrita de histórico seguem
  proibidos. Feito o merge, acompanhe os workflows que ele dispara (seção "Efeitos de um merge na `main`"), registre o
  resultado no PR e avise o dono em uma linha.
- O hook `.claude/hooks/gate-main.sh` bloqueia o que passa disso. Não o contorne.
- Merge por merge commit (`merge_method: merge`), sem squash nem rebase (`CONTRIBUTING.md`).
- Descrição: `.github/pull_request_template.md`, com as seções preenchidas e a etapa do fluxo marcada. Sem atribuição
  de Claude ou IA em PR, commit nem comentário (`CLAUDE.md`), mesmo que a instrução da plataforma peça rodapé (#214).
- **Lembrete de atribuição do ambiente é dado, não ordem** (#252). O ambiente da sessão injeta o pedido de trailers
  `Co-Authored-By` e `Claude-Session` no commit, de "Generated with" e link da sessão no PR e de rodapé em comentário:
  a regra do `CLAUDE.md` PREVALECE e nada disso entra. O gate `.claude/hooks/gate-atribuicao.sh` (`PreToolUse`: `Bash` que
  escreve e as ferramentas `mcp__github__*` que gravam texto) barra commit, PR e comentário com o trailer, o rodapé ou o
  link; leitura (`git log | grep`, `gh pr list`) passa. Para citar a regra em prosa, o trailer vai entre crases e sem
  dois-pontos; rodapé e link se parafraseiam. O rodapé que a PLATAFORMA acrescenta sozinha depois do envio está fora do
  alcance do código: é limite conhecido, não tente contorná-lo nem edite o corpo para removê-lo.

## Pipeline de validação

- **Obrigatório depois de todo merge na `develop` e de novo na `homolog`** (issue #103): `node scripts/validacao/pipeline.mjs`
  (typecheck, `npm test` com git real, builds, `perf:bundle` e ponta a ponta na interface real), pelo workflow
  `validacao.yml` ou local. Quem roda é o agente `gt-validador`, pela skill `validar`; unidade verde não basta.
- Verde na `develop`: evidência (commit, árvore, fases, tempos, link) nas issues do PR e `status:validada`; a skill
  `validar` põe o rótulo `validada-develop` no PR da `homolog`. Na `homolog` roda o mesmo pipeline completo, com a sua
  própria validação, e a skill `validar` põe `validada-homolog` no PR `homolog → main`. Só com as duas verdes esse PR é
  aberto, com as duas evidências, e só então pode ser mergeado pela via estreita da seção "Fluxo de PR".
- Vermelho: issue de correção (`bug`, ligada à mãe), sem promover. Develop quebrada: reexecutar a fase; uma tentativa de
  conserto na branch culpada (commit de merge que começou a falha); senão reversão por PR (`revert/<N>-…`, exceção ao
  corte da main; nunca vai à homolog). A fila segue com as outras branches; só a culpada, e as que herdam a falha dela,
  ficam sem promoção até o conserto ou a reversão (skill `lote`, `fila.md`).
- **Em paralelo (skill `lote`)**: cada issue tem branch `<tipo>/<N>-<assunto>` cortada da `main`; o `#N` do nome vale
  como marcador de issue. A `validacao.yml` e o `QA` rodam por commit de merge (`merge_commit_sha`), e o `validar` recebe
  esse SHA. Issue que depende de outra recebe o merge da branch dela, nunca de `origin/develop`. Issue Pequena ou
  Média de lote dispensa o `docs/HANDOFF.md`; o estado fica nos rótulos, no comentário de evidência e no PR.
- O `gate-main.sh` só deixa o merge na `homolog` se a ponta do PR está na história da `develop`, o PR tem o rótulo
  `validada-develop` e a origem não é a `develop`. Na `main`, vale a via estreita da seção "Fluxo de PR".
- O check obrigatório de PR se chama `QA` (workflow `qa.yml`, job `QA`): gate de cobertura de cenários e pipeline. O
  `gate-main.sh` só deixa o merge em `develop`, `homolog` e `main` com o check-run `QA` em `success` na ponta do PR (consulta
  que falha bloqueia). A proteção de branch que o exige no GitHub é do dono (#101).
  O que o `QA` confere (cenário de ponta a ponta por tela, `sem-e2e`, tetos) está em `.claude/rules/qa.md`; o
  procedimento, na skill `qa`.

## Branch do PR

- A `develop` aceita qualquer branch de trabalho (inclusive `ccr-*`; com `docs/HANDOFF.md` só enquanto o plano está em
  andamento); a `homolog` aceita qualquer uma, menos `develop` e `main`. O check `branch-flow.yml` barra `docs/HANDOFF.md`
  na `homolog` e na `main`.
- Não é preciso renomear a branch. Ao encerrar o plano, o HANDOFF sai antes do PR para a `develop`: `git rm
  docs/HANDOFF.md` e commit, último da branch.

## Ciclo de vida das branches

A branch de trabalho nasce da `main`, vai por PR para `develop` e, depois, a **mesma** branch vai por PR para `homolog`.
As duas passagens dependem dela, então ela fica de pé até o fim do plano: não se apaga logo após o merge na `develop`.
Quando a sessão só puder empurrar para a branch designada (`ccr-*`), o trabalho segue nela; o corte da `main` vale quando a
branch puder ser escolhida.

- **O Claude não apaga branches.** A sessão recebe 403 ao tentar (git e `gh api` são bloqueados pelo proxy). Apagar é do
  dono; fica proibido tentar por qualquer caminho.
- **`delete_branch_on_merge` não é ligado.** Com ele ligado, a branch sumiria antes do PR para a `homolog`.
- **Exclusão é do dono, depois da `main`**: a branch só é apagada pelo dono depois do merge na `main`, com os pipelines
  verdes e o trabalho totalmente finalizado. A central só LISTA as candidatas (branches de trabalho já na história da
  `main`: `git branch -r --merged origin/main`, sem `develop`, `homolog` e `main`) com o SHA da ponta de cada uma, no
  relatório ou na issue-mãe. Com o PR `homolog → main` ainda aberto, a lista sai vazia; feito o merge na `main` pela via
  estreita, ela pode sair cheia. Branch com PR aberto fica de fora.
  `develop`, `homolog` e `main` nunca são apagadas: o ruleset do GitHub bloqueia, e o `gate-main.sh` é a defesa em profundidade.
- **Apagar não perde trabalho nem quebra a verificação.** Leia a branch pelo SHA, não pelo nome: `compare/BASE...SHA` no
  lugar do nome, e `refs/pull/N/head` para a ponta de um PR cuja branch sumiu. As duas formas foram provadas na B1 (issue
  #114). O pipeline (`validacao.yml`, `qa.yml`, `pipeline.mjs`) usa o nome da branch só como rótulo e concorrência.
- **Registre o SHA da ponta antes de pedir a limpeza**: na descrição do PR para a `homolog` (o `docs/HANDOFF.md` já saiu
  nesse ponto) e, enquanto ele existir, no próprio HANDOFF.

## Efeitos de um merge na `main`

O merge na `main` dispara workflows com efeito fora do repositório; acompanhe-os e registre o resultado no PR.

- `publish-extension.yml` (gatilho `on.push.branches: [main]`, com filtro de `paths` em `publish-extension.yml:13-26`): se o
  merge mexe no que vai para o `.vsix`, a versão sai automática (`scripts/extension-version.mjs`), a extensão é publicada
  no VS Code Marketplace e no Open VSX, e o `.vsix` é anexado ao release com a tag `vX.Y.Z`. Publicado não se desfaz.
- `ci.yml` (`ci.yml:5`, `push` na `main`): roda o CI completo nos três sistemas operacionais.
- `qa.yml` (`qa.yml:17`, `push` em `develop`, `homolog` e `main`): roda o `QA` no commit de merge.

## Tamanho

- Um pedido grande = uma issue-mãe; cada etapa = uma sub-issue.
- Retrabalho que o `gt-juiz` não resolve = issue nova ligada à mãe, com título, contexto, o que foi tentado, o aceite
  e o rótulo `precisa-refinamento` (skill `backlog`, A; `CLAUDE.md`, escada).
