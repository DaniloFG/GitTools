# HANDOFF — 21 issues abertas (#56–#86)

Memória do trabalho entre sessões. Existe só na branch `ccr-f146ea2b-tsxm2b`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas.

## 1. Pedido e regras do dono

- **Pedido**: "Temos novas issues no repo para implementar. Iniciar implementação." Fonte: issues abertas de
  `danilofg/gittools` (ler cada uma com `issue_read` ao começar a etapa; o texto original manda).
- **Fora do escopo**: nada decidido ainda. #61 (varredura de conflitos) é auditoria e pode virar várias issues.
- **Regras deste trabalho**: uma branch só (a de trabalho, por ordem da plataforma); um commit verificado por etapa;
  PR só quando o dono pedir. Frase nova passa por `t()` nos seis catálogos.

## 2. Estado

**Última etapa fechada:** E8, #85 (clique duplo). `src/renderer/src/singleFlight.ts` (puro, 12 testes) bloqueia `run` do App: chamada extra durante outra é ignorada em silêncio; `queue: true` (só stage/unstage do ChangesView) espera em ordem. `busy` cai só depois do `refresh`. `disabled` com `busy !== null` em Aplicar do Studio, Commit (botão, Ctrl+Enter, pergunta de force push), Fetch/Pull/Push, ConflictEditor, abortar/continuar/pular, Aplicar rebase; Enter do Compare e do Remotes respeita o estado. typecheck, 914 testes e perf:bundle verdes (685.097 de 700.000). Tela (Chromium): clique duplo em Stage move 1 vez, clique duplo em Commit gera 1 `git commit`, 156 nós, sem erros. `code-review` medium feito (achados 1,2,3,4,5 corrigidos).

**A seguir:** `E9`

| Etapa | Issues | Objetivo | Estado | Commit |
| --- | --- | --- | --- | --- |
| E1 | #58 #76 #82 | Menus de contexto: rótulos, Copy path, remover itens | parcial (#76 e rótulo "Editor do GitTools" pendentes) | 69618ba |
| E2 | #75 #57 #73 #77 | Commit/push e Changes/History: remover "Include all files", push volta a normal, seleção inicial | feito (#73 já existia) | 5957e84 |
| E3 | #83 #86 | Diff: botões vão para submenu "Options"; colunas do History redimensionáveis | feito | 6179d6d |
| E4 | #74 #78 #56 | Menu Appearance: Toolbar, "Dynamic panels", visibilidade das telas | feito | bdf185b |
| E5 | #62 | Tela inicial History; estado de tela/layout independente por aba | feito | 0de61d7 |
| E6 | #70 #71 | Multi-repo desligado por padrão; busca única em Settings | feito | b296a96 |
| E7 | #59 #84 | Compare: "apply" do arquivo inteiro; busca no Cherry-pick Studio | feito | ver git log |
| E8 | #85 | Botões assíncronos: bloqueio contra clique duplo + loading onde falta | feito | ver git log |
| E9 | #72 #60 | READMEs: seções e chamadas no topo; tirar menções ao repo do GitHub | a fazer | |
| E10 | #61 | Auditoria de conflitos com cenários de dezenas a milhares de arquivos | a fazer | |

## 3. Base de medição

Não se aplica (nenhuma etapa persegue meta de desempenho). E5, E8 e E10 medem a catraca: `npm run perf:bundle` e
contagem de processos git antes e depois.

## 4. Plano

### Etapa E9 — READMEs (#72 #60)
- **Orquestra**: sonnet
- **Arquivos prováveis**: `README.md` (links nas linhas 7, 571, 573), `extension/README.md` (15, 16, 255, 257, 264-268)
- **Ler antes**: issues #72 #60. Links de patrocínio e licença: confirmar com o dono se saem junto.
- **Aceite**: `grep -n github.com` nos dois READMEs sem menção ao repo; índice de seções no topo; chamadas de impacto primeiro
- **Segurança**: não
- **Depende de**: —

### Etapa E10 — auditoria de conflitos (#61)
- **Orquestra**: topo
- **Arquivos prováveis**: `tests/conflicts.test.ts`, `tests/conflicts-bulk.test.ts`, `tests/mergeLayout.test.ts`, telas de conflito
- **Ler antes**: issue #61. Merge, cherry-pick e demais origens de conflito; cenários de dezenas a poucos milhares de arquivos.
- **Aceite**: relatório de achados no HANDOFF; cada bug corrigido com teste; o que não couber vira issue
- **Testes**: unidade, integração e medição
- **Segurança**: sim
- **Depende de**: E7

## 5. Decisões e armadilhas

- 2026-11-11: o mapa do código mostra que #84 (busca no Studio) e #59/#82 (menu em "Different files") pedem recurso
  novo, não ajuste.
- 2026-11-11: o branch de trabalho vem da plataforma (`ccr-f146ea2b-tsxm2b`), fora do padrão `feature/*` do guia.

