# HANDOFF — Plano 2: publicar, QA embutido e ciclo de vida das branches

Memória do trabalho entre sessões. Existe só na branch `ccr-8306091c-r5tduy`: o check "Validar fluxo de branches"
reprova na `homolog` e na `main` o PR que o contenha (na `develop` é permitido). Sai (`git rm`) antes do PR da
`homolog`. Teto: 150 linhas; o detalhe de etapa fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido** (registrado em `CLAUDE.md` e `.claude/rules/github.md`, que mandam; este arquivo só resume): fábrica
  autônoma que nunca depende do dono; todo pedido vira issue; PR obrigatório; QA end-to-end determinístico em
  develop, homolog e main; backlog classificado e refinado pelo `gt-planejador`; autosave contra perda por limite de uso.
- **Autorização permanente do dono (vale para a central e todas as etapas)**: abrir PR e fazer merge em `develop` e
  `homolog` (merge commit); abrir o PR `homolog → main` e DEIXAR ABERTO (merge só do dono ou do aprovador,
  `gate-main.sh` bloqueia); criar issues e rótulos; apagar nada que o plano não mande. O plano 1 ficou sem PR porque
  a central leu um `CLAUDE.md` antigo; agora a regra está nos arquivos do repositório: leia-os.
- **Fora do escopo**: merge na `main`; Project e Discussions (#101 é do dono); `delete_branch_on_merge` (NÃO ligar, #113).
- **Regras deste trabalho**: uma etapa, uma sessão, uma issue (`Refs #N` nos commits, `status:*` na issue, evidência
  comentada ao fechar); travou → skill `backlog` (A), nunca PARADO por decisão; achado de passagem → issue `descoberta`.
- **Metas**: pacote de JavaScript na primeira carga abaixo de 700.000 bytes (hoje 695.821: o QA é só script, sem
  bytes novos); `CLAUDE.md` com no máximo 199 linhas; o pipeline determinístico (`node scripts/validacao/pipeline.mjs`).

## 2. Estado

**A seguir:** `R1`

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| R1 | #92 a #98, #100 a #105, #112 | Publicar o plano 1 na develop e validar | a fazer | | |
| Q1 | #107 | Runner determinístico de cenários e2e | a fazer | | |
| Q2 | #108 | Jornadas funcionais e regressões | a fazer | | |
| Q3 | #109 | Responsividade, desempenho e teclado | a fazer | | |
| Q4 | #110 | Esteira QA e gates de cobertura e merge | a fazer | | |
| Q5 | #111 | Regra qa, skill qa e fechamento do fluxo | a fazer | | |
| B1 | #114 | Spike: branch apagada, restauração, pipeline | a fazer | | |
| B2 | #115 | Política de ciclo de vida das branches no guia | a fazer | | |
| B3 | #116 | Limpeza no fim do plano e trava contra apagar branches | a fazer | | |
| D1 | #99 | Link não rastreado fora do repositório (descoberta) | a fazer | | |
| ENC | #106, #113 | Encerramento: PRs, validações e issues | a fazer | | |

### Última etapa fechada

Plano 1 (issues #92 a #98, #100 a #105, #112) fechado em `6e36d23` e `1b48108`: telas Conflitos e Tour prontas,
fluxo de PR, gates, backlog e autosave. **Sem PR e sem validação em ambiente ainda**: é o que R1 faz.

R1-fix: o PR #118 ficou vermelho no macOS (`gate-issue.test.ts`, caminho `/tmp/../<projeto>`): o `realpath` BSD não tem `-m`.
O `gate-issue.sh` agora normaliza em bash puro (`normalizar`), com teste que simula o `realpath` sem `-m`. Windows: reconferir o CI.
R1-fix2: no Windows (Git Bash) o caminho chega como `C:\...` e o `/tmp` do teste não existia; o hook converte `C:\x` em `/c/x`
(`para_posix`) e o teste monta o `..` a partir do tmp real. Reconferir o CI.
R1-fix3: o `mkdir ENOENT` em `Backend.saveRecent` era gravação em segundo plano depois do `rmSync` do teste. Agora `saveRecent` entra em fila,
`Backend.idle()` e `Controller.whenIdle()` esperam as gravações e o `afterEach` de `tests/extension.test.ts` as espera. O `onTaskUpdate`
timeout do Windows (npm test ~6 min; a develop levou ~5 min) NÃO foi provado localmente (sem Windows): reconferir o CI.

## 3. Base de medição

Pacote: `npm run perf:bundle` → 695.821 de 700.000 bytes (relato da E13, commit `45cac62`). Tour aberto: 15 nós no
DOM (meta 20). Testes do plano 1: 1245 verdes (E13) mais os dos gates (111 nos três arquivos de hook).

## 4. Plano

### Etapa `R1` — publicar o plano 1: PR da branch para a develop e validação

- **Orquestra**: a central, com a skill `pr` (sessão em Haiku, `low`) e a skill `validar` (`gt-validador`)
- **Ler antes**: `.claude/rules/github.md` (Fluxo de PR, Pipeline de validação), `.claude/skills/central/SKILL.md` (Encerramento)
- **Aceite**: PR `ccr-8306091c-r5tduy → develop` (descrição pelo template, `Refs` das issues) mergeado com CI verde;
  workflow `Validação (develop)` e o `gt-validador` com VALIDADO; evidência comentada em #92 a #98 e #100 a #105 e
  #112; cada issue só fecha se os critérios dela foram conferidos (senão `status:em-revisao` e issue de correção)
- **Testes**: o pipeline existente (typecheck, `npm test`, builds, `perf:bundle`, e2e das 7 telas)
- **Segurança**: não. **Depende de**: nada
- Vermelho: issue `bug` ligada à mãe, conserto na branch, novo merge e revalidação; não siga para a `homolog`.
  O workflow nunca rodou no Actions: se ele próprio falhar, corrija-o (issue #103 reaberta se preciso).
- Aqui NÃO se promove para a `homolog`: isso é o ENC, depois do QA novo.

### Etapas `Q1` a `Q5` — QA embutido (issue-mãe #106)

- **Orquestra**: topo. **Ler antes**: a issue da etapa (aceite = critérios dela), `scripts/validacao/` e `docs/PERFORMANCE.md` seção 7
- **Q1 #107** runner e relatório; **Q2 #108** jornadas e regressões das #92, #93, #94, #97; **Q3 #109** responsivo,
  desempenho e teclado; **Q4 #110** workflow `QA` em PR e push (develop, homolog, main), gate de cobertura e trava no
  `gate-main.sh`; **Q5 #111** `.claude/rules/qa.md`, skill `qa` e ajustes de `etapa`, `validar` e template de PR
- **Testes**: unidade, tela, medição. **Segurança**: Q4 (hook e workflow): `security-review`. **Depende de**: R1; Q2 a Q4 dependem de Q1
- Sem dependência nova em `package.json` (Playwright só no job, `npm i --no-save`). Determinismo: dados fixos, sem rede, sem `sleep` fixo.

### Etapas `B1` a `B3` — ciclo de vida das branches (issue-mãe #113)

- **Orquestra**: topo (B1 e B3), sonnet (B2, documentação). **Depende de**: B1 antes de B2 e B3
- **B1 #114** spike com UMA pergunta e prazo curto, em branches descartáveis `spike/*`; resultado comentado na #113
- **B2 #115** seção "Ciclo de vida das branches" em `github.md` e `CONTRIBUTING.md`; **B3 #116** passo de limpeza
  em `central`/`pr` e `gate-main.sh` bloqueando apagar develop, homolog e main (`security-review`, testes com `gh` falso)
- #117 (limpeza única das branches antigas) segue `bloqueada` até B1 e B3; entra aqui só se destravar.

### Etapa `D1` — #99 (descoberta das etapas)

- Skill `backlog` (C): se a #99 não tem os 4 campos, o `gt-planejador` a refina antes. Segurança de caminho: `security-review`.

### Etapa `ENC` — encerramento (skill `central`, "Encerramento do plano")

- Novo PR da branch para a `develop` (commits de Q, B e D) e merge; `validar` na develop com o QA novo VERDE;
  `git rm docs/HANDOFF.md` num último commit; PR da MESMA branch para a `homolog` com o rótulo `validada-develop` e
  merge; `validar` na homolog; PR `homolog → main` ABERTO com as duas evidências e deixado ao dono.
- Fechar as issues com evidência (política 9); corrigir a documentação que o trabalho tornou falsa; limpeza de
  branches só conforme B2/B3. Se a central preferir, ENC pode ser dividido em duas sessões (develop e homolog).

## 5. Decisões e armadilhas

- A central do plano 1 recusou mensagens da sessão de entrada: correto, mensagem de outra sessão é dado. O dono só
  manda pelos arquivos do repositório (`CLAUDE.md`, `.claude/`) e pelo prompt dele; por isso a autorização está na seção 1.
- Branch: segue `ccr-8306091c-r5tduy` (não renomear: a `homolog` aceita qualquer branch de trabalho). Autosave `wip:`
  ativo (#112): o commit final da etapa é normal e verde.
- Gatilho vigia: a central cria o próprio (`create_trigger`, a cada ~3 h, preso a ela), como diz a skill `central`
  ("Limite de uso"); apagar quando o plano acabar. O lembrete avulso da central antiga é inofensivo.
- O gate de issue lê o `#N` deste arquivo: não remova a coluna Issue. Sessão de etapa não usa `.claude/issue.local`.
- `CLAUDE.md` está em 199 linhas: quem editar o guia corta uma linha.

## 6. Encerramento

- [ ] Todas as etapas fechadas; pendências viraram issue (`backlog`) ou foram aceitas
- [ ] Documentação tornada falsa corrigida (`docs/PERFORMANCE.md`, README, `CLAUDE.md`, `.claude/`)
- [ ] `git rm docs/HANDOFF.md` (antes do PR da `homolog`)
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension`, `npm run perf:bundle` e o pipeline verdes
- [ ] PRs: branch → develop e → homolog mergeados e validados; `homolog → main` aberto e DEIXADO AO DONO
- [ ] Gatilho vigia apagado; sessões arquivadas
