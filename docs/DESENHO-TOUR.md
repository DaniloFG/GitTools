# Desenho: Tour guiado (issue #98)

Documento de desenho, sem código. Estado: proposta para o `gt-juiz` (etapa E11 do `docs/HANDOFF.md`). Os números
vêm dos arquivos citados; o que é estimativa está marcado como hipótese.

## 1. Objetivo e restrições

- **Objetivo**: um passeio que mostra e destaca partes da interface. Não clica em nada, não abre repositório, não
  muda configuração de repositório e não executa ação de git.
- **Custo zero fechado**: sem ouvinte, quadro extra nem pedaço carregado; na abertura só existe o convite (seção 5).
- **Git**: nenhum processo além do que os mesmos cliques fariam à mão, medido contra esse roteiro (seção 9).
- **Primeira carga**: só o convite cabe nela. O pacote JS da primeira carga está em 692.522 de 700.000 bytes
  (E10, `docs/HANDOFF.md`, seção 2), folga de 7.478 bytes. `docs/PERFORMANCE.md:724` ainda diz 683.731; é medição
  antiga.
- **Dados**: passos num módulo `.ts` puro, sem React. Alvos por `data-tour` ou pelo `data-view` que já existe. Textos
  por `t()` nos seis catálogos. Nenhuma dependência nova.

## 2. Lista de passos (ordem de uso)

"sem repo" = aparece na tela de abrir (Welcome); "com repo" = aparece com um repositório aberto.

| # | id | Tela | Alvo | Arquivo:linha | Texto-guia (1 frase) | Contexto |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | open | Welcome | `data-tour="open"` | `Welcome.tsx:61` | Abre um repositório que já está no seu computador. | sem repo |
| 2 | clone | Welcome | `data-tour="clone"` | `Welcome.tsx:67` | Copia um repositório remoto para uma pasta local. | sem repo |
| 3 | branch | Barra | `data-tour="branch"` | `Toolbar.tsx:172` | Mostra a branch atual, onde os novos commits entram. | com repo |
| 4 | fetch | Barra | `data-tour="fetch"` | `Toolbar.tsx:178` | Busca no remoto o que mudou, sem alterar seus arquivos. | com repo |
| 5 | pull | Barra | `data-tour="pull"` | `Toolbar.tsx:184` | Traz as mudanças do remoto e as integra à branch atual. | com repo |
| 6 | push | Barra | `data-tour="push"` | `Toolbar.tsx:192` | Envia seus commits para o remoto. | com repo |
| 7 | new | Barra | `data-tour="new"` | `Toolbar.tsx:204` | Cria uma branch, uma tag ou guarda as alterações. | com repo |
| 8 | studio | Barra | `data-tour="studio"` | `Toolbar.tsx:214` | Abre o Studio para copiar commits para a branch atual. | com repo |
| 9 | conflicts | Faixa de operação | `data-tour="conflicts"` | `OperationBanner.tsx:33` | Mostra conflitos ou operação em andamento; abre a tela Conflitos. | com repo, só se existir |
| 10 | settings | Welcome / Barra | `data-tour="settings"` | `Welcome.tsx:70` e `Toolbar.tsx:220` | ⚙ abre as Configurações (8 seções) e, em Aparência, a barra, as telas e os painéis. | ambos |
| 11 | screens | Abas | `data-tour="screens"` | `Screens.tsx:91` | As abas de tela: History, Changes, Files, Compare, Branches, Git Log e Dashboards. | com repo |
| 12 | history | History | `data-view="history"` | existente, `Dock.tsx:282` | A lista de commits; clique num deles para ver os detalhes. | com repo |
| 13 | history-diff | History | `data-view="commit.diff"` | existente, `Dock.tsx:282` | As diferenças do commit escolhido, arquivo por arquivo. | com repo |
| 14 | changes-commit | Changes | `data-view="changes.commit"` | existente, `Dock.tsx:282` | Escreva a mensagem e confirme o que está preparado. | com repo |
| 15 | changes-diff | Changes | `data-view="changes.diff"` | existente, `Dock.tsx:282` | Veja o que mudou no arquivo selecionado antes de confirmar. | com repo |
| 16 | files | Files | `data-view="files.list"` | existente, `Dock.tsx:282` | Os arquivos rastreados; abra um para ver histórico e conteúdo. | com repo |
| 17 | compare | Compare | `data-view="compare.setup"` | existente, `Dock.tsx:282` | Escolha duas referências (branches, tags ou commits) para comparar. | com repo |
| 18 | branches | Branches | `data-view="branches"` | existente, `Dock.tsx:282` | Branches, tags e stashes: troque de branch e veja o que existe. | com repo |
| 19 | gitlog | Git Log | `data-view="gitlog"` | existente, `Dock.tsx:282` | A visão de log do histórico (texto a confirmar com o dono em E13). | com repo |
| 20 | dashboards | Dashboards | `data-tour="dashboards"` | `Screens.tsx:110` | Gráficos e números do repositório; o passeio só mostra a aba, não abre a tela. | com repo |

