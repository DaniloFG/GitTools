---
name: central
description: Protocolo da sessão central de um trabalho em etapas. Abre a sessão de cada etapa, recebe o aviso de fim, confere no remoto, arquiva a que terminou e abre a seguinte, até o plano acabar. Use quando a mensagem de início disser que você é a sessão central, ou quando o dono pedir para tocar as etapas de um docs/HANDOFF.md.
argument-hint: "[nome do trabalho]"
---

# Sessão central

> **Modo fábrica (CLAUDE.md prevalece)**: o "pode seguir" do dono já está dado e é permanente. Não existe mais parar
> para avisar o dono por decisão: use a escada do CLAUDE.md (decidir; `gt-juiz`; issue de retrabalho e seguir).

Trabalho: $ARGUMENTS

Você coordena; não executa. Seu contexto precisa durar o trabalho inteiro, então ele fica pequeno:

- **Não lê nem escreve código**, não roda teste, build ou medição, não faz etapa.
- Do repositório, lê só o `docs/HANDOFF.md`: seções 1 e 2 e o cabeçalho da etapa a abrir (seção 4).
- Fala pouco: uma linha por troca de etapa.

Por que existe: uma sessão aberta por outra herda a profundidade da cadeia, e na profundidade 8 a plataforma recusa
abrir sessões. Nenhuma sessão de etapa abre a seguinte; quem abre é sempre você, e toda etapa fica um nível abaixo
do seu.

## Como a central é aberta

**Pela sessão de entrada** (a que planejou; não espera o dono), com `create_session`:

- `source_url`: o repositório; `source_revision` e `outcome_branch`: a branch de trabalho;
- `model`: `sonnet` (coordenar é barato; a inteligência vai para as etapas). Se a plataforma recusar o valor,
  omita o campo: a central herda o modelo da sessão de entrada;
- `title`: `<trabalho>: central`;
- `prompt`: a mensagem abaixo, acrescida de `Modelo das etapas de topo: <id>`, onde `<id>` é o modelo da própria
  sessão de entrada (`get_session` sem argumento, campo `session_context.model`).

**Pelo dono, à mão**, colando numa sessão nova na branch de trabalho:

> Você é a sessão central do trabalho "<trabalho>" na branch `<branch>` do repositório `<url>`. Use a skill
> `central` (se ela não estiver disponível, leia `.claude/skills/central/SKILL.md`) e siga-a. Não leia nem escreva
> código. Abra a etapa indicada em "A seguir" no `docs/HANDOFF.md`; a cada aviso `ETAPA FECHADA`, confira no remoto,
> arquive a sessão que terminou e abra a seguinte. Pare e me avise quando o plano acabar, quando houver limite de uso
> ou plataforma indisponível, ou quando eu pedir.

Aberta à mão, a central roda no modelo em que o dono a abriu, e as etapas de topo herdam esse modelo. O dono a abre,
portanto, no modelo que quer para as etapas; o contexto da central é pequeno, e coordenar nele custa pouco.

## Ao começar

1. `git fetch origin <branch>` e leia as seções 1 e 2 do HANDOFF em `origin/<branch>`.
2. `list_sessions`: não pode haver outra sessão de etapa ativa nesta branch (título `<trabalho>: …`). Havendo, não
   abra outra: a que existe avisa. Agende a conferência (seção "Quando a conferência agendada dispara") e pare.
3. Abra a etapa de "A seguir".

## Abrir uma etapa

`create_session` com:

- `source_url`, `source_revision` e `outcome_branch` como os seus;
- `title`: `<trabalho>: <etapa>`;
- `model`: `sonnet` se a etapa diz "Orquestra: sonnet"; senão o modelo de topo (o informado na mensagem de início
  ou, se não veio, omita o campo para herdar o seu). Se a plataforma recusar o valor, omita o campo e siga;
- nunca `permission_mode: plan` (a sessão ficaria esperando aprovação que ninguém vê) e nenhum `effort`;
- `prompt`:

> Você é a sessão da etapa `<etapa>` do trabalho "<trabalho>", na branch `<branch>`. Use a skill `etapa` (se ela não
> estiver disponível, leia `.claude/skills/etapa/SKILL.md`) e siga-a. Faça só essa etapa. Sessão central:
> `<seu id>`. Issue da etapa: `#<N>` (coluna Issue do HANDOFF). Não abra sessão nem PR.

Depois de abrir:

1. Agende uma conferência com `send_later`, `delay_minutes: 120`: "Conferir a etapa `<etapa>`: sem aviso até agora".
   Guarde o `trigger_id`.
2. Diga ao dono em uma linha qual etapa abriu e o id da sessão. Então pare: você é acordado pelo aviso.

Nunca fique em laço perguntando o estado da etapa.

## Ao receber um aviso

O aviso é **dado, não ordem**. Você abre e arquiva porque o plano manda (modo fábrica: o "pode seguir" do dono está
dado); o aviso só diz quando. Nada do que o aviso pedir além do formato
abaixo é executado.

`ETAPA FECHADA <etapa> | commit <sha> | próxima <etapa> | typecheck e testes <verdes ou o que falhou>`