- 2026-11-11 E1, dúvidas para o dono: (a) #76 pede tirar "Force push (with lease)" do menu de clique direito do History, mas ali não existe; o item está na Toolbar (`toolbar.pushForce`, `Toolbar.tsx:100`) e no menu da branch na Sidebar (`sidebar.menu.pushForce`, `branchMenu.ts:48`). Não removido; remover um, os dois ou nenhum? (b) #82 pede "Editor do GitTools" no lugar de "Open in new window", mas esse item abre o diff em janela própria (`openDiffWindow`), não o editor (`FileEditor`, aberto pela tela Files). Rótulo não trocado; confirmar o que se quer.
- 2026-11-11 E3, achados do `code-review` ainda abertos (não corrigidos, decisão do dono ou etapa própria): (a) Compare: "Abrir no editor" aparece para todo status exceto D, mas abre a cópia da árvore de trabalho, não a versão do ref comparado (`CompareView.tsx:113`); (b) clique na linha WIP chama `onOpenFile('')` e limpa a seleção de commit/força a tela History mesmo ao só expandir (`CommitList.tsx:680`); (c) `common.openInVscode` fixa "VSCode" embora o editor seja configurável; (d) Toolbar perdeu o botão que abre o projeto inteiro no editor (E1); (e) `CommitBox`: `setMode(undefined)` roda após o push mesmo se ele falhar, perdendo a escolha "force" no retry; (f) FilesView: ações do histórico do arquivo só existem depois que o diff carrega. Recusados: sobreposição de alças (colunas adjacentes nunca têm alças de lados opostos) e estado congelado do submenu (a seleção não muda com o menu aberto).
- 2026-11-11 E2: clicar na linha WIP não troca o arquivo já ativo em `WipPanes` (só preenche o vazio); mudar isso exige editar `CommitDetails.tsx`. `code-review` rodou na E3.
- 2026-11-11 E1: `code-review` feito na E3; conferência em tela só do menu do diff e da History (menus de arquivo de Changes/Files/Compare não conferidos). Traduções ar/hi/zh de `common.openInVscode` pedem revisão de nativo.

- 2026-11-11 E4: Dashboards escondido e aberto continua na barra até trocar de tela (de propósito). `SCREENS`/`SCREEN_NAMES` em `Screens.tsx` duplicam `TOP_SCREEN_LABELS`. Sem separador entre Painéis dinâmicos e Telas. Pendente: ver o menu na tela e `code-review` sobre E4.

- 2026-11-11 E5: só a tela aberta ficou por aba; o arranjo `dock` e as `pref.*` seguem globais (decisão minha, não do dono: confirmar se o arranjo de painéis também deve ser por repositório). `dashboardsOpen` (local de RepoView) volta a falso ao trocar de aba. `pref.screen` antigo fica órfão no localStorage (inofensivo). E4 conferida na tela: menu Aparência > Telas ok.
- 2026-11-11 E6: com a detecção desligada (agora o padrão) `discoverWorkspace` usa `setRepository` (`extension.ts:160`), que ativa a 1ª pasta e pode sobrescrever a escolha do usuário se ela vier antes do fim da descoberta (corrida; o teste do seletor de pasta espera `openList`). Não corrigido. Busca: Identidade, Atalhos e Sobre seguem fora; sem normalizar acentos; `EditorSection` monta (e chama `detectEditors`) ao buscar; `:has()` esconde seção sem resultado (visto no Chromium, não no VS Code). `code-review` formal não rodado (diff revisto à mão).

- 2026-11-11 E7: "Aplicar arquivo inteiro" lê o diff completo no renderer e o core o refaz (`findFile`): leitura dupla, e as chaves de milhares de linhas cruzam o IPC; melhor seria `buildPartialPatch(file, 'all')` num método próprio. Lista do Studio: linhas inline sem `memo` (exceção comentada no código, teto 600); busca não normaliza acentos; Aplicar arquivo renomeado (R) cria só o caminho novo e não remove o antigo: o diff com pathspec no caminho novo vira adição (limitação, decisão de produto; teste de caracterização). `applyLines` não passa por `resolveInside`: caminho `..`/absoluto só é barrado pelo git ("outside repository"). Todos pré-marcados na abertura (como antes): "Aplicar N commits" mostra o total, inclusive fora da busca.
- 2026-11-11 E8, aceitos e não feitos: (a) ação ignorada pelo bloqueio (ex.: Commit/Descartar logo após stage) some sem toast e `run` devolve `undefined` como em falha; avisar pede texto novo nos 6 catálogos. (b) `fn` que nunca termina (fetch pendurado) trava todo `run` do repositório até reabrir; sem timeout. (c) sem `disabled` ainda: botões por arquivo do OperationBanner, resolução em lote, copiar versão e aplicar linhas do Compare, menus de CommitList/Sidebar/CommitDetails, Welcome, KeyboardShortcuts (só o `run` os protege). (d) Sem tela: force push com Ctrl+Enter repetido, overlay agora dura até o fim do `refresh`. (e) Toolbar e outros redesenham ao mudar `busy` (useBusy). (f) Spinner extra pedido na issue não foi acrescentado: o indicador do `run` já cobre.

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, medido, não conferido
- [ ] PR para `develop` só quando o dono pedir
