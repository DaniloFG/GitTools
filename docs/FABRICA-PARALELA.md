# Fábrica paralela de issues: desenho e alternativas descartadas

Registro da decisão da #198 (sub-issues #199 a #204). O procedimento está em `.claude/skills/lote/` (`SKILL.md`,
`sessao-issue.md`, `fila.md`); este documento só guarda **por que** é assim e o que ficou de fora. Cada motivo cita a
fonte; nenhuma decisão nova entra aqui.

## O desenho

- **Uma branch por issue**, `<tipo>/<N>-<assunto>`, sempre cortada da `main`. O número no nome é a issue ativa do gate
  (`gate-issue.sh`), sem `.claude/issue.local` e sem `docs/HANDOFF.md` (#199, `lote/SKILL.md`).
- **Uma sessão de nuvem por issue**, até 3 em voo, e **uma sessão de fila serial** por lote que leva cada branch pronta a
  `develop` e depois a `homolog` (`lote/SKILL.md`, `fila.md`). A central do lote só abre, confere e arquiva.
- **Seleção por disjunção**: duas issues correm juntas só se não se cruzam em arquivo nem em costura (`src/shared/i18n/messages/`,
  `styles.css`, `src/shared/`, `CLAUDE.md`, `.claude/`, `package.json`, `orcamentos.json`, `tsconfig.node.json`).
- **A `develop` só concatena**; o rigor fica por branch (QA e testes por PR) e por commit de merge (`Validação` por SHA, #201).
- **Estado por worktree**: marcador de issue e triagem lidos do worktree (`lib-raiz.sh`, #199); autosave por worktree (#200).

## Alternativas descartadas

| Alternativa | Por que não |
| --- | --- |
| Worktrees locais numa só sessão | Os hooks resolviam a raiz por `$CLAUDE_PROJECT_DIR`, então `issue.local` e `triagem.local` colidiam e um worktree fora do projeto passava sem issue; o `autosave.sh` nunca salvava um worktree (#199, #200). Uma sessão de nuvem por issue dá contexto limpo e nenhum estado compartilhado (#198, "uma branch isolada por issue"). Os hooks ainda foram ajustados para valer em worktrees. |
| Promover `develop` → `homolog` | A `develop` aceita qualquer branch e pode ter mistura; a `homolog` leva só o que a branch fez, então vai a **mesma** branch de trabalho (`rules/github.md`, fluxo de PR; `gate-main.sh` barra origem `develop`). |
| Uma branch para todas as issues | Quebra o isolamento pedido na #198 (contexto limpo, rigor por branch) e prende todas ao pior atraso: uma issue vermelha seguraria as outras. Uma branch por issue deixa só a culpada sem promoção (`rules/github.md`, "Vermelho"). |
| Branch nascida da `develop`, ou `git merge origin/develop` na branch | A `develop` pode ter conteúdo que a `main` não tem, e a `homolog` passaria a levar o que não é da branch (#133; `sessao-issue.md`). A branch só se atualiza pela `main` ou pela branch de outra issue, quando a fila pedir. |
| Merge em lote com validação só da ponta da ref | Com merges em rajada o grupo de concorrência por ref descartava a validação do commit do meio, e `validar` validava "a ponta da ref" (#201). Hoje cada commit de merge tem a sua `Validação`, com veredito por SHA e regra de falha herdada. |
| Fila em paralelo | A fila é serial, um PR por vez, na ordem de chegada (`fila.md`): o `QA` do cruzamento é refeito contra a `develop` de agora e a validação precisa de um commit de merge por vez. Quem corre em paralelo são as sessões de issue, não os merges. |
| `docs/HANDOFF.md` por issue | A #198 deixava em aberto "HANDOFF por issue ou dispensado"; ficou dispensado: issue Pequena ou Média de lote guarda o estado nos rótulos, no comentário de evidência e no PR (`rules/github.md`). O HANDOFF continua só para plano Grande, na branch do plano. |
| Reverter na `homolog` ou na branch de trabalho | A reversão é exceção: PR `revert/<N>-…` cortado da `develop`, nunca vai à `homolog` (`fila.md`, passo 8). |

## Ensaio com par disjunto

O ensaio da E6 (#204) usou #196 e #197, que dividem `DiffView.tsx`, `styles.css` e `diff-estreito.mjs`: prova a fábrica, não
a disjunção. O par abaixo foi executado pelo lote, com as duas branches cortadas da `main` no mesmo commit
(`84d89b7`), e seus arquivos não têm interseção (`git diff --name-only $(git merge-base <merge>^1 <merge>^2) <merge>^2`):

| Issue | Branch | Arquivos | PR → `develop` | PR → `homolog` |
| --- | --- | --- | --- | --- |
| #232 | `fix/232-crlf-testes-de-workflow` | `tests/lerTexto.test.ts`, `tests/support/lerTexto.ts`, `tests/workflows-publicacao.test.ts`, `tests/workflows-validacao.test.ts` | #240, merge `4c3ff82` | #242, merge `c43275b` |
| #188 | `chore/188-acompanhar-prs-a-cada-10-minutos` | `.claude/skills/pr/SKILL.md`, `tests/skill-pr-acompanhamento.test.ts` | #244, merge `e3d7e8c` | #248, merge `f0a05a4` |

`Validação` por commit de merge, todas `success`, nenhuma cancelada: `develop` runs 43593677977 (#240) e 43598624301 (#244);
`homolog` runs 43596132304 (#242) e 43599903408 (#248), todos do workflow `validacao.yml`. Cada branch tem a sua validação
própria nas duas refs, que é o que a #201 pede.

**Não conferido**: o `QA` por ponta de cada PR (não consultado nesta sessão) e se as duas sessões de issue estavam vivas ao
mesmo tempo (o registro de sessões do lote não foi lido). O que está provado é a disjunção de arquivos, a mesma base e as
validações por SHA.
