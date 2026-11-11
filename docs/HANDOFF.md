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

**A seguir:** `E1` (aguardando o "pode seguir" do dono para abrir a sessão central)

| Etapa | Issues | Objetivo | Estado | Commit |
| --- | --- | --- | --- | --- |
| E1 | #58 #76 #82 | Menus de contexto: rótulos "Open in editor VSCode"/"Editor do GitTools", Copy path, remover itens | a fazer | |
| E2 | #75 #57 #73 #77 | Commit/push e Changes/History: remover "Include all files", push volta a normal, seleção inicial | a fazer | |
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

### Etapa E1 — menus de contexto coerentes (#58 #76 #82)
- **Orquestra**: sonnet
- **Arquivos prováveis**: `components/CommitList.tsx:853-866`, `CommitDetails.tsx:162-173`, `ChangesView.tsx:242-243`,
  `Toolbar.tsx:100,168,190-192`, `FilesView.tsx`, `CompareView.tsx`, `src/shared/i18n/messages/*`
- **Ler antes**: issues #58 #76 #82. Atenção: o "Force push (with lease)" não está no menu de contexto do History
  (`CommitList.tsx:301-346`), só na Toolbar (`:100`, `:168`); confirmar com o dono onde o item aparece antes de remover.
- **Aceite**: `npm run typecheck && npm test` verdes; menus vistos na tela (`run-gittools`)
- **Testes**: unidade (lógica de itens do menu) e tela
- **Segurança**: não

### Etapa E2 — commit, push e seleção inicial (#75 #57 #73 #77)
- **Orquestra**: topo
- **Arquivos prováveis**: `CommitBox.tsx:47-58,129`, `feedback.ts:78-81`, `ChangesView.tsx:80`, `CommitDetails.tsx:469`,
  `CommitList.tsx:644`
- **Ler antes**: `CommitBox.tsx:40-60`. O modo `force` fica salvo em `pref.commitPushMode` (só `normal` é trocado):
  é a causa de #57. Remover `commitStageAll` sem deixar chave órfã em `settings`/`layout`.
- **Aceite**: teste que reprova sem a mudança (modo volta a `normal` após push); `npm test` verde
- **Testes**: unidade e tela
- **Segurança**: não
- **Depende de**: —

### Etapa E3 — painel de diff e colunas (#83 #86)
- **Orquestra**: topo
- **Arquivos prováveis**: `CommitDetails.tsx:365-379`, `ChangesView.tsx:411,433`, `CompareView.tsx:252`,
  `FilesView.tsx:448`, `DiffView.tsx:554-568`, `CommitList.tsx:108,134-138,416-420`
- **Ler antes**: issues #83 e #86; `.claude/rules/interface.md`. Larguras já são salvas (`history.columnWidths`):
  #86 é achar/alargar a alça `.column-resize`, não criar persistência.
- **Aceite**: print antes/depois; nós no DOM do History iguais; `npm test` verde
- **Testes**: unidade (largura mínima/máxima) e tela
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

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, medido, não conferido
- [ ] PR para `develop` só quando o dono pedir
