# HANDOFF — Issues #92 a #98

Memória do trabalho entre sessões. Existe só na branch `ccr-8306091c-r5tduy`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de etapa
fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: "Iniciar implementação das issues do repo. Vc tem autonomia completa sobre tudo do repo" e consulta ao
  `gt-juiz` nas dúvidas. Depois: tudo segue rigorosamente as etapas (regra absoluta e gate em `CLAUDE.md`).
- **Fora do escopo**: PR (só quando o dono pedir). `rerere` nunca ligado por padrão (ver seção 5).
- **Regras deste trabalho**: uma issue (ou parte dela) por etapa, em ordem de risco; todas as etapas na branch acima
  (a designada pela plataforma vale no lugar de `feature/*`), uma de cada vez; frases por `t()` nos seis catálogos.
- **Metas**: sem regressão em processos git, nós no DOM, pacote (`npm run perf:bundle`, teto 700.000 bytes). A #98
  não pode somar bytes à primeira carga além do convite.

## 2. Estado

**A seguir:** `E9` (ler `docs/ESBOCO-CONFLITOS.md`, seção 8, e a seção 5 daqui)

| Etapa | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- |
| 0 | #91 segurança de caminhos e `tooLarge` | fechada | `7fffbe7` | 41 testes verdes (13 reprovavam antes) |
| E1 | #93 lista de arquivos do Changes sem rolagem | fechada sem correção (não reproduzido) | ver commit | 4 cenários na tela rolam; #91 revisada: aprovada |
| E2 | #94 combobox do Dashboard escondido | fechada | ver commit | 0/5 pontos clicáveis antes, 5/5 depois em 3 tamanhos de janela |
| E3 | #97 menu principal em janela estreita | fechada | ver commit | roteiro 320/480/640: falhava em 320 e 480, passa nos 3 |
| E4 | #92 fluxo de conflito: lista lenta e modal que fecha | fechada | `adfec47` | modal de 3 opções: aparecia, some; salvar+refresh 9 → 3 processos git |
| E5 | #95 investigação: medir cherry-pick e `rerere` | fechada | `b544667` | 3 processos por parada (início 5); teto travado em teste; números na #95 |
| E6 | #95 implementar os caminhos decididos (seção 5) | fechada | `80caaea`, `4ed4c12` | `orderCommits` em empate de data corrigido; continuar automático + reaproveitar decisão; 1010 testes verdes, pacote 689.842/700.000 |
| E7 | #96 esboço da tela Conflitos | fechada | ver commit | `docs/ESBOCO-CONFLITOS.md` (147 linhas), juiz APROVADO na 2ª rodada |
| E8 | #96 tela Conflitos: lista, estado, rodapé | fechada | `9af47be` | pacote JS 689.842 → 693.527/700.000; 60 conflitos: 41 linhas montadas, 1.169 nós |
| E9-E10 | #96 editor embutido e seção Conflitos | E9 a fazer | | |
| E11 | #98 Tour: desenho e lista de passos | a fazer | | |
| E12-E13 | #98 Tour: infraestrutura e conteúdo | depende de E3, E10, E11 | | |

### Última etapa fechada: `E8` (#96, tela Conflitos)

- `ConflictsScreen.tsx` (lazy, substitui o dock como Dashboards), `ConflictFlow.tsx` (provedor: decisões, continuar sozinho, ações).
  Banner informativo (esconde a lista com a tela aberta); continuar/pular/abortar/auto/reaproveitar no rodapé. Entradas: ⚠ da aba ativa, banner, painel `changes.conflicts`, partida.
- Verificado: typecheck, 1147 testes, builds, `perf:bundle`; tela vista com 60 conflitos. Code-review high: 5 achados corrigidos.
- **Não conferido**: `core.mjs --trace`, `ui.mjs 4×`, janela estreita depois da correção, Esc dentro do `ConflictEditor`, merge concluindo pelo commit de Alterações (merge perdeu o "Continuar" do banner: decisão 5 do esboço). Sem teste de React.
- **Remover `docs/ESBOCO-CONFLITOS.md` no encerramento** (`git rm`), junto do HANDOFF.

## 3. Base de medição

