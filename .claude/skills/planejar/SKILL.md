---
name: planejar
description: Transforma um pedido grande em plano de etapas e cria ou atualiza docs/HANDOFF.md, a memória do trabalho entre sessões. Use quando o pedido tem vários itens, é uma fase ou um plano, não cabe numa sessão, ou quando a sessão vai parar com trabalho por fazer e outra precisa continuar de onde esta parou.
argument-hint: "[nome do trabalho]"
---

# Planejar um trabalho em etapas

> **Modo fábrica (CLAUDE.md prevalece)**: o "pode seguir" do dono já está dado e é permanente. Não existe mais PARADO
> nem "avise o dono" por decisão: use a escada do CLAUDE.md (decidir; `gt-juiz`; issue de retrabalho e seguir).

Trabalho: $ARGUMENTS

O plano existe para que cada etapa rode numa sessão nova, de contexto limpo, sabendo só o que está escrito no
repositório. O que não estiver no `docs/HANDOFF.md` não existe para a sessão seguinte.

## 1. Antes de planejar

- Confirme a branch: é a de trabalho (`feature/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`, nascida de `develop`), nunca `develop`, `homolog` ou `main`.
- Se já existe `docs/HANDOFF.md`, você está **retomando**: leia-o, atualize o estado (passo 5) e não refaça o plano.
- Diga o pedido de volta ao dono em duas linhas e decida você mesmo o escopo, o que fica de fora e as metas, registrando
  cada decisão no HANDOFF. O dono não é consultado para planejar.

## 2. Levantar, barato

- Mande o agente `gt-leitor` mapear o que o trabalho toca (arquivos, quem chama, testes que já existem). Vários
  leitores em paralelo quando as perguntas são independentes.
- De `docs/PERFORMANCE.md` leia só a seção que importa (`grep -n '^## ' docs/PERFORMANCE.md` dá o índice; a 7 tem
  os orçamentos).
- Se o trabalho mexe em desempenho, tire a base agora (skill `medir`) e guarde os números com o comando que os gerou.

## 3. Cortar em etapas

Uma etapa é o que **uma sessão** fecha com folga:

- um objetivo só, que dá para dizer em uma linha e conferir com um comando;
- até umas três tarefas de escrita e, no máximo, uma rodada de medição de interface;
- termina com a branch verde (`npm run typecheck` e `npm test`) e algo entregue, mesmo que as seguintes não aconteçam;
- arquivos disjuntos das etapas que poderiam rodar ao mesmo tempo (elas não rodam ao mesmo tempo, mas isso mostra
  que o corte está limpo).

Ordene por dependência e por risco: primeiro o que destrava medir (roteiro, teste que conta), depois o ganho maior.
Etapa que não dá para conferir está mal cortada: divida ou junte.

Para cada etapa, decida também:

- **Quem orquestra**: `topo` (padrão) quando há desenho, desempenho ou segurança em jogo; `sonnet` quando é mecânica
  (renomear, preencher catálogos, mover arquivo, documentação).
- **Quais camadas de teste** ela exige: unidade, integração, tela, medição (`.claude/rules/testes.md`).
- **Se toca em segurança** (arquivo listado em `.claude/rules/seguranca.md`): a etapa termina com `security-review`.

## 4. Escrever o `docs/HANDOFF.md`

Copie [modelo-handoff.md](modelo-handoff.md) e preencha. Regras do arquivo:

- **Teto de 150 linhas.** O detalhe de uma etapa fechada mora na mensagem do commit dela, não aqui.
- **Estado é o de agora**, não o diário: a tabela tem uma linha por etapa; em detalhe, só a última fechada.
- **"A seguir" é uma etapa só**, e quem lê precisa conseguir começá-la sem perguntar nada.
- Medido fica separado de hipótese; o que não foi conferido aparece como "não conferido".
- Nada de dado pessoal, segredo, plano de assinatura ou nome de modelo: papéis (`topo`, `sonnet`) bastam.

Commit só com o HANDOFF e envie: `git push -u origin <branch>`.

## 5. Ao retomar ou ao parar no meio

Sessão que vai terminar com trabalho por fazer (contexto no fim, bloqueio, limite de uso) fecha o que está coerente
e verificado, commita, e deixa no HANDOFF: o que ficou pronto (commit), o que ficou pela metade e em que estado, e o
"A seguir". Sem HANDOFF ainda? Crie um com as seções 1, 2 e 4, mesmo que o plano tenha uma etapa só.

## 6. Entregar o plano ao dono

Mostre na conversa, sem repetir o arquivo:

1. a tabela das etapas (id, objetivo, quem orquestra, aceite);
2. o que ficou de fora e as decisões que você tomou sozinho;
3. quantas sessões o trabalho abre (uma central e uma por etapa).

Não peça o "pode seguir": ele já está dado (modo fábrica). Abra a central direto:

- **Há `create_session`**: abra a sessão central como a skill `central` descreve em "Como a central é aberta", diga
  ao dono o id dela e pare.
- **`create_session` falhou ou não está disponível** (parada legítima): entregue ao dono a mensagem pronta para colar
  numa sessão nova (está na mesma seção da skill `central`), com o estado no HANDOFF.

Esta sessão não executa etapa: o contexto dela já está cheio do levantamento.
