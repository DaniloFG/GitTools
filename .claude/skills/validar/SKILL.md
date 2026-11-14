---
name: validar
description: Validação do GitTools (issues #103 e #104). Depois de todo merge na develop, e de novo depois do merge da mesma branch na homolog, dispara o gt-validador (pipeline completo com integração e ponta a ponta) para o commit de merge de cada PR, um veredito por commit; registra a evidência nas issues e põe o rótulo validada-develop no PR da homolog e, depois da validação da homolog, validada-homolog no PR homolog → main (os dois liberam o merge na main). Use depois de qualquer merge na develop ou na homolog, antes do passo seguinte.
argument-hint: "<develop|homolog> <sha>[, <sha>…]"
---

# Validar a promoção

Ref e alvo: $ARGUMENTS

O argumento é `<ref> <sha>[, <sha>…]`: a ref e os SHAs dos commits de merge (`merge_commit_sha` do PR), em ordem de
merge. Cada SHA é validado no próprio commit, não na ponta da ref: merges em rajada na develop deixam cada commit de
merge com o seu veredito. Sem SHA (chamada manual), vale a ponta atual da ref.

**Unidade verde não basta.** Toda promoção passa pelo mesmo pipeline, com integração (`npm test` cria repositórios git de
verdade) e ponta a ponta (a interface compilada num Chromium ligado ao Backend, como na skill `run-gittools`). Quem
orquestra (central ou sessão de entrada) não roda o pipeline: delega ao `gt-validador` e decide pelo veredito.

## O pipeline

`node scripts/validacao/pipeline.mjs` (alias `npm run validar`; `--so <fase>`). O workflow
`.github/workflows/validacao.yml` ("Validação", job `Validação (develop)` / `Validação (homolog)`) roda o mesmo comando
em push para `develop` e `homolog` e em `workflow_dispatch`. Relatório: `validacao-out/relatorio.json`
(`{commit, arvore, branch, quando, fases:[{nome,ok,ms}], ok}`); o artefato `validacao-<ref>-<sha>` guarda o de cada commit.

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

1. **Merge da branch de trabalho na develop feito** (pela skill `pr`, pelo encerramento da central ou pela fila do
   lote). Antes do PR da
   branch para a homolog, chame `Agent` com `subagent_type: "gt-validador"` e `model: "sonnet"`, pedindo a ref `develop`
   com o `merge_commit_sha` do PR (`gh api repos/{o}/{r}/pulls/<N> --jq .merge_commit_sha`) e passando os números das
   issues do PR, se quiser que ele comente. Em rajada, um pedido só com os SHAs de todos os merges, em ordem.
2. **`VALIDADO develop <sha> <árvore>`** (uma linha por SHA pedido):
   - comente em cada issue do PR a evidência: commit, árvore, fases com tempos, cenários passados e falhas
     (`validacao-out/e2e.json`, `total` e `falhas`), o check `QA` do commit e o link da execução;
   - troque o rótulo para `status:validada` (`.claude/rules/github.md`, política 7);
   - abra o PR da **mesma** branch para a `homolog` (skill `pr`; a develop nunca vai para a homolog) e ponha nele o
     rótulo `validada-develop`, só depois do veredito e do comentário. O gate `.claude/hooks/gate-main.sh` só deixa o
     merge passar se a ponta do PR está na história da develop, o PR tem esse rótulo e a origem não é a develop.
3. **`REPROVADO <fase> | …`**: não promova o SHA. Só o culpado (a linha que **não** diz `herdado`) pede ação: conserto ou
   reversão, abaixo. A linha `herdado de <sha>` não gera issue nem conserto: ela espera o culpado, que é o primeiro commit
   vermelho da cadeia. Política de develop quebrada (outros merges não ficam bloqueados):
   - reexecute o job vermelho no mesmo commit (`gh run rerun <ID> --failed`) para separar falha real de instabilidade.
     Verde na reexecução: a fase não foi afrouxada nem pulada; a falha original vira issue de instabilidade (`bug`), e a
     reexecução verde é a que vale.
   - Vermelho de novo: abra issue de correção (rótulo `bug`, ligada à mãe, com a fase, o trecho do log, o SHA culpado e a
     branch dele) e peça **uma** tentativa de conserto na branch culpada, pela sessão dessa branch (skill `pr` para o PR
     de correção na develop). Conserto validado: valide o SHA novo desde o passo 1.
   - Sem conserto validado: reversão por PR. A branch `revert/<N>-<assunto>` nasce da develop (exceção à regra de nascer
     da main: é desfazer um commit que já está na develop), reverte o commit de merge culpado (`git revert -m 1 <sha>`
     se for merge commit; `git revert <sha>` se for squash) e segue a develop como qualquer PR, com CI verde e validação
     do SHA novo. **Reversão nunca vai à homolog.**
   - Nenhum SHA `REPROVADO` é promovido, herdado incluso: a branch só vai à homolog com um `VALIDADO` (regra da branch
     inocente, em Regras).
4. **Merge na homolog feito**: repita exatamente a mesma validação completa, agora para `homolog` (`merge_commit_sha` do
   PR da homolog), com a sua própria evidência. Não há comparação de árvore com a develop (ela pode conter mistura de outros).
5. **Só com as duas validações verdes** abra o PR `homolog → main` (ou reaproveite o aberto), com as duas evidências na
   descrição (commit, árvore, fases, tempos e links da `develop` e da `homolog`), e ponha nele os rótulos `validada-develop`
   e `validada-homolog` (este só depois do `VALIDADO` da homolog e do comentário de evidência). Se o rótulo
   `validada-homolog` não existir, crie-o: `gh api -X POST repos/{owner}/{repo}/labels -f name=validada-homolog`. O PR pode
   então ser mergeado pela sessão de PR, só pela via estreita de `.claude/rules/github.md` (o `gate-main.sh` confere os
   dois rótulos, os checks e o merge commit); nunca auto-merge.

## Regras

- A validação é por commit de merge: cada SHA pedido tem o seu veredito e nenhum é descartado. Um merge posterior não
  muda o veredito de um SHA anterior; um commit novo na branch pede a validação do SHA novo. O rótulo vale por PR.
- Branch inocente (veredito `herdado`): o veredito do SHA antigo não muda, e ele não bloqueia a branch nem os outros
  merges. Depois que o culpado for consertado ou revertido (o conserto ou a reversão já na develop), revalide a branch no
  commit de merge da develop que já contém o conserto ou a reversão: o `merge_commit_sha` do PR de conserto ou de
  reversão, ou o do merge seguinte da branch, se houver; nunca na ponta da ref. Esse `VALIDADO` é o que libera o rótulo
  `validada-develop`; sem ele, a branch não vai à homolog.
- Sem workflow disponível (por exemplo, ainda não está na ref), o `gt-validador` roda o pipeline local num checkout
  limpo do SHA; o veredito vale igual, e a evidência diz "pipeline local".
- Não afrouxe nem pule fase para "passar". Fase instável é issue de correção, não motivo de promover.
- O veredito `VALIDADO` exige também o check `QA` do SHA validado em `success` (o `qa.yml` roda em push para `develop` e
  `homolog` e `main`, então cada commit de merge já tem o seu). Check ausente ou não `success` é `REPROVADO QA`. Sem workflow
  (pipeline local), o check não existe: rode `node scripts/validacao/gate-cobertura.mjs` e registre o resultado no lugar.
