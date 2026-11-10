# GitTools — guia para quem altera o código

Interface gráfica para o Git: aplicativo Electron e extensão do VS Code, com a mesma interface React.
A prioridade deste projeto é **desempenho**: a ferramenta precisa ser rápida em computadores fracos e em
repositórios grandes. Toda alteração é avaliada primeiro por isso.

A análise completa, os números medidos e o plano estão em [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).
Leia a seção de orçamentos antes de mexer em qualquer coisa que rode a cada tecla, quadro, clique ou atualização.

Para continuar o trabalho de otimização em uma sessão nova (estado, regras de delegação, próximos passos), leia
[`docs/HANDOFF.md`](docs/HANDOFF.md) primeiro. Esse arquivo existe só na branch de trabalho
(`claude/gittools-gui-repo-yyo0ff`) e é removido no encerramento do trabalho de otimização; ele nunca vai para
`develop`, `homolog` ou `main`.

## Mapa do código

| Pasta | O que é | Onde roda |
| --- | --- | --- |
| `src/core/` | Fala com o git (`runGit`, `GitRepository`), sem depender de Electron nem do VS Code | Node |
| `src/backend/` | Repositórios abertos, configurações, observador da pasta `.git` | Node (os dois ambientes) |
| `src/main/`, `src/preload/` | Só o que é do Electron: janelas, diálogos, IPC | Electron |
| `extension/src/` | Só o que é do VS Code: painéis, comandos | Extensão |
| `src/shared/` | Tipos, canais, configurações e traduções (6 idiomas) | Todos |
| `src/renderer/src/` | Interface React; módulos `.ts` sem React guardam a lógica pura | Navegador |
| `tests/` | Vitest; `tests/web/` roda com tipos do navegador | Node |
| `scripts/perf/` | Roteiros de medição de desempenho | Node e Chromium |

Não há dependência de execução além de `react` e `react-dom`. Mantenha assim: não acrescente biblioteca sem
mostrar o custo dela no tamanho do pacote e por que o código próprio não resolve.

## Comandos

```bash
npm run typecheck          # os três tsconfig
npm test                   # vitest (os testes criam repositórios git de verdade; são lentos)
npm run build              # aplicativo Electron (out/)
npm run build:extension    # extensão e interface do webview (extension/dist/)
node scripts/perf/core.mjs moderate     # leituras do git: tempo, processos e tamanho
node scripts/perf/ui.mjs 4 moderate     # interface com a CPU 4× mais lenta (precisa do build:extension)
```

## Os sete princípios

1. **O custo acompanha o que está na tela, nunca o tamanho do repositório.** Lista, tabela ou árvore que mostra
   dados do repositório (commits, arquivos, linhas, branches, tags) é desenhada por janela ou por lotes e tem teto.
2. **Cada processo git é caro.** No Windows, abrir um processo custa dezenas de milissegundos. Conte os
   processos de cada ação e gaste o mínimo.
3. **Uma mudança, uma leitura.** O mesmo fato não é lido duas vezes; nada é relido se não mudou.
4. **Rolar, arrastar e digitar não passam pelo React nem pelo disco a cada evento.**
5. **Quem redesenha é só quem mudou.** Estado perto de quem usa; propriedades estáveis; linhas memorizadas.
6. **A primeira tela carrega só o que ela usa.** O resto vem sob demanda.
7. **Medir antes e depois.** Sem número não há melhoria nem regressão comprovada.

## Regras

O código atual ainda quebra algumas destas regras. As exceções conhecidas estão em `docs/PERFORMANCE.md`, com a
correção planejada; código existente que foge à regra não é modelo para código novo.

### Git e processo principal (`src/core`, `src/backend`, `src/main`, `extension`)

- **Orçamento de processos.** Antes de acrescentar uma chamada ao git, diga quantos processos a ação passa a
  abrir (`node scripts/perf/ui.mjs 4 moderate --trace` lista quais). Não ultrapasse o "hoje" da tabela de
  orçamentos e aproxime-se da meta.
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
  tarefas por vez.
- **Trabalho pesado fora do processo principal.** Converter saída grande (análises, diffs enormes) trava todas
  as janelas enquanto roda. Divida em partes ou use um processo auxiliar.
- **O que vai para a interface é o que a tela mostra.** Mande o mínimo, em formato compacto; nada de megabytes
  de objetos para uma tela que exibe 40 linhas.
- **Método novo de `RepoApi`**: inclua-o em `REPO_METHODS` e, se só lê, em `READS` de `readCache.ts`, com a
  classificação certa em `classifyCall` (imutável quando endereçado por sha completo). Sem isso ele é tratado
  como alteração e invalida o cache do repositório a cada chamada.
- **Leituras da interface passam pelo proxy `git`** (`git.ts`), que usa o cache; as de segundo plano usam
  `gitInBackground`. Não chame `window.gittools.invokeOn` direto para ler.

### Interface (`src/renderer`)

