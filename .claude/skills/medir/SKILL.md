---
name: medir
description: Mede o desempenho do GitTools antes e depois de uma mudança e compara com os orçamentos de docs/PERFORMANCE.md (processos git, tempo por quadro, tarefas longas, nós no DOM, tamanho do pacote). Use quando a mudança toca caminho quente, quando o pedido fala em lentidão, travamento, otimização ou regressão, ou antes de afirmar qualquer ganho.
argument-hint: "[o que medir]"
---

# Medir antes e depois

O que medir: $ARGUMENTS

Sem número não há melhoria nem regressão comprovada. Meça **antes** de alterar, com o mesmo roteiro que vai usar
depois.

## Qual roteiro

| Mudou | Roteiro | Leva | Métrica que vale |
| --- | --- | --- | --- |
| Leitura do git, função pura (`src/core`, `src/backend`, módulos `.ts`) | `node scripts/perf/core.mjs moderate` (`clean`, `heavy`) | ~10 s | processos por leitura, KB que vão à interface, tempo (mediana) |
| Interface: rolar, arrastar, abrir, selecionar | `node scripts/perf/ui.mjs 4 moderate` | ~40 s | processos por interação, ms por quadro ou passo, tarefas longas, nós no DOM |
| Quais comandos git uma ação abre | `node scripts/perf/ui.mjs 4 moderate --trace` | ~40 s | a lista dos processos |
| Tamanho do que o usuário baixa e carrega | `npm run build && npm run build:extension && npm run perf:bundle` | < 1 min | bytes contra os tetos (o CI reprova acima) |

Preparar, uma vez por contêiner: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`, `node scripts/perf/stress-repo.mjs`
(cria o repositório de teste na pasta temporária, ~20 s) e, para o `ui.mjs`, `npm run build:extension`.

## Como medir sem se enganar

- **Uma medição por vez.** Nada mais rodando (testes, build, outro roteiro, subagente compilando).
- **Processos git, nós no DOM e bytes não dependem da máquina**: uma rodada basta e o número é exato. Prefira essas
  métricas para afirmar ganho.
- **Tempo varia cerca de ±10% entre rodadas** (a rolagem do histórico, mais). Para afirmar ganho de tempo: três
  rodadas de cada lado e a mediana, ou alterne antes e depois na mesma máquina. Diferença dentro da variação é
  "sem diferença medida", não ganho.
- **Mesma máquina, mesmo cenário, mesmo roteiro** dos dois lados. Tempo de outra sessão ou do documento não é base.
- **Antes e depois em cópias separadas** quando outro agente edita os mesmos arquivos:
  `git worktree add --detach <pasta> HEAD`, link simbólico de `node_modules`, `npm run build:extension` na cópia e
  `git worktree remove --force <pasta>` no fim. Dentro da cópia, o `ui.mjs` serve o `extension/dist/webview` dela.
- **Perfil de JavaScript e contagem de redesenhos** pedem a interface sem minificar:
  `npx vite build -c vite.webview.config.ts --minify false` (depois, `npm run build:extension` de novo).
- A limitação de CPU não simula disco lento nem o custo de abrir processo no Windows: por isso a contagem de
  processos pesa mais que o tempo do git.
- O Chromium não abre com `TMPDIR` num caminho longo.

## Guardar a saída

Mande a saída inteira para um arquivo fora do repositório e leia só as linhas da mudança:

```bash
node scripts/perf/ui.mjs 4 moderate > <rascunho>/ui-antes.log 2>&1
grep -n -i "<interação>" <rascunho>/ui-antes.log
```

O arquivo é a prova: número citado no commit ou no HANDOFF sai dele, copiado, não de memória.

## Comparar com o orçamento

Leia só a seção 7 de `docs/PERFORMANCE.md` (`grep -n '^## 7' docs/PERFORMANCE.md` dá a linha). A regra:

- **Nunca piorar o "hoje"** da tabela. Piorou: a mudança não entra como está; desfaça, redesenhe ou leve o custo ao
  dono com o número.
- **Aproximar-se da meta** quando a mudança é de desempenho.
- Melhorou de forma estável: atualize a coluna "Hoje" da seção 7 no mesmo trabalho, com o commit e o roteiro.

## Relatar

```
<métrica> | antes <número> | depois <número> | <comando> | <rodadas>
```

Mais uma linha para o que **não** foi medido (Electron de verdade, Windows, disco lento) e para o que é hipótese.
Em mudança de desempenho, esses números vão na mensagem do commit e na descrição do PR.
