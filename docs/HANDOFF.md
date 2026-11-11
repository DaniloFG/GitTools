# Retomada do trabalho de desempenho

Este arquivo é a memória do trabalho entre janelas de sessão. Quem abre uma sessão nova lê este arquivo, depois o
[`CLAUDE.md`](../CLAUDE.md) e a seção 6 em diante de [`docs/PERFORMANCE.md`](PERFORMANCE.md), e continua daqui.
Atualize a seção 2 (estado) e a seção 5 (próximos passos) ao fim de cada janela.

## 1. Regras de trabalho definidas pelo dono do projeto

Estas instruções vieram do usuário e valem para todas as janelas:

1. **A janela principal nunca escreve código.** Ela só delega a subagentes **Haiku 5.5**, o Haiku mais recente (nunca
   o 4.5), para escrever e buscar no código. Na ferramenta `Agent`, isso é `model: "haiku"`; o ambiente resolve para o
   Haiku mais recente. A janela principal especifica, revisa os diffs, roda verificações e medições, e faz os commits.
   Documentos em Markdown (como este) não são código, mas também é preferível delegá-los quando forem longos.
2. **Se os tokens da sessão estiverem acabando**, fazer só o que der para fechar bem (commitar e enviar o que está
   verificado) e deixar o resto para a próxima janela, registrando o estado na seção 2 e 5 deste arquivo.
3. O objetivo do projeto: a ferramenta precisa ser **rápida em computadores fracos** e em repositórios grandes, com
   desempenho mantido a cada alteração (as regras permanentes estão no `CLAUDE.md`).
4. Branch de desenvolvimento: `claude/gittools-gui-repo-yyo0ff`. Não abrir PR sem o usuário pedir. Fluxo do projeto:
   trabalho → `develop` → `homolog` → `main`, sempre por PR (`CONTRIBUTING.md`).
