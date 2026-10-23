# Como contribuir: fluxo de branches

Toda mudança passa pelas quatro etapas, nesta ordem:

```
feature/* ──PR──▶ develop ──PR──▶ homolog ──PR──▶ main
```

| Branch | Para que serve | Recebe PR de | Aceita push direto? |
|---|---|---|---|
| `feature/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`, `claude/*` | Trabalho do dia a dia | — | Sim, são as branches de trabalho |
| `develop` | Integração das mudanças | branches de trabalho | Não, só por PR |
| `homolog` | Validação antes de produzir | `develop` | Não, só por PR |
| `main` | Produção: sempre igual ao que foi validado na homolog | `homolog` | Não, só por PR |

## Regras

- Nenhuma mudança chega à `main` sem passar pela `develop` e pela `homolog`. Não há atalho para correções urgentes: um `fix/` segue o mesmo caminho.
- O check **Validar fluxo de branches** reprova o PR se a origem não for a permitida para o destino.
- Os checks de CI (typecheck, testes e build) precisam estar verdes antes do merge.
- `develop`, `homolog` e `main` não aceitam force push nem podem ser apagadas.
- Promoções (`develop → homolog` e `homolog → main`) entram por **merge commit**, sem squash nem rebase, para o histórico das três branches continuar ligado.
- Não há aprovação obrigatória hoje (o repositório tem um mantenedor). Para exigir revisão, ajuste `APROVACOES` em `scripts/apply-branch-protection.sh`.

## Passo a passo

1. Criar a branch de trabalho a partir da `develop`:
   ```bash
   git switch develop && git pull
   git switch -c feature/nome-da-mudanca
   ```
2. Commitar, enviar e abrir o PR com base `develop`:
   ```bash
   git push -u origin feature/nome-da-mudanca
   ```
3. Depois do merge na `develop`, promover a mudança: PR `develop → homolog`, validação na homolog e, por fim, PR `homolog → main`.

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
