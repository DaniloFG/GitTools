# HANDOFF — Plano 4: provas pendentes do Plano 3 e descobertas abertas

Memória do trabalho entre sessões. Existe só na branch `chore/plano-4-provas`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de etapa
fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: fechar o que sobrou do Plano 3 (mãe #131): descobertas #132, #134, #135; filhas em `status:em-revisao`
  com prova pendente (#92, #93, #94, #95, #96, #97, #98, #108, #119); candidatas viradas em issue (#140, #141, #142).
  Issue-mãe: **#139**. Branch nascida da `homolog` (`3f0239b`, que contém o Plano 3).
- **Fora do escopo**: #101 e #117 (dono), apagar branches (dono), merge na `main`, PR da branch
  `docs/branch-nasce-da-main` (#133, o dono decide a base). PR #138 homolog → main aguarda o dono.
- **Regras deste trabalho** (além do `CLAUDE.md`):
  - Teste de regressão só vale com a prova de que reprova sem a correção (mutação registrada, em worktree).
  - `npm run build:extension` antes de cada e2e que muda o produto.
  - Issue sem prova completa por critério não fecha: fica `status:em-revisao` com o que falta comentado.
  - Atualizar rótulo de issue SUBSTITUI todos: ler os rótulos antes e reenviar a lista completa.
  - Testes de hook sem `spawnSync`.
  - `security-review`/`code-review` quebram sem `origin/HEAD`: `git remote set-head origin <branch>` (a E1 resolve).
  - Saída longa vai para arquivo fora do repositório; ler só o fim.
- **Metas**: nenhuma de desempenho; catraca: `perf:bundle` JS da primeira carga ≤ 700.000 (hoje 695.255 Electron e
  696.098 webview), processos git e nós no DOM sem piora.

## 2. Estado

**A seguir:** `E1`

| Etapa | Issue | Objetivo | Orquestra | Estado | Commit |
| --- | --- | --- | --- | --- | --- |
| E1 | #143 (#142) | `origin/HEAD` garantido para code-review e security-review | sonnet | a fazer | |
| E2 | #144 (#135) | Teste por chamador de `readRegularFile` (link no lugar do arquivo) | sonnet | a fazer | |
| E3 | #145 (#134) | Corrida da pasta-mãe trocada por link: fechar ou documentar | topo | a fazer | |
| E4 | #146 (#132) | Aviso externo logo após ação da interface (`isOwnEcho`) | topo | a fazer | |
| E5 | #147 (#92, #95) | Provas de conflitos e cherry-pick | topo | a fazer | |
| E6 | #148 (#141) | `ui.mjs` com Conflitos e Tour; medições de #96 e #98 | topo | a fazer | |
| E7 | #149 (#96) | Conflitos: merge por Alterações, 320 px, hi/ar/zh-CN | topo | a fazer | |
| E8 | #150 (#93, #94, #108) | Rolagem do Changes e empilhamento do combobox | topo | a fazer | |
| E9 | #151 (#97, #119, #140) | Barra estreita (direita/embaixo), Dashboard ≥ 1050, `.wip-open` | topo | a fazer | |

Ordem = dependência: E1 destrava `security-review` (E2, E3, E5); E2 dá a rede da E3; E6 destrava E7; E5 e E8 e E9
juntas fecham a #108 (mutações de #92, #93, #94, #97).

### Última etapa fechada

Nenhuma ainda. O planejamento (sessão de entrada) criou #139 e as sub-issues #143 a #151, mais as descobertas
#140 (`.wip-open` a 320 px), #141 (`ui.mjs` sem Conflitos/Tour) e #142 (`origin/HEAD`). A candidata (c) do ENC da #131
já era a #132. Não conferido: nada foi executado além do planejamento.

## 3. Base de medição

Não se aplica ao planejamento. As etapas E3, E4 e E6 tiram a própria base (`medir`) no `3f0239b` (homolog) antes de
mexer: `node scripts/perf/core.mjs moderate`, `node scripts/perf/ui.mjs 4 moderate`, `npm run perf:bundle`.

## 4. Plano

### Etapa E1 — `origin/HEAD` para as skills de revisão (#143, #142)

- **Orquestra**: sonnet
- **Arquivos prováveis**: `.claude/skills/etapa/SKILL.md`, `.claude/skills/pr/SKILL.md` e/ou um hook de início de
  sessão em `.claude/hooks/` + `.claude/settings.json`; teste do script em `tests/` (sem `spawnSync`).
- **Ler antes**: `.claude/rules/github.md` (gates), `.claude/settings.json`.
- **Aceite**: numa cópia sem `origin/HEAD`, `security-review` roda até o fim (saída anexada); `CLAUDE.md` ≤ 199 linhas.
- **Testes**: do script, se houver; `npm run typecheck`, `npm test`. **Segurança**: não (não afrouxar `gate-*.sh`).

### Etapa E2 — um teste por chamador de `readRegularFile` (#144, #135)

- **Orquestra**: sonnet
- **Arquivos prováveis**: `tests/path-safety.test.ts` ou `tests/repository.test.ts` (só testes).
- **Ler antes**: `src/core/paths.ts` (`readRegularFile`), `src/core/repository.ts` (`conflictDetails`, `readFile`,
  `untrackedDiff`), os 3 casos da E11 do Plano 2 em `tests/path-safety.test.ts`.
- **Aceite**: `npx vitest run tests/path-safety.test.ts` verde; mutação por chamador (voltar à leitura antiga) reprova
  o teste dele, anexada ao commit. Ler por `readFile(handle)` (espião de `repository.test.ts`).
- **Testes**: integração com git real. **Segurança**: sim (`security-review`).

### Etapa E3 — corrida da pasta-mãe (#145, #134)

- **Orquestra**: topo. **Depende de**: E1, E2.
- **Arquivos prováveis**: `src/core/paths.ts`, `src/core/repository.ts`, `tests/path-safety.test.ts`,
  `.claude/rules/seguranca.md` (se a decisão for documentar o limite).
- **Ler antes**: `.claude/rules/seguranca.md`; `resolveInsideReal`/`resolveInsideParent`.
- **Aceite**: decisão registrada (consulte o `gt-juiz`); se fechar, teste de pasta-mãe trocada por link reprova sem a
  mudança; `node scripts/perf/core.mjs moderate` sem piora de processos nem de tempo (base no `3f0239b`).
- **Testes**: integração + medição. **Segurança**: sim (`security-review`, `code-review high`).

### Etapa E4 — `isOwnEcho` (#146, #132)

- **Orquestra**: topo.
- **Arquivos prováveis**: `src/renderer/src/App.tsx` (136-153), `src/renderer/src/git.ts` (99), módulo `.ts` puro novo
  para a decisão, `tests/`, cenário em `scripts/validacao/e2e/cenarios/`.
- **Ler antes**: `.claude/rules/interface.md`, `.claude/rules/testes.md`, `docs/PERFORMANCE.md` (seção 7).
- **Aceite**: e2e altera arquivo por fora < 1 s após salvar e a lista atualiza; processos git por ação própria iguais
  à base; unidade reprova sem a correção (mutação).
- **Testes**: unidade, e2e, medição. **Segurança**: não.

### Etapa E5 — provas de conflitos e cherry-pick (#147, #92, #95)

- **Orquestra**: topo. **Depende de**: E1.
- **Arquivos prováveis**: pouco ou nenhum produto; cenários em `scripts/validacao/e2e/cenarios/` (`conflito-*`).
- **Ler antes**: comentários da #92 e da #95 (ler nas issues); `scripts/readme-media/conflict-save.mjs`.
- **Aceite**: mutação de `adfec47` em worktree do commit anterior à E9 da #96 reprova `conflito-resolver-salvar`
  (ou inalcançável hoje, com motivo); processos "antes 9 / depois 3" reexecutados; 4 cenários novos vistos reprovando
  contra produto quebrado; #95: `security-review` real e `HEAD^{tree}` igual ao do fluxo manual.
- **Testes**: e2e + mutação. **Segurança**: sim (#95).

### Etapa E6 — `ui.mjs` com Conflitos e Tour (#148, #141, #96, #98)

- **Orquestra**: topo.
- **Arquivos prováveis**: `scripts/perf/ui.mjs`, `scripts/validacao/orcamentos.json`.
- **Ler antes**: skill `medir`, `docs/PERFORMANCE.md` (seções de interface e 7).
- **Aceite**: `node scripts/perf/ui.mjs 4 moderate` abre Conflitos e Tour; base anterior à E12 do Plano 2 versus hoje
  (Tour fechado igual); Tour aberto e Conflitos com números; `perf:bundle` ≤ 700.000.
- **Testes**: medição. **Segurança**: não.

### Etapa E7 — tela Conflitos: restante da #96 (#149)

- **Orquestra**: topo. **Depende de**: E6.
- **Arquivos prováveis**: `src/renderer/src/ConflictsScreen.tsx`, CSS, cenários e2e, catálogos se houver texto.
- **Aceite**: merge pelo commit de Alterações encerra a operação (e2e); 320/480/640/1000 px sem rolagem horizontal;
  hi/ar/zh-CN com capturas; mutação de cada cenário novo anexada.
- **Testes**: e2e. **Segurança**: não.

### Etapa E8 — rolagem do Changes e empilhamento do combobox (#150, #93, #94, #108)

- **Orquestra**: topo.
- **Arquivos prováveis**: cenários `regressao-93-changes-rolagem` e `regressao-94-dashboard-everyone`.
- **Aceite**: variantes sem parar na primeira falha; `overflow` mutado reprova nas 3 posições; `z-index` do
  `.dash-popover` removido reprova o cenário reforçado; pedido de confirmação do dono comentado na #93.
- **Testes**: e2e. **Segurança**: não.

### Etapa E9 — barra estreita, Dashboard e `.wip-open` (#151, #97, #119, #140)

- **Orquestra**: topo.
- **Arquivos prováveis**: cenário `regressao-97-telas-ocultas`, CSS do History e do Dashboard.
- **Aceite**: telas ocultas com painel à direita/embaixo e alerta de conflito; mutação de `7cd72d1`; Dashboard 1280 px
  igual (caixas ou pixels) antes/depois de `dfad82f`; #140 reproduzida e corrigida ou fechada com evidência.
- **Testes**: e2e + `e2e-responsivo`. **Segurança**: não.

## 5. Decisões e armadilhas

- 2026-11-12: a plataforma não designou branch (HEAD solto na `homolog`); criada `chore/plano-4-provas` a partir de
  `3f0239b`. `git remote set-head origin -a` falha sem `origin/main` buscado; usei `git fetch origin main` primeiro.
- 2026-11-12: a #92 aparece como `status:planejada` embora tenha comentário de revisão; a E5 corrige o rótulo
  (ler os rótulos antes: a atualização substitui todos).
- 2026-11-12: #133 e a regra "nasce da main" são do dono; este plano segue o pedido (nasce da homolog).
- A #108 só fecha depois de E5, E8 e E9 (mutações de #92, #93, #94, #97).

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação que o trabalho tornou falsa foi corrigida (`docs/PERFORMANCE.md`, README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree usado removido, depois do último push (`git worktree remove <caminho>` e `git worktree prune`)
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] Issues das etapas validadas (evidência comentada, `status:validada`, fechadas); issue-mãe #139 fechada por último
- [ ] PR branch → `develop` mergeado e validado; `git rm docs/HANDOFF.md` em commit; PR da mesma branch → `homolog`
  (rótulo `validada-develop`) mergeado e validado; PR `homolog` → `main` aberto e deixado ao dono
  (`.claude/rules/github.md`); SHA da ponta registrado na descrição do PR da homolog; lista de branches para o dono apagar
