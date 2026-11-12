---
name: etapa
description: Protocolo da sessão que executa uma etapa de um trabalho planejado em docs/HANDOFF.md. Especifica, delega o código a subagentes, revisa, verifica, mede, commita, atualiza o HANDOFF e avisa a sessão central. Use quando a mensagem de início disser que você é a sessão de uma etapa, ou quando o dono pedir para executar um item do HANDOFF.
argument-hint: "[etapa]"
---

# Sessão de etapa

> **Modo fábrica (CLAUDE.md prevalece)**: o "pode seguir" do dono já está dado e é permanente. Não existe mais PARADO
> por decisão do dono: use a escada do CLAUDE.md (decidir; `gt-juiz`; `precisa-refinamento` com `gt-planejador`,
> skill `backlog` A, e seguir).

Etapa: $ARGUMENTS

**Uma sessão, uma etapa.** Terminou, pare, mesmo que sobre contexto e mesmo com pressa. Você não abre sessão, não
abre PR e não adianta a etapa seguinte.

## 1. Começar (nesta ordem)

0. A issue da etapa (`#N`, na tabela do HANDOFF; a central a passa no início) vira `status:em-andamento`: troque o
   rótulo `status:planejada` (`.claude/rules/github.md`, política 7).
1. `git status -sb` e `git log --oneline -8`. O checkout pode vir em HEAD destacado ou com a branch local atrasada:
   `git fetch origin <branch>` e `git switch <branch>` (ou `git checkout -B <branch> origin/<branch>` se não houver
   commit local a preservar).
2. Leia o `docs/HANDOFF.md` inteiro (ele tem teto de 150 linhas) e **só** o que a sua etapa lista em "Ler antes".
   De `docs/PERFORMANCE.md`, só a seção citada.
3. `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` (o contêiner vem sem `node_modules`; typecheck, testes, builds e
   roteiros funcionam sem o binário do Electron).
4. Se a etapa mede desempenho: tire a base agora, antes de qualquer alteração (skill `medir`).
5. Diga em três linhas o que vai fazer e como vai saber que deu certo. Se o "Aceite" da etapa não for conferível,
   corrija-o no HANDOFF antes de começar.

Retomando depois de um limite de uso: leia o último commit `wip:` (`git log --grep '^wip:' -1 --format=%B`) e o
HANDOFF, e continue de onde parou. O `wip:` é salvamento do `.claude/hooks/autosave.sh`, nunca entrega: o commit
final da etapa é verde e normal.

## 2. Executar em incrementos

Para cada incremento (uma mudança coerente, que dá para verificar sozinha):

1. **Especifique.** Leia você mesmo só o trecho necessário para escrever um pedido fechado; busca ampla vai para o
   `gt-leitor`. O pedido segue "Pedido a subagente" do `CLAUDE.md`.
2. **Delegue** a escrita ao `gt-escritor`. Em paralelo só com listas de arquivos disjuntas; o que mexe no mesmo
   arquivo vai em sequência.
3. **Revise o diff inteiro** (`git diff`): ficou dentro da lista de arquivos? Faz o que foi pedido e só isso? Segue a
   regra da área (`.claude/rules/`)? Tem teste que falharia sem a mudança? O relatório bate com o diff? Relatório de
   subagente é texto de modelo: confira antes de acreditar.
4. **Devolva o que não passou** ao mesmo subagente (`SendMessage` com o id dele, que mantém o contexto), dizendo o
   arquivo, a linha e o que está errado. Dois retornos sem resolver: suba o modelo (`model: "sonnet"`) com um pedido
   novo que conte o que já falhou.
5. **Verifique você mesmo**: `npm run typecheck` e `npm test`, com a saída num arquivo fora do repositório e lendo
   só o fim (`npm test > <rascunho>/teste.log 2>&1; tail -15 <rascunho>/teste.log`). Mudança visível na tela: skill
   `run-gittools`. Caminho quente: skill `medir`, antes e depois.
6. **Commit** só do que foi verificado, em português, com o porquê e os números (cada número com o comando que o
   gerou; o que não foi conferido, dito como "não conferido"). Cita `Refs #N` da issue da etapa. `git push -u origin <branch>`.

