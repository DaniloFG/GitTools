# Desempenho do GitTools: análise e plano de melhoria

Este documento registra onde o GitTools gasta tempo hoje, com números medidos, e o plano para deixá-lo rápido
também em computadores fracos. As regras do dia a dia que saem daqui estão no [`CLAUDE.md`](../CLAUDE.md).

- [1. Resumo](#1-resumo)
- [2. Como foi medido](#2-como-foi-medido)
- [3. Linha de base](#3-linha-de-base)
- [4. O que já está bem resolvido](#4-o-que-já-está-bem-resolvido)
- [5. Achados](#5-achados)
- [6. Plano de melhoria](#6-plano-de-melhoria)
- [7. Orçamentos](#7-orçamentos)
- [8. Resultado da Fase 1](#8-resultado-da-fase-1)

## 1. Resumo

O GitTools abre rápido e já tem uma boa base de cache. O que o deixa lento em máquina fraca não é a carga
inicial: é o que acontece **durante o uso**. Em ordem de impacto:

1. **Telas que desenham tudo de uma vez.** O diff, o blame e as listas de branches e tags montam uma linha no
   DOM para cada item, sem janela. Um diff de 5.000 linhas alteradas vira 161.726 nós e trava a tela por
   **20 segundos** com a CPU 4× mais lenta (4,4 s numa máquina rápida). Depois de aberto, cada clique numa
   linha custa ~1,9 s e cada quadro de rolagem, 800 ms.
2. **Arrastar uma divisória redesenha o aplicativo inteiro a cada movimento** e grava no `localStorage` a cada
   movimento: 258 ms por passo no uso normal (cerca de 4 quadros por segundo).
3. **Processos git demais por ação.** Marcar um arquivo para o stage roda 1 comando útil e mais **16 leituras**;
   ganhar o foco da janela roda 7; cada commit selecionado roda 5, sem cancelar os anteriores (segurar a seta
   por 10 commits abre 50 processos). No Linux desta medição um processo git custa ~3 ms; no Windows criar um
   processo é bem mais caro, e é lá que isso mais pesa.
4. **O estado do repositório é lido do jeito caro, sempre.** Toda atualização pede as linhas adicionadas e
   removidas de cada arquivo, o que lê do disco todos os arquivos não rastreados: com 2.000 deles, o status
   passa de 15 ms para 331 ms.
5. **O histórico não é uma lista virtual.** As linhas se acumulam ao rolar (120 → 500) e cada lote novo é uma
   tarefa longa: 39 ms por quadro com a CPU 4× mais lenta, com pausas de até 376 ms.
6. **O pacote carrega o que não usa.** O aplicativo Electron é publicado **sem minificação** (2,08 MB de
   JavaScript; minificado seriam 1,25 MB) e 48% do código da interface são traduções dos idiomas que não
   estão em uso. Nada é carregado sob demanda.

Os itens 1 a 3 são os que o usuário sente como "travou". O plano (seção 6) começa por eles.

## 2. Como foi medido

Os roteiros ficam em `scripts/perf/` e geram os mesmos números em qualquer máquina:

```bash
node scripts/perf/stress-repo.mjs          # cria o repositório de teste (uma vez; fica na pasta temporária)
node scripts/perf/core.mjs moderate        # leituras do git e funções puras (cenários: clean, moderate, heavy)
npm run build:extension                    # a interface empacotada, usada pelo roteiro abaixo
node scripts/perf/ui.mjs 4 moderate        # a interface com a CPU 4× mais lenta (--trace lista os comandos git)
```

- **Repositório de teste** (sintético e determinístico): 20.003 commits com merges, 1.142 branches e tags,
  6.001 arquivos (1.200 numa pasta só), um commit que altera 3.000 arquivos e outro com 5.000 linhas alteradas
  num arquivo de 20.000 linhas. Cenários da pasta de trabalho: `clean`, `moderate` (30 arquivos alterados e 10
  novos) e `heavy` (300 alterados e 2.000 novos).
- **Interface**: a de verdade, num Chromium ligado ao `Backend` real (o mesmo arranjo de `scripts/readme-media`).
  O computador fraco é simulado limitando a CPU em 4× (`Emulation.setCPUThrottlingRate`).
- **Ambiente desta medição**: Linux x64, git 2.43, Node 22, disco rápido.

Limites do que foi medido, para ler os números com a cautela certa:

- A limitação de CPU não simula disco lento nem o custo de criar processos no Windows. Por isso a métrica de
  git que vale é a **quantidade de processos**, que não depende da máquina.
- A interface foi medida com o pacote do webview (minificado). O aplicativo Electron usa o mesmo código, porém
  sem minificação na época desta medição (achado D1, corrigido na Fase 1; ver seção 8); a inicialização do Electron em si não foi medida.
- Blame e Dashboards foram medidos só na camada de dados; os problemas de desenho deles vêm da leitura do código.

## 3. Linha de base

Interface, cenário `moderate`:

| Interação | Sem limitar a CPU | CPU 4× mais lenta |
| --- | --- | --- |
| Carga a frio até a 1ª linha do histórico | — | 1,0–1,1 s |
| Rolar o histórico | 17 ms por quadro, sem tarefas longas | 39 ms por quadro, 28 tarefas longas (maior: 376 ms) |
| Arrastar divisória (diff pequeno aberto) | 57 ms por passo | 258 ms por passo |
| Abrir a tela Changes | 149 ms | 372 ms |
| Abrir diff de 5.000 linhas alteradas | 4,4 s (maior tarefa: 2,6 s) | 20,0 s (maior tarefa: 13,5 s) |
| Rolar esse diff | 93 ms por quadro | 800 ms por quadro |
| Marcar 1 linha nesse diff | 0,3–0,5 s | 1,8–3,3 s |
| Arrastar divisória com esse diff aberto | 1,1 s por passo | 7,1 s por passo |

Processos git por interação (não dependem da máquina):

| Interação | Processos | Quais |
| --- | --- | --- |
| Carga inicial | 14–16 | abrir (2), `--version`, `status` ×2, numstat ×2, refs, operação, `rev-parse HEAD`, log, e 5 do commit selecionado |
| A janela ganha o foco | 7 | `status` ×2, operação ×2, refs, numstat ×2 |
| Selecionar 1 commit | 5 | `show`, `diff --name-status`, `diff --numstat`, `rev-list --parents`, `diff` |
| 10× seta ↓ no histórico | 50 | 5 por commit, nenhum cancelado |
| Stage de 1 arquivo | 17 | 1 `add` e 16 leituras: `status` ×3, operação ×3, refs ×2, numstat ×4, `ls-files`, `diff` ×2, `--version` |

Leituras do git (mediana; a última coluna é o que atravessa do processo principal para a interface):

| Leitura | Tempo | Processos | Tamanho |
| --- | --- | --- | --- |
| `status()` | 12–15 ms | 1 | 4 KB |
| `status(true)`, cenário `moderate` | 26–34 ms | 3 | 5 KB |
| `status(true)`, cenário `heavy` (2.000 não rastreados) | 331–421 ms | 3 | 288 KB |
| `refs()` (1.142 refs) | 32 ms | 1 | 145 KB |
| `log` de 500 commits | 43 ms | 2 | 117 KB |
| `commitDetails` de 3.000 arquivos | 225–250 ms | 3 | 232 KB |
| `diff` de 1 arquivo com 5.000 linhas alteradas | 40 ms | 2 | 2,8 MB |
| `diff` do commit de 3.000 arquivos, sem caminho | 350 ms | 2 | 12,6 MB |
| `blame` de 20.000 linhas | 318 ms | 1 | 2,6 MB |
| `analytics` (dashboards, 20 mil commits) | 3,9–4,9 s | 3 | 7,5 MB |

Funções puras e pacote:

| Item | Hoje | Referência |
| --- | --- | --- |
| Data de uma linha do histórico (`toLocaleString` a cada chamada) | 0,058–0,076 ms | 0,001 ms com o formatador guardado |
| `formatRelative` (cria um `Intl.RelativeTimeFormat` por chamada) | 0,023 ms | 0,001 ms com o formatador guardado |
| `buildTree` com 30.000 arquivos | 357–471 ms | cresce com o quadrado; 10.000 arquivos = 58 ms |
| JavaScript da interface no Electron | 2.076 KB, sem minificar | 1.249 KB no webview, que é minificado |
| CSS da interface no Electron | 132 KB | 97 KB minificado |
| Traduções no pacote da interface | 48% do código | só 1 idioma (e o de reserva) é usado por vez |

Medidos e **sem problema** (não vale otimizar): `t()` custa 0,002 ms; `computeGraph` de 5.000 commits, 7–10 ms;
`mergeData` com 2.300 arquivos e 1.100 branches, 3,5 ms.

## 4. O que já está bem resolvido

Vale preservar; as regras do `CLAUDE.md` partem daqui.

- **Cache de leituras por repositório** (`src/renderer/src/readCache.ts`): leituras por sha valem para sempre, as
  voláteis valem até a "geração" mudar, chamadas iguais ao mesmo tempo viram uma só, com limite de memória.
- **Sessão por repositório** (`repoSession.ts`): voltar a uma aba em dia não chama o git; dado velho aparece
  na hora e é relido por trás.
- **Só o que está na tela é montado e lido** (`slots.tsx`: `PaneSlot`, `WhenShown`, `useAnyShown`; `Wants` em `App.tsx`).
- **O histórico só é baixado de novo quando uma ref muda de lugar** (`historySignature` em `stable.ts`) e os dados
  iguais mantêm a mesma referência (`mergeData`), o que evita redesenhos.
- **Git sem travar o índice e sem linha de comando gigante**: `GIT_OPTIONAL_LOCKS=0`, caminhos pela entrada padrão
  (`--pathspec-from-file`, `--stdin`), lotes (`chunkArgs`), `cat-file --batch-check` em vez de um processo por arquivo.
- **Leituras de segundo plano limitadas** (`Limiter(2)` em `git.ts`) e listas de arquivos montadas em lotes de 300
  (`FileEntries`).
- **Linhas do histórico memorizadas** (`CommitRow` com `handlers` por referência) e grafo calculado uma vez por lista
  (`graphFor`).

## 5. Achados

Cada achado traz a evidência, a causa e a correção. Prioridade: **A** trava a tela, **B** gasta processos git,
**C** tira a fluidez, **D** pesa na carga, **E** é detalhe.

### A. Travamentos

**A1. O diff é desenhado inteiro, e cada clique o redesenha inteiro.**
`components/DiffView.tsx:270-409` monta uma `<tr>` por linha, sem janela e sem memorização; a seleção é um `Set`
no componente de cima, então marcar uma linha redesenha as 25 mil. Agravantes:

- o modo "em cima e embaixo" usa tabela de largura automática (`styles.css:1106`; só `.diff-split` tem
  `table-layout: fixed`), que obriga o navegador a medir todas as células a cada mudança;
- não há limite de tamanho: `maxOutputBytes` existe em `core/exec.ts:55`, mas só o terminal o usa. O diff de um
  arquivo com 5.000 linhas alteradas chega à interface como 2,8 MB de objetos (um por linha) e o de um commit
  inteiro, 12,6 MB;
- "arquivo inteiro" pede `-U1000000` (`core/repository.ts:60`), sem teto.

Correção: desenhar por janela (blocos de linhas memorizados, só os visíveis montados), seleção que redesenha só
o bloco tocado, tabela de largura fixa, e um teto no núcleo (bytes e linhas) com a opção "mostrar mesmo assim".

**A2. A régua de alterações mede o DOM a cada clique e redesenha a cada quadro de rolagem.**
`components/ChangeRuler.tsx:112-116` observa classes e atributos de toda a subárvore: cada linha marcada dispara
`querySelectorAll` e `getBoundingClientRect` em todas as linhas alteradas (`:86`). O ouvinte de rolagem é global e
em captura (`:121`): rolar **qualquer** lista do aplicativo chama `setView` (`:67`) e redesenha todas as marcas.
Correção: calcular as marcas a partir dos dados do diff (índices das linhas), desenhá-las num único elemento
(canvas ou gradiente) e mover a área visível por estilo direto, ouvindo só o próprio elemento que rola.

**A3. Arrastar uma divisória redesenha o aplicativo inteiro e grava no disco a cada movimento.**
`useDock()` é lido em `RepoView` (`App.tsx:618`). Cada `pointermove` chama `onChange` (`components/Dock.tsx:348-350`),
que passa por `writeLayout` (`layout.ts:40-49`): `JSON.stringify`, `localStorage.setItem` (síncrono) e aviso a
todos os assinantes do layout. O resultado é o redesenho de `RepoView` e de tudo abaixo dele; o objeto `meta`
(`App.tsx:956-979`) é recriado a cada vez, e nenhum painel é memorizado. `Split.tsx:160-165` faz o mesmo.
Correção: durante o arrasto, aplicar o tamanho por estilo direto nas duas células e gravar uma vez ao soltar;
assinar o arranjo só em `Dock` e `Toolbar`; `meta` memorizado; painéis com `React.memo`.

**Atualização (Fase 1):** a parte do React e do `localStorage` foi corrigida: `RepoView` e a lista de commits deixaram
de ser redesenhados no arrasto, e o arranjo é gravado uma vez, ao soltar. O custo que resta é de layout e pintura do
navegador, proporcional ao conteúdo montado; ver a [seção 8](#8-resultado-da-fase-1).

**A4. O blame desenha todas as linhas e formata uma data por linha.**
`components/FilesView.tsx:201-236`: uma `<tr>` por linha do arquivo, cada uma com `fullDate()` no `title`
(0,06 ms cada; 20 mil linhas somam mais de 1 s só nisso) e `color-mix()` no estilo. O efeito em `:158-167` refaz o
`git blame` (318 ms) a cada mudança de `data.status`, mesmo que o arquivo não tenha mudado.
Correção: janela, dica calculada só ao passar o mouse, e reler apenas quando o HEAD ou o próprio arquivo mudar.

### B. Processos git

**B1. Cada mudança é lida duas ou três vezes.**
Depois de uma operação, `run` chama `refresh()` no `finally` (`App.tsx:849-852`); 250 ms depois o observador da
pasta `.git` avisa (`backend/backend.ts:264-273`) e a aba agenda outro `refresh()` (`App.tsx:815-827`), que invalida
o cache de novo. Em paralelo, o resumo da aba ativa faz o seu próprio `status()` sem estatísticas
(`App.tsx:192-201`), com chave de cache diferente do `status(true)` da tela. No foco da janela, o nível do app
invalida tudo e a aba invalida outra vez 150 ms depois. É por isso que 1 `git add` vira 17 processos.
Correção: um único agendador de atualização por repositório; ignorar o aviso do observador causado pela própria
operação; o resumo da aba ativa sai dos dados já carregados.

**B2. `status(true)` lê todos os arquivos não rastreados, sem limite.**
`core/repository.ts:392-394` abre um `lstat` e um `readFile` por arquivo não rastreado, todos ao mesmo tempo
(`Promise.all` sem limite: milhares de arquivos abertos de uma vez), só para contar linhas; arquivos de até 5 MB
são lidos inteiros (`:399-412`). Isso roda em toda atualização, mesmo sem a lista de alterações na tela.
Correção: `status` leve por padrão; as contagens (dois `numstat` e os não rastreados) só quando a lista está
visível, com limite de quantidade, fila de poucas leituras por vez e cache por caminho, tamanho e data.

**B3. Selecionar um commit custa 5 processos e nada é cancelado.**
`commitDetails` usa 3 (`core/repository.ts:491-518`) e o `diff` de commit usa 2, um deles só para descobrir o
pai (`:541-545`, `:557-561`), que a interface já tem. `SingleCommit` não descarta respostas atrasadas
(`components/CommitDetails.tsx:116-125` e `:163-171` não têm `cancelled`): além dos processos à toa, um diff antigo
pode sobrescrever o novo. Não há espera entre a tecla e a leitura.
Correção: detalhes num processo (`git show --raw --numstat -z`), diff sem `rev-list`, espera curta (80–120 ms)
antes de ler, descarte das respostas substituídas e, de preferência, cancelamento do processo.

**B4. Leituras que podiam não abrir processo.**
- `operationState` roda `git rev-parse --git-path …` toda vez (`core/repository.ts:623-653`); o caminho da pasta
  `.git` não muda e pode ser guardado ao abrir.
- `log` roda `rev-parse --verify HEAD` antes (`:467`); o `status` da mesma rodada já diz se há HEAD.
- Abrir um repositório roda `rev-parse --show-toplevel` e depois `rev-parse --git-dir` (`:310`, `backend.ts:250`); um só responde os dois.
- A carga pede `appInfo()` só pelos idiomas do sistema (`App.tsx:420`), o que roda `git --version`.

**B5. Trabalho síncrono no caminho de toda chamada.**
`Backend.keyOf` (`backend/backend.ts:218-223`) chama `comparablePath`, que usa `realpathSync` (`core/paths.ts:12-20`),
para o caminho pedido e para cada repositório aberto, em **toda** chamada `repo:invoke`. É disco síncrono no
processo principal. Correção: guardar a chave de cada root aberto.

**B6. Não há limite de processos git simultâneos no núcleo.**
Só as leituras de segundo plano da interface têm limite. Um repositório grande e uma tela cheia de painéis abrem
vários `git` de uma vez, que disputam o mesmo disco e os mesmos núcleos. Correção: fila no `Backend`, com
prioridade para o que o usuário está vendo.

**B7. Dashboards leem e convertem tudo no processo principal.**
`analytics` (`core/repository.ts:1418-1477`) junta 20 mil commits em 3,9–4,9 s e manda 7,5 MB de uma vez. A
conversão roda no processo principal, que nesse tempo não atende nenhuma outra janela nem chamada.
Correção: processo auxiliar (`utilityProcess` ou worker), envio em partes com progresso, formato em colunas e
cache em disco pela assinatura do histórico.

### C. Fluidez de listas

**C1. O histórico acumula linhas em vez de usar uma janela.**
`components/CommitList.tsx:25-31` e `:131-144`: começa com 120 linhas e acrescenta 160 a cada aproximação do fim,
sem nunca retirar. Cada lote é uma tarefa longa. Cada linha custa três formatações de data sem formatador
guardado (`:506-507`; ver C3), um `<svg>` e, se tem etiqueta de branch, um `BranchBadge` com quatro hooks ligados
ao contexto global (`:844-876`). As linhas têm altura fixa (30 px), então a janela real é simples.

**C2. Um contexto só, com tudo dentro.**
`AppContextValue` (`context.tsx:61-111`, montado em `App.tsx:865-927`) junta dados, operação em andamento, abas,
configurações e vinte funções. Qualquer mudança redesenha todo componente que chama `useApp()`, e isso inclui
itens de lista: `BranchItem`, `TagItem`, `StashItem`, `BranchBadge`, `FileIcon`. Cada operação muda `busy`
duas vezes e os dados uma. Correção: separar dados, ocupado, ações (estáveis) e configurações; item de lista
não lê contexto, recebe o que precisa por propriedades estáveis (como `CommitRow` já faz).

**C3. Datas formatadas do jeito mais caro.**
`shared/i18n/index.ts:69-117`: `toLocaleString` monta um formatador a cada chamada e `formatRelative` cria um
`Intl.RelativeTimeFormat` a cada chamada (`:111`). São 60 a 75 vezes mais lentas do que usar um formatador
guardado, e são chamadas por linha (histórico, blame, branches, stashes). É a correção mais barata da lista.

**C4. Branches e tags sem limite e com trabalho repetido.**
`components/Sidebar.tsx`: todas as linhas são montadas (`:221-262`); o agrupamento das remotas copia o array a
cada item (`:72-75`, quadrático); `checked.includes` por linha (`:84`); a árvore é refeita a cada desenho (`:233`);
`commitColors` cria um `Map` de 500 entradas a cada desenho (`:56`); `relativeDate` por item no `title` (`:303`).

**C5. `buildTree` é quadrático.** `fileTree.ts:45` procura a subpasta com `find` entre os filhos, a cada arquivo.
Correção: um `Map` por pasta.

**C6. Ícones por `innerHTML`.** `components/FileList.tsx:18-25`: cada linha injeta um SVG como texto e assina o
contexto e o tema. Correção: símbolos reutilizados (`<use>`) e o ícone recebendo o tema por propriedade.

**C7. Comparações por `JSON.stringify` em dados grandes.** `ChangesView.tsx:122` e `CommitDetails.tsx:396`
serializam o diff anterior e o novo a cada leitura; `ChangesView.tsx:111-129` refaz o diff do arquivo aberto a
cada mudança de `status`, mesmo de outro arquivo. Correção: comparar por identificador (o blob do `index`).

### D. Carga e tamanho

**D1. O aplicativo Electron é publicado sem minificação.**
O `electron-vite` 4 usa `minify: false` por padrão nos três alvos e `electron.vite.config.ts` não muda isso:
2.076 KB de JavaScript em 40 mil linhas, contra 1.249 KB do mesmo código no webview. O CSS vai com comentários
(132 KB contra 97 KB). O ganho medido no tempo de análise do código é pequeno (26 ms → 22 ms); o ganho real é
em leitura de disco e memória. Uma linha de configuração.

**D2. Seis idiomas dentro de todos os pacotes.**
`shared/i18n/messages/index.ts` importa os seis catálogos de forma estática: são 48% do JavaScript da interface
e também vão no processo principal (663 KB) e na extensão (766 KB). Correção: carregar o idioma ativo e o de
reserva sob demanda.

**D3. Nada é carregado sob demanda.** Não há um `import()` no projeto. Dashboards (7% do pacote), Studio, editor
de conflitos, rebase, comparação, clone e editor (4%), terminal (3%) e configurações (2%) entram na primeira
carga, embora só apareçam quando pedidos.

**D4. A janela espera o que não precisa.** `main/index.ts:144-171` só cria a janela depois de ler as
configurações e, com um caminho na linha de comando, depois de abrir o repositório; `reopenSaved`
(`backend/backend.ts:193-206`) reabre os repositórios da sessão um por vez (2 processos git cada).

**D5. Na extensão, o painel só aparece depois da descoberta.** `Controller.open()` espera
`useWorkspaceRepository()` (`extension/src/extension.ts:134-175`): varredura de até 5.000 pastas, uma por vez, e,
para cada repositório achado, 2 processos git e duas gravações de arquivo (`rememberRepo` e `saveWorkspace`).
Correção: criar o painel primeiro e descobrir por trás, gravando uma vez no fim.

### E. Detalhes

- `transition: all` em `styles.css:3539` e `:4351`; `backdrop-filter` em `:2118` e `:2412` (caro sem GPU).
- `ReadCache.invalidate` copia todas as entradas a cada invalidação (`readCache.ts:232-235`).
- Cada comando git gera dois avisos `git:command` para todas as janelas (`main/index.ts:18-20`), mesmo sem o
  painel do log aberto.
- `document.querySelectorAll('.commit-row')` a cada seta (`CommitList.tsx:206`).
- O histórico para em 500 commits (`core/repository.ts:470`); com a janela real, dá para paginar.

## 6. Plano de melhoria

Ordem pensada para o usuário sentir o ganho logo e para cada fase preparar a seguinte. Tamanho: **P** até meio
dia, **M** um a dois dias, **G** três dias ou mais. Cada item só está pronto com os números de `scripts/perf`
antes e depois.

### Fase 0 — Medir sempre (feito nesta entrega)

- Roteiros em `scripts/perf/` e orçamentos na seção 7.
- A fazer (P): conferir o tamanho do pacote no CI e falhar se passar do orçamento.

### Fase 1 — Ganhos rápidos (cerca de 3 dias, risco baixo)

| # | Mudança | Achado | Tamanho |
| --- | --- | --- | --- |
| 1.1 | `build.minify` no `electron.vite.config.ts` (interface e processo principal) | D1 | P |
| 1.2 | Formatadores `Intl` guardados por idioma e formato | C3 | P |
| 1.3 | Gravar o layout ao soltar o arrasto; durante o arrasto, só estilo | A3 | M |
| 1.4 | `useDock()` fora de `RepoView`; `meta` memorizado | A3 | P |
| 1.5 | `cancelled` nos efeitos de `CommitDetails` e espera curta entre seleção e leitura | B3 | P |
| 1.6 | Resumo da aba ativa a partir dos dados já lidos; um agendador de atualização | B1 | M |
| 1.7 | `operationState` sem processo; `log` sem `rev-parse`; `keyOf` com cache | B4, B5 | P |
| 1.8 | Tabela do diff com largura fixa | A1 | P |

Fase concluída. Os resultados medidos, as metas atingidas e as que não foram atingidas estão na
[seção 8](#8-resultado-da-fase-1).

### Fase 2 — Fim dos travamentos (cerca de 1 semana)

| # | Mudança | Achado | Tamanho |
| --- | --- | --- | --- |
| 2.1 | Componente único de lista em janela (altura fixa e altura medida) | A1, A4, C1, C4 | G |
| 2.2 | Diff por blocos memorizados, com seleção por bloco | A1 | G |
| 2.3 | Teto de tamanho do diff no núcleo, com "mostrar mesmo assim" | A1 | M |
| 2.4 | Régua de alterações calculada dos dados e desenhada num elemento só | A2 | M |
| 2.5 | Blame em janela; reler só quando o arquivo ou o HEAD mudar | A4 | M |
| 2.6 | Histórico em janela real (e paginação além de 500 commits) | C1 | M |

Meta: nenhuma tela com mais de 5.000 nós no DOM; abrir o diff de 5.000 linhas em menos de 300 ms e marcar uma
linha em menos de 50 ms, com a CPU 4× mais lenta.

Fase concluída. Resultados, metas atingidas e não atingidas na [seção 9](#9-resultado-da-fase-2).

### Fase 3 — Menos git (cerca de 1 semana)

| # | Mudança | Achado | Tamanho |
| --- | --- | --- | --- |
| 3.1 | `status` leve por padrão; contagens de linhas sob demanda, com limite e cache | B2 | M |
| 3.2 | `commitDetails` em 1 processo; `diff` de commit sem `rev-list` | B3 | M |
| 3.3 | Cancelamento de verdade (`AbortSignal` até o `runGit`) | B3 | M |
| 3.4 | Fila de processos git no `Backend`, com prioridade | B6 | M |
| 3.5 | Ignorar o aviso do observador causado pela própria operação (feito na Fase 1) | B1 | M |

Meta: selecionar um commit com 2 processos; 10 setas seguidas com até 6; `status` do cenário `heavy` em até
2× o `status()` simples.

Fase concluída. Resultados na [seção 10](#10-resultado-da-fase-3).

### Fase 4 — Listas e redesenhos (cerca de 1 semana)

| # | Mudança | Achado | Tamanho |
| --- | --- | --- | --- |
| 4.1 | Contexto dividido (dados, ocupado, ações, configurações) | C2 | G |
| 4.2 | Itens de lista sem contexto: propriedades e manipuladores estáveis | C2, C4 | M |
| 4.3 | Branches e tags: agrupamento linear, `Set`, árvore memorizada | C4 | P |
| 4.4 | `buildTree` com `Map` | C5 | P |
| 4.5 | Ícones por símbolo reutilizado | C6 | M |
| 4.6 | Comparação de diffs por identificador, não por `JSON.stringify` | C7 | P |

Meta: rolar o histórico sem tarefas longas e em até 16 ms por quadro com a CPU 4× mais lenta.

### Fase 5 — Carga e trabalho pesado fora da interface (cerca de 1 semana)

| # | Mudança | Achado | Tamanho |
| --- | --- | --- | --- |
| 5.1 | Idiomas sob demanda (interface, processo principal e extensão) | D2 | M |
| 5.2 | `React.lazy` nas telas e diálogos que não aparecem na abertura | D3 | M |
| 5.3 | Criar a janela antes de ler configurações e repositórios; reabrir a sessão em paralelo | D4 | P |
| 5.4 | Extensão: painel primeiro, descoberta por trás, uma gravação no fim | D5 | M |
| 5.5 | Dashboards num processo auxiliar, em partes, com cache em disco | B7 | G |

Meta: JavaScript da primeira carga em até 700 KB; carga inicial com até 8 processos git.

## 7. Orçamentos

Valem para o repositório de teste, cenário `moderate`, com `node scripts/perf/ui.mjs 4`. "Hoje" é a medição ao fim da Fase 3; a meta é o que o plano busca. Enquanto a meta não é atingida, a regra é **não piorar o "hoje"**.

| Métrica | Hoje | Meta |
| --- | --- | --- |
| Processos git: a janela ganha o foco | 2 | ≤ 3 |
| Processos git: stage de 1 arquivo | 9 | ≤ 6 |
| Processos git: selecionar 1 commit | 2 | ≤ 2 |
| Processos git: 10× seta no histórico | 4 | ≤ 6 |
| Processos git: carga inicial | 6 | ≤ 8 |
| Rolar o histórico (CPU 4×, 30 quadros de 400 px) | 45–73 ms por quadro (antes da janela: ~41) | ≤ 16 ms |
| Tarefas longas ao rolar o histórico (CPU 4×) | 1–13 (maior 50–123 ms) | 0 |
| Arrastar divisória (CPU 4×) | 71–122 ms por passo (34–41 linhas montadas); com o diff de 5.000 linhas, 151–160 ms | ≤ 16 ms |
| Abrir diff de 5.000 linhas alteradas (CPU 4×) | 0,93–0,99 s | ≤ 300 ms |
| Marcar 1 linha nesse diff (CPU 4×) | 26–61 ms | ≤ 50 ms |
| Nós no DOM, em qualquer tela | ≤ 1.645 (histórico, diff de 5.000 linhas, blame de 20 mil) | ≤ 5.000 |
| `status` no cenário `heavy` | com contagens 129 ms (simples 15 ms); sem contagens, que é o caso da atualização fora das telas que as mostram, igual ao simples | ≤ 2× o `status()` simples |
| JavaScript da primeira carga (Electron) | 1.251 KB | ≤ 700 KB |

A meta do arrasto de divisória depende da lista em janela da Fase 2 (itens 2.1 e 2.6): o custo que resta é de layout
e pintura do conteúdo montado, e não do React.

## 8. Resultado da Fase 1

A Fase 1 (seção 6) foi implementada e medida com os roteiros da linha de base (seção 3): `ui.mjs 4 moderate` para a
interface, `core.mjs moderate` para o git e `npm run build` para o tamanho do pacote. Os números de "antes" são os da
seção 3.

### O que foi feito

| Item | O que mudou | Resultado medido |
| --- | --- | --- |
| 1.1 Minificação | `build.minify` nos três alvos do `electron.vite.config.ts` | JavaScript da interface 2.076 KB → 1.251 KB; CSS 132 KB → 96 KB; processo principal 663 KB → 541 KB |
| 1.2 Formatadores `Intl` | Formatadores guardados em `src/shared/i18n/index.ts`; teste confirma texto idêntico nos seis idiomas | `formatShortDateTime`: 0,058–0,076 ms → 0,003 ms por chamada; `formatRelative`: 0,023 ms → 0,001 ms. Rolagem do histórico: sem ganho comprovado (39 ms por quadro antes; 24–44 ms depois) |
| 1.3 Arrasto em lote | `startResize` abre um lote de layout, grava no `localStorage` só ao soltar e entrega um movimento por quadro | Sem ganho no tempo por passo (ver o diagnóstico do arrasto, logo abaixo) |
| 1.4 `Dock`, `Toolbar` e `meta` | `Dock` e `Toolbar` leem o arranjo por conta própria; `RepoView` e a lista de commits deixam de ser redesenhados no arrasto (confirmado por perfil); `meta` memorizado | O custo de script caiu para cerca de 9 ms por passo; o passo continua caro (ver o diagnóstico do arrasto, logo abaixo) |
| 1.5 Cancelamento e espera | `cancelled` nos efeitos de `CommitDetails`; espera com dois tempos em `src/renderer/src/settle.ts` (400 ms sem mudanças para valer na hora; 120 ms dentro de uma rajada). A primeira versão, com um tempo só (100 ms), não funcionou em máquina lenta (36 processos), porque cada seleção leva mais de 100 ms para ser desenhada | 10 setas: 50 → 10 processos. Selecionar 1 commit segue em 5 (não era alvo desta fase) |
| 1.6 Resumo e eco do observador | Resumo da aba ativa a partir dos dados já lidos. O aviso do observador causado pela própria operação é ignorado quando os dados já foram lidos depois dela (`repoSession.ts`, `isOwnEcho`; o carimbo vale para um aviso só). A parte do eco estava prevista como item 3.5 e foi antecipada | Foco: 7 → 4 processos. Stage de 1 arquivo: 17 → 9 processos |
| 1.7 Leituras sem processo | `operationState` sem processo; `log` sem `rev-parse` depois de ver o HEAD; abertura do repositório em um processo só; `Backend.keyOf` sem disco a cada chamada | `operationState()`: 1 → 0 processos; `log({ all: true })`: 2 → 1 processo; linha "ATUALIZAÇÃO" de `core.mjs`: 7 → 5 processos |
| 1.8 Tabela do diff | Tabela do diff unificado com `table-layout: fixed` e larguras por `<col>` | Sem ganho medido no diff de 5.000 linhas (20 s antes; 18–20 s depois). O custo ali é montar 161.732 nós; fica para a Fase 2 |

Abrir a tela Changes não teve mudança comprovada: as faixas de antes e depois se sobrepõem, em torno de 400 a 700 ms.

### O diagnóstico do arrasto estava incompleto

O achado A3 (seção 5) atribuía o custo do arrasto ao redesenho do React e à gravação no `localStorage`. Essas duas
partes foram corrigidas (itens 1.3 e 1.4), e o tempo por passo não caiu. O perfil feito depois da correção mostra, por
passo com a CPU 4× mais lenta e 500 linhas do histórico montadas: script de cerca de 9 ms, layout do navegador de
92–107 ms e pintura de cerca de 75–92 ms. Com 120 linhas montadas, o passo custa 124 ms, dos quais 31 ms são de layout.

Ou seja, o custo acompanha a quantidade de conteúdo montado, e o histórico acumula linhas ao rolar (achado C1). A
correção de verdade é a lista em janela (itens 2.1 e 2.6).

### Testado e não adotado

`content-visibility: auto` nas linhas do histórico. Numa rodada de cada, o layout do arrasto com 500 linhas caiu de
97 ms para 42 ms por passo (262 → 177 ms por passo no total), mas a rolagem do histórico foi de 24 para 32 ms por
quadro. Como a rolagem varia muito entre rodadas, o efeito nela não ficou comprovado para nenhum dos lados. A mudança
foi desfeita; a lista em janela da Fase 2 é o caminho previsto para os dois casos.

### Metas da Fase 1

| Meta | Resultado | Situação |
| --- | --- | --- |
| Foco da janela: até 4 processos | 4 | Atingida |
| Stage de 1 arquivo: até 8 processos | 9 | Não atingida (um processo acima) |
| Arrasto de divisória: abaixo de 30 ms por passo | 262–291 ms por passo | Não atingida; o motivo está no diagnóstico acima |

### Correções no roteiro de medição

- O marcador de "abrir a tela Changes" esperava `.diff-file`, que já existe no histórico antes do clique. Agora espera
  `.csection-diff .diff-file`.
- O roteiro passou a mostrar a divisão script / layout / estilo na rolagem e no arrasto, e a medir o arrasto com 120 e
  com 500 linhas montadas.
- Os 372 ms de "abrir a tela Changes" da linha de base (seção 3) vieram do marcador antigo e de uma rodada só: não
  servem de comparação.

## 9. Resultado da Fase 2

Fase concluída: 2.1 a 2.6. Medições com `ui.mjs 4 moderate`, duas rodadas (as do histórico alternando versão nova e
anterior na mesma máquina).

### O que foi feito

| Item | O que mudou | Resultado medido |
| --- | --- | --- |
| 2.1 Lista em janela | `virtual.ts` (posições acumuladas, busca binária, folga para não redesenhar a cada linha, rolagem "nearest" calculada dos dados) e `components/VirtualList.tsx` (fluxo normal com dois espaçadores, rolagem passiva com um quadro por vez, `ResizeObserver` só no contêiner e nos itens de altura variável) | Sem consumidor próprio; os números são os do 2.6 |
| 2.6 Histórico em janela | `CommitList` usa o `VirtualList`: commit aberto é um item de altura medida; a linha de alterações (sticky) vai no cabeçalho; setas rolam pelo índice nos dados e levam o foco à linha selecionada | Arrasto de divisória depois de rolar: 252–325 → 71–116 ms por passo (layout 88–123 → 15–22 ms). Nós no DOM depois de rolar: 8.161 → 1.204–1.292 (500 → 45 linhas montadas). Carga a frio: 2.035 → 1.030 nós |
| 2.6 Paginação | `skip` em `LogOptions`; o rodapé da lista pede a página seguinte (500 commits, 1 processo git, sem reler status nem refs); teto de 10.000 com aviso | 1 processo git por página (`log -n500 --skip=N`). Carga, foco, setas e stage com os mesmos processos de antes |
| 2.3 Teto do diff | 4 MB de saída crua do git; o último bloco, que pode estar incompleto, sai; não rastreado lido só até o teto; ação de linhas relê sem teto; aviso com "mostrar mesmo assim" | Mesmos processos git. Diff do commit de 3.000 arquivos: 12.570 → 11.457 KB de objetos (a saída crua dele mal passava dos 4 MB; os objetos ocupam ~2,8× a saída crua) |
| 2.4 Régua | Marcas calculadas dos dados (`marksFromRows`), desenhadas num `canvas` só; a área visível é um `div` movido por estilo num quadro; `scroll` só no elemento que rola; sem `MutationObserver` nem ouvinte na `window` | Sem custo próprio visível no perfil (`marksFromRows` de 25 mil linhas: ~17 ms com CPU 4×) |
| 2.2 Diff em blocos | `diffBlocks.ts` (linhas como dados, blocos de 40); cada bloco é uma tabela própria com o mesmo `colgroup`, memorizada, medida; seleção por assinatura do bloco; navegação e régua pelos dados; o `.diff-body` rola em todo lugar | Diff de 5.000 linhas: abrir 18–21 s → 1,0–1,3 s; nós 160.711 → 1.245; marcar uma linha 1,6–2,4 s → 26–61 ms; rolar 730–870 → 54–64 ms por quadro; arrastar divisória com o diff 5,9–7,4 s → 151–160 ms por passo |
| 2.5 Blame em janela | `VirtualList` em blocos de 40; cor de calor por commit e primeira/segunda linha calculadas uma vez (`blameRows.ts`); dica ao passar o mouse; relê só quando muda o HEAD ou o próprio arquivo | Arquivo de 20 mil linhas: 80 linhas montadas e 661 nós no DOM (antes, uma linha de tabela por linha do arquivo) |

Pacote da interface: 1.251.651 → 1.265.420 bytes (+13,8 KB, a fase inteira). Carga a frio até a 1ª linha do histórico:
1.029–1.430 → 869–910 ms (2.035 → 1.036 nós). Processos git: sem mudança em nenhuma ação (carga 11, foco 4, 10 setas
10–15, stage 9, selecionar um commit 5).

### Abrir o diff: o que restava era o harness de medição

Com o diff já em janela, abrir ainda levava 4,0 s, com uma tarefa longa de 2,7 s. O perfil mostrou o JavaScript do
projeto abaixo de 100 ms nesse caminho; o resto era o Playwright entregando à página a resposta de 2,9 MB como
objeto (um objeto de 3,5 MB leva 2,6–3,5 s com CPU 4×; como texto com `JSON.parse`, 0,56–0,73 s). O harness passou
a mandar texto JSON (`6bc6069`), que é como a mensagem do webview do VS Code trafega. Os tempos de respostas grandes
medidos antes disso não são comparáveis com os de depois. O que sobra (1,0–1,3 s) é o transporte e a conversão de
2,9 MB de objetos (~580 bytes por linha de diff): o caminho para a meta de 300 ms é um formato compacto do diff
(por exemplo, linhas como texto e tipos num vetor), assunto do item 3.x de leituras mais leves.

### Rolagem do histórico: regressão por quadro, travamentos menores

O roteiro rolava 120 quadros de 400 px (48.000 px), mas o histórico tinha 15.000 px: a partir do quadro 37, mais ou
menos, a lista estava no fim e os quadros seguintes, parados, diluíam a média. Com a paginação, todos os quadros
passaram a trabalhar e a média dobrou sem que nada tivesse piorado. O roteiro agora rola 30 quadros dentro dos
primeiros 500 commits (`4fa9eeb`); os números de rolagem anteriores não são comparáveis com estes.

Com o método novo, por quadro: versão anterior 37,7 e 46,8 ms; lista em janela 73,3 e 45,1 ms. A maior tarefa longa
caiu de 237–472 ms para 50–123 ms. A versão anterior montava cada linha uma vez, em lotes de 160, e nunca a
retirava (os lotes eram os travamentos grandes); a lista em janela monta e desmonta uma linha a cada 30 px rolados
(script de 12–21 ms e layout de 13–22 ms por quadro, contra 6–7 e 5–9 ms antes). Investigação seguinte (3 rolagens por
rodada, mediana, alternando versões): antes da janela, 41,2 ms por quadro; versão atual, 43,3–51,6 ms. Antes da
janela, com as 500 linhas já montadas, o script era de 2 ms e o layout 0, e o quadro ainda custava 41 ms: o piso
é pintura e composição. O perfil de CPU mostrou que o código do projeto pesa pouco (`CommitRow` ~1,7 ms por quadro;
`BranchBadge` e `useApp` nem aparecem). Testados e descartados: `contain: strict`, `content-visibility: auto`,
margem maior e desmontar só com a rolagem parada (layout 14 → 9 ms, mas estilo 0,2 → 5 ms e quadro igual ou
pior). A diferença que resta, ~10%, está dentro do ruído da medição.

### Metas da Fase 2

| Meta | Resultado | Situação |
| --- | --- | --- |
| Nenhuma tela com mais de 5.000 nós | Histórico 1.036–1.299; diff de 5.000 linhas 1.245 (lado a lado 1.645); blame de 20 mil linhas 661 | Atingida |
| Arrasto de divisória perto do caso de 120 linhas (113–157 ms) | 71–116 ms por passo | Atingida |
| Abrir o diff de 5.000 linhas em ≤ 300 ms | 1,0–1,3 s | Não atingida (transporte de 2,9 MB; ver acima) |
| Marcar uma linha em ≤ 50 ms | 26–61 ms (mediana ~45) | Praticamente atingida |

## 10. Resultado da Fase 3

Fase concluída: 3.1 a 3.5 (o 3.5 veio na Fase 1) e o formato compacto do diff. Medições com `ui.mjs 4 moderate`
(duas rodadas) e `core.mjs`.

| Item | O que mudou | Resultado medido |
| --- | --- | --- |
| 3.2 Detalhes em 1 processo | `commitDetails` com um `git show -z --raw --numstat -M -m --first-parent` (parser `parseCommitShow`, com testes de equivalência); diff de commit com base `<sha>^`, árvore vazia só no commit raiz | Selecionar 1 commit: 5 → 2 processos (36 → 19–23 ms); 10 setas: 10–15 → 4; carga inicial: 11 → 8 |
| 3.1 Status leve | `stats` em `Wants`: as contagens de linhas só são lidas com a tela Changes, os painéis das alterações não commitadas, a lista de alterações do histórico ou o blame na tela. Não rastreados: fila de 8 leituras, teto de 1.000 arquivos, limite de 1 MB por arquivo e cache por caminho, tamanho e data | Foco da janela: 4 → 2 processos; carga: 8 → 6; abrir a tela Changes: 2 → 5 (é ela que lê as contagens); `status(true)` no cenário `heavy`: 331–421 → 129 ms |
| 3.3 Cancelamento | `signal` e `stopAtLimit` em `runGit`; o diff encerra o git ao chegar ao teto | Núcleo pronto e testado; a ligação com a interface não foi feita (ver abaixo) |
| 3.4 Fila de processos | No máximo 2 a 6 processos git simultâneos (pelos núcleos), com prioridade; dashboards em `low`; comandos de rede fora da fila | Testado (pico, prioridade, cancelamento na fila, vaga devolvida após erro) |
| Formato compacto do diff | `diffWire.ts`: tipos das linhas numa string e textos num vetor; números de linha recalculados na chegada | JSON do diff de 5.000 linhas 636 → 369 KB; abrir o diff de 5.000 linhas 1,0–1,3 s → 0,93–0,99 s |

### Metas da Fase 3

| Meta | Resultado | Situação |
| --- | --- | --- |
| Selecionar um commit com 2 processos | 2 | Atingida |
| 10 setas seguidas com até 6 processos | 4 | Atingida |
| `status` do cenário `heavy` em até 2× o `status()` simples | Com contagens, 129 contra 15 ms (8,6×); a atualização só pede contagens quando uma tela as mostra | Não atingida com contagens; o custo que resta são os 2 `numstat` e o `lstat` de cada não rastreado |
| (Fase 0) Foco ≤ 3 e carga inicial ≤ 8 processos | 2 e 6 | Atingidas |

### Não feito, de propósito

- **Cancelamento ligado à interface.** Exigiria um protocolo de cancelamento nas três pontes (Electron, VS Code e o
  harness). Com a espera curta entre seleção e leitura (Fase 1) e a seleção em 2 processos, 10 setas já abrem 4
  processos; o ganho restante é pequeno. O núcleo está pronto (`signal` em `runGit`).
- **Stage de 1 arquivo em 6 processos** (hoje 9): o resto está no `refresh()` do fim de `run` e no ouvinte da aba,
  que ainda leem duas vezes em alguns caminhos (ver HANDOFF).
- **Abrir o diff de 5.000 linhas em 300 ms** (hoje 0,93–0,99 s): o que sobra é o texto das linhas (~1,6 MB), a
  conversão e o primeiro desenho. Próximos passos possíveis: mandar só as primeiras centenas de linhas e o resto
  sob demanda (o diff já é desenhado por janela), ou comprimir o texto.
