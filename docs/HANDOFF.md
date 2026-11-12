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

**A seguir:** `D1`

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| R1 | #92 a #98, #100 a #105, #112 | Publicar o plano 1 na develop e validar | fechada | `38a0479` | PR #118 mergeado; validação da develop VALIDADO (árvore `951ac51`, [run](https://github.com/DaniloFG/GitTools/actions/runs/43154515685)) |
| Q1 | #107 | Runner determinístico de cenários e2e | fechada | `48b7a9a` | 7 cenários em ~3,7 s; 1303 testes verdes |
| Q2 | #108 | Jornadas funcionais e regressões | fechada | `cb8e437` | 27 cenários (20 novos) em ~31 s; mutação reprova #93, #94 e #97; 1312 testes verdes |
| Q3 | #109 | Responsividade, desempenho e teclado | fechada | `1d56c8f` | 3 fases em ~10 s cada; 1322 testes verdes; teclado: 3 sem nome e 5 sem foco (#120) |
| Q4 | #110 | Esteira QA e gates de cobertura e merge | fechada | `25d1b2a` | 1357 testes verdes; gate-main 61 (9 reprovam com o hook antigo); gate-cobertura 23 |
| Q5 | #111 | Regra qa, skill qa e fechamento do fluxo | fechada | `3f8edac` | 1357 testes verdes; `CLAUDE.md` em 199 linhas; só documentação |
| B1 | #114 | Spike: branch apagada, restauração, pipeline | fechada (parcial) | ver git log | compare por SHA e `refs/pull/N/head` provados; DELETE não testável da sessão (403) |
| B2 | #115 | Política de ciclo de vida das branches no guia | fechada | `4e222e5` | só documentação; `CLAUDE.md` em 199 linhas; typecheck e testes não rodados |
| B3 | #116 | Limpeza no fim do plano e trava contra apagar branches | fechada | ver git log | 84 testes do gate-main (12 novos reprovam sem a trava); 1380 testes verdes |
| D1 | #99 | Link não rastreado fora do repositório (descoberta) | a fazer | | |
| ENC | #106, #113 | Encerramento: PRs, validações e issues | a fazer | | |

### Última etapa fechada: `B3` (#116)

- **Feito**: `gate-main.sh` bloqueia (exit 2, "GATE DE BRANCHES") apagar `develop`, `homolog` e `main` por `git push --delete/-d/:ref`, `git branch -d/-D`, `gh api -X DELETE .../git/refs/heads/<ref>` (com `%2F`) e GraphQL `deleteRef`; outras branches passam. `central` ganhou o passo 8 (só LISTA as mergeadas na `homolog`, com SHA, e pede ao dono); `pr` manda registrar o SHA no PR da `homolog`.
- **security-review**: a skill não carregou (usa `origin/HEAD`, ausente no clone); revisão manual do diff: o hook só restringe, sem execução nova, variáveis entre aspas, padrões fixos. Limite aceito: heurística de texto (`git push origin ":$VAR"` e `git update-ref -d` não são vistos); a defesa real é o 403 do proxy.
- **Não conferido**: `perf:bundle`/builds (só hook e documentação). **Para o dono**: apagar `spike/base` e `spike/work`; #117 segue `bloqueada`.

## 3. Base de medição

Pacote: `npm run perf:bundle` → 695.821 de 700.000 bytes (relato da E13, commit `45cac62`). Tour aberto: 15 nós no
DOM (meta 20). Testes do plano 1: 1245 verdes (E13) mais os dos gates (111 nos três arquivos de hook).

## 4. Plano

### Etapas `Q1` a `Q5` — QA embutido (issue-mãe #106)

- **Orquestra**: topo. **Ler antes**: a issue da etapa (aceite = critérios dela), `scripts/validacao/` e `docs/PERFORMANCE.md` seção 7
- **Testes**: unidade, tela, medição. **Segurança**: Q4 (hook e workflow): `security-review`. **Depende de**: R1; Q2 a Q4 dependem de Q1
- Sem dependência nova em `package.json` (Playwright só no job, `npm i --no-save`). Determinismo: dados fixos, sem rede, sem `sleep` fixo.

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