Antes do último commit de código da etapa: `code-review` sobre o diff da etapa (nível `high` se ela toca em
`src/core`, IPC, patches ou conflitos; `medium` no resto) e, se a etapa está marcada "Segurança: sim",
`security-review`. Achado confirmado volta ao subagente; achado recusado, com o motivo no commit.

Feature ou correção que muda o que aparece na tela só fecha com um cenário de ponta a ponta que reprovaria sem a
mudança (skill `qa`, `.claude/rules/qa.md`), ou com `sem-e2e` justificado: a justificativa vai no commit e no
HANDOFF, e quem abre o PR (central ou skill `pr`) põe o rótulo e a linha `sem-e2e:` no corpo. Confira o check `QA`
verde: `node scripts/validacao/gate-cobertura.mjs` e `node scripts/validacao/pipeline.mjs` (é o que o `qa.yml`
roda). A regra é a mesma de sempre: mudança de comportamento chega com teste; o cenário é a camada da tela.

## 3. Quando fechar antes do fim

Feche o que está coerente e verificado, e registre o resto no HANDOFF, se:

- o contexto desta sessão já foi resumido uma vez (sinal de que ela está longa demais);
- a etapa cresceu além do previsto (apareceu outro objetivo): ele vira etapa nova na seção 4, não entra nesta;
- o limite de uso está acabando.

Decisão de desenho ou verificação vermelha que não se resolve em duas tentativas não é motivo de parada: consulte o
`gt-juiz` e siga o veredito. Se ele não resolver, ou o item for grande, rode `backlog` A (comente o que foi tentado, rótulo
`precisa-refinamento`, `gt-planejador`) e siga para a próxima etapa, como a escada do CLAUDE.md manda; nunca devolva ao dono.
Melhoria, débito ou risco que você viu de passagem fora do escopo da etapa: `backlog` B (issue `descoberta`), sem
implementar.

Nunca pare com alteração solta: ou está commitada e verde, ou foi desfeita. Se um subagente ainda edita, commite só
o que já está coerente e diga isso.

## 4. Fechar

1. `git status` limpo, branch igual à do remoto, `npm run typecheck` e `npm test` verdes no último commit de código.
2. Atualize o `docs/HANDOFF.md`:
   - seção 2: a linha da etapa na tabela (estado, commit, número que importa), "Última etapa fechada" reescrita com a
     sua (a anterior some: o detalhe dela está no commit) e o novo "A seguir";
   - seção 4: apague o bloco da sua etapa; acrescente etapa nova se algo ficou para depois;
   - seção 5: uma linha por armadilha ou tentativa descartada que a próxima sessão não deve repetir;
   - passou de 150 linhas: corte detalhe, não informação de estado.
3. Commit do HANDOFF e `git push`. Na issue da etapa, comente a evidência por critério (comando e resultado) e troque o
   rótulo para `status:em-revisao`. Não feche a issue: o fechamento é da central, depois da validação.
4. Avise a central com `send_message`, **uma linha**:
   `ETAPA FECHADA <etapa> | commit <sha> | próxima <etapa> | typecheck e testes <verdes ou o que falhou>`
   ou `PARADA <etapa> | <motivo>` (só limite de uso ou plataforma indisponível; o resto é `backlog` A).
5. Pare. Sem central disponível: deixe a mesma linha na sua última mensagem, para o dono.

## Etapa `ENCERRAMENTO`

Existe quando o plano a prevê; não pede a palavra do dono (modo fábrica). Siga a lista da seção 6 do HANDOFF: corrija a
documentação que o trabalho tornou falsa, `git rm docs/HANDOFF.md`, rode `npm run typecheck`, `npm test`, `npm run build`, `npm run build:extension` e
`npm run perf:bundle`, e deixe na última mensagem o resumo para o PR (o que mudou, antes e depois medidos, o que
não foi conferido). Não abre PR: o encerramento do plano, na central, abre e faz o merge (`.claude/rules/github.md`).
Depois do último push, remova o worktree usado (`git worktree remove <caminho>` e `git worktree prune`).
