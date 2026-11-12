# HANDOFF — Plano 4: diff e editores

Memória do trabalho entre sessões. Existe só na branch `feature/plano-4-diff-editores`: o check "Validar fluxo de
branches" reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de
etapa fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: (1) no diff lado a lado, o arraste do mouse seleciona os dois lados e a cópia sai misturada: confinar a
  seleção ao lado onde o arraste começou (#155); (1b) #160 (Commit diff não ocupa a altura do painel e perde linhas após arrastar o divisor); (2) History → "Open in new window" abre o arquivo atual, deveria abrir
  a comparação feita naquele commit (#156); (3) READMEs: as primeiras imagens são History e depois Commit; Dashboards
  vêm depois (#157); (4) editores de código: opção de NÃO quebrar linha (barra horizontal), configuração em Settings
  (padrão fixo) e alternância rápida no menu ⋯ do componente, como o lado a lado; textos nos 6 idiomas (#158).
- **Issue-mãe**: #154. Marcador local (`.claude/issue.local`): `#154 #155 #156 #157 #158`.
- **Fora do escopo**: Plano 3 (#131), em outra branch; não tocar nele nem no HANDOFF dele.
- **Regras deste trabalho**: branch nasce da `main` (regra do dono, #133). Sem PR até o ENCERRAMENTO; merge só até a
  `homolog`, nunca na `main`. Cada etapa de tela traz cenário e2e que reprova sem a mudança (skill `qa`).
- **Metas**: nós no DOM, tempo por quadro e `perf:bundle` não pioram (teto 700.000 bytes de JS na primeira carga;
  o Tour deixa pouca folga: medir antes, `npm run perf:bundle`).
- **Modelo das etapas de topo**: o da sessão de entrada (`claude-sonnet-5-5`).

### Ferramentas
A `main` já tinha skills, hooks e `CLAUDE.md` atuais (conferido): nada foi trazido por cherry-pick.

## 2. Estado

**Última etapa fechada:** `3` — Quebra de linha opcional (#158): `wrapLines` (padrão `true`) em Settings e item no ⋯ do diff (só enquanto aberto); sem quebra o `.diff-body` ganha `diff-nowrap` e `--code-ch` (maior linha, teto 5000) e rola na horizontal; `.merge-final` do ConflictEditor segue a configuração.

**A seguir:** `4` — "Open in new window" abre a comparação do commit (#156)

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| 1 | #157 | READMEs: History, depois Commit, depois Dashboards | fechada | ver `git log` | 1ª imagem History, 2ª Commit |
| 2 | #155 | Seleção do diff lado a lado confinada ao lado de origem | fechada | ver `git log` | perf:bundle JS 1ª carga 695.532 → 695.747 (teto 700.000) |
| 3 | #158 | Quebra de linha opcional nos editores (Settings + menu ⋯) | fechada | ver `git log` | perf:bundle JS 1ª carga 695.747 → 697.685 webview / 697.119 Electron (teto 700.000; folga ~2.300) |
| 4 | #156 | "Open in new window" do History abre a comparação do commit | a fazer | | |
| 5 | #160 | Commit diff: linhas ocupam a altura do painel e não somem após arrastar o divisor | a fazer | | |
| 6 | #154 | ENCERRAMENTO | a fazer | | |

## 3. Base de medição

Base (antes da etapa 2): `perf:bundle` JS da 1ª carga Electron 695.532 / webview 696.098 (teto 700.000: folga ~4.000 bytes). Etapas 2 e 3 tocam `DiffView.tsx` (caminho quente): cada uma mede antes e depois
`npm run perf:bundle` e nós no DOM do diff (skill `medir`); gravar aqui o número de partida na primeira que medir.

## 4. Plano

### Etapa `4` — "Open in new window" abre a comparação do commit

- **Orquestra**: topo
- **Arquivos prováveis**: `CommitDetails.tsx` (:166-174, :240, :374), `CommitList.tsx` (:504, :871, :912),
  `App.tsx` (:1223-1226, :1387-1389), `DiffWindow.tsx` (:42-83), `diffWindowRequest.ts`, `src/main/index.ts` (:107-136),
  `src/backend/backend.ts` (:534-537), `extension/src/extension.ts` (:294-362), `src/shared/api.ts` (:238-245).
- **Levantamento (leitura, não confirmado)**: o `source: {kind:'commit', sha}` sai certo de todos os pontos lidos;
  não se achou a causa por leitura. Pistas: `DiffWindow.tsx:79` cai em `files[0]` em silêncio; `CommitDetails.tsx:474`
  e `ChangesView.tsx:432` abrem pelo estado de trabalho; o rótulo "Open in new window" é `diffExtra.openWindow` (`en.ts:1749`,
  menu ⋯ do diff). **Primeiro passo: reproduzir** (skill `run-gittools`) e escrever o teste que reprova (e2e: abrir
  a janela a partir do History e conferir `request.source.kind==='commit'`, o sha e o conteúdo do diff).
- **Segurança**: sim. `backend.ts:535` valida só `path` e a presença de `source`: validar `source.kind` e o `sha` no
  canal `app:openDiffWindow` (regra "todo canal novo valida o que recebe"), se a correção mexer ali; terminar com
  `security-review`. Janela isolada e navegação fechada não regridem.
- **Aceite**: e2e novo que reprova sem a correção; `tests/` do `diffWindowRequest`; typecheck e `npm test` verdes.
- **Testes**: unidade, integração do canal, tela. **Depende de**: nada (fica por último: a causa é incerta).

### Etapa `5` — Commit diff: altura do painel e divisor (#160)

- **Orquestra**: topo
- **Arquivos prováveis**: `DiffView.tsx` (`VirtualList`), `CommitDetails.tsx`, `styles.css`, o divisor do painel.
- **Levantamento**: não feito (issue nova do dono). Sintoma: as linhas não ocupam a altura do painel e somem depois de
  arrastar o divisor; hipótese (não conferida): altura da janela de virtualização não recalculada ao redimensionar.
  Mesmo componente das etapas 2 e 3 (fechadas): ler o que elas mudaram. Primeiro passo: reproduzir
  (skill `run-gittools`) e escrever o e2e que reprova sem a correção.
- **Aceite**: e2e que arrasta o divisor e confere linhas visíveis preenchendo a altura; nós no DOM não crescem;
  `perf:bundle` abaixo do teto (folga de ~2.300 bytes hoje).
- **Testes**: tela (e unidade se houver lógica de janela). **Segurança**: não. **Depende de**: nada.

### Etapa `6` — ENCERRAMENTO

- **Orquestra**: sonnet. Roda a seção 6.

## 5. Decisões e armadilhas

- 2026-11-12 (dono, via sessão pai): #160 entra como etapa 5 (as 1–3 já estavam fechadas). Em #155 o sintoma não
  aparece em imagem estática: o e2e reproduz com `window.getSelection()`. #158: linhas longas quebram nos dois layouts.
- **Privacidade**: prints do dono mostram nomes de repositórios e pessoas e o repositório é público: nenhuma imagem
  nem nome vai para commit, HANDOFF ou issue.
- 2026-11-12: ordem 1 → 2(#155) → 3(#158) → 4(#156) pelo levantamento; #160 entrou depois como etapa 5.
- 2026-11-12: `RebaseEditor` fora do escopo do #158 (não é editor de código); padrão da quebra = `true`.
- 2026-11-12: etapa 4 começa por reprodução; se não reproduzir, o `gt-juiz` decide (não inventar correção).
- Gate: `.claude/triagem.local` com `media <assunto>` e `.claude/issue.local` (fora do git) em cada sessão de etapa.

- 2026-11-12: o arraste do Playwright não estende seleção em `td.code` do diff (também sem a mudança; caret cai fora do lugar, causa não achada). O cenário `diff-selecao-lado` aperta o mouse de verdade e estende a seleção pela API; não repetir a tentativa de `mouse.move` com o botão apertado.
- 2026-11-12: etapa 3: CodeEditor/ConflictEditor (textarea) já eram `wrap=off`; só diff e `.merge-final` mudaram. `useWrapLines` é useState (vale só com o diff aberto, como o layout). Folga do bundle agora ~2.300 bytes: a etapa 4 não deve crescer a primeira carga. Não conferido: salto de rolagem ao alternar a quebra em diff grande; CJK conta 1 coluna em `--code-ch`.

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas
- [ ] Documentação tornada falsa corrigida (READMEs, `docs/PERFORMANCE.md`, `CLAUDE.md`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] Issues validadas (evidência, `status:validada`, fechadas); #154 por último
- [ ] PR branch → `develop` (validar), mesma branch → `homolog` (`validada-develop`, validar), `homolog` → `main` aberto e deixado ao dono
