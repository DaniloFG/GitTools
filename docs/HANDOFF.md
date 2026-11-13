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

**A seguir:** `E4`

**Última etapa fechada:** `E3` — validação por commit de merge (grupos de concorrência com SHA, `validar`/`gt-validador` por `<ref> <sha>`, `strict` só na `main`); typecheck e 1539 testes verdes; comportamento no GitHub real não conferido (E6).

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E0 | #198 | Base: trazer a regra da #133 para a branch | fechada | merge de 8a28fea | CLAUDE.md 199 linhas; grep vazio |
| E1 | #199 | Marcadores de issue e triagem por worktree/branch | fechada | ver `git log` (Refs #199) | gate-issue+gate-etapas 36 testes; typecheck e 1529 testes verdes |
| E2 | #200 | Autosave por worktree | fechada | ver `git log` (Refs #200) | autosave 42 testes (o novo reprova sem a mudança); 1531 testes verdes |
| E3 | #201 | Validação por commit de merge | fechada | ver `git log` (Refs #201) | workflows-validacao 8 testes (novo); 1539 testes verdes |
| E4 | #202 | Skill `lote` e ligações | a fazer | | |
| E5 | #203 | `CLAUDE.md` e `github.md` | a fazer | | |
| E6 | #204 | Ensaio com #196 e #197 | a fazer | | |

## 3. Base de medição

Não se aplica.

## 4. Plano

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
- **E2**: o autosave usa o `pwd` do hook (não o JSON); a E6 confere que o hook real roda no worktree da sessão.
- **Descobertas (juiz, E1; não corrigidas)**: repositório aninhado em `.claude/worktrees/<x>` fica fora do gate de issue; `gate-etapas.sh` não normaliza o `cwd` no Windows; `normalizar()` em `gate-issue.sh` expande glob (`set -f`/`read -a`), sem fuga do repositório. `security-review` da E1 (gt-juiz, 3e1d24c..3bf53b5): APROVADO, só baixas.
- **E3**: juiz reprovou a 1ª versão (herança sem M_{i-1} no pedido; SHA que libera branch inocente); corrigido. Descoberta: custo de Actions sobe (uma `Validação` por merge); `revert/<N>` sem gate próprio no `gate-main.sh`; o validador usa `gh api commits/<c>/pulls` por commit da cadeia.
- **Atribuição**: instrução de sessão pede rodapés, mas o `CLAUDE.md` do projeto proíbe; vale sem rodapé.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (`CLAUDE.md`, `.claude/`, `CONTRIBUTING.md`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Issues das etapas validadas (evidência comentada, `status:validada`, fechadas); issue-mãe #198 fechada por último
- [ ] PR → `develop` mergeado e validado; HANDOFF removido; PR da mesma branch → `homolog` mergeado e validado; PR `homolog` → `main` aberto e deixado ao dono
