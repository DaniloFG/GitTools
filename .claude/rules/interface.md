---
paths:
  - "src/renderer/**/*"
---

# Interface (`src/renderer`)

O código atual ainda quebra algumas destas regras; as exceções conhecidas estão em `docs/PERFORMANCE.md`, com a
correção planejada. Código existente que foge à regra não é modelo para código novo.

- **Nenhum `.map` sem limite sobre dados do repositório.** Use a montagem por lotes que já existe
  (`FileEntries`) ou uma janela (`virtual.ts`); linhas com altura fixa quando possível. Meta: nenhuma tela com
  mais de 5.000 nós no DOM.
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
- **Leituras passam pelo proxy `git`** (`git.ts`), que usa o cache; as de segundo plano usam `gitInBackground`.
  Não chame `window.gittools.invokeOn` direto para ler.
- **O caminho de atualização não ganha leitura nova** (`load` em `App.tsx`: status, refs, operação). Dado que só
  uma tela usa é lido por essa tela, quando ela aparece (`WhenShown`, `useAnyShown`, `Wants`).
- **Formatadores `Intl` são guardados**, nunca criados por chamada (`toLocaleString`, `new Intl.…` dentro de
  função chamada por linha custam cerca de 60 vezes mais). Textos de dica (`title`) caros são calculados ao passar
  o mouse, não ao desenhar a linha.
- **Derivados caros ficam em `useMemo` ou em cache por referência** (como `graphFor`, com `WeakMap`): árvores,
  agrupamentos, ordenações, mapas de cor. Algoritmo sobre itens do repositório é linear: `Map` e `Set` no lugar
  de `find`, `includes` e de copiar o array a cada item.
- **Não compare dados grandes com `JSON.stringify`.** Compare por identificador ou assinatura (sha, blob,
  `historySignature`).
- **Componente de tela que não aparece na abertura é carregado sob demanda** (`React.lazy`, em `lazyScreens.ts`):
  diálogos, editores, dashboards, configurações.
- **Conteúdo do repositório entra na tela só como texto do React.** Mensagem de commit, nome de arquivo, autor,
  linha de diff e saída do git nunca vão para `dangerouslySetInnerHTML`, `innerHTML` nem para um atributo de URL
  sem validação (ver `.claude/rules/seguranca.md`).

## Estilo (`styles.css`)

- Tabela grande usa `table-layout: fixed`.
- Anime só `transform` e `opacity`; `transition: all` e `backdrop-filter` em área grande são proibidos.
- Efeito por linha (sombra, gradiente, `color-mix`) só se a lista for desenhada por janela.

## Teste que acompanha

- **Lógica nova não nasce dentro do componente.** Cálculo, agrupamento, ordenação, janela e formatação ficam num
  módulo `.ts` sem React, com teste em `tests/` (e o módulo entra no `include` do `tsconfig.node.json`). O que
  precisa de tipos do navegador (proxy `git`, cache, sessão) é testado em `tests/web/`.
- **Mudança visível na tela é conferida na tela de verdade** (skill `run-gittools`): comportamento observado, nenhum
  erro no console e contagem de nós no DOM. Caminho quente (rolar, arrastar, digitar, abrir diff) ganha medição de
  antes e depois (skill `medir`).
