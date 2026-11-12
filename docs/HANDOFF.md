# HANDOFF — Plano 5: provas do que sobrou do Plano 4

Memória do trabalho entre sessões. Existe só na branch `chore/plano-5-provas`: o check "Validar fluxo de branches"
reprova o PR que o contenha, e ele sai (`git rm`) no commit de encerramento. Teto: 150 linhas.

## 1. Pedido e regras do dono

- **Pedido**: fechar com PROVAS, sem afrouxar critério, o que o Plano 4 (mãe #139) deixou aberto. Mãe do Plano 5: #165.
  Fonte das pendências: os comentários de fechamento do Plano 4 em cada issue (leia-os antes de cada etapa).
- **Fora do escopo**: PR #164 (homolog → main), que aguarda o dono; revisão humana das traduções hi/ar/zh-CN (#172, descoberta, é do dono).
- **Regras**: modo fábrica (nunca esperar o dono); critério não é afrouxado: ou há prova (comando e saída
  comentados na issue), ou a pendência vira `precisa-refinamento`/pergunta ao dono e o plano segue.
  Branch nascida da `homolog` (ponta d064ecd, que contém o Plano 4). Nenhum `gate-*.sh` é alterado.
- **Metas**: sem meta numérica; `perf:bundle` não sobe (teto 700.000).

## 2. Estado

**A seguir:** ENCERRAMENTO (só com a palavra do dono; ver seção 6)

**Última etapa fechada:** E6: cenários `tour-movimento-reduzido` (estilo calculado `tour-in` vs `none`, emulação desfeita no `finally`) e `tour-sem-repositorio` (repositório do roteiro fechado, Tour percorrido, `git: 0`, reaberto no `finally`); Windows documentado em `.claude/rules/qa.md`; 2 mutações reprovam (CSS `animation: none`; `setTourOpen`); e2e 44 ok, testes 1474.

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E1 | #166 | security-review sem origin/HEAD + disparo real do SessionStart (#143, #142) | fechada | (este commit) | disparo real + security-review ok |
| E2 | #167 | security-review do diff da #95 (#147, #95); depende da E1 | fechada | (este commit) | sem achados |
| E3 | #168 | processos git por ação e stats em ms (#146, #132) | fechada | (este commit) | sem aumento; stats 0,09 ms |
| E4 | #169 | relato da #93, z-index do `.dash-popover`, fechar #108 (#150, #93, #94) | fechada | (este commit) | 2 mutações reprovam; 1474 testes |
| E5 | #170 | telas ocultas na barra estreita (#97) | fechada | (este commit) | 3 mutações reprovam; 42 e2e |
| E6 | #171 | Tour: reduced-motion, sem repositório, Windows (#98) | fechada | (este commit) | 2 mutações reprovam; 44 e2e |

Ordem: E1 → E2 → E3 → E4 → E5 → E6 (E4 fecha #108 depois de #93/#94/#97: o fechamento da #108 fica para depois da E5).

## 3. Base de medição

Só a E3 mede. Base: `4b9f8e5^` contra `4b9f8e5` (commit da correção da #132), com `node scripts/perf/core.mjs moderate`.

## 4. Plano

Cada etapa: ler a issue e os comentários de fechamento do Plano 4, executar, comentar a evidência por critério e
trocar o rótulo para `status:em-revisao`. Issues antigas só fecham com prova completa.


## 5. Decisões e armadilhas

- 2026-11-12: #143 destrava #147; por isso E1 antes de E2.
- 2026-11-12: relato da #93 e divergência do `.dash-popover` seguem a escada (pergunta registrada sem bloquear; `gt-juiz`).
- Cópia de teste sem `origin/HEAD` vive no scratchpad, nunca no repositório. Apagar a ref remota de `develop` na cópia é bloqueado pelo `gate-main.sh`: monte a cópia com `git init` + `git fetch origin <branch-de-trabalho>`.
- `claude -p` roda os hooks de `.claude/settings.json` do cwd (prova do SessionStart); `/security-review` em `-p` funciona.
- `claude -p "/security-review"` com `--permission-mode bypassPermissions` é negado pelo classificador; use `--allowedTools Read Grep Glob "Bash(git diff:*)"…`. Para revisar commits antigos, a cópia leva `origin/HEAD` no pai e só o `git diff` deles aplicado (o clone é raso).

- E4: `npm run build:extension` é obrigatório entre cada mutação de CSS/TS no e2e (ele testa o `extension/dist`); #108 segue aberta até a E5, com as mutações da #93 e #94 já anexadas na #150.
- Medição por ação (E3): roteiro de rascunho abre `launch` do worktree, chama `repo:invoke` (`stageFiles`, `commit`, `checkout`) e conta `app:gitLog` 3,5 s depois; `esbuild` não resolve fora do repositório (copie o script para dentro do worktree com `node_modules` ligado). `labels` em `issue_write update` SUBSTITUI todos os rótulos: reenvie a lista inteira.
- E5: o runner roda os cenários em ordem alfabética na mesma página (localStorage persiste); por isso o cenário de limpeza se chama `regressao-97-z-…`. Mutar CSS exige `npm run build:extension` antes do e2e; o e2e completo passa de 2 min (rode em segundo plano).
- E6: sem repositório não existe `.toolbar` nem `.screen-tab`; o cenário espera `#root > *` e conta as abas. Cenário que fecha o repositório do roteiro deve reabri-lo no `finally`.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Issues das etapas validadas e fechadas; #165 por último (e #139)
- [ ] PR branch → `develop` validado; PR da mesma branch → `homolog` validado; `homolog` → `main` aberto e deixado ao dono
