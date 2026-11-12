# HANDOFF — Plano 4: provas pendentes do Plano 3 e descobertas abertas

Memória do trabalho entre sessões. Existe só na branch `chore/plano-4-provas`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de etapa
fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: fechar o que sobrou do Plano 3 (mãe #131): descobertas #132, #134, #135; filhas em `status:em-revisao`
  com prova pendente (#92, #93, #94, #95, #96, #97, #98, #108, #119); candidatas viradas em issue (#140, #141, #142).
  Issue-mãe: **#139**. Branch nascida da `homolog` (`3f0239b`, que contém o Plano 3).
- **Fora do escopo**: #101 e #117 (dono), apagar branches (dono), merge na `main`, PR da branch
  `docs/branch-nasce-da-main` (#133, o dono decide a base). PR #138 homolog → main aguarda o dono.
- **Regras deste trabalho** (além do `CLAUDE.md`):
  - Teste de regressão só vale com a prova de que reprova sem a correção (mutação registrada, em worktree).
  - `npm run build:extension` antes de cada e2e que muda o produto.
  - Issue sem prova completa por critério não fecha: fica `status:em-revisao` com o que falta comentado.
  - Atualizar rótulo de issue SUBSTITUI todos: ler os rótulos antes e reenviar a lista completa.
  - Testes de hook sem `spawnSync`; saída longa em arquivo fora do repositório, ler só o fim.
  - `security-review`/`code-review` quebram sem `origin/HEAD`: `git remote set-head origin <branch>` (a E1 resolve).
- **Metas**: nenhuma de desempenho; catraca: `perf:bundle` JS da primeira carga ≤ 700.000 (hoje 695.255 Electron e
  696.098 webview), processos git e nós no DOM sem piora.

## 2. Estado

**A seguir:** nenhuma etapa; resta o ENCERRAMENTO (seção 6)

| Etapa | Issue | Objetivo | Orquestra | Estado | Commit |
| --- | --- | --- | --- | --- | --- |
| E1 | #143 (#142) | `origin/HEAD` garantido para code-review e security-review | sonnet | fechada | df18263 |
| E2 | #144 (#135) | Teste por chamador de `readRegularFile` (link no lugar do arquivo) | sonnet | fechada | 7a308ce |
| E3 | #145 (#134) | Corrida da pasta-mãe trocada por link: fechar ou documentar | topo | fechada (documentada) | f7ce096 |
| E4 | #146 (#132) | Aviso externo logo após ação da interface (`isOwnEcho`) | topo | fechada | 4b9f8e5 |
| E5 | #147 (#92, #95) | Provas de conflitos e cherry-pick | topo | fechada | bf8dd18 |
| E6 | #148 (#141) | `ui.mjs` com Conflitos e Tour; medições de #96 e #98 | topo | fechada | c627a0f |
| E7 | #149 (#96) | Conflitos: merge por Alterações, 320 px, hi/ar/zh-CN | topo | fechada | 59eaddc |
| E8 | #150 (#93, #94, #108) | Rolagem do Changes e empilhamento do combobox | topo | fechada | d8ef5fc |
| E9 | #151 (#97, #119, #140) | Barra estreita (direita/embaixo), Dashboard ≥ 1050, `.wip-open` | topo | fechada | 84c95cf |

Ordem = dependência: E1 destrava `security-review` (E2, E3, E5); E2 dá a rede da E3; E6 destrava E7; E5, E8 e E9 fecham a #108.

### Última etapa fechada

**E9** (84c95cf): `regressao-97-telas-ocultas` roda também com painel à direita e embaixo e com cherry-pick em conflito
(banner vermelho), medindo banner e `.wip-open`. #140 era defeito real (`.wip-open` em 259..390 a 320 px): corrigido com
`.wip-title` encolhível; reprova sem a correção. Mutação de reverter `7cd72d1` reprova barra-estreita e telas-ocultas.
#119: 400 caixas do Dashboard a 1280 px idênticas antes/depois de `dfad82f`. e2e 41 ok, testes 1474 ok, perf:bundle ok.
Não conferido: extensão no VS Code.

## 3. Base de medição

Não se aplica ao planejamento. E3, E4 e E6 tiram a base (`medir`) no `3f0239b` antes de mexer.

## 4. Plano

## 5. Decisões e armadilhas

- 2026-11-12: a plataforma não designou branch (HEAD solto na `homolog`); criada `chore/plano-4-provas` a partir de
  `3f0239b`. `git remote set-head origin -a` falha sem `origin/main` buscado; usei `git fetch origin main` primeiro.
- 2026-11-12: #92 está `status:planejada` apesar da revisão; a E5 corrige o rótulo. #133 é do dono (base da branch).

- 2026-11-12: o commit da E1 saiu com `Co-Authored-By`/`Claude-Session` (o lembrete de atribuição da plataforma contradiz o
  `CLAUDE.md`); próximas etapas: sem atribuição. Não reescrevi o histórico.
- 2026-11-12 (E2): espião de teste vai em `open` (não em `lstat`, que `resolveInsideReal` também chama).
- 2026-11-12 (E3): decisão (documentar) mantida; o `gt-juiz` reprovou o 1º texto por cobrir só leitura: faltavam a escrita (`writeFile`, `saveConflictResolution`), a exceção `hasConflictMarkers` e `untrackedStats`. Corrigido.

- 2026-11-12 (E4): `createRepo().git` e `app.git` passam por `runGit` e o backend os conta como PRÓPRIOS; alteração
  externa em teste/e2e usa `execFile('git', …)`. `.mjs` não é pego por typecheck/vitest: `node --check` (crase em
  `String.raw` do harness quebrou o e2e). `comparablePath` (realpathSync) não entra no caminho do comando.

- 2026-11-12 (E5): o clone vem raso; `git fetch --unshallow origin` antes de procurar commit antigo. Mutação em worktree em
  `$scratchpad/wt/*` com `node_modules` por link; `git worktree remove --force` ao fim. O e2e não tem filtro: roda os 39.
- 2026-11-12 (E6): o clone é raso mas `b1dd21c` existe; base em worktree com `node_modules` por link e o `ui.mjs` novo (cai no Tour após imprimir o resto). A tela Conflitos não tem base anterior (é nova). Teto sem medida no `desempenho.tetos` reprova o `qa.mjs`: por isso `perfUi` separado.
- 2026-11-12 (E7): o e2e não filtra por id; `language` muda por `app:saveSettings` + `page.reload()`. O `.gitignore` já cobre `validacao-out/`.
- 2026-11-12 (E8): `node scripts/validacao/e2e.mjs` é a entrada (não `runner.mjs`); `E2E_SO` filtra. Mutação: edita, `build:extension`, roda, `git checkout -- arquivo`.
- 2026-11-12 (E9): `git checkout -- arquivo` na mutação apaga também correção não commitada no mesmo arquivo; commite antes de mutar. `expect.visivel(seletor, minimo)` exige o mínimo.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono; documentação corrigida
- [ ] `git rm docs/HANDOFF.md` (último commit); worktree removido (`git worktree remove`, `git worktree prune`)
- [ ] `typecheck`, `npm test`, `build`, `build:extension` e `perf:bundle` verdes; resumo para o PR
- [ ] Issues validadas (evidência por critério, `status:validada`, fechadas); a mãe #139 por último
- [ ] PR → `develop` e validar; mesma branch → `homolog` (`validada-develop`) e validar; `homolog` → `main` só aberto
  (`.claude/rules/github.md`); SHA da ponta na descrição do PR da homolog; branches para o dono apagar
