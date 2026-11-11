---
paths:
  - "src/core/**/*"
  - "src/backend/**/*"
  - "src/main/**/*"
  - "src/preload/**/*"
  - "extension/src/**/*"
  - "src/shared/api.ts"
  - "src/shared/channels.ts"
  - "src/renderer/src/git.ts"
  - "src/renderer/src/readCache.ts"
---

# Git e processo principal

Vale para `src/core`, `src/backend`, `src/main`, `src/preload` e `extension`. O código atual ainda quebra algumas
destas regras; as exceções conhecidas estão em `docs/PERFORMANCE.md`, com a correção planejada. Código existente que
foge à regra não é modelo para código novo.

- **Orçamento de processos.** Antes de acrescentar uma chamada ao git, diga quantos processos a ação passa a
  abrir (`node scripts/perf/ui.mjs 4 moderate --trace` lista quais). Não ultrapasse o "hoje" da tabela de
  orçamentos (`docs/PERFORMANCE.md`, seção 7) e aproxime-se da meta.
- **Não acrescente nada ao caminho de atualização** (`load` em `App.tsx`: status, refs, operação). Ele roda a
  cada foco da janela, a cada operação e a cada mudança na pasta `.git`. Dado novo que só uma tela usa é lido
  por essa tela, quando ela aparece (`WhenShown`, `useAnyShown`, `Wants`).
- **Junte leituras.** Um comando com mais campos em vez de dois comandos; `--stdin`, `--pathspec-from-file` e
  `cat-file --batch-check` em vez de um processo por item. Nunca um processo dentro de um laço sobre itens do
  repositório.
- **Toda leitura tem teto.** Saída que cresce com o repositório leva `-n`, paginação ou `maxOutputBytes`, e a
  interface mostra que foi cortada. `--untracked-files=all`, contexto ilimitado (`-U1000000`) e leituras de
  arquivos da pasta de trabalho precisam de limite de quantidade e de tamanho.
- **Nada síncrono no caminho de uma chamada.** `readFileSync`, `realpathSync`, `existsSync`, `statSync` e
  `execSync` são proibidos em tudo que atende a interface. Use as versões assíncronas e guarde o que não muda
  (versão do git, caminho da pasta `.git`, chave do repositório).
- **Disco em paralelo, com limite.** `Promise.all` sobre uma lista do repositório precisa de fila com poucas
  tarefas por vez (`mapLimited`).
- **Trabalho pesado fora do processo principal.** Converter saída grande (análises, diffs enormes) trava todas
  as janelas enquanto roda. Divida em partes ou use um processo auxiliar.
- **O que vai para a interface é o que a tela mostra.** Mande o mínimo, em formato compacto; nada de megabytes
  de objetos para uma tela que exibe 40 linhas.
- **Método novo de `RepoApi`**: inclua-o em `REPO_METHODS` e, se só lê, em `READS` de `readCache.ts`, com a
  classificação certa em `classifyCall` (imutável quando endereçado por sha completo). Sem isso ele é tratado
  como alteração e invalida o cache do repositório a cada chamada.

## Teste que acompanha

Mudança aqui chega com teste em `tests/` usando um repositório git de verdade (`createRepo` em `tests/helpers.ts`).
Quando a mudança mexe em quantos processos uma ação abre, o teste conta os processos (`tests/gitProcesses.test.ts`
é o modelo) e a medição de antes e depois vai no commit (skill `medir`).
