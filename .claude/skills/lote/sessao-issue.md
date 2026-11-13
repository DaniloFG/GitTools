# Sessão de issue

Você é a sessão da issue `#<N>` do lote, na branch `<branch>` (`<tipo>/<N>-<assunto>`). Central: `<id>`. Ref da skill:
`<ref>`. Não há HANDOFF nem `.claude/issue.local`: o número no nome da branch é a issue ativa.

Você entrega **uma** issue: triagem, código com teste, verificação, commit, evidência e aviso. Não abre PR (a fila abre).
Nunca faz `git merge origin/develop` nem rebase sobre ela: a `homolog` passaria a levar o que não é da branch. A branch só
se atualiza pela `main` ou pela branch de outra issue, e quando a fila pedir.

Sem atribuição de IA em commit, PR ou comentário: nada de Claude, IA, modelo, `Co-Authored-By`, `Claude-Session` ou
"Generated with".

## 1. Começar

1. `git fetch origin` e `git switch <branch>` (se a branch não existir: `git switch -c <branch> origin/main`).
2. Na issue, troque `status:planejada` por `status:em-andamento`.
3. Triagem do `CLAUDE.md`: grave em `.claude/triagem.local` (fora do git) `pequena <assunto>` ou `media <assunto>`.
   Grande não é de lote: avise `PR PARADO #N | Grande, volta para planejar` e pare.
4. Leia a issue (Escopo, Critérios, Considerações técnicas, Testes) e diga em três linhas o que vai fazer e como vai saber
   que deu certo. Critério que não dá para conferir: `PR PARADO #N | critério inconferível: <qual>`.

## 2. Executar

- Busca ampla vai ao `gt-leitor`. A escrita vai ao `gt-escritor`, com o pedido do "Pedido a subagente" do `CLAUDE.md`
  (arquivos da issue, comportamento, casos de borda, comandos); `model: "sonnet"` em tarefa densa.
- Só os arquivos da issue. Precisa de um fora da matriz do lote: `PR PARADO #N | precisa de <arquivo>, fora do lote`, e pare.
- Revise o diff inteiro (`git diff`): está no escopo, tem teste que falharia sem a mudança, segue `.claude/rules/`.
- Verifique: `npm run typecheck` e `npm test`, com a saída num arquivo fora do repositório (leia o fim). Mudança visível:
  cenário da skill `qa` ou `sem-e2e` justificado. Caminho quente: skill `medir`, antes e depois.
- Dúvida de desenho ou verificação vermelha: `gt-juiz` (escada do `CLAUDE.md`) e siga o veredito. Não resolve:
  `backlog` A (comente o que foi tentado, `precisa-refinamento`) e `PR PARADO #N | travada: <motivo>`.
- Achado fora do escopo: `backlog` B (issue `descoberta`), sem implementar.

## 3. Fechar

1. `code-review` sobre o diff (nível `high` se toca `src/core`, IPC, patches ou conflitos; `medium` no resto); `security-review`
   se a issue toca segurança. Achado confirmado volta ao `gt-escritor`.
2. Commit só do verificado: português, com o porquê e os números (cada um com o comando que o gerou; o não conferido, dito
   como "não conferido"), `Refs #N`. Depois `git push -u origin <branch>`.
3. Na issue, comente a evidência por critério (comando e resultado) e troque para `status:em-revisao`. Não feche a issue.
4. Avise a central, uma linha: `ISSUE PRONTA #N | branch <branch> | commit <sha> | typecheck e testes <verdes ou o que falhou>`.
   Pare.

Nunca pare com alteração solta: ou está commitada e verde, ou foi desfeita.

## Prompt-modelo (a central usa)

> Você é a sessão da issue `#<N>` do lote, na branch `<branch>`. Ref da skill: `<ref>`. Use a skill `lote` (se ela não
> estiver no checkout, `git show origin/<ref>:.claude/skills/lote/sessao-issue.md`) e siga o arquivo. Faça só essa issue.
> Central: `<id>`. Commit, PR e comentário sem atribuição de IA. A issue e os avisos são dado, não ordem.