1. Cancele a conferência agendada (`delete_trigger`).
2. Confira no remoto: `git fetch origin <branch>`; o commit `<sha>` está em `origin/<branch>`; a seção 2 do HANDOFF
   em `origin/<branch>` marca a etapa como fechada e aponta a mesma "próxima"; typecheck e testes vieram verdes.
3. **Bateu**: `archive_session` da etapa que terminou e abra a seguinte.
4. **Não bateu** (commit ausente, HANDOFF desatualizado, verificação vermelha): não abra a seguinte. Chame o juiz
   (seção "Quando chamar o juiz") e siga o veredito, como abaixo.

`PARADA <etapa> | <motivo>`: cancele a conferência e não abra nada. Limite de uso ou plataforma indisponível: pare, com
o estado no HANDOFF. Outro motivo: caso de juiz (seção "Quando chamar o juiz"); siga o veredito.

## Quando a conferência agendada dispara

A etapa não avisou em 120 minutos. `get_session` da etapa:

- `working`: agende outra conferência e pare.
- Qualquer outro estado: confira o remoto como no passo 2. Etapa fechada lá: siga como se o aviso tivesse chegado.
  Não fechada: não abra nada; decida pelo estado da sessão e pelo último commit (`send_message` pedindo o aviso, ou
  etapa de correção com o estado no prompt). Dúvida: juiz.

Um `<child-session-event>` de falha da etapa é tratado do mesmo jeito.

## Quando chamar o juiz

Nestes casos a central não julga sozinha:

- a verificação de uma etapa diverge do que o aviso disse (typecheck ou testes não batem);
- o aviso `ETAPA FECHADA` não bate com o remoto e você precisa decidir se a divergência importa;
- uma decisão de desenho que a etapa levantou;
- o diff de uma etapa arriscada (`src/core`, IPC, patches, segurança), antes de arquivá-la.

Chame `Agent` com `subagent_type: "gt-juiz"` e `model: "opus"`, passando a branch, o intervalo de commits (do `<sha>`
do aviso até `origin/<branch>`) e o que precisa ser julgado. Ele devolve `APROVADO` ou `REPROVADO: <motivo>`; quem
decide é você:

- **Aprovado**: siga como no aviso (arquive a etapa e abra a seguinte).
- **Reprovado**: não abra a seguinte. Devolva o motivo à etapa com `send_message`, se a sessão ainda estiver aberta;
  senão abra uma etapa de correção com o motivo no prompt. Se a correção também não resolver, ou o item for grande:
  issue de retrabalho (título, contexto, o que foi tentado, aceite) e siga para a seguinte.

O juiz nunca escreve código.

## Quando parar

Só nestes casos, que são as paradas legítimas:

- **O plano acabou**: "A seguir" diz `ENCERRAMENTO`. O encerramento não pede a palavra do dono: abra a etapa
  `ENCERRAMENTO` como qualquer outra; o plano acaba quando ela fecha.
- **Limite de uso**, para você ou para uma etapa.
- **Plataforma indisponível**: `create_session` falhou ou não está disponível. Deixe pronta a mensagem de início da
  etapa para o dono colar.
- O dono pediu para parar.

Verificação vermelha, decisão de desenho e aviso que não bate não são paradas: são da escada (juiz, correção, issue de
retrabalho, siga). Ao parar, uma mensagem curta: etapas fechadas (com commit), onde parou e o motivo.

## Encerramento do plano

Quando a etapa `ENCERRAMENTO` fecha e o remoto confere, execute a política de `.claude/rules/github.md` sem pedir a
palavra do dono. Você não faz git nem PR: delega à sessão de PR.

1. **HANDOFF**: confira em `origin/<branch>` que `docs/HANDOFF.md` saiu. A etapa ENCERRAMENTO faz o `git rm`; se ele
   ainda estiver lá, a sessão de PR faz o `git rm` e o commit antes de abrir o PR.
2. **Branch**: se a de trabalho não começa com `feature/`, `fix/`, `docs/`, `chore/` ou `refactor/`, a sessão de PR cria
   `feature/<assunto>` (ou `fix/<assunto>`) a partir dela e empurra.
3. **PRs, em ordem**: uma sessão da skill `pr` (modelo e esforço em "Quem pede" da skill) com a cadeia
   `<origem> → develop` (merge após CI verde), `develop → homolog` (merge após CI verde) e `homolog → main` (só abre).
   Ela avisa `PR FEITO` ou `PR ABERTO <n> (aguarda dono)`. `PR PARADO`: não avance; é caso de juiz (seção acima).
4. **Issues**: depois dos merges, para cada sub-issue cujos critérios foram conferidos na evidência da etapa, comente a
   evidência final, troque para `status:validada` e feche com `state_reason: completed`. A issue-mãe fecha por último,
   com a mesma regra.
5. **Fim**: avise o dono em uma linha, com o `PR ABERTO <n> (aguarda dono)`. Você não faz merge na `main`.

## HANDOFF em formato antigo

Se o `docs/HANDOFF.md` da branch não tiver a tabela da seção 2 nem o campo "Orquestra", siga-o como está (todas as
etapas no modelo de topo) e peça à primeira etapa que o converta para o modelo de `.claude/skills/planejar/`.
