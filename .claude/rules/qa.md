---
paths:
  - "scripts/validacao/**/*"
  - ".github/workflows/qa.yml"
---

# QA: pirâmide, cenários e gate

O check `QA` (`.github/workflows/qa.yml`, job `QA`) é o portão de PR: o gate de cobertura de cenários e o pipeline
(`scripts/validacao/pipeline.mjs`). A feature ou correção usa a camada mais barata que a reprova, e as de baixo
quando o que mudou é o que o usuário vê ou o que custa tempo. Como escrever o cenário: skill `qa`.

| Camada | O que prova | Onde | Rodar só isso |
| --- | --- | --- | --- |
| Unidade | Lógica pura, sem git nem tela | `tests/<módulo>.test.ts` | `npx vitest run tests/<arquivo>.test.ts` |
| Integração | Git de verdade: `GitRepository`, `Backend`, extensão | `tests/` (ex.: `repository.test.ts`) | idem |
| Interface sem tela | Módulos que precisam de tipos do navegador | `tests/web/` | idem |
| Cenário ponta a ponta | Na interface compilada, ligada ao `Backend` real: o que aparece na tela e o que o git fez | `scripts/validacao/e2e/cenarios/` | `node scripts/validacao/e2e.mjs` |
| QA não funcional | Responsivo, desempenho (git, DOM, tempo) e teclado, contra os tetos de `orcamentos.json` | `scripts/validacao/qa.mjs` | `node scripts/validacao/qa.mjs <fase>` |

Número de desempenho novo (quadro, carga, contagem de processos) sai da skill `medir`, com antes e depois. O QA
confere os tetos; ele não substitui a medição.

## Determinismo

- **Dados fixos.** O repositório de exemplo vem de `createDemoRepo` (`scripts/readme-media/demo-repo.mjs`); o de
  desempenho, de `createStressRepo` e `applyScenario` (`scripts/perf/stress-repo.mjs`). Cenário não usa dado
  aleatório nem a data do relógio.
- **Sem rede e sem LLM.** O cenário não chama serviço externo nem modelo.
- **Sem `sleep` fixo: espera por condição.** No cenário, `expect.visivel`, `expect.pagina` e `expect.ate`, com
  limite de 10 s (`TEMPO_CONDICAO` em `scripts/validacao/e2e/runner.mjs`). Em `qa.mjs`, `ate` e `assentar` (duas
  leituras iguais). O intervalo entre leituras é cadência de consulta, não critério.
- **Sem retry silencioso.** O runner não repete cenário que falhou; o `qa.mjs` não repete checagem. Flaky é bug:
  ache a causa (espera sem condição, estado de partida, ordem) e corrija. Subir tempo limite ou afrouxar asserção
  para passar é proibido, salvo com o motivo escrito no commit (`.claude/rules/testes.md`).

## Gate de cobertura (`scripts/validacao/gate-cobertura.mjs`)

1. **Telas.** Cada id de `TOP_SCREEN_IDS` (`src/renderer/src/screenVisibility.ts`) precisa de um cenário com o campo
   `tela` correspondente, pelo mapa `TELA_POR_ID` (`scripts/validacao/cobertura.mjs`). Tela sem entrada no mapa
   reprova. Roda em PR e em push.
2. **PR** (só no evento `pull_request`). Mudança em `src/renderer/src/components/` exige algum arquivo de
   `scripts/validacao/e2e/cenarios/` alterado no mesmo PR. Sem isso, vale o rótulo `sem-e2e` e a linha
   `sem-e2e: <motivo com pelo menos 10 caracteres>` no corpo. Rótulo sem linha reprova; linha sem rótulo não basta.
   O gate olha só `components/`: mudança de interface fora dessa pasta não é conferida por ele.

## Quando vale `sem-e2e`

Só quando a mudança não tem efeito visível na tela, por exemplo uma reorganização interna de componente que deixa
a tela igual. O motivo fica no corpo do PR, na linha `sem-e2e:`. Mudança visível sem cenário não se justifica com
`sem-e2e`: escreve-se o cenário.

## Tetos

- Os tetos da fase de desempenho e de teclado estão em `scripts/validacao/orcamentos.json` (fonte única, lida pelo
  `qa.mjs`). Cada cenário tem o seu `orcamento` (`ms`, `nos`, `erros`, `git`).
- Teto só sobe com o motivo escrito no commit. Os números de origem são a seção 7 de `docs/PERFORMANCE.md`.
- Teclado (#120) é base medida: 3 controles sem nome acessível e 5 sem foco visível são o que o app tem hoje, não
  a meta. Quando o número cai, o teto cai no mesmo commit, porque a catraca só gira para um lado.

## O que o Windows cobre (#98)

- O job `check` do `ci.yml` roda em ubuntu, windows e macos: `typecheck`, `npm test` (git real), `build` e
  `build:extension`. O Tour é coberto ali só pelas unidades (`tests/tour*.test.ts`) e pelo bundle compilar.
- Os cenários e2e e o `perf:bundle` rodam só no ubuntu (`qa.yml`, `validacao.yml`): nada da interface num Chromium é
  provado no Windows. O Tour não tem código específico de plataforma (só CSS, teclado e foco), por isso a prova
  vale pelo Chromium; custo de processo e de disco do Windows não é medido (`docs/PERFORMANCE.md`, limite da CPU 4×).

## Quem lê o veredito

O QA é roteiro determinístico: o veredito é o relatório em `validacao-out/`. O `gt-validador` lê e relata; não
interpreta prova, não altera teto e não promove. Falha é achado: vira issue de correção (`bug`), nunca afrouxamento.
