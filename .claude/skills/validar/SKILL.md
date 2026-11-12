---
name: validar
description: Validação do GitTools (issues #103 e #104). Depois de todo merge na develop, e de novo depois do merge da mesma branch na homolog, dispara o gt-validador (pipeline completo com integração e ponta a ponta), registra a evidência nas issues e põe o rótulo validada-develop no PR da homolog. Use depois de qualquer merge na develop ou na homolog, antes do passo seguinte.
argument-hint: "[develop|homolog]"
---

# Validar a promoção

Ref: $ARGUMENTS

**Unidade verde não basta.** Toda promoção passa pelo mesmo pipeline, com integração (`npm test` cria repositórios git de
verdade) e ponta a ponta (a interface compilada num Chromium ligado ao Backend, como na skill `run-gittools`). Quem
orquestra (central ou sessão de entrada) não roda o pipeline: delega ao `gt-validador` e decide pelo veredito.

## O pipeline

`node scripts/validacao/pipeline.mjs` (alias `npm run validar`; `--so <fase>`). O workflow
`.github/workflows/validacao.yml` ("Validação", job `Validação (develop)` / `Validação (homolog)`) roda o mesmo comando
em push para `develop` e `homolog` e em `workflow_dispatch`. Relatório: `validacao-out/relatorio.json`
(`{commit, arvore, branch, quando, fases:[{nome,ok,ms}], ok}`).

| Fase | O que prova |
| --- | --- |
| `typecheck` | Os três `tsconfig` compilam |
| `test` | `npm test`: unidade e integração com git de verdade |
| `build` | Aplicativo Electron compila |
| `build-extension` | Extensão e interface do webview compilam |
| `perf-bundle` | Tamanho do pacote dentro dos tetos |
| `e2e` | Cenários de `scripts/validacao/e2e/cenarios/` na interface real: cada um dentro do seu orçamento, sem erro de console nem processo git inesperado (skill `qa`) |
| `e2e-responsivo` | Barra, tela ativa e alerta de conflito dentro da janela, sem rolagem horizontal, em 5 larguras × 3 posições do painel de branches |
| `e2e-desempenho` | Carga a frio, processos git por ação, rolagem e nós no DOM, contra os tetos de `orcamentos.json` |
| `e2e-teclado` | Controles sem nome acessível e sem foco visível, contra os tetos de `orcamentos.json` (base medida, #120) |

## Procedimento

1. **Merge da branch de trabalho na develop feito** (pela skill `pr` ou pelo encerramento da central). Antes do PR da
   branch para a homolog, chame `Agent` com `subagent_type: "gt-validador"` e `model: "sonnet"`, pedindo a ref `develop`
   e passando os números das issues do PR, se quiser que ele comente.
2. **`VALIDADO develop <commit> <árvore>`**:
   - comente em cada issue do PR a evidência: commit, árvore, fases com tempos, cenários passados e falhas
     (`validacao-out/e2e.json`, `total` e `falhas`), o check `QA` da ponta e o link da execução;
   - troque o rótulo para `status:validada` (`.claude/rules/github.md`, política 7);
   - abra o PR da **mesma** branch para a `homolog` (skill `pr`; a develop nunca vai para a homolog) e ponha nele o
     rótulo `validada-develop`, só depois do veredito e do comentário. O gate `.claude/hooks/gate-main.sh` só deixa o
     merge passar se a ponta do PR está na história da develop, o PR tem esse rótulo e a origem não é a develop.
3. **`REPROVADO <fase> | …`**: não promova. Abra issue de correção (rótulo `bug`, ligada à mãe, com a fase, o trecho do
   log, o commit e o aceite "pipeline verde na develop") e conserte **antes de qualquer outro merge** na develop. Depois
   do conserto, valide de novo desde o passo 1.
4. **Merge na homolog feito**: repita exatamente a mesma validação completa, agora para `homolog`, com a sua própria
   evidência. Não há comparação de árvore com a develop (ela pode conter mistura de outros).
5. **Só com as duas validações verdes** abra o PR `homolog → main`, com as duas evidências na descrição (commit,
   árvore, fases, tempos e links da `develop` e da `homolog`). Deixe-o ao dono: nunca merge nem auto-merge na `main`.

## Regras

- A validação é por commit da branch: se a branch recebeu outro commit depois da validação, valide de novo a nova ponta.
  Lixo de outros na ponta da develop não trava a branch limpa; o rótulo vale por PR.
- Sem workflow disponível (por exemplo, ainda não está na ref), o `gt-validador` roda o pipeline local num checkout
  limpo; o veredito vale igual, e a evidência diz "pipeline local".
- Não afrouxe nem pule fase para "passar". Fase instável é issue de correção, não motivo de promover.
- O veredito `VALIDADO` exige também o check `QA` da ponta em `success` (o `qa.yml` roda em push para `develop` e
  `homolog`, então a ponta validada já tem o seu). Check ausente ou não `success` é `REPROVADO QA`. Sem workflow
  (pipeline local), o check não existe: rode `node scripts/validacao/gate-cobertura.mjs` e registre o resultado no lugar.
