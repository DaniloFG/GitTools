---
name: validar
description: Validação de promoção do GitTools (issue #103). Depois de todo merge na develop, e de novo depois do merge na homolog, dispara o gt-validador (pipeline completo com integração e ponta a ponta), registra a evidência nas issues e só então deixa promover. Use depois de qualquer merge na develop ou na homolog, antes de abrir o PR seguinte.
argument-hint: "[develop|homolog]"
---

# Validar a promoção

Ref: $ARGUMENTS

**Unidade verde não basta.** Toda promoção passa pelo mesmo pipeline, com integração (`npm test` cria repositórios git de
verdade) e ponta a ponta (a interface compilada num Chromium ligado ao Backend, como na skill `run-gittools`). Quem
orquestra (central ou sessão de entrada) não roda o pipeline: delega ao `gt-validador` e decide pelo veredito.

## O pipeline

`node scripts/validacao/pipeline.mjs` (alias `npm run validar`; `--so <fase>`, `--igual-a <ref>`). O workflow
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
| `e2e` | Interface real: abre repositório de exemplo, navega pelas telas, sem erro de console nem processo git inesperado |
| `homolog-igual-develop` | Só na homolog: a árvore é idêntica à da develop |

## Procedimento

1. **Merge na develop feito** (pela skill `pr` ou pelo encerramento da central). Antes de qualquer outro merge ou do
   PR para a homolog, chame `Agent` com `subagent_type: "gt-validador"` e `model: "sonnet"`, pedindo a ref `develop`
   e passando os números das issues do PR, se quiser que ele comente.
2. **`VALIDADO develop <commit> <árvore>`**:
   - comente em cada issue do PR a evidência: commit, árvore, fases com tempos e o link da execução;
   - troque o rótulo para `status:validada` (`.claude/rules/github.md`, política 7);
   - abra o PR `develop → homolog` (skill `pr`). O gate `.claude/hooks/gate-main.sh` só deixa o merge passar se a ponta
     do PR tiver o check `Validação` verde.
3. **`REPROVADO <fase> | …`**: não promova. Abra issue de correção (rótulo `bug`, ligada à mãe, com a fase, o trecho do
   log, o commit e o aceite "pipeline verde na develop") e conserte **antes de qualquer outro merge** na develop. Depois
   do conserto, valide de novo desde o passo 1.
4. **Merge na homolog feito**: repita exatamente a mesma validação, agora para `homolog` (o validador usa
   `--igual-a origin/develop` no caminho local; no workflow a fase `homolog-igual-develop` já faz isso). Árvore
   diferente da develop é `REPROVADO`: a homolog tem de ser a develop promovida, nada a mais.
5. **Só com as duas validações verdes** abra o PR `homolog → main`, com as duas evidências na descrição (commit,
   árvore, fases, tempos e links da `develop` e da `homolog`). Deixe-o ao dono: nunca merge nem auto-merge na `main`.

## Regras

- A validação é por commit: se a develop recebeu outro merge depois da validação, valide de novo a nova ponta.
- Sem workflow disponível (por exemplo, ainda não está na ref), o `gt-validador` roda o pipeline local num checkout
  limpo; o veredito vale igual, e a evidência diz "pipeline local".
- Não afrouxe nem pule fase para "passar". Fase instável é issue de correção, não motivo de promover.
