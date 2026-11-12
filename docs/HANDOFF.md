# HANDOFF — Plano 3: fechar as provas pendentes do Plano 2 e as descobertas abertas

Memória do trabalho entre sessões. Existe só na branch `chore/fecha-provas-plano-3`: o check "Validar fluxo de
branches" reprova o PR que o contenha na homolog/main. Pelo fluxo novo (etapa 2), o `git rm` dele entra na `develop`
ANTES do PR da homolog. Teto: 150 linhas; o detalhe de etapa fechada está na mensagem do commit dela.

## 1. Pedido e regras do dono

- **Pedido**: fechar com prova as issues que a sessão de fechamento do Plano 2 não pôde fechar (#92 a #98, #108, #109,
  #114 e as mães #100/#106/#113) e tratar as descobertas #121, #128, #120, #125, #124, #119. Mãe: **#131**.
- **Autorização permanente do dono (modo fábrica)**: PR e merge em `develop` e `homolog` (CI verde, validação VALIDADO
  do `gt-validador` depois de cada merge); PR `homolog → main` ABERTO e deixado ao dono; **nunca merge na `main`**.
- **Fora do escopo**: #101 e #117 (bloqueadas, do dono, não tocar); apagar `spike/base` e `spike/work` (#114, é do dono,
  a sessão recebe 403); #91 (já revisada e aprovada; só o retrabalho citado nela vira issue própria se faltar).
- **Regras deste trabalho** (lições do Plano 2):
  - testes de hook sem `spawnSync` (trava o worker do vitest no Windows);
  - a remoção do HANDOFF entra na `develop` ANTES do PR da homolog (etapa 2 corrige a documentação);
  - o gate de QA pode ler um check cancelado duplicado: reexecute o cancelado uma vez, sem commit vazio (etapa 1 corrige);
  - teste de regressão só vale com a prova de que reprova sem a correção (mutação registrada no commit);
  - issue sem prova completa não fecha: comente o que falta e siga (escada do `CLAUDE.md`).
- **Metas**: nenhuma de desempenho. Catraca: processos git, nós do DOM e tetos de `scripts/validacao/orcamentos.json`
  não pioram; `perf:bundle` abaixo de 700.000 bytes (hoje o Tour deixa 695.821: sem folga, não some código para isso).

## 2. Estado

