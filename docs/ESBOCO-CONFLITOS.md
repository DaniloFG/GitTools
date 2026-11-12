# Esboço: tela Conflitos (issue #96)

Documento de desenho, sem código. Decisões do dono já tomadas: a tela não entra no menu principal e só existe
enquanto houver conflito; o banner fica só informativo; a resolução sai do banner e dos modais; o alerta da aba abre
a tela; duas configurações numa seção "Conflitos".

## 1. Objetivo e o que sai do banner e dos modais

Hoje `OperationBanner.tsx` (250 linhas) mistura informação e ação, e `ConflictEditor.tsx` (573 linhas) é um modal
lazy aberto pelo `App.tsx`. A tela reúne tudo num lugar só, com lista em janela e editor embutido.

- **Sai do banner já em E8**: continuar, pular, abortar, "continuar automaticamente" e "reaproveitar decisão"
  (Aplicar e Ignorar). Vão para o rodapé da tela.
- **Sai do banner só em E9**: ações por arquivo e lote (`resolveEvery`). Até lá, o banner as mantém.
- **Sai dos modais em E9**: o `ConflictEditor` deixa de ser modal e vira painel embutido. Em E8, selecionar um
  arquivo na lista ainda abre o `ConflictEditor` modal existente.
- **Fica no banner**: totais e situação em texto; a partir de E9, sem botão de resolução.

## 2. Entrada e saída da tela

**Entradas** (a tela nunca entra no menu principal):
- **Alerta** ⚠ da aba (`RepoTabs.tsx:124-128`): vira `button` com `aria-label` e abre a tela.
- **Banner**: o clique na faixa abre a tela.
- **Partida**: se o repositório ativo já tem conflito na primeira leitura do `status`, a tela abre uma vez por
  repositório e sessão. Se o usuário fechou, não volta sozinha.

**Saída:**
- **Fechar** (rodapé ou Esc): não aborta nem muda a operação; só volta à tela anterior.
- **Tela anterior**: não há pilha (`View = ScreenId`, `context.tsx:32`). Proposta: um valor, `conflictReturnView`,
  guardado no `App.tsx` ao abrir por alerta ou banner. Sem valor (partida), volta para `history`, o fallback atual.
