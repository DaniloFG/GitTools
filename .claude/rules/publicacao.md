---
paths:
  - "extension/package.json"
  - "extension/CHANGELOG.md"
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
- **PR é obrigatório** (`.claude/rules/github.md`): o merge é do Claude, e na `main` só pela via estreita da regra (homolog, as duas validações, checks verdes, merge commit; o hook confere). A descrição segue `.github/pull_request_template.md` e, em mudança de desempenho,
  traz o antes e o depois medidos.
- **Dependência** (`package.json`, `package-lock.json`): só muda quando a tarefa é essa, com motivo, tamanho no
  pacote e licença; `THIRD_PARTY_NOTICES.md` acompanha o que passa a ser distribuído.

## CHANGELOG da extensão

- **Toda mudança visível ao usuário na extensão entra em `extension/CHANGELOG.md`**, sob `## [Unreleased]`, no mesmo
  PR. Em inglês (o Marketplace é em inglês), formato Keep a Changelog (`### Added`, `### Changed`, `### Fixed`), bullet
  curto e concreto; sem número de issue, nome de pessoa nem termo interno.
- **Ao subir minor ou major** em `extension/package.json`, o mesmo PR troca `## [Unreleased]` pela seção
  `## [x.y.z] - AAAA-MM-DD` e abre um `## [Unreleased]` novo no topo, com `- Nothing yet.`.
- **`tests/extensionChangelog.test.ts` confere** a seção da versão do `package.json`, o `Unreleased` com bullet, a
  ordem decrescente das versões e bullet em cada seção. O patch que o workflow publica sozinho não sobe o arquivo e
  não ganha seção; o teste não o cobre.
