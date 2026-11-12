---
paths:
  - "extension/package.json"
  - "package.json"
  - "scripts/extension-version.mjs"
  - "scripts/apply-branch-protection.sh"
  - ".github/**/*"
  - "CONTRIBUTING.md"
---

# Versão, publicação e fluxo de branches

- **Versão da extensão do VS Code é automática.** A cada merge na `main` que mexa no código da extensão, o
  workflow de publicação usa a versão de `extension/package.json` se ela for maior que a última tag `v*`; senão,
  publica a última tag com o último número + 1 e cria a tag nova (`scripts/extension-version.mjs`). Não suba o
  patch à mão; suba `extension/package.json` só para uma minor ou major.
- **Publicar é do workflow** (`publish-extension.yml`), nunca de uma sessão: nada de `vsce publish`, tag `v*` ou
  release criados à mão.
- **Fluxo de branches**: trabalho → `develop`, a mesma branch → `homolog` (nunca a `develop`) e `homolog` → `main`,
  sempre por PR; merge commit, sem squash nem rebase (`CONTRIBUTING.md`). O check "Validar fluxo de branches" reprova
  origem errada e PR para `homolog` ou `main` que contenha `docs/HANDOFF.md`.
- **PR é obrigatório** (`.claude/rules/github.md`): o merge até a `homolog` é do Claude; na `main`, só do dono. A descrição segue `.github/pull_request_template.md` e, em mudança de desempenho,
  traz o antes e o depois medidos.
- **Dependência** (`package.json`, `package-lock.json`): só muda quando a tarefa é essa, com motivo, tamanho no
  pacote e licença; `THIRD_PARTY_NOTICES.md` acompanha o que passa a ser distribuído.