Não se aplica ainda. E4 e E5 tiram a base (processos git do fluxo de conflito e do cherry-pick) com
`node scripts/perf/core.mjs moderate` e `--trace`; E3 e E12 usam `node scripts/perf/ui.mjs 4 moderate`.

## 4. Plano

### Etapas seguintes (detalhar quando destravadas)

- **E9-E10** (#96): seção 8 de `docs/ESBOCO-CONFLITOS.md` (E9 editor embutido e ações por arquivo, E10 seção Conflitos). E9 deve: tirar a lista por arquivo e `resolveEvery` do banner, medir `ui.mjs` em 320/480/640, `security-review`; E10 liga `CONFLICT_STARTUP` (App.tsx) e `shouldCloseAfterResolve`.
- **E11** (#98): lista final de recursos e ordem dos passos (juiz aprova); desenho do convite e do cartão.
- **E12-E13** (#98): infraestrutura sob demanda (chunk separado, `data-tour`, convite); depois conteúdo nos seis idiomas
  e teste "todo alvo existe". Medir pacote da primeira carga e CPU 4×.

## 5. Decisões e armadilhas

- Decidido sem o dono: ordem por risco (segurança, bugs de tela, conflitos, Tour). #98 por último: depende do menu
  estreito (#97) e da tela de Conflitos (#96).
- `.claude/triagem.local` é pessoal e fora do git; em sessão nova, o gate libera pelo `docs/HANDOFF.md`.
- `CLAUDE.md` tem 199 linhas, no teto (abaixo de 200): quem editar o guia corta outra linha.
- **Modo fábrica** (o dono mandou decidir sem ele, em definitivo): nada para por decisão do dono. Dúvida vai ao
  `gt-juiz`; o que ele não resolve vira issue de retrabalho, e a próxima etapa segue.
- **E6**: entram "continuar automático" e "reaproveitar decisão", com resumo antes de confirmar (nunca silencioso).
  `rerere` só opcional, desligado por padrão, e só se a investigação (E5) provar segurança.
- **E7**: tela é `ScreenId` fora de `SCREEN_VIEWS`; sem pilha de telas (`conflictReturnView`); tipo de conflito sai do XY do `status` (sem processo); "renomeado" fora.
- **E11**: cobertura = tudo que o usuário usa, exceto Settings (só passada rápida), como na issue #98.
- **#93**: reprodução em `scripts/readme-media/lib.mjs` com `layout: { dock }` exige `changes.unstaged` ativo (clicar a aba); `placeMissing` põe `commit.message` no grupo. Reabrir só com passos do dono. #99: retrabalho de link em `untrackedDiff`/`conflictDetails` (fora do plano; pode entrar antes de E4/E5).
- **Tela do Dashboard**: roteiro de repro em scratchpad usa `launch` + `.dashboards-tab` + `.dash-people > button`; `elementFromPoint` prova cobertura. `.dash-filters` z 20 empata com `.modal-backdrop`; o modal vence pela ordem do DOM (conferido).
- **E5**: `onGitCommand` (`e.exitCode === undefined`) conta processos iniciados; testes com datas de commit distintas
  usam `process.env.GIT_COMMITTER_DATE` (o `runGit` herda `process.env`). `rerere` com `reset --hard` na `main` errada
  muda o conflito: use uma tag do ponto de partida.
- **E8**: o `RepoView` é remontado por aba (`key`), por isso `conflictsStartupSeen` é módulo e o provedor fica no `AppProviders`. `.app > .dock-hidden` foi copiado para `styles.css` (a regra original só carrega com o chunk dos Dashboards). Esc da tela: `onKeyDown` no `<section>`, nunca `window` (regra da interface). Filtro "Decididas" só tem decisões lembradas de paradas anteriores.
- Instalar dependências em contêiner novo: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci`.

## 6. Encerramento

Sem palavra do dono (modo fábrica): o plano acaba quando a etapa de encerramento fecha. PR só quando o dono pedir.

- [ ] Todas as etapas fechadas; pendências viraram etapa ou issue de retrabalho
- [ ] Documentação que o trabalho tornou falsa foi corrigida (`docs/PERFORMANCE.md`, README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree usado removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] PR para a `develop` só quando o dono pedir
