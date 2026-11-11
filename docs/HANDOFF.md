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

**Última etapa fechada:** E10, #61 (auditoria de conflitos). `tests/conflicts-scale.test.ts` (21 testes, git de verdade, 1500 arquivos; 300 no Windows) cobre merge, cherry-pick, rebase, revert, stash pop e `apply --3way` com tipos mistos e ours/theirs/resolved/continue/skip/abort. Bug corrigido: `conflictDetails` lia `join(root, path)` e devolvia arquivo de fora do repositório com `../`; agora `resolveInside` e teto de 2 MB. Medido: `resolveConflicts` de 1500 arquivos = 32 processos git (teste do cenário 8). `typecheck` e `npm test` verdes (936). `security-review` pela skill falhou (sem `origin/HEAD`): diff pequeno revisto à mão. `code-review` high rodou; achados na seção 5.

**A seguir:** `ENCERRAMENTO` (só com a palavra do dono)

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
| E9 | #72 #60 | READMEs: seções e chamadas no topo; tirar menções ao repo do GitHub | feito | ver git log |
| E10 | #61 | Auditoria de conflitos com cenários de dezenas a milhares de arquivos | feito | ver git log |

## 3. Base de medição

Não se aplica (nenhuma etapa persegue meta de desempenho). E5, E8 e E10 medem a catraca: `npm run perf:bundle` e
contagem de processos git antes e depois.

## 4. Plano

(sem etapas pendentes)

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
- 2026-11-11 E9, dúvida para o dono: os links de patrocínio (GitHub Sponsors) e o da licença (`extension/README.md:15`, aponta para `github.com/DaniloFG/GitTools/blob/main/LICENSE`) ficaram; sair junto com #60? `package.json`, `extension/package.json` e `CONTRIBUTING.md` também citam o repositório (metadados/contribuição), fora do que a issue pede com clareza; não tocados. Índice sem título próprio.
- 2026-11-11 E10, achados abertos de conflitos (candidatos a issue): (a) `abortOperation` sem operação registrada (`apply --3way`, `repository.ts:1439`) só restaura os arquivos em conflito: arquivos aplicados sem conflito e novos do patch ficam no índice (teste de caracterização em `conflicts-scale.test.ts`; corrigir sem apagar trabalho do usuário pede decisão). (b) `conflictDetails`: blobs dos estágios 1–3 sem teto (cortar truncaria o lado e o editor poderia salvar texto incompleto); `ConflictDetails` sem `tooLarge` (a tela mostra "ilegível"); `git show :n:path` usa o caminho cru, não o normalizado; `resolveInside` é léxico (pasta-pai que é link para fora passa; `readFile` igual); `lstat`+`readFile` sem `fstat`. (c) `resolveConflict` (um arquivo) marca "resolvido" sem checar marcadores, ao contrário do lote. (d) `rebase(branch, onto)` + abort volta para `branch`, não para a branch em que o usuário estava (comportamento do git). (e) Rename+edição resolvido por ours/theirs cai só no caminho novo. (f) Não medido nem testado em tela: layout do `ConflictEditor`/lista com milhares de conflitos (só o core).

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, medido, não conferido
- [ ] PR para `develop` só quando o dono pedir
