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

**A seguir:** `E1`

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E1 | #166 | security-review sem origin/HEAD + disparo real do SessionStart (#143, #142) | a fazer | | |
| E2 | #167 | security-review do diff da #95 (#147, #95); depende da E1 | a fazer | | |
| E3 | #168 | processos git por ação e stats em ms (#146, #132) | a fazer | | |
| E4 | #169 | relato da #93, z-index do `.dash-popover`, fechar #108 (#150, #93, #94) | a fazer | | |
| E5 | #170 | telas ocultas na barra estreita (#97) | a fazer | | |
| E6 | #171 | Tour: reduced-motion, sem repositório, Windows (#98) | a fazer | | |

Ordem: E1 → E2 → E3 → E4 → E5 → E6 (E4 fecha #108 depois de #93/#94/#97: o fechamento da #108 fica para depois da E5).

## 3. Base de medição

Só a E3 mede. Base: `4b9f8e5^` contra `4b9f8e5` (commit da correção da #132), com `node scripts/perf/core.mjs moderate`.

## 4. Plano

Cada etapa: ler a issue e os comentários de fechamento do Plano 4, executar, comentar a evidência por critério e
trocar o rótulo para `status:em-revisao`. Issues antigas só fecham com prova completa.

### Etapa E1 — security-review numa cópia sem origin/HEAD (#166)
- **Orquestra**: topo. **Segurança**: sim.
- **Ler antes**: `.claude/hooks/origin-head.sh`, `.claude/settings.json`, comentários da #143.
- **Aceite**: clone fora do repositório sem `origin/HEAD`; `security-review` roda até o fim e a saída vai para a #143; disparo real do SessionStart provado (ou limite documentado); `npx vitest run tests/origin-head.test.ts` 8/8.
- **Testes**: execução real; unidade existente como regressão.

### Etapa E2 — security-review do diff da #95 (#167)
- **Orquestra**: topo. **Depende de**: E1. **Segurança**: sim (nível `high`).
- **Aceite**: saída anexada na #147 e #95; achado vira correção com teste que reprova sem ela, ou issue.

### Etapa E3 — processos git e stats (#168)
- **Orquestra**: topo. **Ler antes**: skill `medir`, `docs/PERFORMANCE.md` seção 7.
- **Aceite**: processos por ação antes/depois sem aumento; custo dos stats em ms (mediana); comandos e saídas na #146/#132.

### Etapa E4 — relato da #93 e z-index (#169)
- **Orquestra**: topo. **Aceite**: pergunta ao dono na #93 (`question`), plano segue; veredito do `gt-juiz` sobre `.dash-popover` aplicado, com mutação vista reprovando. #108 só fecha depois da E5.

### Etapa E5 — telas ocultas (#170)
- **Orquestra**: topo. **Ler antes**: `Toolbar.tsx:125-151`, `layout.ts:9`, `screenVisibility.ts:39`.
- **Aceite**: variação de `e2e-responsivo` registrada; cenário com mutação (reverter `7cd72d1`); `finally` provado; teste "tela ativa oculta ainda aparece". Ao fim, fechar #108 (E4) com as mutações anexadas.

### Etapa E6 — Tour (#171)
- **Orquestra**: topo. **Ler antes**: `scripts/validacao/e2e/cenarios/tour.mjs`.
- **Aceite**: reduced-motion sem animação (mutação); Tour sem repositório com 0 processos git; Windows provado ou documentado (o que o CI Windows cobre).

## 5. Decisões e armadilhas

- 2026-11-12: #143 destrava #147; por isso E1 antes de E2.
- 2026-11-12: relato da #93 e divergência do `.dash-popover` seguem a escada (pergunta registrada sem bloquear; `gt-juiz`).
- Cópia de teste sem `origin/HEAD` vive no scratchpad, nunca no repositório.

## 6. Encerramento

Só com a palavra do dono de que o trabalho acabou.

- [ ] Todas as etapas fechadas; pendências viraram etapa, issue ou foram aceitas pelo dono
- [ ] Documentação tornada falsa corrigida
- [ ] `git rm docs/HANDOFF.md`
- [ ] Worktree removido, depois do último push
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e `npm run perf:bundle` verdes
- [ ] Issues das etapas validadas e fechadas; #165 por último (e #139)
- [ ] PR branch → `develop` validado; PR da mesma branch → `homolog` validado; `homolog` → `main` aberto e deixado ao dono
