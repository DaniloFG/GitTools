# HANDOFF — Plano 4: diff e editores

Memória do trabalho entre sessões. Existe só na branch `feature/plano-4-diff-editores`: o check "Validar fluxo de
branches" reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas; o detalhe de
etapa fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: (1) no diff lado a lado, o arraste do mouse seleciona os dois lados e a cópia sai misturada: confinar a
  seleção ao lado onde o arraste começou (#155); (2) History → "Open in new window" abre o arquivo atual, deveria abrir
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

**Última etapa fechada:** `1` — READMEs: History, Commit, depois Dashboards (só documentação; `extension/media/readme/commit.png` é cópia de `linhas-do-commit.png`).

**A seguir:** `2` — Seleção confinada ao lado (diff lado a lado)

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| 1 | #157 | READMEs: History, depois Commit, depois Dashboards | fechada | ver `git log` | 1ª imagem History, 2ª Commit |
| 2 | #155 | Seleção do diff lado a lado confinada ao lado de origem | a fazer | | |
| 3 | #158 | Quebra de linha opcional nos editores (Settings + menu ⋯) | a fazer | | |
| 4 | #156 | "Open in new window" do History abre a comparação do commit | a fazer | | |
| 5 | #154 | ENCERRAMENTO | a fazer | | |

## 3. Base de medição

Não conferida ainda. Etapas 2 e 3 tocam `DiffView.tsx` (caminho quente): cada uma mede antes e depois
`npm run perf:bundle` e nós no DOM do diff (skill `medir`); gravar aqui o número de partida na primeira que medir.

## 4. Plano

### Etapa `2` — Seleção confinada ao lado (diff lado a lado)

- **Orquestra**: topo
- **Arquivos prováveis**: `src/renderer/src/components/DiffView.tsx` (`DiffBlock` :157, `side()` :164-192,
  `onCodeDown` :448), `styles.css` (:1111-1198, :2871-2880), módulo `.ts` novo para decidir o lado + teste,
  `scripts/validacao/e2e/cenarios/history-diff-commit.mjs` ou cenário novo.
- **Levantamento** (não rodado no navegador): cada linha `split` é um `<tr>` com as duas metades (`DiffView.tsx:226-233`),
  e nenhum `user-select` cobre `.code`; o arraste cruza lados por ordem de documento. O pedido do dono diz "separar
  cada lado em componente individual"; corte mínimo sugerido: gravar o lado do `pointerdown` (ref + atributo
  `data-side` na tabela, sem `setState`) e aplicar `user-select: none` ao outro lado via CSS, limpando no
  `pointerup`. Se não bastar (copiar), separar em duas tabelas/colunas por bloco. Decidir pelo teste real.
- **Restrições**: princípio 4 (nada de React por evento de mouse); nós no DOM não crescem; `td.code` novo recebe a
  marca de lado (só o `td.sel` tem `half` hoje).
- **Aceite**: cenário e2e que arrasta do lado antigo ao novo e confere que `getSelection()` só contém texto do lado de
  origem, reprovando sem a mudança; `npm run typecheck`, `npx vitest run` do módulo novo; `perf:bundle` e nós no
  DOM iguais ou menores.
- **Testes**: unidade (decisão do lado) e tela (e2e). **Segurança**: não. **Depende de**: nada (faz antes da 3: mesmo componente).

### Etapa `3` — Quebra de linha opcional nos editores

- **Orquestra**: topo
- **Arquivos prováveis**: `src/shared/settings.ts` (:60, :92, :127; `diffLayout` é o modelo), `components/settings/EditorSection.tsx`
  (:98-115), `components/ViewOptions.tsx` (:26-96, `diffViewGroups`), `DiffView.tsx` (:24-30 `useDiffLayout`,
  :544-549, :85-92 medição de bloco), `styles.css` (:1145-1149 `pre-wrap`, :4958-5050, :3163, :3206), `CodeEditor.tsx`
  (:186-196), `ConflictEditor.tsx`, `src/shared/i18n/messages/*.ts` (6 catálogos), `tests/settings.test.ts`,
  `tests/viewMenu.test.ts`.
- **Levantamento**: o diff hoje quebra (`pre-wrap`, linha de 18 px, blocos medidos); `CodeEditor` já usa `wrap="off"`;
  `.merge-side` é `pre` e `.merge-final` é `pre-wrap`. Escopo: "editores de código" = DiffView, CodeEditor/FileEditor
  e ConflictEditor; o `RebaseEditor` fica de fora (não é código). Decisão: configuração `wrapLines` (padrão fixo
  `true`, o comportamento de hoje, para nada mudar a quem não mexe) em Settings; alternância temporária no ⋯ como o
  lado a lado. O padrão pode ser revisto pelo `gt-juiz`.
- **Restrições**: sem quebra, a altura da linha é fixa (18 px): a virtualização por janela tem de continuar certa
  (princípio 1); barra horizontal sem custo por quadro; nós no DOM iguais.
- **Aceite**: e2e que liga/desliga pelo ⋯ e confere a barra horizontal (`scrollWidth > clientWidth`) e a ausência
  de quebra, reprovando sem a mudança; `settings.test.ts` com a normalização; typecheck verde nos 6 idiomas;
  `perf:bundle` abaixo do teto.
- **Testes**: unidade, tela, medição leve (bundle e nós no DOM). **Segurança**: não. **Depende de**: etapa 2.

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

### Etapa `5` — ENCERRAMENTO

- **Orquestra**: sonnet. Roda a seção 6.

## 5. Decisões e armadilhas

- 2026-11-12: ordem 1 → 2 → 3 → 4 pelo levantamento (2 e 3 tocam `DiffView.tsx`; 4 tem causa incerta).
- 2026-11-12: `RebaseEditor` fora do escopo do #158 (não é editor de código); padrão da quebra = `true`.
- 2026-11-12: etapa 4 começa por reprodução; se não reproduzir, o `gt-juiz` decide (não inventar correção).
- Gate: `.claude/triagem.local` com `media <assunto>` e `.claude/issue.local` (fora do git) em cada sessão de etapa.

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas
- [ ] Documentação tornada falsa corrigida (READMEs, `docs/PERFORMANCE.md`, `CLAUDE.md`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Resumo para o PR: o que mudou, antes e depois medidos, o que não foi conferido
- [ ] Issues validadas (evidência, `status:validada`, fechadas); #154 por último
- [ ] PR branch → `develop` (validar), mesma branch → `homolog` (`validada-develop`, validar), `homolog` → `main` aberto e deixado ao dono
