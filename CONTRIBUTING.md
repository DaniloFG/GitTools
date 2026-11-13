# Como contribuir: fluxo de branches

Toda mudança segue três PRs, nesta ordem. A `develop` é o ambiente livre de integração (pode ter lixo, aceita qualquer branch de trabalho). A **mesma** branch de trabalho, já mergeada e validada na `develop`, vai por PR direto para a `homolog`; a `develop` nunca é promovida para a `homolog`. Cada ambiente tem a sua validação completa.

```
branch de trabalho ──PR──▶ develop        (validação completa na develop)
branch de trabalho ──PR──▶ homolog        (a mesma branch, já validada na develop; validação completa na homolog)
homolog ──PR──▶ main                      (o Claude só abre o PR; o merge é do dono)
```

| Branch | Para que serve | Recebe PR de | Aceita push direto? |
|---|---|---|---|
| `feature/`, `fix/`, `docs/`, `chore/`, `refactor/`, nascidas da `main` | Trabalho do dia a dia | — | Sim, são as branches de trabalho |
| `develop` | Integração das mudanças, ambiente livre | qualquer branch de trabalho (até `ccr-*`, com `docs/HANDOFF.md`) | Não, só por PR |
| `homolog` | Validação antes de produzir | a branch de trabalho, já validada na `develop` (nunca a `develop`); sem `docs/HANDOFF.md` | Não, só por PR |
| `main` | Produção: sempre igual ao que foi validado na homolog | `homolog` | Não, só por PR |

## Regras

- Nenhuma mudança chega à `main` sem passar pela `develop` e pela `homolog`, cada uma com a sua validação. Não há atalho para correções urgentes: um `fix/` segue o mesmo caminho.
- O check **Validar fluxo de branches** reprova o PR se a origem não for a permitida para o destino (`develop → homolog` é recusado) e, para `homolog` e `main`, se a árvore tiver `docs/HANDOFF.md`.
- Os checks de CI (typecheck, testes e build) precisam estar verdes antes do merge.
- `develop`, `homolog` e `main` não aceitam force push nem podem ser apagadas.
- Os PRs para `homolog` e `main` entram por **merge commit**, sem squash nem rebase, para o histórico continuar ligado. Antes do PR para a `homolog`, a branch precisa estar mergeada e validada na `develop` (rótulo `validada-develop`; o hook `gate-main.sh` confere).
- Não há aprovação obrigatória hoje (o repositório tem um mantenedor). Para exigir revisão, ajuste `APROVACOES` em `scripts/apply-branch-protection.sh`.

## Passo a passo

1. Criar a branch de trabalho a partir da `main` (a produção; a `develop` e a `homolog` podem ter o que a `main` não tem):
   ```bash
   git switch main && git pull
   git switch -c feature/nome-da-mudanca
   ```
2. Commitar, enviar e abrir o PR com base `develop`:
   ```bash
   git push -u origin feature/nome-da-mudanca
   ```
3. Depois do merge na `develop` e da validação lá, remover `docs/HANDOFF.md` (se existir) e abrir o PR da **mesma branch de trabalho** com base `homolog`. Validada a homolog, abrir o PR `homolog → main` (o merge é do dono).

## Ciclo de vida das branches

A branch de trabalho nasce da `main` e vai por PR para `develop`. Depois, a **mesma** branch vai por PR para `homolog`;
por isso ela fica de pé até o fim do plano, e não se apaga logo após o merge na `develop`.

- O Claude não apaga branches: apagar é do dono. `delete_branch_on_merge` fica desligado, porque apagar a branch no merge
  tiraria a base do PR para a `homolog`.
- Depois do merge na `main`, com os pipelines verdes e o trabalho finalizado, a exclusão da branch é do dono. A central só
  lista as candidatas (já na história da `main`), com o SHA da ponta de cada uma. `develop`, `homolog` e `main` nunca são
  apagadas.
- Antes de pedir a limpeza, registre o SHA da ponta da branch na descrição do PR para a `homolog`. Com o SHA, a
  verificação segue funcionando mesmo sem a branch (compare por SHA e `refs/pull/N/head`).

## Proteção das branches

As regras ficam em rulesets do GitHub e são aplicadas por `scripts/apply-branch-protection.sh` (idempotente; pode ser rodado de novo sempre que as regras mudarem):

```bash
scripts/apply-branch-protection.sh DaniloFG/GitTools
```

Cada branch (`main`, `homolog` e `develop`) tem:

- bloqueio de deleção e de force push;
- PR obrigatório, sem bypass para administradores;
- conversas resolvidas antes do merge;
- checks obrigatórios: **Validar fluxo de branches** e o CI nos três sistemas operacionais, com a branch atualizada em relação à base.
