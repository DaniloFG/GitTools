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

## 2. Estado atual (fim da janela 1)

- **Entregue e enviado** na branch (7 commits sobre `develop`, `8b52873` a `7296ca9`): análise e plano
  (`docs/PERFORMANCE.md`), roteiros de medição (`scripts/perf/`), `CLAUDE.md` e a **Fase 1 inteira** (itens 1.1 a 1.8).
- **Verificado no estado final:** `npm run typecheck` limpo, 604 testes passando, `npm run build` ok.
- **Árvore limpa**, branch igual à do remoto. Nenhum trabalho pela metade.
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

### Fase 2 — Fim dos travamentos (a próxima)

É onde estão os travamentos que o usuário sente. Os itens dependem do componente de lista em janela, então começam
por ele.

1. **2.1 Componente único de lista em janela** (novo módulo, ex. `src/renderer/src/components/VirtualList.tsx` com a
   lógica pura de janela em `src/renderer/src/virtual.ts`, testável sem navegador). Altura fixa primeiro (o histórico
   tem `ROW = 30`); altura medida é opcional e só se algum consumidor precisar. Requisitos: monta só as linhas visíveis
   mais uma margem; mantém o foco e a rolagem por teclado do histórico; não mede o DOM em laço; deve funcionar dentro
   do `Split`/`Dock` (a altura vem do contêiner, via `ResizeObserver` de um elemento só).
2. **2.6 Histórico em janela real** (`components/CommitList.tsx`): troca o acréscimo por lotes (`INITIAL_ROWS`,
   `MORE_ROWS`, `LOAD_AHEAD`) pela lista em janela. Atenção: as linhas de arquivos expandidos (`CommitFiles`) e a
   linha de alterações (`WipRow`, `position: sticky`) têm altura diferente de 30 px; o consumo precisa tratar isso
   (por exemplo, expandidos como itens de altura calculada). Depois, paginação além de 500 commits (`limit` do `log`).
   **Medir:** o arrasto com 500 linhas montadas deve cair para perto dos 113 ms do caso de 120 linhas.
3. **2.2 Diff por blocos memorizados** (`components/DiffView.tsx`): bloco de linhas memorizado, seleção que redesenha
   só o bloco tocado (hoje o `Set` de seleção está no componente de cima e cada clique redesenha as 25 mil linhas) e
   só os blocos visíveis montados. Preservar: seleção por clique, arrasto, Shift+clique, caixa de bloco e de arquivo,
   navegação entre alterações (`changeBlocks` usa `querySelectorAll` em `tr.hunk-header, tr.line`), cópia (`data-copy`)
   e a régua de alterações.
4. **2.3 Teto de tamanho do diff no núcleo** (`src/core/repository.ts`): `maxOutputBytes` já existe em `runGit`
   (hoje só o terminal usa). Cortar o diff de um arquivo e o diff de um commit inteiro (12,6 MB para 3.000 arquivos)
   acima de um limite, marcar como cortado no tipo (`FileDiff`/resultado) e a interface mostra aviso com "mostrar mesmo
   assim". Também um teto para `fullFile` (`-U1000000`). Tipos novos em `src/shared/types.ts`; as 6 traduções em
   `src/shared/i18n/messages/` (o TypeScript reprova catálogo incompleto).
5. **2.4 Régua de alterações** (`components/ChangeRuler.tsx`, `changeRuler.ts`): calcular as marcas a partir dos dados
   do diff (índices das linhas), desenhar num elemento só, ouvir só o elemento que rola (hoje há ouvinte global de
   `scroll` em captura e `MutationObserver` com `attributes` na subárvore, ambos proibidos pelo `CLAUDE.md`).
6. **2.5 Blame em janela** (`components/FilesView.tsx`, `BlameView` por volta das linhas 150-240): lista em janela,
   dica (`title`) calculada só ao passar o mouse, e reler só quando o HEAD ou o arquivo mudar (hoje refaz a cada
   mudança de `data.status`).

**Metas da Fase 2:** nenhuma tela com mais de 5.000 nós no DOM; abrir o diff de 5.000 linhas em ≤ 300 ms e marcar uma
linha em ≤ 50 ms (CPU 4×). Ordem sugerida de entrega (cada uma com testes, medição e commit): 2.1 + 2.6, depois 2.3,
2.2 e 2.4 (o diff e a régua andam juntos), depois 2.5.

### Fases seguintes (resumo; detalhes no documento)

- **Fase 3 — Menos git:** `status` leve por padrão com contagens de linhas sob demanda (B2); `commitDetails` em 1
  processo e `diff` de commit sem `rev-list` (B3); cancelamento real até o `runGit` (`AbortSignal`); fila de processos
  git no `Backend` com prioridade (B6). O item 3.5 (eco do observador) já foi feito na Fase 1.
- **Fase 4 — Listas e redesenhos:** contexto `useApp()` dividido (C2); itens de lista sem contexto (C2/C4);
  branches/tags com agrupamento linear (C4); `buildTree` com `Map` (C5); ícones por símbolo reutilizado (C6);
  comparação de diffs por identificador, não por `JSON.stringify` (C7: `ChangesView.tsx`, `CommitDetails.tsx` `WipPanes`).
- **Fase 5 — Carga:** idiomas sob demanda (D2: 48% do JavaScript são traduções); `React.lazy` nas telas que não
  aparecem na abertura (D3); janela criada antes de ler configurações (D4); extensão: painel primeiro, descoberta por
  trás (D5); dashboards num processo auxiliar (B7).

### Pendências menores já identificadas

- `CommitDetails.tsx`, `WipPanes`: comparação por `JSON.stringify` do diff (regra do `CLAUDE.md`)
  e `applyLines` que chama `setSelection` depois de `await` sem guarda. Inofensivo hoje; resolver junto da Fase 4.
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

## 6. Como começar a próxima janela

Cole isto como primeira mensagem da sessão nova:

> Leia `docs/HANDOFF.md`, `CLAUDE.md` e as seções 6 a 8 de `docs/PERFORMANCE.md`. Siga as regras de trabalho da seção 1
> do HANDOFF (a janela principal não escreve código: delega a subagentes Haiku 5.5, o mais recente, e só especifica,
> revisa, mede e commita). Comece pela Fase 2, itens 2.1 e 2.6. Antes de começar, confira `git status` e
> `git log --oneline -8`, recrie o repositório de teste com `node scripts/perf/stress-repo.mjs` e rode
> `node scripts/perf/core.mjs moderate` para ter a base. Se os tokens estiverem acabando, faça só o que der para fechar
> bem e atualize a seção 2 e 5 do HANDOFF.