- **Zerou conflitos**: o alerta some. Com a tela aberta, ela mostra o resumo até fechar (padrão "Manter o resumo
  até eu fechar").
- **Fechar sozinha** (opção explícita): é o único gatilho de fechamento automático. Quando a operação terminar
  (`operation.kind` vira `'none'`; em merge, depois do commit), a tela fecha e volta a `conflictReturnView`.

**Só com conflito**: `ScreenId` novo, fora de `SCREEN_VIEWS` e do menu; sem conflito, não há como chegar a ela.
O painel `changes.conflicts` de `dock.ts` continua; ganha um link para a tela (E8).

## 3. Tela (esboço)

```
+------------------------------------------------------------------------------+
| Conflitos · Rebase · passo 2 de 5      Pendentes 12 · Resolvidos 8 · Total 20 |
| [Tipo: todos v] [Situação: pendentes v] [Buscar por nome............]         |
+----------------------------+-------------------------------------------------+
| ! src/app/Login.tsx   UU   | Login.tsx                  [Nosso] [Deles] [Editor] |
| ! src/api/client.ts   DU   | +----------------------+-----------------------+ |
| > src/db/schema.sql   AA   | | Nosso (HEAD)         | Deles (main)          | |
| ! src/ui/Modal.tsx    UU   | | ...                  | ...                   | |
|   (só as linhas visíveis   | +----------------------+-----------------------+ |
|    são montadas)           |                                                 |
+----------------------------+-------------------------------------------------+
| [Continuar] [Pular] [Abortar]  [x] Continuar sozinho   Próximo  Fechar        |
+------------------------------------------------------------------------------+
```

- **Cabeçalho**: operação, passo ("passo N de M" só em rebase, de `OperationState.step/total`) e contadores.
- **Barra**: filtro por tipo e por situação; busca por nome (substring, sem diferença de maiúsculas e acento).
- **Lista à esquerda**: `VirtualList` em `components/VirtualList.tsx`, com as funções de janela de `virtual.ts`;
  altura fixa (caminho, tipo, situação).
- **Editor à direita**: lado a lado, embutido a partir de E9; carrega só o arquivo selecionado (`conflictDetails`).
- **Rodapé**: Continuar, Pular, Abortar com confirmação (como hoje), e "Continuar automaticamente" e "Reaproveitar
  decisão". **Em merge não há Continuar nem Pular**: o rodapé leva a Alterações para commitar.

**Janela estreita (< 640 px)**: lista e editor viram abas "Lista" e "Editor"; escolher uma linha leva à aba do
editor. O rodapé cabe em uma linha; o que não couber vai para um menu "Mais". Medir nos 320, 480 e 640 px (`ui.mjs`).

**Próximo pendente**: atalho a definir (candidato F8, sem colisão); vai ao próximo pendente e volta ao início.

## 4. Banner informativo (estado final, a partir de E9)

- Mostra operação e passo, "X em conflito de Y arquivos" e uma situação curta ("aguardando resolução", "pronto
  para continuar", "sem conflitos"). Usa só `data.status` e `data.operation`, sem leitura extra.
- Clique ou Enter (`role="button"`) abre a tela. Sem conflito, o banner não existe. A contagem de "resolvidos" é
  por repositório, como `seen` hoje: trocar de aba não parece "resolvi tudo".
- Em E8 o banner ainda tem as ações por arquivo e o lote; continuar, pular e abortar já saíram para a tela.

## 5. Configurações

Seção "Conflitos" em `SETTINGS_SECTIONS` (`components/settings/sections.tsx`), `searchable: true`, para entrar na
busca única. Textos por `t()` nos seis catálogos de `src/shared/i18n/messages/`.

| Configuração | Chave em `Settings` | Valores | Padrão |
| --- | --- | --- | --- |
| Ao terminar a operação | `conflictSummary` | `'keep'` · `'close'` | `'keep'` |
| Ao abrir o app com conflito | `conflictStartup` | `'open'` · `'bannerOnly'` | `'open'` |

Frases em português: título "Conflitos"; "Ao terminar a operação": "Manter o resumo até eu fechar" (padrão) ·
"Fechar sozinha" (ajuda: "Quando a operação terminar, a tela fecha e volta à tela anterior."); "Ao abrir o app com
conflito pendente": "Abrir a tela direto, mantendo banner e alerta" (padrão) · "Só banner e alerta (a tela abre ao
clicar)".

`normalizeSettings` (`src/shared/settings.ts:99`) cai no padrão para valor fora da lista. Cada chave entra em
`Settings`, em `DEFAULT_SETTINGS`, em `normalizeSettings` e num controle da seção: sem chave órfã.

## 6. Módulos `.ts` puros e testes

Em `src/renderer/src/`, sem React, com testes em `tests/`; entram no `include` do `tsconfig.node.json`.

1. **`conflictRows.ts`**: `conflictKind(index, worktree)` e `buildConflictRows(files, decisions)`. O XY da linha `u`
   já vem no `status` (`repository.ts:313` guarda em `FileStatus.index` e `.worktree`), então o tipo sai **sem
   processo extra**: `UU` ambos modificados; `AA` ambos adicionados; `DD` ambos removidos; `AU`/`UA` adicionado de
   um lado; `DU`/`UD` removido de um lado. Teste: os sete pares e um arquivo que não é conflito (rejeitado).
2. **`conflictFilter.ts`**: filtro por tipo e situação e busca por nome. Teste: lista vazia, sem resultado, nome com
   acento, 1.500 linhas.
3. **`nextPending(rows, currentPath)`**: teste com sem pendentes (null), atual no último (volta ao primeiro) e atual
   fora da lista.
4. **`conflictScreenPolicy.ts`**: `shouldOpenOnStartup`, `shouldCloseAfterResolve` e `returnViewFor`. Teste: matriz
   completa, incluindo "já abriu nesta sessão" e troca de repositório.
5. **Padrões**: `normalizeSettings` com valor válido e inválido (`tests/settings*.test.ts`).

## 7. Desempenho e segurança

**Desempenho** (princípios 1, 4, 5, 6 de `CLAUDE.md`):
- Lista em janela: 1.500 arquivos montam só as linhas visíveis mais o `overscan`. Teto de 5.000 nós DOM
  (`docs/PERFORMANCE.md`, seção 7). Medido em E8, não antes.
- **Nenhum git em laço**: o tipo vem do `status` já lido. O único processo novo é `conflictDetails` ao selecionar um
  arquivo. O cache é desse arquivo e cai quando muda a assinatura dele (seu XY ou o conjunto de conflitos), não a
  cada leitura do `status`.
- Digitar no filtro e rolar não passam por IPC nem disco. Linha `memo`, handlers estáveis (o caminho vai por
  argumento). Trocar o filtro redesenha a lista; trocar o arquivo, só o editor.
- Tela `lazy` (`lazyScreens`), fora da primeira carga. Medir `npm run perf:bundle` e `core.mjs --trace` em E8; os
  orçamentos de `PERFORMANCE.md` seção 7 ("stage de 1 arquivo", "carga inicial") não podem piorar.

**Segurança**: os canais com caminho (`conflictDetails`, `resolveConflicts`) continuam em `resolveInside`
(`src/core/paths.ts`); nenhum canal novo previsto (se surgir, `security-review`). O editor mostra conteúdo de arquivo
como texto, sem `dangerouslySetInnerHTML`. Configurações passam por `normalizeSettings`.

## 8. Recursos simples e avançados, e incrementos

| Incremento | Entrega | Verificação |
| --- | --- | --- |
| **E8** lista e estado | `ScreenId` novo; lista em janela com filtros e busca; cabeçalho e rodapé (continuar, pular, abortar, avançados); alerta, banner e link do `changes.conflicts` abrem a tela; abertura na partida e fechar com os padrões; ao selecionar um arquivo, abre o `ConflictEditor` modal existente; banner mantém ações por arquivo | testes 6.1 a 6.4; `ui.mjs` com tela e banner; `--trace` |
| **E9** editor e atalhos | painel embutido (`ConflictEditor` sem modal); ações por arquivo e lote saem do banner; ações por arquivo na tela (nosso, deles, resolvido, editor externo); atalho "próximo pendente"; janela estreita com abas | `run-gittools` na tela; roteiro 320/480/640; `security-review` |
| **E10** seção Conflitos | seção com as duas opções, ligadas a `conflictSummary` e `conflictStartup` | testes 6.5; busca única acha a seção; seis catálogos completos |

Avançados da #95 (`autoContinueConflicts`, `reusePlan`, teto `MAX_DECISIONS` = 200) saem do banner para a tela em E8,
com as mesmas regras. Fora de E8-E10 (futuro): resolução por trecho e visão por origem.

## 9. Decisões tomadas no modo fábrica (revisáveis)

1. **Painel `changes.conflicts`**: fica, com um link para a tela (E8). Tirá-lo vira issue de retrabalho depois de E10.
2. **`autoContinueConflicts`**: vai para a seção "Conflitos" com a mesma chave; não muda o valor padrão (`false`).
3. **"Renomeado"**: fica de fora desta versão. O XY não distingue; ler os estágios (`unmergedStages()`) custaria
   processo a mais, a conferir.
4. **Partida com vários repositórios**: abre o repositório ativo; os outros só mostram o alerta.
5. **Merge**: sem Continuar nem Pular; o rodapé leva a Alterações para commitar.