Notas:
- **Ordem**: a da tabela. Sem repositório sobram os passos 1, 2 e 10.
- **Painéis (12 a 19)**: o alvo é o botão de aba do painel, que já tem `data-view` (`Dock.tsx:282`). Não há atributo
  novo para eles. History e Changes têm 2 pontos; as demais telas, 1.
- **Passo 10**: um passo só. O texto cita as oito seções de `components/settings/sections.tsx:36-99`, sem detalhe.
  Aparência fica nele: o botão é ⚙ (`Toolbar.tsx:220`), não ☰ como diz o pedido; segui o código.
- **Passo 9**: a faixa também aparece em operação sem conflito (`OperationBanner.tsx:22`). Contagem: 20 com conflito, 19 sem.

## 3. Passos sem repositório

Sem repositório ativo a aplicação mostra só o Welcome (`App.tsx:606-612`): não há barra nem abas. Logo, o pedido
("barra sem repositório") não se aplica. Sem repo o Tour tem três passos (1, 2 e 10); os demais são **omitidos**, não
cinzentos. O cartão final diz: "O resto do tour aparece quando você abrir um repositório." `pref.tour.seen` guarda os
vistos, e a próxima vez com repositório retoma nos que faltam.

## 4. Regras de salto e de saída

- **Alvo ausente no DOM** (inclui painel que o usuário escondeu e faixa de conflito que sumiu): o passo é pulado e
  vai para a lista "Pulei: ..." do cartão final. A checagem é ao mostrar o passo, porque a tela muda no passeio.
- **Tela oculta em `pref.screens.hidden`** (`Toolbar.tsx:47`, `Screens.tsx:94` e `:109`): sem aba, o passo 11 e os
  passos da tela oculta saem da lista ao começar, e o cartão final os nomeia.
- **Dock em `left`, `right` ou `bottom`** (e `top`, que também existe em `dock.ts:101`): o alvo é achado pelo seletor no
  documento inteiro, então o lado não muda a regra. O cartão vai para o lado do alvo com mais espaço, nunca por cima dele.
- **Passos 12 a 19 trocam de tela** pelo mesmo caminho do clique na aba (`openScreen`, `App.tsx:918-922`). Não há ação
  de git nem de dados; é a única exceção a "só mostra". Decisão para o dono.
- **Saída**: ao sair (Sair, Esc ou fim do passeio), a tela e o estado de Dashboards voltam ao que eram ao começar.
  O módulo de passos guarda os dois valores iniciais e tem teste para a saída em qualquer passo.

## 5. Convite da primeira abertura

- **Onde**: no Welcome, cartão pequeno abaixo dos botões (`Welcome.tsx:73-74`), sem cobrir Abrir, Clonar ou
  Configurações. Título "Quer um passeio pela interface?"; botões "Fazer o Tour" e "Agora não".
- **Quando aparece**: `tourOffer` é `'pending'` **e** não há repositório recente. Quem já usa o app não recebe o convite
  depois de atualizar (decisão proposta; o dono confirma).
- **Chave nova**: `tourOffer: 'pending' | 'accepted' | 'dismissed'`, padrão `'pending'`. Entra em `Settings`
  (`shared/settings.ts:80`, depois de `conflictStartup`), em `DEFAULT_SETTINGS` (`:85`) e em `normalizeSettings`
  (`:132`): valor fora da lista volta a `'pending'`. "Fazer o Tour" grava `accepted`; "Agora não" grava `dismissed`.
- **Catálogos**: `tour.invite.*` vão no catálogo comum dos seis idiomas (o tipo exige catálogo completo).
- **i18n hoje**: os seis catálogos já são pedaços separados (`renderer/src/i18n.ts:11-20`). Carregam o idioma ativo
  (`appearance.ts:28`) e o inglês de reserva depois do primeiro desenho (`appearance.ts:34-36`, `main.tsx:26`). O CI
  soma o maior catálogo à primeira carga (`bundle-size.mjs:88-89`, `:116`).
- **Custo se os passos ficarem no catálogo comum** (hipótese): 2,5 a 4 KB no maior catálogo, quase toda a folga.
- **Proposta**: `tour.step.*` em seis arquivos `messages/tour/<idioma>.ts`, tipados pelo tipo das chaves do Tour
  (o typecheck reprova idioma incompleto). Carregados por chunks `tour-<idioma>`, que o `maiorCatalogo` de
  `bundle-size.mjs:63-85` não conta. `t()` não muda.

## 6. Pontos de entrada

- **Welcome**: o convite (seção 5) e um botão "Tour" em `Welcome.tsx:60-72`, depois de Configurações, para quem já
  dispensou o convite.