5. Commits em português, explicando o porquê, terminando com as linhas de atribuição que o ambiente indicar.
6. **Este arquivo nunca sobe para `develop`, `homolog` ou `main`.** A branch de trabalho não recebe PR para a `develop`
   até o trabalho de otimização acabar. O CI reprova qualquer PR que contenha este arquivo (check "Validar fluxo de
   branches"). No commit final (quando todas as fases combinadas estiverem prontas e o usuário disser que acabou),
   remova `docs/HANDOFF.md` e a linha que o menciona no `CLAUDE.md`, e só então abra o PR. Não há exceção para
   "driblar" a trava: se algo precisar ser entregue antes, pergunte ao usuário.
7. **Troca de janela por conta própria, ao fim de cada fase ou micro fase.** O usuário autorizou que a sessão siga
   sozinha de uma janela para a seguinte, para trabalhar sempre com contexto limpo. A sessão não consegue limpar a
   própria conversa (`/clear` é só do usuário); em vez disso, abre uma sessão nova e para a atual. A troca acontece
   num ponto de corte limpo: uma fase inteira ou uma micro fase (um item da fase, como "3.2") fechada; nunca no meio
   de um item. Passos, nesta ordem:
   1. Tudo commitado e enviado (`git status` limpo, branch igual à do remoto), com `npm run typecheck` e `npm test`
      verdes no último commit de código.
   2. Seções 2 e 5 deste arquivo atualizadas (estado, o que foi medido, o próximo item) e enviadas.
   3. Conferir com `list_sessions` (ferramentas `mcp__claude-code-remote__*`) que não há outra sessão desta branch em
      andamento: nunca duas sessões ao mesmo tempo na branch.
   4. Criar a sessão nova com `create_session`: `source_url` deste repositório, `source_revision` e `outcome_branch`
      iguais a `claude/gittools-gui-repo-yyo0ff`, mesmo modelo, título "GitTools desempenho: <próximo item>" e, como
      `prompt`, a mensagem da seção 6 com o próximo item no lugar de "Continue pela …".
   5. Dizer ao usuário, numa linha, o que foi fechado e o link ou id da sessão nova; então parar (não arquivar a
      sessão atual: o usuário pode querer lê-la).
   Quando NÃO trocar sozinha e parar para o usuário: todas as fases combinadas acabaram (o encerramento da seção 5
   pede a palavra do usuário); uma decisão que só o usuário pode tomar (por exemplo, uma meta que exige mudar algo
   que ele pediu, como as contagens de linhas em todas as listas); verificação vermelha que não se resolve; ou se o
   usuário pediu para parar. Se a criação da sessão falhar ou não estiver disponível, deixe a mensagem da seção 6
   pronta e avise o usuário.

## 2. Estado atual (fim da janela 5)

- **Janela 5: item 4.3 feito** (`e0fbf26`): `groupBranches` (`src/renderer/src/sidebarGroups.ts`, linear, teste de
  equivalência com a versão antiga) memorizado por `data.branches`; marcadas num `Set`; `commitColors`, `buildTree` e
  `flattenTree` do `NameRows` em `useMemo` (as listas passadas a `NameRows` precisam ser estáveis); dicas de branch e
  stash montadas no `onMouseEnter`. `core.mjs`: agrupar 1.100 branches 0,349 → 0,025 ms. 738 testes, typecheck limpo.
  Base da janela 5: ATUALIZAÇÃO 5 processos, SELECIONAR 1 COMMIT 2 (sem mudança).
- **Não verificado no navegador:** a dica (`title`) definida no `mouseenter` (só typecheck e testes).
- **Fica para depois:** as linhas de branches e tags continuam todas montadas (sem janela) e os itens ainda
  leem contexto (4.2). `useBranchColors` percorre `data.branches` a cada desenho no escopo "todas" (linear).
- **A seguir: 4.2** (itens de lista sem contexto).

### Janela 4

- **Janela 4: item 4.4 feito** (`530263e`): `buildTree` acha a subpasta por um `Map` do caminho completo (no lugar
  do `find` entre os filhos) e `flattenTree` empurra tudo num array só (sem `push(...)` por nível). Resultado
  idêntico (teste de equivalência com a versão antiga em `tests/fileTree.test.ts`). `core.mjs`: 2 mil arquivos
  6,3 → 3,0 ms; 10 mil 44,9 → 13,1 ms; 30 mil 268 → 37 ms. 732 testes passando, typecheck limpo.
  Base da janela 4 (`core.mjs moderate`): ATUALIZAÇÃO 5 processos, SELECIONAR 1 COMMIT 2 (sem mudança).
- **A seguir: 4.3** (branches e tags lineares, `components/Sidebar.tsx`, achado C4).

### Janela 3

- **Fase 4 em andamento.** Janela 3: item **4.6 feito** (`7fde95b`): `sameDiff` em `src/renderer/src/diffIdentity.ts`
  no lugar do `JSON.stringify` em `ChangesView` e `WipPanes` (diff de 5.000 linhas: 2,35 ms → 0,002 ms com `index`,
  0,078 ms sem); `applyLines` de `SingleCommit` só limpa a seleção se o diff ainda for o mesmo. `lineAction` do
  `ChangesView` não precisou de guarda (limpa a seleção por efeito). 730 testes passando, typecheck limpo.
  Medições novas em `core.mjs` (linhas "comparar diff de 5000 linhas"). Não mudou: o diff do arquivo aberto ainda é
  relido a cada mudança de `status` (necessário: a árvore de trabalho pode mudar sem mudar o status do arquivo).
- **Base da janela 3** (`core.mjs moderate`): ATUALIZAÇÃO 5 processos, SELECIONAR 1 COMMIT 2, `buildTree` de 10 mil
  arquivos 44,7 ms e de 30 mil 339 ms (alvo do 4.4).
- **Container novo vem sem `node_modules`:** rode `npm ci` antes de `core.mjs` (ele precisa do `esbuild`).

### Janela 2

- **Fases 2 e 3 concluídas**, medidas e enviadas; resultados nas seções 9 e 10 de `docs/PERFORMANCE.md`.
- **Verificado no último commit de código (`6cff4a2`):** `npm run typecheck` limpo, 719 testes passando,
  `npm run build:extension` ok; conferências no navegador do histórico, do diff, do blame e das contagens sob demanda.
- **Mudanças de medição na janela 2:** `ui.mjs` rola o histórico só 30 quadros dentro dos primeiros 500 commits
  (`4fa9eeb`) e espera o diff por `data-rows` (`0527760`); o harness entrega as respostas como texto JSON
  (`6bc6069`). Números anteriores a esses commits, nessas linhas, não são comparáveis.
- **Roteiros descartáveis** (somem com o scratchpad; recriar delegando se precisar): conferência do histórico,
  do diff, do blame e das contagens (`check-*.mjs`), rolagem com mediana (`scroll-only.mjs`) e perfis de CPU
  (`prof-*.mjs`). Todos usam `launch` de `scripts/readme-media/harness.mjs`.
- **A seguir: Fase 4** (seção 5).

### Janela 1

- **Entregue e enviado** na branch (7 commits sobre `develop`, `8b52873` a `7296ca9`): análise e plano
  (`docs/PERFORMANCE.md`), roteiros de medição (`scripts/perf/`), `CLAUDE.md` e a **Fase 1 inteira** (itens 1.1 a 1.8).
- **Verificado no estado final:** `npm run typecheck` limpo, 604 testes passando, `npm run build` ok.
- Resultado medido da Fase 1: seção 8 de `docs/PERFORMANCE.md`. Em resumo: processos git muito menores (10 setas:
  50 → 10; stage: 17 → 9; foco: 7 → 4), pacote do Electron de 2,08 MB para 1,25 MB, formatação de datas 20 vezes mais
  rápida. **Sem ganho** em arrasto de divisória, rolagem do histórico e diff grande.
- **Não verificado visualmente** (só por teste e medição): a tabela do diff unificado com larguras por `<col>`
  (`DiffView.tsx`, `styles.css`). Conferir abrindo um diff.
- **Sem teste automatizado:** a ligação de `isEcho` em `App.tsx` (só a regra pura `isOwnEcho` tem teste). Teste manual
  útil: stage no aplicativo e, logo depois, `git commit` pelo terminal; a tela deve atualizar.
- **Ambiente que some entre janelas:** o repositório de teste em `/tmp/gittools-perf-stress` e os scripts do
  scratchpad. O repositório é recriado por `node scripts/perf/stress-repo.mjs` (cerca de 20 s). Os scripts de perfil
  descartáveis do scratchpad (`prof-scripts`) não valem a pena recuperar: as conclusões estão no documento.

## 3. Como medir (resumo; detalhes na seção 2 de `docs/PERFORMANCE.md`)

```bash
node scripts/perf/stress-repo.mjs               # cria o repositório de teste (20 mil commits, 6 mil arquivos)
node scripts/perf/core.mjs moderate             # leituras do git: tempo, processos, tamanho (clean|moderate|heavy)
npm run build:extension                         # gera a interface empacotada usada pelo roteiro abaixo
node scripts/perf/ui.mjs 4 moderate [--trace]   # interface real, CPU 4× mais lenta; --trace lista os comandos git
```

Cuidados aprendidos:

- Rode **uma medição por vez**; cada rodada de `ui.mjs` leva cerca de 5 minutos e a variação entre rodadas é de
  uns ±10% (a rolagem do histórico varia mais, de 24 a 44 ms por quadro). Para afirmar ganho, repita ou use mediana.
- O `ui.mjs` usa o Chromium do ambiente: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` e o módulo `playwright`
  em `/opt/node22/lib/node_modules/playwright` (o `harness.mjs` já aponta para eles; variáveis `CHROMIUM` e
  `PLAYWRIGHT_MODULE` se mudar).
- Meça sempre numa **cópia separada** quando outro agente estiver editando os mesmos arquivos:
  `git worktree add --detach <pasta> HEAD`, link simbólico de `node_modules`, `npm run build:extension` na cópia, e
  `git worktree remove --force <pasta>` ao terminar. Dentro do worktree, `ui.mjs` serve o `extension/dist/webview` dele.
- A métrica de git que vale é a **quantidade de processos**, porque não depende da máquina (no Windows, abrir um
  processo custa muito mais do que no Linux desta medição).
- O perfil de JavaScript precisa da interface **sem minificar** (alterar temporariamente `vite.webview.config.ts` na
  cópia) para ler nomes de função; restaurar depois.

## 4. Como delegar (o que funcionou)

- **Um subagente por tarefa, com arquivos próprios.** Cada prompt lista os únicos arquivos que o agente pode alterar;
  agentes em paralelo só se os conjuntos de arquivos forem disjuntos. Tarefas que mexem no mesmo arquivo (ex.:
  `App.tsx`) vão em sequência.
- **Todo prompt inclui:** ler o `CLAUDE.md` primeiro; proibição de comandos git que alteram estado (commit, add,
  stash, checkout, reset, restore); comentários em português; nenhuma dependência nova; o que pode e o que não pode
  rodar (builds e `ui.mjs` só quando a tarefa pede medição); comandos exatos de verificação; formato do relatório final
  (limite de linhas, separando medido de hipótese).
- **Dar o problema com número e o motivo**, o comportamento que não pode mudar e os casos de borda a testar. Os
  melhores resultados vieram de prompts que diziam "o texto devolvido tem de ser idêntico" ou "resultado idêntico ao de
  hoje em todos os casos", com testes de equivalência.
- **A janela principal confere o diff** antes de commitar (o que o agente alterou, se ficou dentro da lista de
  arquivos, comentários, erros de lógica), depois roda `npm run typecheck` e `npm test` e, nas mudanças de desempenho,
  a medição de antes e depois. Commits só do que foi verificado, e `git push -u origin claude/gittools-gui-repo-yyo0ff`.
- **Verificar o commit exato num worktree limpo** quando outros agentes ainda estão editando a pasta principal.
- **O hook de fim de turno** reclama de alterações não commitadas. Se houver trabalho de subagente em andamento,
  commite apenas o que já está coerente e verificado (sintaxe, typecheck) e diga isso.
- Relatórios de subagentes são texto de modelo: conferir os números e as afirmações no código antes de repassá-los.

## 5. Próximos passos

Ordem recomendada; tamanhos e metas completos na seção 6 e 7 de `docs/PERFORMANCE.md`.

### Fase 2 — Fim dos travamentos (concluída na janela 2)

É onde estão os travamentos que o usuário sente. Os itens dependem do componente de lista em janela, então começam
por ele.

1. ~~2.1 Componente único de lista em janela~~ (feito na janela 2). `VirtualList` aceita altura fixa e itens de
   altura medida (por chave, `ResizeObserver` só neles), `header` e `footer` no fluxo, `stickyTop`, `scrollToIndex`
   calculado dos dados e proteção de foco quando a linha focada é desmontada. Use-o no 2.2 e no 2.5.
2. ~~2.6 Histórico em janela real e paginação~~ (feito na janela 2). **Rolagem do histórico: investigada e
   estacionada.** Medida com o roteiro `scroll-only.mjs` (3 rolagens de 30 × 400 px, mediana, CPU 4×): versão antes
   da janela 41,2 ms por quadro; versão atual 43,3–51,6 ms (quatro rodadas). Na versão antes da janela, com todas as
   linhas já montadas, o script era de 2 ms e o layout 0, e o quadro ainda custava 41 ms: o piso é pintura e
   composição, que `Performance.getMetrics` não mostra. Testado e descartado: `contain`/`content-visibility` (dentro
   do ruído) e desmontar só com a rolagem parada (`growRange`: layout 14 → 9 ms, mas estilo 0,2 → 5 ms e quadro igual
   ou pior). A diferença que resta (~5 ms, ~10%) está dentro do ruído; os travamentos grandes (237–472 ms) sumiram.
   Se voltar a isso: medir a pintura com `Tracing` do CDP (categorias `devtools.timeline`) antes de mexer, e
   considerar menos nós por linha (SVG do grafo).
3. **2.2 Diff por blocos memorizados** (`components/DiffView.tsx`): bloco de linhas memorizado, seleção que redesenha
   só o bloco tocado (hoje o `Set` de seleção está no componente de cima e cada clique redesenha as 25 mil linhas) e
   só os blocos visíveis montados. Preservar: seleção por clique, arrasto, Shift+clique, caixa de bloco e de arquivo,
   navegação entre alterações (`changeBlocks` usa `querySelectorAll` em `tr.hunk-header, tr.line`), cópia (`data-copy`)
   e a régua de alterações.
4. ~~2.3 Teto de tamanho do diff no núcleo~~ (feito na janela 2): `DIFF_MAX_BYTES` (4 MB crus) em
   `src/shared/types.ts`, `trimTruncated` em `src/core/diff.ts`, `diffLimit.ts` na interface. Pendências: o git
   ainda gera a saída inteira (o excedente é descartado na leitura; matar o processo no teto exigiria mudar
   `exec.ts`); um arquivo cujo único bloco passa do teto aparece vazio com o aviso; o formato em objetos ocupa
   cerca de 2,8× a saída crua (formato compacto é assunto do 2.2).
5. **2.4 Régua de alterações** (`components/ChangeRuler.tsx`, `changeRuler.ts`): calcular as marcas a partir dos dados
   do diff (índices das linhas), desenhar num elemento só, ouvir só o elemento que rola (hoje há ouvinte global de
   `scroll` em captura e `MutationObserver` com `attributes` na subárvore, ambos proibidos pelo `CLAUDE.md`).
6. **2.5 Blame em janela** (`components/FilesView.tsx`, `BlameView` por volta das linhas 150-240): lista em janela,
   dica (`title`) calculada só ao passar o mouse, e reler só quando o HEAD ou o arquivo mudar (hoje refaz a cada
   mudança de `data.status`).

**Metas da Fase 2:** nenhuma tela com mais de 5.000 nós no DOM; abrir o diff de 5.000 linhas em ≤ 300 ms e marcar uma
linha em ≤ 50 ms (CPU 4×). Ordem sugerida de entrega (cada uma com testes, medição e commit): 2.1 + 2.6, depois 2.3,
2.2 e 2.4 (o diff e a régua andam juntos), depois 2.5.

### Fase 3 — Menos git (concluída na janela 2)

Metas: selecionar um commit com 2 processos (hoje 5); 10 setas com até 6 (hoje 10–15); `status` do cenário `heavy`
em até 2× o `status()` simples. Ordem sugerida:

1. ~~3.2~~ (feito na janela 2, `f720cad`: selecionar um commit 5 → 2 processos, 10 setas 10–15 → 4, carga 11 → 8). Era: `commitDetails` em 1 processo (`git show --raw --numstat -z -m --first-parent`, no lugar de `show` + dois
   `diff`; testes de equivalência com o resultado de hoje: arquivo normal, renomeado, binário, commit raiz, merge,
   commit vazio) e o `diff` de commit sem `rev-list` (`sha^` e, só no commit raiz, a árvore vazia).
2. ~~3.1~~ (feito na janela 2: foco 4 → 2 processos, carga 8 → 6, status pesado 331–421 → 129 ms; meta de 2× o simples não atingida: 129 contra 15 ms). Era: `status` leve no caminho de atualização; as contagens de linhas (dois `numstat` e a leitura dos não
   rastreados) só para as telas que as mostram, por `Wants`, com limite de quantidade e fila de poucas leituras.
3. **3.3** `AbortSignal` até o `runGit` (matar o processo de uma leitura substituída) e, junto, parar o git no teto de
   saída do diff (hoje o excedente é lido e descartado).
4. **3.4** fila de processos git no `Backend`, com prioridade para o que está na tela.
5. Formato compacto do diff (as linhas como texto e os tipos num vetor), que é o que falta para abrir o diff de
   5.000 linhas em 300 ms (hoje 1,0–1,3 s, quase tudo transporte de 2,9 MB).

### Fase 4 — Listas e redesenhos (a próxima)

Detalhes na seção 6 de `docs/PERFORMANCE.md` (C2, C4, C5, C6, C7). **4.6 feito na janela 3, 4.4 na janela 4, 4.3 na janela 5; o próximo é o 4.2.**
Ordem sugerida: ~~4.6~~ (comparação de diffs por
identificador, não por `JSON.stringify`: `ChangesView.tsx`, `CommitDetails.tsx` `WipPanes`, com o `applyLines` que
chama `setSelection` depois de `await` sem guarda), ~~4.4~~ (`buildTree` com `Map`), ~~4.3~~ (branches e tags lineares),
4.2 (itens de lista sem contexto: `BranchBadge` no histórico chama `useApp()` e `data.branches.find` por
etiqueta), 4.5 (ícones por símbolo reutilizado) e 4.1 (contexto dividido, o maior). Meta da fase: rolar o histórico
em até 16 ms por quadro (hoje 45–73 ms; o piso de pintura medido na janela 2 é de ~41 ms, então a meta exige menos
nós por linha, não só menos React).

Pendências da Fase 3 que podem entrar junto: stage de 1 arquivo em 6 processos (hoje 9) e a ligação do
cancelamento com a interface (núcleo pronto).

### Fases seguintes (resumo; detalhes no documento)

- **Fase 4 — Listas e redesenhos:** contexto `useApp()` dividido (C2); itens de lista sem contexto (C2/C4);
  branches/tags com agrupamento linear (C4); `buildTree` com `Map` (C5); ícones por símbolo reutilizado (C6);
  comparação de diffs por identificador, não por `JSON.stringify` (C7: `ChangesView.tsx`, `CommitDetails.tsx` `WipPanes`).
- **Fase 5 — Carga:** idiomas sob demanda (D2: 48% do JavaScript são traduções); `React.lazy` nas telas que não
  aparecem na abertura (D3); janela criada antes de ler configurações (D4); extensão: painel primeiro, descoberta por
  trás (D5); dashboards num processo auxiliar (B7).

### Pendências menores já identificadas

- `log()` em `repository.ts` ainda roda o `rev-parse` quando a consulta é por uma branch explícita sem `all`
  (a verificação muda o resultado se o HEAD for órfão). Aceito de propósito.
- `analytics` em `repository.ts` tem outro `rev-parse --verify HEAD` próprio (fora do escopo da Fase 1).
- Um 404 de recurso aparece no console da página em todas as sessões do `ui.mjs`; não investigado (provavelmente o
  favicon do servidor de teste).
- A seção 1 e o achado D1 de `docs/PERFORMANCE.md` descrevem o estado de antes da Fase 1; a seção 8 e a coluna "Hoje"
  da seção 7 trazem o atual. Pode valer reescrever a seção 1 ao fim da Fase 2.
- O item 1.6 do plano previa "um agendador de atualização por repositório"; o que foi feito foi o resumo da aba ativa a
  partir dos dados lidos e o descarte do eco do observador. Se o stage de 1 arquivo (hoje 9 processos) precisar chegar
  a 6, o resto está em: o `refresh()` do fim de `run` e o do ouvinte da aba ainda leem duas vezes em alguns caminhos.

### Encerramento do trabalho

Lista de conferência do commit final. Só se faz quando o usuário disser que o trabalho de otimização acabou:

1. Todas as fases combinadas feitas e medidas.
2. Seção 1 e o achado D1 de `docs/PERFORMANCE.md` reescritos para o estado final.
3. `git rm docs/HANDOFF.md` e remover do `CLAUDE.md` o parágrafo que o menciona.
4. `npm run typecheck`, `npm test` e `npm run build` verdes.
5. Só então abrir o PR da branch de trabalho para a `develop`, avisando o usuário.

## 6. Como começar a próxima janela

Cole isto como primeira mensagem da sessão nova:

> Leia `docs/HANDOFF.md`, `CLAUDE.md` e as seções 6 a 10 de `docs/PERFORMANCE.md`. Siga as regras de trabalho da seção 1
> do HANDOFF (a janela principal não escreve código: delega a subagentes Haiku 5.5, o mais recente, e só especifica,
> revisa, mede e commita). Continue pela Fase 4, na ordem da seção 5 do HANDOFF. Antes de começar, confira `git status` e
> `git log --oneline -8`, recrie o repositório de teste com `node scripts/perf/stress-repo.mjs` e rode
> `node scripts/perf/core.mjs moderate` para ter a base. Se os tokens estiverem acabando, faça só o que der para fechar
> bem e atualize a seção 2 e 5 do HANDOFF. Este arquivo nunca vai para develop/homolog/main; nada de PR da branch de trabalho até o fim.
> (Num container novo, rode `npm ci` antes das medições.)
> Ao fechar cada item ou fase, siga a regra 7 da seção 1 do HANDOFF: abra a sessão seguinte por conta própria e pare.
