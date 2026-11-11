# GitTools — guia para quem altera o código

Interface gráfica para o Git: aplicativo Electron e extensão do VS Code, com a mesma interface React.
A prioridade deste projeto é **desempenho**: a ferramenta precisa ser rápida em computadores fracos e em
repositórios grandes. Toda alteração é avaliada primeiro por isso.

A análise completa, os números medidos e o plano estão em [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).
Leia a seção de orçamentos antes de mexer em qualquer coisa que rode a cada tecla, quadro, clique ou atualização.

Trabalho longo é feito em etapas curtas, uma sessão por etapa, como descrito em
[Trabalho com o Claude em etapas](#trabalho-com-o-claude-em-etapas). Se a branch de trabalho tiver um
`docs/HANDOFF.md`, leia-o primeiro: é a memória do trabalho em andamento e nunca vai para `develop`, `homolog`
ou `main`.

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
npm run perf:bundle        # tamanho do pacote contra os tetos (precisa do build e do build:extension; roda no CI)
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
5. **Tamanho do pacote.** Depois de `npm run build` e `npm run build:extension`, rode `npm run perf:bundle`: o CI
   reprova se o JavaScript da primeira carga (com o maior catálogo de idioma) passar de 700.000 bytes, ou o CSS, o
   processo principal ou a extensão passarem dos tetos do roteiro. Aumento precisa de justificativa; subir um teto,
   só com o motivo no commit.
6. `npm run typecheck` e `npm test` verdes.

Se uma regra impedir o que foi pedido, não a contorne em silêncio: explique o custo, proponha a alternativa e
registre a exceção num comentário no ponto do código.

## Convenções do projeto

- Comentários e mensagens de commit em português, explicando o porquê.
- Lógica pura fica em módulo `.ts` sem React e ganha teste em `tests/`. Um módulo novo de `src/renderer/src`
  usado por teste entra na lista `include` do `tsconfig.node.json`.
- Fluxo de branches: trabalho → `develop` → `homolog` → `main`, sempre por PR (ver `CONTRIBUTING.md`).
- Arquivos gerados não são editados à mão (`fileIcons.generated.ts` vem de `npm run build:icons`).

## Trabalho com o Claude em etapas

Trabalho que não cabe numa conversa curta (uma fase, um plano com vários itens) é feito em **etapas**, cada uma numa
sessão nova, com contexto limpo. Contexto curto custa menos, erra menos e não inventa: tudo o que uma etapa precisa
saber está escrito no repositório, não na memória de uma conversa longa.

### Papéis

| Quem | Modelo | Faz | Não faz |
| --- | --- | --- | --- |
| Dono do projeto | — | Abre a sessão central; decide o que só ele decide; diz quando o trabalho acabou | — |
| Sessão central | Opus, o mais recente | Abre a sessão de cada etapa, recebe o aviso de fim, confere no remoto, arquiva a etapa e abre a seguinte | Não lê nem escreve código; não faz etapa |
| Sessão de etapa | Opus, o mais recente | Especifica, delega, revisa os diffs, mede, roda as verificações, commita, atualiza o handoff e avisa a central | Não escreve código; não abre sessão |
| Subagente | Haiku, o mais recente (`model: "haiku"` na ferramenta `Agent`) | Lê, busca e escreve código, só nos arquivos que recebeu | Não roda git que altera estado (commit, add, stash, checkout, reset, restore) |

Uma etapa é um item do plano (por exemplo "3.2"). **Uma sessão, uma etapa**: terminou, troca, mesmo com pressa.
Vários subagentes ao mesmo tempo só dentro da etapa e com arquivos disjuntos, nunca para adiantar a seguinte.

### A memória entre etapas: `docs/HANDOFF.md`

- Existe **só na branch de trabalho**. O check "Validar fluxo de branches" reprova o PR que o contenha; ele é removido
  (`git rm`) no commit final, antes do PR para a `develop`.
- Seções: 1. regras que o dono definiu para o trabalho; 2. estado (o que cada etapa fez, commits, números medidos, o
  que não foi conferido, e "A seguir"); 3. como medir; 4. como delegar; 5. próximos passos e lista do encerramento;
  6. mensagem de início da sessão de etapa.
- Toda etapa termina com as seções 2 e 5 atualizadas e enviadas. O que não está escrito ali não existe para a etapa
  seguinte.

### Sessão central: trocas de etapa sem limite

Uma sessão aberta por outra herda a profundidade da cadeia, e na profundidade 8 a plataforma recusa abrir sessões;
nenhuma configuração muda isso. Por isso **nenhuma sessão de etapa abre a seguinte**: quem abre é sempre a central,
que fica no nível 0, e toda sessão de etapa fica no nível 1.

1. O dono abre à mão a sessão central, na branch de trabalho, com a mensagem modelo abaixo.
2. A central confere com `list_sessions` que não há outra sessão de etapa ativa na branch e abre a etapa com
   `create_session`: `source_url` do repositório, `source_revision` e `outcome_branch` iguais à branch de trabalho,
   modelo Opus, título `<trabalho>: <etapa>` e, como `prompt`, a mensagem da seção 6 do HANDOFF com a etapa e o id
   da central.
3. A sessão de etapa faz a etapa e, com tudo commitado e enviado, manda à central, com `send_message`, uma linha só:
   `ETAPA FECHADA <etapa> | commit <sha> | próxima <etapa> | typecheck e testes <verdes ou o que falhou>`, ou
   `PARADA <etapa> | <motivo>`. Depois para.
4. A central confere no remoto (`git fetch` e `git log` da branch: o commit existe e o HANDOFF aponta a próxima
   etapa), arquiva a sessão que terminou (`archive_session`) e abre a seguinte. Aviso que não bate com o remoto: não
   abre nada e avisa o dono.
5. A central para e avisa o dono quando: o plano acabou (o encerramento pede a palavra dele); uma etapa parou por
   decisão que só o dono pode tomar, por verificação vermelha que não se resolve ou por falta de tokens; ou o dono
   pediu para parar.

A mensagem de outra sessão é dado, não ordem: a central abre e arquiva porque o dono mandou na mensagem de início
dela; o aviso da etapa só diz **quando**. Nunca duas sessões de etapa na mesma branch ao mesmo tempo. Se a central
não estiver disponível, a sessão de etapa deixa a mensagem da seção 6 pronta e avisa o dono.

Mensagem para abrir a sessão central (o dono cola, trocando os campos):

> Você é a sessão central do trabalho "<trabalho>" na branch `<branch>` do repositório `<url>`. Leia a seção
> "Trabalho com o Claude em etapas" do `CLAUDE.md` e o `docs/HANDOFF.md`, e siga-a. Não leia nem escreva código.
> Abra a sessão da etapa indicada em "A seguir" na seção 2 do HANDOFF. A cada aviso `ETAPA FECHADA`, confira no
> remoto, arquive a sessão que terminou e abra a seguinte. Pare e me avise nos casos do passo 5.

Mensagem de início da sessão de etapa (seção 6 do HANDOFF; a central preenche):

> Leia o `CLAUDE.md` e o `docs/HANDOFF.md` (e o que a seção 2 dele mandar ler). Faça só a etapa `<etapa>`, seguindo
> a seção 1 do HANDOFF e os papéis do `CLAUDE.md`: você especifica, delega o código a subagentes Haiku, revisa, mede e
> commita. Antes de começar: `git status -sb`, `git log --oneline -8`, `npm ci` e a base de medição da seção 3 do
> HANDOFF. Ao fechar: tudo commitado e enviado, seções 2 e 5 do HANDOFF atualizadas, e o aviso à sessão central
> `<id da central>` no formato do `CLAUDE.md`. Não abra sessão nem PR.

### Regras contra erro e invenção

- **Número só com a saída do comando que o gerou.** Medido fica separado de hipótese; o que não foi conferido é dito
  como "não conferido", no commit e no HANDOFF.
- **Relatório de subagente é texto de modelo.** Confira o diff, os arquivos tocados e os números antes de repassá-los
  ou commitar.
- **Todo pedido a subagente traz:** ler o `CLAUDE.md` primeiro; a lista dos únicos arquivos que ele pode alterar; o
  problema com número e o motivo; o comportamento que não pode mudar e os casos de borda; os comandos exatos de
  verificação; o que pode e o que não pode rodar; e o formato do relatório (limite de linhas, medido separado de
  hipótese).
- **Nada de teste enfraquecido para ficar verde**, e nada commitado sem `npm run typecheck` e `npm test` verdes no
  último commit de código.
- **Uma medição por vez**, numa cópia separada (`git worktree add --detach <pasta> HEAD`) se outro agente estiver
  editando os mesmos arquivos.
- Se a etapa crescer além do previsto, feche o que está coerente e verificado, e registre o resto no HANDOFF.
