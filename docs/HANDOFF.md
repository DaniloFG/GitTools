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

**A seguir:** `ENC` — Encerramento (#131); lembrar de separar o commit `aeeda3f` (seção 5)

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
| E10 | #120 | Acessibilidade: 3 controles sem nome, 5 sem foco visível | feita | cf8db35 | qa teclado 3/5 → 0/0, tetos em 0; pacote 696.098 |
| E11 | #125 | readFile: janela TOCTOU em conflictDetails | feita | (ver git log) | openRegularFile (O_NOFOLLOW+fstat); mutação reprova; 1415 testes ok |
| E12 | #124 | gate-main: escapes da trava de apagar branch | feita | a8911a2 + correção | 16 casos de bloqueio novos reprovam sem a correção; gate-main 113/113; 1439 testes ok |
| E13 | #119 | Dashboard a 320 px: rolagem horizontal | feita | dfad82f | e2e 38 ok; 3 mutações reprovam; só CSS; pacote dentro dos tetos |
| ENC | #131 | Encerramento: PRs, validações, fechar issues, lista de branches | a fazer | | |

### Última etapa fechada: E13 (#119)

- **Feito**: refinada (gt-planejador, PRONTA, Pequena) e implementada só em CSS (`dashboard.css`): `flex-wrap` em `.dash-actions`,
  `.dash-filters .segmented`, `.dash-card-head`, `.dash-card-tools`; `.dash-summary` sem `nowrap`. O cenário `regressao-97-barra-estreita`
  confere a rolagem da página e os botões das ações/filtros nas duas telas.
- **Provas**: sem wrap em `.dash-actions` (340>320), sem wrap nos `.segmented` (467>320) e com `nowrap` de volta (322>320) reprovam.
- **Não conferido**: aparência a olho em ≥ 1050 px; `.wip-open` do History a 320 px (x=390, a página não rola) segue sem investigar.

## 3. Base de medição

Não se aplica a desempenho de produto. Base do QA: develop `082f5bc`, homolog `cf02905` (VALIDADAS). E6 mede por
`node scripts/validacao/qa.mjs desempenho`.

## 4. Plano

Cada etapa lê só o necessário, delega ao `gt-escritor`, termina com `npm run typecheck` e `npm test` verdes, comenta a
evidência na issue (política 9) e mantém `status:em-revisao`; quem fecha é o ENCERRAMENTO.

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

- E11: as skills `security-review`/`code-review` quebram sem `origin/HEAD` (`git remote set-head origin -a` talvez resolva); o espião de `repository.test.ts` conta `readFile` de node:fs/promises, então leia por `readFile(handle)`, não `handle.readFile()`.

- E13: o `.dash-summary` com `white-space: nowrap` estourava 2 px mesmo com o resto contido; ache o excedente listando `body *` com `right > vw` no cenário (temporário).

- E12: o hook lê o texto inteiro do comando, inclusive a mensagem de commit: citar o padrão de apagar com variável num `git commit -m` ou heredoc é barrado. `git branch -D heads/develop` passa de propósito (branch local); `update-ref -d` com variável e push com variável que não apaga são limites documentados no cabeçalho do hook.

- **Commit `aeeda3f`** ("docs: toda branch de trabalho nasce da main", Refs #133) entrou nesta branch fora do escopo do Plano 3
  (juiz: viola "pedido novo no meio não entra" e "uma sessão, um assunto"; o código da E9 foi aprovado). O ENCERRAMENTO deve
  separá-lo: cherry-pick numa branch própria cortada da base certa (`main`), PR próprio do #133, fora dos PRs do Plano 3,
  sem reescrever o histórico desta branch.

## 6. Encerramento

- [ ] Etapas fechadas; `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension`, `perf:bundle` verdes
- [ ] Docs tornadas falsas corrigidas; `git rm docs/HANDOFF.md` e PR para a `develop` ANTES do PR da homolog
- [ ] develop e homolog mergeadas e validadas; PR `homolog → main` aberto e deixado ao dono; issues fechadas, #131 por último
