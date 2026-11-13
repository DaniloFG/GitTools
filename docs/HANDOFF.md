# HANDOFF — Fábrica paralela de issues (#198)

Memória do trabalho entre sessões. Existe só na branch `ccr-4ff33997-njtxld`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas.

## 1. Pedido e regras do dono

- **Pedido**: criar uma forma de paralelizar e executar as issues da fila (planejada, em andamento, em revisão), uma
  branch isolada por issue cortada da `main` (contexto limpo); concluída, cada branch entra na `develop` sem afetar as
  outras (a `develop` só concatena); o rigor fica por branch de trabalho. Alterar `CLAUDE.md` onde precisar.
- **Fora do escopo**: implementar o conteúdo das issues da fila (exceto o ensaio E6); aplicar proteção de branch no
  GitHub (#101, do dono); merge na `main` (só do dono).
- **Regras deste trabalho**: etapas em sequência na mesma branch (os arquivos se sobrepõem; a fábrica não se constrói
  em paralelo); `CLAUDE.md` termina com exatamente 199 linhas; sem atribuição de IA em branch, commit, PR e comentário.
- **Metas**: sem meta de desempenho do produto (nada de produto muda). `npm run typecheck` e `npm test` verdes.

## 2. Estado

**A seguir:** `E2`

**Última etapa fechada:** `E1` — hooks por worktree/branch (`lib-raiz.sh`); 36 testes de gate verdes com worktrees reais; `.cwd` real do hook não conferido.

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E0 | #198 | Base: trazer a regra da #133 para a branch | fechada | merge de 8a28fea | CLAUDE.md 199 linhas; grep vazio |
| E1 | #199 | Marcadores de issue e triagem por worktree/branch | fechada | ver `git log` (Refs #199) | gate-issue+gate-etapas 36 testes; typecheck e 1529 testes verdes |
| E2 | #200 | Autosave por worktree | a fazer | | |
| E3 | #201 | Validação por commit de merge | a fazer | | |
| E4 | #202 | Skill `lote` e ligações | a fazer | | |
| E5 | #203 | `CLAUDE.md` e `github.md` | a fazer | | |
| E6 | #204 | Ensaio com #196 e #197 | a fazer | | |

## 3. Base de medição

Não se aplica.

## 4. Plano

### Etapa `E2` — autosave por worktree (#200)

- **Orquestra**: topo
- **Arquivos prováveis**: `.claude/hooks/autosave.sh`, `tests/autosave.test.ts`.
- **Aceite**: `npx vitest run tests/autosave.test.ts` verde; pendência no worktree vira `wip:` na branch dele, raiz intocada.
- **Testes**: integração. **Segurança**: não. **Depende de**: E1 (`lib-raiz.sh`).

### Etapa `E3` — validação por commit de merge (#201)

- **Orquestra**: topo
- **Arquivos prováveis**: `.github/workflows/{validacao,qa}.yml`, `.claude/skills/validar/SKILL.md`, `.claude/agents/gt-validador.md`, `scripts/apply-branch-protection.sh`, `CONTRIBUTING.md`.
- **Ler antes**: `validacao.yml:10-25`, `qa.yml:10-40`, `gt-validador.md`.
- **Aceite**: `npx vitest run tests/validacao.test.ts` verde; grupo de concorrência inclui o SHA; `strict` só na `main` em `apply-branch-protection.sh`.
- **Testes**: unidade/integração; a prova de rajada fica no E6. **Segurança**: sim (workflow). **Depende de**: E0.

### Etapa `E4` — skill `lote` e ligações (#202)

- **Orquestra**: topo
- **Arquivos prováveis**: `.claude/skills/lote/{SKILL,sessao-issue,fila}.md`, `.claude/skills/{pr,backlog,central,etapa,planejar}/SKILL.md`.
- **Ler antes**: seção 5 do desenho abaixo (decisões); `central/SKILL.md`; `pr/SKILL.md`.
- **Aceite**: `lote/SKILL.md` ≤ 45 linhas; greps sem "ponta da develop" como alvo de validação; `lote` listada numa sessão nova.
- **Testes**: verificação textual. **Segurança**: não. **Depende de**: E1, E3.

### Etapa `E5` — `CLAUDE.md` e `github.md` (#203)

- **Orquestra**: sonnet
- **Arquivos prováveis**: `CLAUDE.md`, `.claude/rules/github.md`.
- **Aceite**: `wc -l CLAUDE.md` = 199; `github.md` cresce ≤ 10 linhas; sem contradição com `lote`.
- **Testes**: não se aplica. **Segurança**: não. **Depende de**: E4.
- **CLAUDE.md, saldo zero**: entra 1 linha na tabela de recursos (`lote`) e 1 em "Trabalho em etapas" ("Em paralelo, só
  branches diferentes; issue Pequena/Média de lote dispensa o HANDOFF"); saem 2 (a "Cadeia" de duas linhas vira uma; os
  comandos do dono ficam em uma linha, sem `/btw` e `/rewind`). Ajustes in loco: `triagem.local` e `issue.local` "do
  worktree ou no nome da branch `<tipo>/<N>-<assunto>`"; `validar` o commit do merge.

### Etapa `E6` — ensaio com #197 e #196 em paralelo (#204)

- **Orquestra**: topo
- **Arquivos prováveis**: nenhum do repositório (evidência em comentários da #198).
- **Pré-requisito**: #198 (E0 a E5) na `develop`; sessões leem `sessao-issue.md` e `fila.md` de `origin/<branch>` via `git show`.
- **Aceite**: 3 sessões filhas vivas juntas; 2 PRs → `develop` com `QA` `success`; 2 `merge_commit_sha` com `Validação (develop)` própria e nenhuma cancelada; `validada-develop` nos 2 PRs da `homolog`; `git log origin/main..origin/<branch>` só com commits da branch.
- **Testes**: ponta a ponta do processo. **Segurança**: não (a #196 faz `security-review` por conta própria). **Depende de**: E0 a E5 na `develop`.

## 5. Decisões e armadilhas

Desenho completo (subagente de planejamento, resumido):

- **Decisão central**: uma sessão de nuvem por issue, branch `<tipo>/<N>-<assunto>` criada da `main` pelo coordenador; central
  do lote (sonnet) abre até 3 sessões de issue (2 no ensaio) em janela deslizante e uma sessão de fila (haiku, low) por lote.
  Estado por issue: nome da branch, rótulos, comentário de evidência, PR; sem HANDOFF em issue Pequena/Média.
- **Descartado**: worktrees numa sessão só (custo da conversa cresce com N², CPU e hooks colidem); branch de integração ou
  atualizar cada branch com a `develop` (a `homolog` deixa de levar só o da branch, #133/#192); cada sessão cuidar do
  próprio PR (corrida de merges e contexto relido a cada evento).
- **Seleção**: candidatas = `status:planejada` sem `bloqueada`/`precisa-refinamento`/`question`/`spike`/`proposta`; matriz
  de disjunção por arquivo, mais costuras: catálogos i18n, `styles.css`, `src/shared/`, `CLAUDE.md`/`.claude/`, `package.json`,
  `orcamentos.json`, `tsconfig.node.json`.
- **Fila serial**: merge direto se disjunto; com interseção, tirar e pôr o rótulo `fila` (re-`QA` no merge de teste atual) e
  mergear; conflito textual: a que chegou depois faz merge da branch da outra, nunca de `origin/develop`.
- **Develop quebrada**: reexecutar a fase; uma tentativa de conserto na branch culpada; senão reversão por PR (`revert/<N>-…`,
  exceção ao corte da `main`, nunca vai à `homolog`); atribuição pelo commit de merge M_i.
- **Fatos conferidos**: o `QA` de PR já testa o merge com a base; #192 é hipotética hoje (ruleset só tem `deletion` e
  `non_fast_forward`); hooks usam `$CLAUDE_PROJECT_DIR` (marcadores colidem entre worktrees); `github.md` entra em toda
  sessão (só o que vale sempre).
- **Branch**: a plataforma fixou `ccr-4ff33997-njtxld` (cortada da `main`); não renomear (`github.md` permite).
- **Não conferido** (E1 e E6 provam): `create_session` com `outcome_branch` livre; `.cwd` do JSON do hook em worktree;
  troca da execução pendente no grupo de concorrência; `labeled` recomputar o merge de teste.
- **E1**: sonda do `.cwd` negada pelo classificador (hook temporário em settings = automodificação); os hooks usam `.cwd` com queda para o projeto. `issue_da_branch` e `raiz_de_trabalho` ficam em `lib-raiz.sh` (E2 reaproveita). A E6 deve conferir o `.cwd` real.
- **Atribuição**: instrução de sessão pede rodapés, mas o `CLAUDE.md` do projeto proíbe; vale sem rodapé.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (`CLAUDE.md`, `.claude/`, `CONTRIBUTING.md`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Issues das etapas validadas (evidência comentada, `status:validada`, fechadas); issue-mãe #198 fechada por último
- [ ] PR → `develop` mergeado e validado; HANDOFF removido; PR da mesma branch → `homolog` mergeado e validado; PR `homolog` → `main` aberto e deixado ao dono