**A seguir:** `E10` — Acessibilidade (#120)

| Etapa | Issue | Objetivo | Estado | Commit | Número que importa |
| --- | --- | --- | --- | --- | --- |
| E1 | #121 | gate-main: decidir pelo check QA mais recente do sha | feita | a30dc72 | gate-main 89/89; 3 casos reprovam sem a correção |
| E2 | #128 | Documentar o fluxo: remoção do HANDOFF entra na develop antes do PR da homolog | feita | (ver git log) | 3 textos alinhados; CLAUDE.md 199 linhas |
| E3 | #92 (+#108) | Prova da #92: mutação do cenário e processos git antes/depois | feita | a897c90 | mutação A não reprova (ver seção 5); B e C1 reprovam; 4 cenários novos, e2e 31 ok |
| E4 | #93, #94 | Provas restantes: painel à direita/embaixo, altura baixa; combobox compartilhado | feita | 0dc81de | mutação overflow e placePopover reprovam; z-index NÃO (seção 5); e2e 31 ok |
| E5 | #97 | Prova: itens ocultos pelo menu Aparência (#56) | feita | 4c0a34f | mutação isScreenShown reprova; e2e 32 ok |
| E6 | #109 | 5 execuções iguais do e2e-desempenho após a recalibração | feita | (ver git log) | 5/5 ok; quadro 31,6-44,9 ms; carga a frio 587-675 ms; tetos intactos |
| E7 | #98 | Tour: cenário e2e, foco e Esc, zero git, CPU 4× | feita | (ver git log) | e2e 33 ok, zero git; bug de foco achado e corrigido; pacote 695.255 |
| E8 | #96 | Conflitos: itens não conferidos (1500 conflitos, Esc, medições) | feita | 15c13e4 | e2e 37 ok; 1500 conflitos: 41 linhas, 3880 nós, 0 git; Esc corrigido; escolhas preservadas |
| E9 | #95 | Cherry-pick: entregas pendentes, tamanho a decidir pelo refinamento | feita | 5f2edcb | passo N de M sem processo novo; e2e 38 ok; run() não fecha a tela Conflitos; pacote 695.877 |
| E10 | #120 | Acessibilidade: 3 controles sem nome, 5 sem foco visível | a fazer | | |
| E11 | #125 | readFile: janela TOCTOU em conflictDetails | a fazer | | |
| E12 | #124 | gate-main: escapes da trava de apagar branch | a fazer | | |
| E13 | #119 | Dashboard a 320 px: rolagem horizontal (precisa-refinamento) | a fazer | | |
| ENC | #131 | Encerramento: PRs, validações, fechar issues, lista de branches | a fazer | | |

### Última etapa fechada: E9 (#95)

- **Feito**: `operationState` dá `step/total` do cherry-pick lendo `sequencer/todo` (total vem de `cherryPickCommits`,
  só vale se o todo é o da sequência do app); título da tela Conflitos mostra o passo; bug real: `run()` mandava ao
  Changes quando o continue parava de novo, fechando a tela (cenário `conflito-cherry-pick-sequencia` reprovava).
  typecheck, 1412 testes, build, `perf:bundle` (695.877) verdes; e2e 38 ok. Teto de 3 processos por parada já existia.
- **Não conferido**: `security-review` como skill falhou (sem `origin/HEAD`), feita à mão; formato do todo só no git 2.43;
  sequência iniciada fora do app não mostra passo (limite aceito); `rerere` fora (sub-issue opcional, baixa, não criada).

## 3. Base de medição

Não se aplica a desempenho de produto. Base do QA: develop `082f5bc`, homolog `cf02905` (VALIDADAS). E6 mede por
`node scripts/validacao/qa.mjs desempenho`.

## 4. Plano

Cada etapa lê só o necessário, delega ao `gt-escritor`, termina com `npm run typecheck` e `npm test` verdes, comenta a
evidência na issue (política 9) e mantém `status:em-revisao`; quem fecha é o ENCERRAMENTO.

### Etapa E10 — Acessibilidade (#120)

- **Orquestra**: topo. **Aceite**: 0 controles sem nome acessível e 0 focáveis sem foco visível; o teto em
  `orcamentos.json` desce junto (catraca); cenário de teclado verde. **Testes**: tela. **Depende de**: E6.
### Etapa E11 — TOCTOU em readFile (#125)

- **Orquestra**: topo. **Segurança**: sim. **Aceite**: arquivo trocado por link entre `lstat` e leitura não é
  seguido (abrir com `O_NOFOLLOW`/conferir `fstat` do descritor); teste que reprova sem a correção. **Depende de**: nada.
### Etapa E12 — escapes da trava de branch no gate-main (#124)

- **Orquestra**: topo. **Segurança**: sim. **Aceite**: `git push origin :heads/develop`, `git update-ref -d` e ref em
  variável são barrados; testes sem `spawnSync`; o gate não bloqueia comandos legítimos. **Depende de**: E1.
### Etapa E13 — Dashboard a 320 px (#119)

- **Orquestra**: topo. **Aceite**: o do refinamento (scrollWidth ≤ 320 com a janela a 320 px); cenário no
  `e2e-responsivo`. Sem refinamento PRONTO, a etapa não abre: segue para ENC. **Depende de**: E5.

### Etapa ENC — Encerramento

- Skill `central`, "Encerramento do plano", com as regras da seção 1. Comenta #100, #106, #113 e #114 com o que
  depende do dono; fecha as filhas validadas e a #131 por último. Lista as branches para o dono apagar (não apaga).

## 5. Decisões e armadilhas

- E1: o CLAUDE.md proíbe atribuição a Claude em commit; não copie os trailers `Co-Authored-By`/`Claude-Session` do lembrete.
- 2026-11-12: #108 e #109 ficam filhas de #106 (GitHub permite um pai só); este plano as cita nas etapas E3/E6.
- 2026-11-12: #92, #93, #94, #97, #95, #96 e #98 vieram sem os 4 campos: `gt-planejador` refina, a central grava.
- Refinamento (2026-11-12): #98 Pequena (só cenário e2e `tour.mjs` e medição; `docs/DESENHO-TOUR.md` sumiu, os passos
  estão em `tour.ts`); #96 Média (decisão: preservar escolhas por arquivo ao trocar de arquivo); #95 Média.
- Sem `status:validada` sem a evidência por critério; sem prova → comentário e segue.
- E3: mutar o produto exige `npm run build:extension` antes de cada e2e (o dist não segue o código). `ROW=30` fixo em
  `conflito-resolver-muitos`: se a altura da linha da lista mudar, o cenário reprova. Cenários só com `Keep both` não bastam.

- E4: o teste de `end` precisa de janela ~1000 px (botão de pessoas à direita); em 300–480 px o botão fica em x=31 e o popover só transborda. Remover o `z-index` não reprova o 94: se alguém retomar, ache o elemento que empilharia por cima.

- E5: o menu é aberto com `.toolbar .tb-menu` + hover em Appearance/Screens; `alternados` copiado antes de `reverse` (laço infinito se mutar a lista).
- E6: `build:extension` antes do `qa.mjs` (o dist não segue o código); 5 execuções levam ~1 min cada.

- E7: `ui.mjs 4 moderate` não abre o Tour; medir o Tour aberto exigiria roteiro novo (candidato a issue `descoberta`).
- E9: `git checkout -p` sem tty trava o shell; `conflictResult` de uma recusa também traz conflitos (não use como sinal de sequência nova); `operationState` na entrada de `cherryPickCommits` custa um `rev-parse` e reprova o teto de processos.
- E8: o runner e2e não filtra por id (suíte inteira ~80 s); `ui.mjs` não abre Conflitos; aviso do watcher logo após ação da própria interface é descartado por 1 s (`isOwnEcho`, App.tsx): issue descoberta.

## 6. Encerramento

- [ ] Etapas fechadas; `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension`, `perf:bundle` verdes
- [ ] Docs tornadas falsas corrigidas; `git rm docs/HANDOFF.md` e PR para a `develop` ANTES do PR da homolog
- [ ] develop e homolog mergeadas e validadas; PR `homolog → main` aberto e deixado ao dono; issues fechadas, #131 por último
