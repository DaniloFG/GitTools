---
paths:
  - "tests/**/*"
  - "vitest.config.ts"
  - "scripts/perf/**/*"
  - "scripts/readme-media/**/*"
---

# Testes e medição

O projeto tem cinco camadas de verificação. Toda mudança de comportamento usa a mais barata que consegue
reprová-la, e as de cima quando o que mudou é o que o usuário vê ou o que custa tempo.

| Camada | Cobre | Onde | Rodar só isso |
| --- | --- | --- | --- |
| Unidade | Lógica pura: módulo `.ts` sem React, sem git | `tests/<módulo>.test.ts` | `npx vitest run tests/<arquivo>.test.ts` |
| Integração | Git de verdade: `GitRepository`, `Backend`, extensão com a API mínima do VS Code (`tests/support/vscode.ts`) | `tests/repository.test.ts`, `backend.test.ts`, `extension.test.ts`, `gitProcesses.test.ts` e vizinhos | idem |
| Interface sem tela | Módulos que precisam de tipos do navegador: proxy `git`, cache, sessão, catálogos | `tests/web/` (entra no `tsconfig.web.json`) | idem |
| Tela de verdade | A interface compilada num Chromium, ligada ao `Backend` real | `launch` e `newApp` em `scripts/readme-media/` (skill `run-gittools`) | roteiro escrito para a mudança |
| Desempenho | Orçamentos de `docs/PERFORMANCE.md`, seção 7 | `scripts/perf/` (skill `medir`) | `core.mjs`, `ui.mjs`, `perf:bundle` |

A conferência na tela tem duas formas. O roteiro curto, escrito para a mudança e fora do repositório, serve para ver
agora. Os cenários versionados em `scripts/validacao/e2e/cenarios/` são a suíte ponta a ponta que o check `QA` roda em
PR e em push (`.claude/rules/qa.md`, skill `qa`). Conferência que se repete em mais de um trabalho é candidata a
cenário versionado; proponha ao dono.

## Como escrever

- **O teste falha sem a mudança.** Para bug: primeiro o teste que reproduz e reprova, depois a correção. Diga no
  relatório que viu o teste reprovar antes.
- **Repositório de verdade, não simulação do git.** `createRepo()` de `tests/helpers.ts` cria um repositório
  temporário, com identidade e `autocrlf` fixos, e apaga no fim. Não simule a saída do git com texto escrito à mão
  quando dá para gerar o caso.
- **Casos de borda são parte do pedido**: lista vazia, um item, o limite e o limite mais um (`ARG_BUDGET`,
  `maxOutputBytes`, tetos de lista), nome com espaço, acento, aspas e `-` inicial, caminho do Windows, arquivo
  binário, repositório sem commit, HEAD destacado.
- **Equivalência em refatoração e otimização**: o teste compara o resultado novo com o de antes em todos os casos
  ("texto idêntico ao de hoje"), não só o caso feliz.
- **Mensagens em português**: os testes rodam com `setLocale('pt-BR')` e os seis catálogos em memória
  (`tests/support/catalogs.ts`).
- **Windows custa mais**: teste pesado usa `scale(full, win)` de `tests/support/scale.ts`; nada depende do relógio
  (`setTimeout` fixo, duração medida) nem da ordem de arquivos do sistema.
- **Módulo novo de `src/renderer/src` usado por teste** entra no `include` do `tsconfig.node.json`.

## O que nunca se faz

- Enfraquecer teste para ficar verde: nada de `.skip`, `.only`, `.todo`, asserção afrouxada, tempo limite aumentado
  ou caso removido sem explicar no commit por que o caso deixou de existir.
- Commitar com `npm run typecheck` ou `npm test` vermelhos, ou sem rodá-los depois da última alteração de código.
- Afirmar número sem a saída do comando que o gerou. O que não foi rodado é dito como "não conferido".

## Roteiros (`scripts/perf`, `scripts/readme-media`)

- O roteiro de tela compila o `Backend` a cada execução, mas serve a interface de `extension/dist/webview`:
  mudou a interface, rode `npm run build:extension` antes.
- O console da página acusa um 404 de `/favicon.ico` em toda carga (o servidor do roteiro não tem esse arquivo).
  É o único erro esperado; qualquer outro é falha.
- Mudança num roteiro de medição muda a régua: meça antes e depois com o **mesmo** roteiro e diga no commit o que
  mudou na medição.
