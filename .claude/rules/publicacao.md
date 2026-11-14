---
paths:
  - "extension/package.json"
  - "extension/CHANGELOG.md"
  - "package.json"
  - "scripts/extension-version.mjs"
  - "scripts/changelog-gate.mjs"
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

## CHANGELOG da extensão

- **Toda mudança visível ao usuário na extensão entra em `extension/CHANGELOG.md`**, sob `## [Unreleased]`, no mesmo
  PR. Em inglês (o Marketplace é em inglês), formato Keep a Changelog (`### Added`, `### Changed`, `### Fixed`), bullet
  curto e concreto; sem número de issue, nome de pessoa nem termo interno.
- **Ao subir minor ou major** em `extension/package.json`, o mesmo PR troca `## [Unreleased]` pela seção
  `## [x.y.z] - AAAA-MM-DD` e abre um `## [Unreleased]` novo no topo, com `- Nothing yet.`.
- **O changelog de usuário (o arquivo e o corpo do release) só tem assunto do app**: o que o usuário vê, usa ou ganha.
  O que é interno (pipeline, CI, workflow, hook, gate, fila, lote, HANDOFF, skill, agente, Claude, IA, modelo, sessão,
  dúvida, número de issue ou de PR, nome de branch, validação ou QA) vai para commit, PR e issue, nunca para ele.
  Termo de jargão técnico que o usuário não entende também sai: escreva o efeito, não o mecanismo.
- **O corpo do release vem da seção do CHANGELOG, nunca gerado de PR ou de commit** (`generate_release_notes` fica
  `false`). `scripts/changelog-gate.mjs` grava as notas (`notes`), as confere (`check`) e confere também o README,
  `displayName`, `description` e `keywords` do `package.json`, os `package.nls*.json` e o nome do release (`files`),
  tudo no workflow de publicação, antes de empacotar e de publicar: se achar termo interno, nada é publicado
  (Marketplace, Open VSX e release). A busca normaliza o texto (NFKC), ignora caracteres invisíveis (que reprovam por
  si) e trata `_` como separador.
- **Falso positivo do portão**: ele é largo de propósito (falso negativo é o que não pode). Termo barrado que é
  vocabulário do produto (`hook`, `agent`, `pull request`, `model`, `session`) se resolve descrevendo o efeito sem a
  palavra, nunca afrouxando a regra: "this working session" vira "this window"; "git hooks" vira "scripts that git
  runs"; "pull request" vira "merge request on the host". Termos de git como branch, merge, commit, rebase,
  cherry-pick, worktree e staging passam.
- **O portão é uma lista de bloqueio, não prova de que o texto é de usuário**: a revisão do PR confere a regra positiva
  (cada bullet descreve o que o usuário vê, usa ou ganha).
- **Patch automático não ganha seção**: o release dele usa o texto de `## [Unreleased]`. Sem seção da versão e com o
  `Unreleased` vazio (sem bullet, ou só `- Nothing yet.`), o push na branch publica a nota fixa
  `- Maintenance release: stability improvements.` (modo `neutro`, ligado só por `github.event_name == 'push'` e
  `ref_type == 'branch'`); tag e disparo manual falham de propósito (modo `estrito`): escreva o que mudou antes.
- **Permissões do workflow de publicação**: `contents: read` no topo; `contents: write` só no job `publish`.
- **`tests/extensionChangelog.test.ts` confere** a seção da versão do `package.json`, o `Unreleased` com bullet, a
  ordem decrescente das versões, bullet em cada seção e a ausência de termo interno no arquivo inteiro.
  O mesmo teste confere README, manifesto e `package.nls*.json`. `tests/changelogGate.test.ts` cobre cada regra do
  portão e `tests/workflows-publicacao.test.ts`, a ordem dos passos e as permissões do workflow. O patch que o workflow publica sozinho não sobe o arquivo e não ganha seção.
