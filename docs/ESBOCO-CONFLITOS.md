# Esboço: tela Conflitos (issue #96)

Documento de desenho, sem código. Decisões do dono já tomadas: a tela não entra no menu principal e só existe
enquanto houver conflito; o banner fica só informativo; a resolução sai do banner e dos modais; o alerta da aba abre
a tela; duas configurações numa seção "Conflitos".

## 1. Objetivo e o que sai do banner e dos modais

Hoje `OperationBanner.tsx` (250 linhas) mistura informação e ação, e `ConflictEditor.tsx` (573 linhas) é um modal
lazy aberto pelo `App.tsx`. A tela reúne tudo num lugar só, com lista em janela e editor embutido.

- **Sai do banner**: ações por arquivo, lote (`resolveEvery`), continuar, pular, abortar, "continuar
  automaticamente" e "reaproveitar decisão" (Aplicar e Ignorar). Vão para a tela.
- **Sai dos modais**: o `ConflictEditor` deixa de ser modal; o corpo vira painel embutido.
- **Fica no banner**: totais e situação em texto, sem botão de resolução (o clique só abre a tela).

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
  até eu fechar"). Opção "Fechar sozinha": quando `operation.kind` vira `none`, a tela fecha e volta sozinha.

**Só com conflito**: `ScreenId` novo, fora de `SCREEN_VIEWS` e do menu; sem conflito, não há como chegar a ela.
O painel `changes.conflicts` de `dock.ts` já existe (seção 9).

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
- **Lista à esquerda**: `VirtualList` de `virtual.ts`, altura fixa (caminho, tipo, situação).
- **Editor à direita**: lado a lado, embutido; carrega só o arquivo selecionado (`conflictDetails`).
- **Rodapé**: Continuar, Pular (não em merge), Abortar com confirmação (como hoje), e as opções movidas do banner.

**Janela estreita (< 640 px)**: lista e editor viram abas "Lista" e "Editor"; escolher uma linha leva à aba do
editor. O rodapé cabe em uma linha; o que não couber vai para um menu "Mais". Medir nos 320, 480 e 640 px (`ui.mjs`).

**Próximo pendente**: atalho a definir (candidato F8, sem colisão); vai ao próximo pendente e volta ao início.

## 4. Banner informativo

- Mostra operação e passo, "X em conflito de Y arquivos" e uma situação curta ("aguardando resolução", "pronto
  para continuar", "sem conflitos"). Usa só `data.status` e `data.operation`, sem leitura extra.
- Clique ou Enter (`role="button"`) abre a tela. Sem conflito, o banner não existe. A contagem de "resolvidos" é
  por repositório, como `seen` hoje: trocar de aba não parece "resolvi tudo".

## 5. Configurações

Seção "Conflitos" em `SETTINGS_SECTIONS` (`components/settings/sections.tsx`), `searchable: true`, para entrar na
busca única. Textos por `t()` nos seis catálogos de `src/shared/i18n/messages/`.

| Configuração | Chave em `Settings` | Valores | Padrão |
| --- | --- | --- | --- |
| Ao resolver o último conflito | `conflictSummary` | `'keep'` · `'close'` | `'keep'` |
| Ao abrir o app com conflito | `conflictStartup` | `'open'` · `'bannerOnly'` | `'open'` |

Frases em português: título "Conflitos"; "Ao resolver o último conflito": "Manter o resumo até eu fechar" (padrão)
· "Fechar sozinha" (ajuda: "Quando a operação terminar, a tela fecha e volta à tela anterior."); "Ao abrir o app com
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
  arquivo; o cache é do arquivo selecionado e cai quando o `status` muda.
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
| **E8** lista e estado | `ScreenId` novo; lista em janela com filtros e busca; cabeçalho e rodapé; banner informativo; alerta e banner abrem a tela; abertura na partida e fechar com os padrões; **move** continuar automático e reaproveitar decisão para o rodapé | testes 6.1 a 6.4; `ui.mjs` com tela e banner; `--trace` |
| **E9** editor e atalhos | painel embutido (`ConflictEditor` sem modal); ações por arquivo (nosso, deles, resolvido, editor externo); atalho "próximo pendente"; janela estreita com abas | `run-gittools` na tela; roteiro 320/480/640; `security-review` |
| **E10** seção Conflitos | seção com as duas opções, ligadas a `conflictSummary` e `conflictStartup` | testes 6.5; busca única acha a seção; seis catálogos completos |

Avançados da #95 (`autoContinueConflicts`, `reusePlan`, teto `MAX_DECISIONS` = 200) saem do banner para a tela em E8,
com as mesmas regras. Fora de E8-E10 (futuro): resolução por trecho e visão por origem.

## 9. Questões em aberto

1. **Painel `changes.conflicts`** (`dock.ts`, aparece em Alterações com conflito): manter, tirar ou apontar para a
   tela? Recomendação: manter até E8 e decidir com as duas à vista. Decisão do dono.
2. **`autoContinueConflicts`**: mover para a seção "Conflitos" (recomendado; a chave não muda) ou ficar em Geral?
3. **"Renomeado"**: o XY não distingue. Para mostrar, seria preciso ler os estágios (`unmergedStages()`, a conferir
   o custo). Recomendação: não mostrar nesta versão.
4. **Vários repositórios na partida**: abrir o ativo (recomendado) ou o primeiro com conflito?
5. **Merge**: sem "continuar" de passo; o rodapé mostraria "Ir para Alterações para commitar". Confirmar.
