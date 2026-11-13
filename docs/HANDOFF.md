# HANDOFF — Fábrica paralela de issues (#198)

Memória do trabalho entre sessões. Existe só na branch `ccr-4ff33997-njtxld`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas.

## 1. Pedido e regras do dono

- **Pedido**: criar uma forma de paralelizar e executar as issues da fila (planejada, em andamento, em revisão), uma
  branch isolada por issue cortada da `main` (contexto limpo); concluída, cada branch entra na `develop` sem afetar as
  outras (a `develop` só concatena); o rigor fica por branch de trabalho. Alterar `CLAUDE.md` onde precisar.
- **Fora do escopo**: implementar o conteúdo das issues da fila (exceto o ensaio E6); aplicar proteção de branch no
  GitHub (#101, do dono); merge na `main` (só do dono).
- **Regras deste trabalho**: etapas em sequência na mesma branch (os arquivos se sobrepõem; a fábrica não se constrói
  em paralelo); `CLAUDE.md` termina com exatamente 199 linhas; sem atribuição de IA em branch, commit, PR e comentário.
- **Metas**: sem meta de desempenho do produto (nada de produto muda). `npm run typecheck` e `npm test` verdes.

## 2. Estado

**A seguir:** `E6`

**Última etapa fechada:** `E5` — `CLAUDE.md` 199 linhas (saldo zero), `github.md` +5 linhas (149→154), conciliado com `lote`/`fila.md`; typecheck e 1539 testes verdes.

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E0 | #198 | Base: trazer a regra da #133 para a branch | fechada | merge de 8a28fea | CLAUDE.md 199 linhas; grep vazio |
| E1 | #199 | Marcadores de issue e triagem por worktree/branch | fechada | ver `git log` (Refs #199) | gate-issue+gate-etapas 36 testes; typecheck e 1529 testes verdes; correção macOS (link /var→/private/var) em `lib-raiz.sh`/`gate-issue.sh`: typecheck e 1540 testes verdes |
| E2 | #200 | Autosave por worktree | fechada | ver `git log` (Refs #200) | autosave 42 testes (o novo reprova sem a mudança); 1531 testes verdes |
| E3 | #201 | Validação por commit de merge | fechada | ver `git log` (Refs #201) | workflows-validacao 8 testes (novo); 1539 testes verdes |
| E4 | #202 | Skill `lote` e ligações | fechada | ver `git log` (Refs #202) | lote/SKILL.md 44 linhas; grep vazio; 1539 testes verdes |
| E5 | #203 | `CLAUDE.md` e `github.md` | fechada | ver `git log` (Refs #203) | CLAUDE.md 199; github.md +5; 1539 testes verdes |
| E6 | #204 | Ensaio com #196 e #197 | a fazer | | |

## 3. Base de medição

Não se aplica.

## 4. Plano

### Etapa `E6` — ensaio com #197 e #196 em paralelo (#204)

- **Orquestra**: topo
- **Arquivos prováveis**: nenhum do repositório (evidência em comentários da #198).
- **Pré-requisito**: #198 (E0 a E5) na `develop`; sessões leem `sessao-issue.md` e `fila.md` de `origin/<branch>` via `git show`.
- **Aceite**: 3 sessões filhas vivas juntas; 2 PRs → `develop` com `QA` `success`; 2 `merge_commit_sha` com `Validação (develop)` própria e nenhuma cancelada; `validada-develop` nos 2 PRs da `homolog`; `git log origin/main..origin/<branch>` só com commits da branch.
- **Testes**: ponta a ponta do processo. **Segurança**: não (a #196 faz `security-review` por conta própria). **Depende de**: E0 a E5 na `develop`.

## 5. Decisões e armadilhas

Desenho completo (subagente de planejamento, resumido):

- **Decisão central**: uma sessão de nuvem por issue, branch `<tipo>/<N>-<assunto>` criada da `main` pelo coordenador; central
  do lote (sonnet) abre até 3 sessões de issue (2 no ensaio) em janela deslizante e uma sessão de fila (haiku, low) por lote.
  Estado por issue: nome da branch, rótulos, comentário de evidência, PR; sem HANDOFF em issue Pequena/Média.
- **Descartado**: worktrees numa sessão só (custo da conversa cresce com N², CPU e hooks colidem); branch de integração ou
  atualizar cada branch com a `develop` (a `homolog` deixa de levar só o da branch, #133/#192); cada sessão cuidar do
  próprio PR (corrida de merges e contexto relido a cada evento).
- **Seleção**: candidatas = `status:planejada` sem `bloqueada`/`precisa-refinamento`/`question`/`spike`/`proposta`; matriz
  de disjunção por arquivo, mais costuras: catálogos i18n, `styles.css`, `src/shared/`, `CLAUDE.md`/`.claude/`, `package.json`,
  `orcamentos.json`, `tsconfig.node.json`.
- **Fila serial**: merge direto se disjunto; com interseção, tirar e pôr o rótulo `fila` (re-`QA` no merge de teste atual) e
  mergear; conflito textual: a que chegou depois faz merge da branch da outra, nunca de `origin/develop`.
- **Develop quebrada**: reexecutar a fase; uma tentativa de conserto na branch culpada; senão reversão por PR (`revert/<N>-…`,
  exceção ao corte da `main`, nunca vai à `homolog`); atribuição pelo commit de merge M_i.
- **Fatos conferidos**: o `QA` de PR já testa o merge com a base; #192 é hipotética hoje (ruleset só tem `deletion` e
  `non_fast_forward`); hooks usam `$CLAUDE_PROJECT_DIR` (marcadores colidem entre worktrees); `github.md` entra em toda
  sessão (só o que vale sempre).
- **Branch**: a plataforma fixou `ccr-4ff33997-njtxld` (cortada da `main`); não renomear (`github.md` permite).
- **Não conferido** (E1 e E6 provam): `create_session` com `outcome_branch` livre; `.cwd` do JSON do hook em worktree;
  troca da execução pendente no grupo de concorrência; `labeled` recomputar o merge de teste.
- **E1**: sonda do `.cwd` negada pelo classificador (hook temporário em settings = automodificação); os hooks usam `.cwd` com queda para o projeto. `issue_da_branch` e `raiz_de_trabalho` ficam em `lib-raiz.sh` (E2 reaproveita). A E6 deve conferir o `.cwd` real.
- **E2**: o autosave usa o `pwd` do hook (não o JSON); a E6 confere que o hook real roda no worktree da sessão.
- **Descobertas (juiz, E1; não corrigidas)**: repositório aninhado em `.claude/worktrees/<x>` fica fora do gate de issue; `gate-etapas.sh` não normaliza o `cwd` no Windows; `normalizar()` em `gate-issue.sh` expande glob (`set -f`/`read -a`), sem fuga do repositório. `security-review` da E1 (gt-juiz, 3e1d24c..3bf53b5): APROVADO, só baixas.
- **E3**: juiz reprovou a 1ª versão (herança sem M_{i-1} no pedido; SHA que libera branch inocente); corrigido. Descoberta: custo de Actions sobe (uma `Validação` por merge); `revert/<N>` sem gate próprio no `gate-main.sh`; o validador usa `gh api commits/<c>/pulls` por commit da cadeia.
- **E4**: `lote` lê `sessao-issue.md`/`fila.md` por `Ref da skill: <ref>` (`git show origin/<ref>:…`); fila sem `outcome_branch` (reversão cria `revert/<N>-…` com git); modelo da sessão de issue = topo (sonnet se mecânica); `FIM DO LOTE` e nova entrada `selecionar` foram acrescentados. Pendente para E5: `lote` na tabela do `CLAUDE.md`; `github.md` só cita `issue.local` (não o nome da branch); `validar`/`gt-validador` ainda aceitam "sem SHA = ponta da ref" em chamada manual (aceito); E5 concilia `github.md` linhas ~105-107 ("Outros merges seguem").
- **E5**: "Outros merges seguem" virou "a fila segue com as outras branches; só a culpada e as que herdam a falha ficam sem promoção" (igual a `fila.md` passo 7). Pendente na E6: conferir `.cwd` real do hook e nome da branch como marcador.
- **Atribuição**: instrução de sessão pede rodapés, mas o `CLAUDE.md` do projeto proíbe; vale sem rodapé.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida (`CLAUDE.md`, `.claude/`, `CONTRIBUTING.md`)
- [ ] `git rm docs/HANDOFF.md`
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Issues das etapas validadas (evidência comentada, `status:validada`, fechadas); issue-mãe #198 fechada por último
- [ ] PR → `develop` mergeado e validado; HANDOFF removido; PR da mesma branch → `homolog` mergeado e validado; PR `homolog` → `main` aberto e deixado ao dono
- **E1-correção (#199)**: CI macOS vermelho em `gate-issue.test.ts:294`; causa confirmada reproduzindo no Linux com tmpdir via link simbólico (o teste novo reprovava antes). `caminho_fisico` (lib-raiz.sh) resolve só o diretório existente (`pwd -P`), nunca o componente final; `gate-issue.sh` isenta o marcador se o caminho léxico OU o físico bate com `$raiz/.claude/{issue,triagem}.local`. `gate-etapas.sh` e `autosave.sh` só usam o topo devolvido (físico) para ler arquivos/`pwd -P`: sem o mesmo defeito. `security-review` do diff da correção: sem achados (só marcadores, nenhum bypass novo). Windows/QA do run 43488383900: não conferidos aqui.
- **E1-correção, revisão do juiz**: o teste do link usa `linkOrSkip` (tests/helpers.ts), para não dar EPERM no Windows sem privilégio de link.
- **E1/E2-correção 2 (#199, #200)**: CI Windows (run 43489845670) com 3 falhas, sem stderr dos hooks no log. Causa do gate (itens 2 e 3) provada por leitura do código: `git rev-parse --show-toplevel` sai `C:/...` e o gate normaliza para `/c/...` (`pwd -P`, `para_posix`), então o marcador nunca igualava. Causa do autosave (item 1) NÃO provada: hipótese de que `--git-common-dir` do worktree sai com grafia diferente (nome curto 8.3 do tmpdir contra o longo do git), `raiz_de_trabalho` falha e o `wip:` sai na raiz. Correção única em `lib-raiz.sh`: `para_posix` (movido do gate) aplicado a topo e pastas comuns; mesmo repositório = mesmo texto ou `-ef` (identidade); `marcador_da_raiz` (só `issue.local`/`triagem.local` dentro do `.claude` da raiz, texto ou `-ef`). Teste novo `tests/lib-raiz.test.ts` (9, reprovam sem a correção) simula grafia diferente por link simbólico; o formato `C:/` real só o Windows prova. `security-review`: sem achados. Prova final: CI do PR #206.
- **E1/E2-correção 3**: revisão do juiz (portabilidade): `tests/lib-raiz.test.ts` usa `linkOrSkip`, git achado por `command -v` no bash, `path.delimiter` e caminhos em formato POSIX; `raiz_de_trabalho` guarda `RAIZ_DIAGNOSTICO` e o `autosave.sh` o registra no `autosave.log` quando a sessão está num worktree do projeto e a raiz não resolve; o teste do autosave mostra stderr e logs na mensagem de falha (asserção intacta).
- **E1/E2-correção 4**: `tests/lib-raiz.test.ts` usa `realpathSync.native` (nome longo no Windows, como o `topo` do git); nenhum outro teste de hooks usa `realpathSync`.
- **E1/E2-correção 5**: CI macOS (bash 3.2) reprovou `para_posix`: `${d,,}` é bash 4+. Causa lida no código (única construção 4+ dos hooks, achada por grep). `para_posix` minúscula com `case` (sem processo). Teste novo em `tests/lib-raiz.test.ts` proíbe construções bash 4+ em todo `.claude/hooks/*.sh` (reprova com a versão antiga). `security-review`: troca de string, sem achados. Sem prova: macOS e Windows reais; o CI do PR é a prova.