- **Configurações**: nova seção `tour` em `SETTINGS_SECTIONS`, depois de `conflicts` (`sections.tsx:83`), com
  `searchable: true`, para entrar na busca (#71; `SettingsCenter.tsx:10`). A seção tem só o botão "Fazer o Tour", que
  fecha as Configurações e começa o passeio.
- **Sem atalho de teclado**: a lista de `KeyboardShortcuts.tsx` não muda.

## 7. Cartão e destaque

- **Estado**: módulo puro para posição, progresso, lista e os valores iniciais de tela; lido por `useSyncExternalStore`
  (como `layout.ts:152`). Muda por passo, nunca por evento.
- **Por passo**: `scrollIntoView({ block: 'nearest' })` no alvo (é a única rolagem do passeio) e, em seguida, a **única**
  leitura de `getBoundingClientRect` daquele passo. Depois só um `ResizeObserver` no alvo e um ouvinte de `resize` na
  janela, passivos, ativos **só com o Tour aberto**.
- **Destaque**: um único elemento fixo, escrito direto no estilo, no máximo uma vez por quadro (`requestAnimationFrame`),
  sem `setState`. O escurecimento é a sombra dele (hipótese); se `ui.mjs 4 moderate` reprovar, vira quatro retângulos.
- **Rolagem e clique**: o overlay segura a roda e os cliques; o usuário não rola a página no passeio. Por isso não há
  ouvinte de `scroll`, e nenhum ouvinte fica em captura na `window`. Clique fora do cartão não faz nada (proposta).
- **Teclado**: setas para passo anterior e seguinte, Esc para sair, no `onKeyDown` do próprio cartão (nunca na
  `window`). Ao abrir, o foco entra no cartão e fica preso nele (Tab circula entre Anterior, Próximo e Sair). Ao fechar,
  o foco volta ao elemento que abriu o Tour. Com o Tour aberto, os atalhos globais ficam desligados, como em
  `modalOpen` (`App.tsx:1337`; o ouvinte global está em `KeyboardShortcuts.tsx:92`).
- **Cartão**: Anterior, Próximo, Sair e o progresso "3 de 20", sempre como texto do React (nada de `innerHTML`).
- **Posição**: ao lado do alvo, no lado com mais espaço, sem cobrir o alvo. Em janela estreita (#97; 320, 480 e 640 px)
  vira faixa no rodapé, com largura limitada à janela. Nenhuma posição sai da tela.
- **Movimento e tema**: com `prefers-reduced-motion`, o destaque troca de lugar sem transição. Cores do tema.
- **Progresso**: `pref.tour.seen` (`layout.ts:84`, prefixo que o "restaurar padrão" não apaga, `:93`) guarda os ids
  vistos; retomar é ir ao primeiro passo não visto.

## 8. Divisão em etapas

| Etapa | Entrega | Verificação |
| --- | --- | --- |
| **E12** infraestrutura | módulo puro de passos (lista, filtros, contagem, saltos, saída) e de progresso, com testes em `tests/`; `data-tour` em 13 pontos (`Welcome.tsx` 61, 67, 70; `Toolbar.tsx` 172, 178, 184, 192, 204, 214, 220; `Screens.tsx` 91 e 110; `OperationBanner.tsx:33`); chunk do Tour em `lazyScreens.ts`; convite; `tourOffer` em `settings.ts` com teste; seção `tour`; textos de convite e de passos nos seis idiomas em `messages/tour/`; **teste de integração** de `tourOffer` pelo caminho de gravação da extensão | typecheck; testes de settings, de passos, de saída e de progresso; integração da extensão; `perf:bundle` depois dos dois builds |
| **E13** revisão e verificação | revisão dos textos nos seis idiomas; testes "todo passo tem texto nos 6 idiomas" e "todo alvo existe"; roteiro na tela com `run-gittools` | conferência na tela (com e sem repositório, 320/480/640 px, claro e escuro, console sem erro); medições da seção 9 |

Divergência com o pedido: o typecheck exige os seis textos de cada passo, então eles entram em E12, e E13 fica com
revisão, testes de conteúdo e medições. Alternativa (E12 sem textos, E13 com todos): o juiz escolhe.

## 9. Medições e riscos

**Medições em E13** (cada uma com o comando e o número colados no commit):
- Pacote: `npm run perf:bundle`, depois dos dois builds; teto de 700.000 bytes; folga atual de 7.478.
- Nós no DOM: Tour fechado sem nó extra; aberto, até 20 nós a mais (destaque e cartão).
- CPU 4×: `node scripts/perf/ui.mjs 4 moderate` com o Tour aberto, passo a passo; comparação com o mesmo roteiro sem Tour.
- Processos git: `node scripts/perf/core.mjs moderate` com `--trace` durante o passeio inteiro, comparado com o roteiro
  feito à mão. A meta é não passar do que os mesmos cliques fariam.

**Riscos**:
- A folga de 7.478 bytes pode não caber com o convite e as chaves (hipótese: 3 KB). Se não couber, o convite vira
  chunk carregado só com `tourOffer` em `pending`; medir antes.
- A extensão do VS Code usa a mesma interface. Onde ela grava `tourOffer` é critério de aceite da E12, com teste de
  integração; não é dúvida aberta.
- O texto de `gitlog` (passo 19) precisa de confirmação do dono.

**Não será feito**: nenhuma ação (clicar em botão, abrir repositório, buscar, puxar, enviar, comando git); nenhum atalho
de teclado, dependência nova, vídeo ou print; nenhum passo por configuração nem sobre as abas de repositório
(`RepoTabs`); nenhuma abertura da tela de Dashboards; nenhuma edição de passos pelo usuário, nem telemetria.
