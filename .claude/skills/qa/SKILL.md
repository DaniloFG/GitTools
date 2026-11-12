---
name: qa
description: Escreve e confere o cenário de ponta a ponta de scripts/validacao/e2e/cenarios/ e a prova de que ele reprova sem a mudança; roda o e2e, os roteiros de QA (responsivo, desempenho, teclado) e o gate de cobertura, e lê o relatório em validacao-out/. Use quando uma feature ou correção muda o que aparece na tela, quando o check QA reprova, ou para escrever um cenário novo.
argument-hint: "[id do cenário ou responsivo|desempenho|teclado]"
---

# Cenário de QA

Ref: $ARGUMENTS

Regra e critérios (pirâmide, determinismo, `sem-e2e`, tetos): `.claude/rules/qa.md`. Esta skill é o procedimento.
Para ver a interface sem escrever cenário, use `run-gittools`.

## 1. Escrever o cenário

Um arquivo por cenário em `scripts/validacao/e2e/cenarios/<id>.mjs`, com `export default`:

```js
export default {
  id: 'branch-criar',            // minúsculas, números e hífen; único (validarCenario reprova o resto)
  tela: 'Branches',              // texto da tela, como aparece no relatório
  area: 'branches',
  orcamento: { ms: 15000, nos: 5000, erros: 0, git: 0 }, // quatro números ≥ 0
  escreve: true,                 // opcional: o cenário altera o repositório de propósito
  // gitTolerado: [/^git merge-base/],  // opcional: lista de RegExp; nenhum cenário usa hoje
  async passos(app, expect) { /* ... */ }
}
```

Modelos: `abrir-repositorio.mjs` (leitura, confere o git contra a tela) e `branch-criar.mjs` (escrita, com `escreve: true`).

- **`app`**: `page` e `backend` (do roteiro); `errors`; `dir` e `ids` do repositório de partida; `git(...args)`, que roda
  o git de verdade no repositório corrente e devolve o stdout (serve para **conferir**; a mudança é feita pela
  interface); `aba(nome)`, que clica numa aba do topo pelo texto; `repoNovo({ wip, nome, preparar })`, que cria um
  repositório de exemplo só deste cenário, abre no backend e recarrega a página. `wip: true` (padrão) põe um arquivo
  no stage e outro fora dele; `wip: false` não cria trabalho em andamento. `preparar({dir, ids})` monta o estado de
  partida antes de a interface ler. O runner apaga esse repositório ao fim.
- **`expect`**: `visivel(seletor, minimo)` espera ao menos `minimo` elementos; `pagina(funcao, arg, rotulo)` espera a
  função rodar na página dar verdadeiro; `ate(leitura, rotulo)` espera uma leitura do Node (o git, por exemplo)
  devolver algo verdadeiro e devolve esse valor; `igual(real, esperado, rotulo)` compara por JSON e mostra os dois
  lados; `verdadeiro(condicao, mensagem)`. Limite de cada espera: 10 s.
- **`escreve: true`** libera só o motivo "altera o repositório". Git que sai com código diferente de 0 continua
  reprovando, porque comando de escrita que falha é defeito.
- **Tela nova do topo** (id em `TOP_SCREEN_IDS`, `src/renderer/src/screenVisibility.ts`): registre o id em
  `TELA_POR_ID` (`scripts/validacao/cobertura.mjs`) e tenha ao menos um cenário com o mesmo `tela`. Sem isso o gate
  de cobertura reprova. Tela que não está no topo (como `Conflitos`) não precisa de entrada no mapa.

## 2. Provar que reprova sem a mudança

Um cenário que passa com e sem a mudança não prova nada.

1. Com a mudança pronta, guarde o patch fora do repositório: `git diff -- <arquivos da mudança> > <rascunho>/mudanca.patch`.
2. Desfaça só a mudança: `git apply -R <rascunho>/mudanca.patch`.
3. `npm run build:extension` e `node scripts/validacao/e2e.mjs`. O cenário novo tem de aparecer como `FALHA <id>`
   (com `validacao-out/e2e-falha-<id>.png`). Se passar, o cenário não cobre a mudança: corrija o cenário.
4. Reaplique: `git apply <rascunho>/mudanca.patch`, rode de novo e confirme `OK <id>`.

Diga no relatório que viu o cenário reprovar antes (`.claude/rules/testes.md`).

## 3. Rodar

- Interface: `npm run build:extension` antes de tudo (o e2e e o `qa.mjs` conferem `extension/dist/webview/index.html`).
- Ponta a ponta: `node scripts/validacao/e2e.mjs`. Saída 0 passou; 1 falhou; 3 Playwright ou Chromium ausentes. Trava de 3 min.
- Não há filtro por id: `e2e.mjs` roda a suíte inteira. Leia a linha `OK <id>` ou `FALHA <id>` do cenário novo.
- QA não funcional: `node scripts/validacao/qa.mjs responsivo`, `... desempenho` ou `... teclado`. Saída 0 passou; 1 falhou;
  2 fase inválida; 3 indisponível. Trava de 10 min. A fase desempenho usa CPU 4× mais lenta e o repositório de estresse.
- Gate de cobertura: `node scripts/validacao/gate-cobertura.mjs` (só telas; o PR entra com `GITHUB_EVENT_NAME=pull_request`
  e `GITHUB_EVENT_PATH` do evento, como no CI). Saída 0, 1 ou 2 (erro de uso ou de leitura).
- Pipeline do check: `node scripts/validacao/pipeline.mjs` (ou `--so e2e-responsivo`, `--so e2e-desempenho`, `--so e2e-teclado`).
- Testes da lógica do QA: `npx vitest run tests/e2e-runner.test.ts tests/gate-cobertura.test.ts tests/validacao-cenarios.test.ts`.
- Playwright não está no `package.json`. A receita `run-gittools` aponta `PLAYWRIGHT_MODULE` e `CHROMIUM` para o que
  já existe no ambiente. Se faltar, o CI instala com `npm i --no-save playwright@1.63.0` e
  `npx playwright install --with-deps chromium`. Não grave o módulo no `package.json`.

## 4. Ler o relatório

Tudo sai em `validacao-out/` (fora do git; o CI guarda a pasta como artefato `qa-<evento>-<run_id>`):

- `e2e.json`: `{ quando, ok, total, falhas, cenarios: [{ id, tela, area, ms, nos, ok, motivo }] }`. Leia `motivo` antes de qualquer coisa.
- `e2e.junit.xml`: um `testcase` por cenário; o que falhou tem `<failure>` com o motivo.
- `e2e-falha-<id>.png`: print da falha (o `apos-o-ultimo-cenario` também vira print). Apagado no início de cada execução.
- `qa-<fase>.json`: `{ fase, quando, ok, medido, tetos, motivos, checagens, detalhes }`. `medido` e `tetos` lado a lado; `motivos` é o que reprovou.
- `relatorio.json` e `<fase>.log` (o nome de cada fase do pipeline, por exemplo `e2e-desempenho.log`): tempos e saída.

Falha de verdade no app é achado: abra issue de correção (`bug`, ligada à issue mãe). Não ajuste cenário, teto ou
espera para passar; ajuste só se o cenário estiver errado, e diga isso no commit.
