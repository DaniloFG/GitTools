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

**Última etapa fechada:** E2, commit `5957e84`: #75 (checkbox removido), #57 (modo de push volta a normal), #77 (clique na linha WIP atualiza o painel) feitos; #73 já existia. typecheck e 828 testes verdes; telas não conferidas no Chromium, sem teste de componente para #57-reset e #77.

**A seguir:** `E3` (E1 segue parcial: #76 e rótulo pendentes, seção 5)

| Etapa | Issues | Objetivo | Estado | Commit |
| --- | --- | --- | --- | --- |
| E1 | #58 #76 #82 | Menus de contexto: rótulos, Copy path, remover itens | parcial (#76 e rótulo "Editor do GitTools" pendentes) | 69618ba |
| E2 | #75 #57 #73 #77 | Commit/push e Changes/History: remover "Include all files", push volta a normal, seleção inicial | feito (#73 já existia) | 5957e84 |
| E3 | #83 #86 | Diff: botões vão para submenu "Options"; colunas do History redimensionáveis | a fazer | |
| E4 | #74 #78 #56 | Menu Appearance: Toolbar, "Dynamic panels", visibilidade das telas | a fazer | |
| E5 | #62 | Tela inicial History; estado de tela/layout independente por aba | a fazer | |
| E6 | #70 #71 | Multi-repo desligado por padrão; busca única em Settings | a fazer | |
| E7 | #59 #84 | Compare: "apply" do arquivo inteiro; busca no Cherry-pick Studio | a fazer | |
| E8 | #85 | Botões assíncronos: bloqueio contra clique duplo + loading onde falta | a fazer | |
| E9 | #72 #60 | READMEs: seções e chamadas no topo; tirar menções ao repo do GitHub | a fazer | |
| E10 | #61 | Auditoria de conflitos com cenários de dezenas a milhares de arquivos | a fazer | |

## 3. Base de medição

Não se aplica (nenhuma etapa persegue meta de desempenho). E5, E8 e E10 medem a catraca: `npm run perf:bundle` e
contagem de processos git antes e depois.

## 4. Plano

### Etapa E3 — painel de diff e colunas (#83 #86)
- **Orquestra**: topo
- **Arquivos prováveis**: `CommitDetails.tsx:365-379`, `ChangesView.tsx:411,433`, `CompareView.tsx:252`,
  `FilesView.tsx:448`, `DiffView.tsx:554-568`, `CommitList.tsx:108,134-138,416-420`
- **Ler antes**: issues #83 e #86; `.claude/rules/interface.md`. Larguras já são salvas (`history.columnWidths`):
  #86 é achar/alargar a alça `.column-resize`, não criar persistência.
- **Aceite**: print antes/depois; nós no DOM do History iguais; `npm test` verde (unidade + tela)
- **Segurança**: não
- **Depende de**: E1 (mesmos menus)

### Etapa E4 — menu Appearance (#74 #78 #56)
- **Orquestra**: topo
- **Arquivos prováveis**: `Screens.tsx:87-147`, `dock.ts:63-73`, `toolbarItems.ts`, `Toolbar.tsx:41,130`,
  `src/shared/settings.ts`, catálogos i18n (seis idiomas)
- **Ler antes**: issues #56 #74 #78. Settings e Sponsor nunca ocultáveis. Dashboards não é `ScreenId`
  (`dock.ts:63`): visibilidade precisa tratá-lo à parte.
- **Aceite**: telas ocultas somem da barra e não quebram o atalho/tela inicial; `npm test` verde
- **Testes**: unidade e tela
- **Segurança**: não
- **Depende de**: E3

### Etapa E5 — tela inicial e independência por aba (#62)
- **Orquestra**: topo (desenho)
- **Arquivos prováveis**: `layout.ts:9,62-74`, `dockStore.ts:7-9,41-42`, `tests/multiRepo.test.ts`
- **Ler antes**: issue #62. Hipótese não confirmada: o vazamento vem de `layout.ts` e `dockStore.ts` guardarem tela e
  arranjo sem identificador de repositório. Reproduzir com teste antes de mudar. Cherry-pick é a única exceção.
- **Aceite**: teste com duas abas em que a escolha de uma não muda a outra; falha sem a correção
- **Testes**: unidade e tela
- **Segurança**: não
- **Depende de**: E4

### Etapa E6 — configurações (#70 #71)
- **Orquestra**: sonnet
- **Arquivos prováveis**: `src/shared/settings.ts:74,115`, `GeneralSection.tsx:29-39`, `extension/src/extension.ts:94-96,153-160`,
  `SettingsCenter.tsx:107-127`, `sections.tsx:30`, `SettingRow.tsx:7,28`
- **Ler antes**: issues #70 #71. #70: trocar o padrão e conferir quem lê `multiRepoDetection !== false`; sem teste de
  detecção hoje, criar um. #71: busca única que diz em qual submenu está a configuração.
- **Aceite**: teste do padrão novo; busca encontra configuração de outra seção; `npm test` verde
- **Testes**: unidade e tela
- **Segurança**: não
- **Depende de**: —

### Etapa E7 — Compare e Cherry-pick Studio (#59 #84)
- **Orquestra**: topo
- **Arquivos prováveis**: `CompareView.tsx:252,325`, `CherryPickStudio.tsx:49,288,318-350`
- **Ler antes**: issues #59 #84. "Different files" não tem menu de contexto hoje (E1 pode ter criado só o de abrir/copiar).
  Busca no Studio filtra por mensagem, autor, data, hash; lista por janela (princípio 1).
- **Aceite**: aplicar arquivo inteiro pelo menu; busca em repositório de 20 mil commits sem montar tudo no DOM
- **Testes**: unidade, integração e tela
- **Segurança**: sim (aplica patch: caminho preso ao repositório)
- **Depende de**: E1, E3

### Etapa E8 — botões assíncronos (#85)
- **Orquestra**: topo
- **Arquivos prováveis**: varredura em `components/` (padrão `run(t('busy...'))` de `CherryPickStudio.tsx:236-252`)
- **Ler antes**: issue #85. Primeiro um `gt-leitor` lista as ações assíncronas sem trava; depois um helper único
  (lógica pura + teste) em vez de `disabled` solto em cada tela.
- **Aceite**: teste do helper (segunda chamada durante a primeira é ignorada); lista antes/depois no commit
- **Testes**: unidade e tela
- **Segurança**: não
- **Depende de**: E7

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
- 2026-11-11 E2: clicar na linha WIP não troca o arquivo já ativo em `WipPanes` (só preenche o vazio); mudar isso exige editar `CommitDetails.tsx`. `code-review` e tela não rodaram; junto da E3.
- 2026-11-11 E1: `code-review` e conferência em tela (`run-gittools`) não rodaram; fazer junto com a E3, que mexe nos mesmos menus. Traduções ar/hi/zh de `common.openInVscode` pedem revisão de nativo.

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, medido, não conferido
- [ ] PR para `develop` só quando o dono pedir