- **Nenhum `.map` sem limite sobre dados do repositório.** Use a montagem por lotes que já existe
  (`FileEntries`) ou uma janela; linhas com altura fixa quando possível. Meta: nenhuma tela com mais de 5.000
  nós no DOM.
- **Linha de lista é memorizada e não lê contexto.** Siga `CommitRow`: `memo`, propriedades primitivas ou de
  referência estável, manipuladores por uma `ref` de handlers. Um item de lista não chama `useApp()`,
  `useActions()` nem `useLayout()`; quem monta a lista passa o que ele precisa.
- **Cuidado com `useApp()`.** O contexto junta dados, operação em andamento, abas e configurações: qualquer
  mudança redesenha todos os consumidores. Não acrescente campo que mude com frequência. Estado novo fica no
  componente que o usa ou numa store com `useSyncExternalStore` (como `layout.ts` e `slots.tsx`).
- **Eventos contínuos** (`pointermove`, `scroll`, `mousemove`, `resize`, `input` em lista grande):
  - no máximo um trabalho por quadro (`requestAnimationFrame`);
  - mudam estilo ou variável CSS direto no elemento, sem `setState` por evento;
  - nada de `localStorage`, `JSON.stringify` ou IPC por evento: grave uma vez, ao terminar (`pointerup`);
  - ouvinte no próprio elemento, `passive`, nunca em captura na `window` para servir um componente só.
- **Não meça o DOM em laço.** `getBoundingClientRect`, `offsetWidth` e `getComputedStyle` em cada linha forçam o
  navegador a recalcular a página. Calcule a partir dos dados; se medir for inevitável, leia tudo primeiro e
  escreva depois, uma vez por quadro. `MutationObserver` em subárvore grande com `attributes` é proibido.
- **Toda leitura assíncrona num efeito tem cancelamento** (`let cancelled = false` e a limpeza do efeito) e,
  quando disparada por teclado ou digitação, uma espera curta antes de pedir. Resposta atrasada nunca
  sobrescreve a atual.
- **Formatadores `Intl` são guardados**, nunca criados por chamada (`toLocaleString`, `new Intl.…` dentro de
  função chamada por linha custam cerca de 60 vezes mais). Textos de dica (`title`) caros são calculados ao passar o
  mouse, não ao desenhar a linha.
- **Derivados caros ficam em `useMemo` ou em cache por referência** (como `graphFor`, com `WeakMap`): árvores,
  agrupamentos, ordenações, mapas de cor. Algoritmo sobre itens do repositório é linear: `Map` e `Set` no lugar
  de `find`, `includes` e de copiar o array a cada item.
- **Não compare dados grandes com `JSON.stringify`.** Compare por identificador ou assinatura (sha, blob,
  `historySignature`).
- **Componente de tela que não aparece na abertura é carregado sob demanda** (`React.lazy`): diálogos, editores,
  dashboards, configurações.
- **Textos**: toda frase visível passa por `t()` e existe nos seis catálogos de `src/shared/i18n/messages/`
  (o TypeScript reprova catálogo incompleto).

### Estilo (`styles.css`)

- Tabela grande usa `table-layout: fixed`.
- Anime só `transform` e `opacity`; `transition: all` e `backdrop-filter` em área grande são proibidos.
- Efeito por linha (sombra, gradiente, `color-mix`) só se a lista for desenhada por janela.

## Antes de dar a alteração por pronta

1. **Onde isto roda?** Se roda a cada quadro, tecla, linha de lista, atualização da tela ou chamada de IPC,
   releia as regras da área.
2. **Quanto cresce?** Pense no repositório de teste: 20 mil commits, 1.100 refs, 6 mil arquivos, 2 mil não
   rastreados, um diff de 5 mil linhas. Nada pode crescer com o quadrado disso, nem montar tudo isso no DOM.
3. **Quantos processos git?** Conte com `--trace` e compare com os orçamentos.
4. **Meça.** Rode `scripts/perf/core.mjs` (git e funções puras) ou `scripts/perf/ui.mjs 4` (interface) antes e
   depois, e escreva os dois números na descrição do PR. Em mudança de desempenho, o número é a prova.
5. **Tamanho do pacote.** Depois de `npm run build:extension`, confira `extension/dist/webview/assets/*.js`.
   Aumento precisa de justificativa.
6. `npm run typecheck` e `npm test` verdes.

Se uma regra impedir o que foi pedido, não a contorne em silêncio: explique o custo, proponha a alternativa e
registre a exceção num comentário no ponto do código.

## Convenções do projeto

- Comentários e mensagens de commit em português, explicando o porquê.
- Lógica pura fica em módulo `.ts` sem React e ganha teste em `tests/`. Um módulo novo de `src/renderer/src`
  usado por teste entra na lista `include` do `tsconfig.node.json`.
- Fluxo de branches: trabalho → `develop` → `homolog` → `main`, sempre por PR (ver `CONTRIBUTING.md`).
- Arquivos gerados não são editados à mão (`fileIcons.generated.ts` vem de `npm run build:icons`).
