---
name: backlog
description: Mantém a fábrica andando sem devolver nada ao dono. Use quando uma issue travou (refinar com o gt-planejador), quando se vê de passagem uma melhoria, débito técnico ou risco fora do escopo atual (registrar como issue descoberta, sem implementar), quando um plano acaba e é preciso puxar a próxima issue pronta, e para a higiene de fechamento das issues.
argument-hint: "[A travei | B descoberta | C puxar | D higiene]"
---

# Backlog autossuficiente

> **Modo fábrica (CLAUDE.md prevalece)**: travar, achar algo no caminho ou terminar um plano nunca é motivo para
> perguntar ao dono. O trabalho vira issue com o rótulo certo e a produção segue. Rótulos e seus eixos:
> `.claude/rules/github.md`, seção Classificação.

Pedido: $ARGUMENTS

## A. Travei (nunca volta ao dono)

1. Comente na issue o que foi tentado e o bloqueio exato (comando, erro, arquivo:linha).
2. Troque `status:em-andamento` por `precisa-refinamento` e some o que descreve o bloqueio: `spike` se falta
   conceito, `bloqueada` se depende de algo externo ao código, `question` se é dúvida, `debito-tecnico` se é custo
   adiado.
3. Chame `Agent` com `subagent_type: "gt-planejador"` e `model: "sonnet"`, passando o número da issue e o passo 1.
4. `PRONTA`: grave o corpo refinado (`issue_write`, método `update`), aplique os rótulos propostos, remova
   `precisa-refinamento` (e os de maturidade que o refinamento resolveu) e ponha `status:planejada`. Tamanho Grande:
   crie as sub-issues da divisão, ligadas à mãe.
5. `AINDA INCOMPLETA` duas vezes na mesma issue: crie uma sub-issue `spike` (template `spike.yml`) com UMA pergunta,
   prazo máximo e critério de encerramento, ligada à mãe; a mãe fica `precisa-refinamento`.
6. **Siga para a próxima issue pronta** (C): a produção não para esperando o refinamento.

## B. Descoberta de passagem

Ao ver, fora do escopo atual, melhoria, débito, risco ou oportunidade **concreta** (com número medido ou risco
claro: desempenho, valor no código, estrutura, infra, arquitetura, engenharia):

1. Procure duplicada: `gh api -X GET search/issues -f q='repo:DaniloFG/GitTools is:issue <termos>'`. Existe: comente
   o novo dado nela e pare.
2. Não existe: crie a issue com os rótulos `descoberta` + tipo + natureza + área + prioridade + `status:planejada`
   (templates `melhoria.yml` ou `debito-tecnico.yml`). Corpo com os 4 campos (Escopo, Critérios de aceite,
   Considerações técnicas, Testes), "Onde vi: `arquivo:linha`" e "Descoberta durante #N".
3. Corpo que não ficou implementável (falta número, arquivo ou aceite): acrescente `precisa-refinamento`; o
   refinamento é o A.
4. **Nunca implemente no meio do escopo.** A regra "quem toca, melhora, dentro do escopo" do `CLAUDE.md` vale: o que
   não cabe na tarefa vira esta issue, não refatoração de passagem.
5. Sem ruído: opinião, gosto e "talvez" não viram issue. Sem número ou risco claro, não registre.

## C. Puxar a próxima

1. Liste as abertas com `status:planejada`, sem `bloqueada` e sem `precisa-refinamento`
   (`gh api -X GET search/issues -f q='repo:DaniloFG/GitTools is:issue is:open label:"status:planejada" -label:bloqueada -label:precisa-refinamento'`).
2. Ordem: `prioridade:alta`; depois `seguranca` e `bug`; depois `fix`, `enhancement` e `feature`; o resto por último.
3. Pegue uma (ou um grupo da mesma `area:*`) e faça a triagem de tamanho do `CLAUDE.md`: Pequena ou Média na
   sessão; Grande, skill `planejar`. Troque para `status:em-andamento`.
4. Quando um plano acaba e há backlog pronto, repita C: a fábrica não para. Sem backlog pronto, rode o A nas
   `precisa-refinamento` mais prioritárias.

## D. Higiene

- Ao fechar uma issue, comente a evidência por critério (comando e resultado; política 9 de `github.md`) e feche com
  `state_reason: completed`.
- Duplicada: comente a que prevalece e feche com `state_reason: duplicate`.
- Issue sem tipo, prioridade ou área: complete a classificação ao tocar nela.
