# GitTools

Ferramenta com interface gráfica (no estilo do GitLens) para usar o Git **arrastando e clicando**.
O foco é deixar simples o que costuma ser difícil no terminal, em especial o **cherry-pick**:
da branch inteira, de commits escolhidos, de **arquivos específicos** ou até de **linhas específicas** de um arquivo.

![Histórico com grafo de branches](docs/screenshots/historico.png)

## Por que o GitTools?

> **Cansado de ter uma ferramenta para o grafo, outra para os conflitos e outra para escolher o que vai no commit?**
> O GitTools junta o melhor que as melhores ferramentas de Git do mercado têm — e entrega tudo numa interface só,
> leve, gratuita e que roda no seu computador.

- 🌳 **O grafo bonito** de um cliente visual de verdade: trilhas coloridas, pesquisa, tags e colunas que você reorganiza.
- ✅ **Escolher o commit com caixas de seleção**, ou arrastar entre *staged* e *não staged* — você decide qual visão prefere, na mesma tela.
- ✂️ **Staging linha a linha**: leve ao commit só as linhas que importam, direto do diff.
- 🔀 **Conflitos lado a lado** (atual × resultado × que entra), bloco a bloco, sem abrir o terminal.
- 🍒 **Cherry-pick de outro nível**: da branch inteira, de commits, de **arquivos** ou de **linhas**, só arrastando.
- 🧹 **Rebase interativo visual**, **blame**, histórico de arquivo e comparação de branches — tudo a um clique.
- 🧩 **A tela do seu jeito**: painéis e abas que você move para onde quiser, como num editor moderno.
- 🔒 **Sem conta, sem nuvem, sem telemetria.** Usa o Git que você já tem instalado. Código aberto (MIT).
- 🧰 **Em dois lugares**: como aplicativo próprio e como extensão dentro do **VS Code**.

*Uma ferramenta só. Todo o fluxo de Git. Sem alternar de janela.*

## O que dá para fazer

| Quero…                                        | Como fazer no GitTools                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Trazer **todos os commits** de uma branch     | Arraste a branch sobre a branch de destino → *Cherry-pick de todos os commits*. Os já aplicados são pulados.   |
| Trazer **alguns commits**                     | Selecione-os no histórico (Ctrl/Shift+clique) e arraste para a branch de destino.                              |
| Trazer **só alguns arquivos** de um commit    | Clique no commit, marque/arraste os arquivos para a branch. Escolha *aplicar as alterações* ou *copiar a versão*. |
| Trazer **só algumas linhas**                  | No diff do commit, clique/arraste sobre as linhas e clique em *Aplicar linhas em …*.                            |
| Fazer tudo isso entre duas branches de uma vez | **🍒 Cherry-pick Studio**: origem → destino, com abas *Branch inteira*, *Commits*, *Arquivos* e *Linhas*.       |
| Merge / rebase                                | Arraste uma branch sobre outra e escolha *Merge* ou *Rebase*.                                                  |
| Stage/unstage de arquivos                     | Aba *Alterações*: arraste entre “não staged” e “staged”, ou use os botões ＋ / －.                              |
| Escolher o que entra no commit **com caixas de seleção** | Aba **Alterações** → visão **Caixas de seleção**: uma lista só com todos os arquivos alterados; marque os que entram no commit (marcar = stage, desmarcar = unstage; a caixa fica parcial quando só parte do arquivo está no commit). A visão **Staged e não staged** continua ali; a escolha fica lembrada. |
| Montar a aba Alterações do seu jeito          | Arraste o cabeçalho de qualquer painel (Alterações, Staged, Commit, Diferenças…) para antes ou depois de outro, ou até a borda para abrir uma coluna nova; arraste as divisórias para redimensionar, recolha com ▾ e use o botão direito no cabeçalho para mover pelo menu. ⊞ restaura. Cada visão guarda a própria disposição; em janelas estreitas as colunas viram uma pilha. |
| Stage/unstage/descartar **linhas**            | Selecione as linhas no diff e use *Stage linhas*, *Unstage linhas* ou *Descartar linhas*.                       |
| Descartar alterações de arquivos              | Arraste-os para a lixeira (com confirmação).                                                                   |
| Resolver conflitos                            | **Resolver lado a lado**: atual × resultado × que entra, bloco a bloco (ou o arquivo todo de uma vez), na visão clássica ou em colunas (como no SmartGit), com os painéis na ordem que você quiser. Depois *Continuar*, *Pular* ou *Abortar*. |
| Achar um commit                               | Campo **Pesquisar** do histórico (`Ctrl+F`): por nome de branch ou tag, mensagem, autor ou hash.                |
| Ver os arquivos de um commit sem sair da lista | ▸ ao lado do commit (ou duplo clique, ou `→`): os arquivos abrem logo abaixo da linha, como no VS Code.        |
| Comparar duas branches, tags ou commits       | Aba **Comparar** (ou botão direito numa branch/commit): commits exclusivos de cada lado e diff dos arquivos, com opção de trazer linhas ou a versão do arquivo. |
| Saber quem mudou cada linha                   | Aba **Arquivos** → *Blame*. Clique no commit ao lado da linha para abri-lo.                                      |
| Ver o histórico de um arquivo                 | Aba **Arquivos** → *Histórico do arquivo* (segue renomeações). Restaure uma versão antiga ou traga só algumas linhas dela. |
| Reordenar, juntar, renomear ou remover commits | Botão direito num commit → **Rebase interativo**: arraste para reordenar e escolha a ação de cada commit.        |
| Outras operações                              | Checkout (duplo clique ou botão direito na branch — o primeiro item do menu), criar/renomear/excluir branch, revert, reset, stash, fetch, pull e push (botão direito / barra superior). |
| Enviar (push) normal ou com **force**         | Botão **Push** e a seta ▾ ao lado dele (ou botão direito): *Force push (com lease)* — a forma segura, recusa se o remoto tem algo novo que você não baixou — e *Force push (sobrescrever)*, ambos com confirmação. *Opções de push…* abre um diálogo com remote e modo. Também no botão direito de uma branch local (envia sem precisar de checkout) e em `Ctrl+Alt+Shift+K` (force com lease). |
| Commit, amend e push de uma vez               | Aba **Alterações**: marque *Corrigir o último commit (amend)*, *Incluir todos os arquivos* e/ou *Enviar (push) em seguida* (normal, force com lease ou force) — o botão mostra o que vai acontecer (ex.: *Corrigir e forçar push*). Se o commit corrigido já está no remoto, o force é escolhido para você. As escolhas ficam lembradas. |
| Criar uma branch com ou sem checkout          | **＋ Branch** (ou botão direito em branch/commit/tag → *Nova branch…*): a caixa *Fazer checkout da nova branch* decide se você troca para ela; a última escolha fica lembrada. |
| Organizar a lista de repositórios recentes   | Na tela inicial e no menu do repositório: **☆** move o repositório para o grupo **Favoritos** (no topo, e eles não saem da lista com o tempo) e **✕** o remove da lista — a pasta não é apagada. |
| Clonar um repositório                         | Menu do repositório (canto superior esquerdo) → **Clonar repositório…**: URL, pasta e nome; o progresso aparece no log do git. |
| Ver os comandos git que o GitTools executa    | Painel **Log do git** no rodapé, em tempo real (com filtro, “só os que alteram”, copiar comando).             |
| Nome e e-mail dos commits                     | ⚙ Configurações → **Identidade e remotes**: global (`~/.gitconfig`) ou só no repositório aberto.              |
| Adicionar outro remote (fork, espelho…)       | ⚙ Configurações → **Identidade e remotes** → *Adicionar outro remote*: nome, URL e, se quiser, já baixar o conteúdo. Também dá para trocar a URL, renomear e remover. Botão direito em **Enviar** escolhe para qual remote enviar. |
| Ver os arquivos em lista ou em árvore         | Botão **☰ Lista / ⊟ Árvore** nas listas de arquivos (histórico, detalhes do commit, Alterações, Comparar, Studio e Arquivos). A escolha vale para todas. |
| Pular de alteração em alteração num diff      | Setas ▲ ▼ no cabeçalho do diff, ou `F7` / `Shift+F7`; ◀ ▶ ou `F8` / `Shift+F8` vão para o arquivo anterior/seguinte da lista. |
| Escolher onde aparecem os avisos              | ⚙ Configurações → **Notificações**: esquerda/centro/direita, em cima/embaixo, largura e altura, com pré-visualização. |
| Montar a tela do seu jeito                    | Arraste as abas (Histórico, Alterações, Arquivos, Comparar, Log do git…) para outra área ou borda da janela, e os painéis pela alça ⠿ para qualquer lado. ⊞ volta tudo ao padrão. |
| Idioma, tema e atalhos                        | ⚙ **Configurações** (canto superior direito): idioma, tema claro/escuro/do sistema, tamanho da interface e atalhos de teclado personalizáveis (F1 lista todos). |

### Cherry-pick de linhas

![Seleção de linhas no Cherry-pick Studio](docs/screenshots/studio-linhas.png)

Selecione exatamente as linhas que quer levar. O GitTools monta um patch só com elas e aplica com
`git apply --3way` na branch de destino — se o contexto mudou, o Git faz a mescla de três vias e,
se mesmo assim houver conflito, ele aparece no painel de conflitos como em qualquer outra operação.

| Arrastar uma branch sobre outra | Conflito durante o cherry-pick |
| --- | --- |
| ![Menu ao soltar uma branch](docs/screenshots/arrastar-branch.png) | ![Painel de conflitos](docs/screenshots/conflito.png) |

### Histórico

![Histórico com grafo, arquivos do commit e diff lado a lado](docs/screenshots/historico.png)

- **Cores das trilhas**: cada linha do grafo mantém a mesma cor do começo ao fim (a linha da branch
  atual não muda de cor quando outra converge nela), e as etiquetas das branches — no histórico e na
  barra lateral — usam a cor da sua trilha. A branch atual tem borda destacada e ✓.
- **Botão direito numa branch** (etiqueta no histórico ou barra lateral): o primeiro item é o checkout
  *daquela* branch. No menu de um commit, os checkouts das branches que apontam para ele vêm primeiro;
  o checkout do commit em si (HEAD destacado) fica por último entre eles.
- **Colunas**: grafo, mensagem, autor, data e hora e hash — arraste um título sobre outro para trocar
  as colunas de lugar e a borda de um título para mudar a largura (duplo clique volta ao padrão).
  Cada coluna tem seu espaço: textos longos terminam em “…” em vez de invadir a coluna vizinha. A
  coluna de data mostra também a hora.
- **Lista ou árvore**: em toda lista de arquivos o botão **☰ Lista / ⊟ Árvore** alterna entre uma
  linha por arquivo — **nome em destaque e, ao lado, a pasta** (`Button.tsx  src/app/ui`; renomeações
  mostram `← caminho antigo`) — e uma árvore de pastas recolhíveis (pastas com um só filho são
  juntadas, como no VS Code: `src/app/ui`). A escolha vale para o histórico, os detalhes, Alterações,
  Comparar, Studio e Arquivos.

  | Lista (nome + pasta) | Árvore |
  | --- | --- |
  | ![Arquivos em lista](docs/screenshots/arquivos-lista.png) | ![Arquivos em árvore e navegação entre alterações](docs/screenshots/arquivos-arvore.png) |
- **Navegação nos diffs**: ▲ ▼ no cabeçalho do diff (com `3/7` mostrando onde você está) e `F7` /
  `Shift+F7` pulam para a alteração seguinte/anterior, destacando-a; ◀ ▶ e `F8` / `Shift+F8` vão
  para o arquivo anterior/seguinte da lista ao lado. Funcionam também na janela própria de diff e no
  Studio; as teclas podem ser trocadas em Configurações → Atalhos de teclado.
- **Linhas adicionadas e removidas** (`+12 −3`) ao lado de cada arquivo: nos arquivos abertos no
  próprio histórico, nos detalhes do commit, em Alterações, Comparar, Arquivos e no Studio.
- **Pesquisa** (`Ctrl+F`): filtra por branch, tag, mensagem, autor, data ou hora (ex.: `21/10/2026`,
  `2026-10-21`, `14:30`) ou início do hash; Enter vai para o primeiro resultado e Esc limpa.
- **Arquivos do commit na própria lista**: ▸ (ou duplo clique, ou `→`/`←`) abre e fecha os arquivos
  logo abaixo da linha do commit. Clique num arquivo para ver o diff; **duplo clique** abre só o diff
  daquele arquivo numa janela própria; arraste-o para uma branch.
- **Diff em nova janela**: ⧉ *Abrir em nova janela* (ou duplo clique / botão direito no arquivo)
  abre o diff numa janela do sistema, que pode ir para outro monitor; ela se atualiza quando volta a
  ter o foco. Vale para os detalhes do commit, Alterações, Comparar e o histórico de um arquivo.
- **Arquivo inteiro**: o botão ⇕ *Arquivo inteiro* no cabeçalho de qualquer diff mostra o arquivo
  completo com as alterações destacadas, em vez de só os trechos alterados (a escolha é lembrada).
- **Ver diff com o painel recolhido**: escolher *Ver diff* (clique ou botão direito) expande o
  painel do diff se ele estiver recolhido.
- **Tags**: crie uma tag no commit atual (botão *Tag* na barra), em qualquer commit ou branch (botão
  direito) ou pelo ＋ da seção Tags; com mensagem, a tag é anotada.
- **Diff "cima e baixo" ou "lado a lado"**: todo diff abre no modo escolhido em ⚙ Configurações →
  Editor e diff; os botões no cabeçalho trocam o modo do diff aberto. A seleção de linhas funciona nos
  dois modos.
- **Abrir no editor**: o arquivo é sempre aberto pelo **caminho completo** (inclusive no Windows,
  onde o git informa a pasta com `/`), e o botão **Testar** abre um arquivo do repositório pelo mesmo
  caminho. Um arquivo que só existe em outro commit avisa em vez de falhar em silêncio. Escolha em ⚙ Configurações → Editor e diff um dos editores encontrados no
  computador (VS Code, Cursor, Sublime, Notepad++, JetBrains…), o executável de qualquer outro ou
  digite o comando (ex.: `code --reuse-window`, `/Applications/Zed.app`). O botão **Testar** abre o
  projeto e mostra o erro se o editor não iniciar. O botão *Abrir no editor* da barra abre o projeto
  inteiro nele.

### Log do git

O painel **Log do git** (no rodapé, como o terminal do VS Code) mostra em tempo real cada comando
git que o GitTools executa enquanto você usa a interface: hora, resultado (✓ / ✕ com o código de
saída e a primeira linha do erro), comando completo e duração. Filtre pelo texto, marque *Só os que
alteram* para esconder as leituras que a interface faz para se atualizar, copie um comando (duplo
clique ou botão direito) e limpe a lista. Como qualquer aba, ele pode ser arrastado para outra área.

### Clonar e identidade git

| Clonar repositório | Identidade e remotes |
| --- | --- |
| ![Clonar repositório](docs/screenshots/clonar.png) | ![Remotes](docs/screenshots/remotes.png) |

- **Clonar**: menu do repositório → *Clonar repositório…* (também na tela inicial). Informe a URL
  (HTTPS ou SSH — usa as credenciais já salvas no git), a pasta e o nome; ao terminar, o repositório
  clonado é aberto.
- **Identidade e remotes**: ⚙ Configurações → *Identidade e remotes* define `user.name` e `user.email` para
  **todos os repositórios** (global) ou **só o repositório aberto** (local, que tem prioridade).
  Deixe em branco para remover o valor daquele escopo; abaixo aparece a identidade em uso.
  Logo abaixo ficam os **remotes** do repositório: veja as URLs, **adicione outro remote** (nome + URL,
  com a opção de já baixar o conteúdo), altere a URL, renomeie ou remova. Com mais de um remote,
  clique com o botão direito em **Enviar** (barra superior) para escolher para qual enviar.

### Notificações

![Posição das notificações](docs/screenshots/notificacoes.png)

⚙ Configurações → **Notificações** escolhe onde aparecem os avisos de sucesso, erro e informação:
posição na horizontal (esquerda, centro, direita) e na vertical (em cima, embaixo), **largura** e
**altura máxima** (textos maiores ganham barra de rolagem). A mudança aparece na hora, e *Mostrar
exemplo* dispara um aviso de teste.

### Editor de conflitos

| Colunas (como no SmartGit) | Clássica (versões em cima, resultado embaixo) |
| --- | --- |
| ![Editor de conflitos em colunas](docs/screenshots/editor-de-conflitos.png) | ![Editor de conflitos clássico](docs/screenshots/editor-de-conflitos-classico.png) |

Três painéis — **Atual (HEAD)**, **Resultado** e **Que entra** — que rolam juntos e mostram cada bloco em
conflito na mesma altura. Escolha a visão em *Visão*: **Clássica** (as duas versões lado a lado em cima e
o resultado embaixo) ou **Colunas**. **Arraste o cabeçalho de um painel sobre outro** para trocá-los de
lugar (ou use o botão direito no cabeçalho, ou *Inverter versões*); o GitTools lembra do arranjo.

As setas acompanham a posição real dos painéis: o "Usar esta →" de cada versão aponta para onde está o
resultado, e "Usar a atual"/"Usar a que entra" apontam para onde está cada versão — em qualquer arranjo,
inclusive em idiomas escritos da direita para a esquerda. A navegação segue sempre a ordem do arquivo:

| Teclas | Ação |
| --- | --- |
| `Alt+↓` / `Alt+↑` | Próximo / anterior conflito |
| `Alt+Shift+↓` | Próximo conflito ainda não resolvido |
| `Alt+←` / `Alt+→` | Usar a versão do painel da **esquerda** / **direita** no conflito atual e ir ao próximo pendente |

Para cada bloco: *Usar a atual*, *Usar a que entra* e, no menu *Ambas / outras*, *Ambas* (em qualquer
ordem), *Original* (versão do ancestral comum) ou *Nenhuma* — e o resultado pode ser editado à mão.
Arquivos binários ou removidos de um dos lados oferecem a escolha da versão inteira.

### Comparar, blame e histórico de arquivo

| Comparar duas referências | Blame por linha | Histórico do arquivo |
| --- | --- | --- |
| ![Comparar](docs/screenshots/comparar.png) | ![Blame](docs/screenshots/blame.png) | ![Histórico do arquivo](docs/screenshots/historico-do-arquivo.png) |

### Rebase interativo visual

![Rebase interativo](docs/screenshots/rebase-interativo.png)

Arraste (ou use ▲▼) para reordenar e escolha para cada commit: *Manter*, *Editar mensagem*, *Juntar ao
anterior* (squash, com mensagem combinada ou nova), *Juntar descartando a mensagem* (fixup) ou *Remover*.
Alterações locais são guardadas e devolvidas automaticamente (`--autostash`); conflitos aparecem no
mesmo painel das outras operações.

### Idiomas

A interface inteira — inclusive as mensagens de erro e de resultado das operações git — está disponível em:

| Idioma | Código |
| --- | --- |
| Português (Brasil) | `pt-BR` |
| English | `en` |
| 简体中文 (chinês simplificado) | `zh-CN` |
| हिन्दी (hindi) | `hi` |
| Español | `es` |
| العربية (árabe, escrito da direita para a esquerda) | `ar` |

Por padrão o GitTools segue o idioma do sistema operacional; troque em ⚙ Configurações → Geral.
A mudança é aplicada na hora, como prévia, e só é gravada ao clicar em *Salvar*.

| Árabe (layout espelhado) | Chinês |
| --- | --- |
| ![Interface em árabe](docs/screenshots/idioma-arabe-rtl.png) | ![Interface em chinês](docs/screenshots/idioma-chines.png) |

### Layout ajustável

Nenhuma área tem tamanho nem lugar fixo (como no VS Code): cada tela se adapta ao que você quer ler.

| Arrastar uma aba para a borda | Arrastar um painel pela alça ⠿ |
| --- | --- |
| ![Arrastando a aba Alterações para a direita](docs/screenshots/layout-arrastar-aba.png) | ![Arrastando o painel de diff para baixo](docs/screenshots/layout-arrastar-painel.png) |

![Alterações ao lado do histórico](docs/screenshots/layout-aba-na-direita.png)

- **Áreas e abas como no VS Code**: a janela tem as áreas *esquerda* (Branches), *centro*
  (Histórico, Alterações, Arquivos, Comparar), *direita* e *embaixo* (Log do git). Arraste uma aba
  para entre outras abas, para outra área ou para a borda esquerda, direita ou de baixo da janela —
  um destaque mostra onde ela vai ficar. Assim dá para ver, por exemplo, Alterações ao lado do
  Histórico. Botão direito numa aba → *Mover para…*.
- **Arrastar painéis para qualquer lado**: cada painel tem uma alça ⠿ na borda; arraste-a e solte no
  lado desejado do outro painel (em cima, embaixo, à esquerda ou à direita) — não é preciso descobrir
  combinações de botões. Vale para a lista e os detalhes do histórico, os arquivos e o diff,
  Alterações, Comparar, Arquivos e o Studio. Lado a lado sem espaço (ex.: numa área estreita), os
  painéis ficam um em cima do outro automaticamente.
- **Ações no lado direito**: os botões de cada componente (barra superior, cabeçalho do diff, detalhes
  do commit, grupos de Alterações, avisos de operação…) ficam sempre no fim — o lado direito — do
  próprio componente; em árabe e outros idiomas da direita para a esquerda tudo é espelhado.
- **⊞ Restaurar layout** na barra superior volta todas as áreas, abas e painéis ao padrão (também em
  ⚙ Configurações → Aparência e no botão direito de uma aba).
- **Cruzamento de divisórias**: onde duas divisórias se encontram, o cursor vira ✥ e arrastar ali
  redimensiona as duas de uma vez.
- **Seções reordenáveis**: arraste as seções da barra lateral para mudar a ordem.
- **Janelas móveis**: arraste o título de qualquer diálogo para movê-lo; ⌖ volta ao centro.

- **Divisórias arrastáveis** entre a barra lateral, a lista e os detalhes — também entre os arquivos
  e o diff de um commit, a lista e o diff do histórico do arquivo, a lista de commits e as opções do
  Cherry-pick Studio e a navegação das Configurações. Duplo clique (ou `Enter`) volta ao tamanho
  padrão; com o foco na divisória, as setas ajustam o tamanho pelo teclado.
- **Recolher painéis**: os botões ◂ ▸ na divisória escondem um dos lados para o outro ocupar todo o
  espaço (ou arraste a divisória até a borda). `Ctrl+B` mostra/oculta a barra lateral. Os botões
  crescem com o mouse em cima; o tamanho deles e a espessura das divisórias são escolhidos em
  ⚙ Configurações → Aparência.
- **Janelas redimensionáveis**: diálogos (Studio, editor de conflitos, rebase, configurações…) podem
  ser redimensionados pelas bordas e maximizados pelo botão □ ou com duplo clique no título.
- **Painéis ajustáveis** no editor de conflitos (atual × resultado × que entra, em colunas ou na visão
  clássica) e coluna do blame ajustável; grupos de arquivos em Alterações e seções da barra lateral
  podem ser recolhidos.
- O GitTools **lembra** do layout escolhido; ⊞ na barra superior (ou ⚙ Configurações → Aparência →
  "Restaurar layout") volta tudo ao padrão. Em janelas estreitas, as barras quebram linha e colunas secundárias saem da lista.

### Configurações

![Central de Configurações](docs/screenshots/configuracoes.png)

Todas as opções gerais ficam num único lugar, separadas em seções: **Geral** (idioma),
**Notificações** (posição e tamanho dos avisos), **Identidade e remotes** (nome e e-mail dos commits, remotes do repositório), **Editor e diff** (editor
para abrir arquivos, com teste, e modo do diff),
**Aparência** (tema, tamanho, espessura das divisórias, tamanho dos botões de recolher/expandir e
restaurar o layout dos painéis), **Atalhos de teclado** (com pesquisa pelo nome da ação ou pelas
próprias teclas: clique em *Gravar teclas* e pressione a combinação) e **Sobre** (versões do GitTools, do git e
do sistema, local do arquivo de configurações e "Restaurar padrões").

### Atalhos de teclado

| Ação | Padrão |
| --- | --- |
| Histórico / Alterações / Arquivos / Comparar | `Ctrl+1` … `Ctrl+4` |
| Mostrar/ocultar a barra lateral | `Ctrl+B` |
| Pesquisar no histórico | `Ctrl+F` |
| Cherry-pick Studio | `Ctrl+Shift+P` |
| Nova branch / Stash | `Ctrl+Shift+N` / `Ctrl+Shift+S` |
| Fetch / Pull / Push | `Ctrl+Shift+F` / `Ctrl+Shift+L` / `Ctrl+Shift+K` |
| Push com force (lease) | `Ctrl+Alt+Shift+K` |
| Atualizar / Abrir repositório | `F5` / `Ctrl+O` |
| Configurações / Lista de atalhos | `Ctrl+,` / `F1` |
| Mover / estender a seleção no histórico | `↑` `↓` / `Shift+↑` `Shift+↓` |
| Abrir / fechar os arquivos do commit no histórico | `→` / `←` |
| Diff: próxima / anterior alteração | `F7` / `Shift+F7` |
| Diff: próximo / anterior arquivo da lista | `F8` / `Shift+F8` |
| Editor de conflitos: navegar / usar o painel da esquerda ou direita | `Alt+↑` `Alt+↓` / `Alt+←` `Alt+→` |

No macOS, `Ctrl` corresponde a `⌘`. Todos podem ser trocados em ⚙ Configurações.

## Extensão do VS Code

O GitTools também roda **dentro do VS Code**: a mesma interface (histórico com grafo, Cherry-pick Studio,
conflitos lado a lado, rebase interativo, remotes…) num painel, com o git da sua máquina. Veja
[`extension/README.md`](extension/README.md).

- **Abrir**: `Ctrl+Alt+G` (`⌘⌥G` no macOS), o botão **⑂ GitTools** na barra de status ou o ícone no título
  do *Controle do código-fonte*. A pasta aberta no VS Code é usada se for um repositório; também há
  **GitTools: Abrir um repositório…**, **Abrir esta pasta no GitTools** (menu do Explorer) e
  **Ver as alterações deste arquivo no GitTools** (título do editor).
- Os arquivos que o GitTools abre vão para o **editor do próprio VS Code**, ao lado do painel; o tema
  segue o do VS Code; o diff em nova janela abre outro painel.
- **Gerar o `.vsix`**: `npm run package:extension` cria `release/gittools-vscode-<versão>.vsix` (instale
  com `code --install-extension release/gittools-vscode-*.vsix`). `npm run build:extension` só compila.
- **Publicar uma versão** (automático): o workflow `publish-extension.yml` testa, empacota e publica no
  VS Code Marketplace; os usuários recebem a atualização sozinhos. Ele roda **a cada merge na `main` que
  mexa no que vai para a extensão** (`extension/`, `src/` exceto `main` e `preload`, `scripts/` e os
  arquivos de build) usando a versão de `extension/package.json` — **suba a versão na PR** para publicar;
  se ela já estiver publicada, o workflow termina sem fazer nada. Também roda ao criar uma tag
  (`git tag v0.5.1 && git push origin v0.5.1`, com a versão da tag) e manualmente em *Actions → Run
  workflow*. Cada publicação nova cria o release `v<versão>` com o `.vsix` anexado. Configuração única:
  em *Settings → Secrets and variables → Actions* crie o secret `VSCE_PAT` (token do Marketplace, escopo
  *Marketplace → Manage*); o secret opcional `OVSX_PAT` publica também no Open VSX (VSCodium, Cursor).
  Sem o secret o workflow só anexa o `.vsix` ao release do GitHub.
- **Como é feito**: a lógica do aplicativo (repositório aberto, configurações, log de comandos,
  remotes, clone…) ficou num `Backend` em `src/backend`, que o Electron e a extensão usam; cada um só
  fornece o `BackendHost` (diálogos, abrir arquivos, janelas). No webview, `src/renderer/src/vscodeBridge.ts`
  faz o papel do preload, trocando mensagens com a extensão (`extension/src/extension.ts`). Os testes usam
  uma versão mínima da API do VS Code (`tests/support/vscode.ts`).

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org/) 20+ e [Git](https://git-scm.com/) 2.23+ no `PATH`.

```bash
npm install
npm run dev            # abre o app em modo desenvolvimento
npm run dev -- -- /caminho/do/repositorio   # já abrindo um repositório
```

Outros comandos:

```bash
npm test               # testes do motor git (cria repositórios temporários reais)
npm run typecheck      # verificação de tipos
npm run build          # gera out/
npm run dist           # gera o instalador para o seu sistema em release/
npm run dist:win       # (ou dist:mac / dist:linux)
```

## Como funciona

```
src/
├── core/               Motor git (Node puro, sem Electron) — testado em tests/
│   ├── exec.ts         Executa o git sem shell e sem prompts interativos (e avisa cada comando ao log)
│   ├── config.ts       Identidade git (user.name/user.email) e git clone
│   ├── paths.ts        Caminho relativo → absoluto dentro do repositório (raiz do git no Windows)
│   ├── diff.ts         Lê diffs unificados e monta patches parciais (linhas escolhidas)
│   └── repository.ts   Status, branches, log, stage, merge, rebase (inclusive interativo), cherry-pick
│                       (branch/commits/arquivos/linhas), conflitos, comparação, blame, histórico, stash, remotos
├── backend/            Lógica comum ao aplicativo e à extensão (repositório aberto, configurações, log, clone…)
├── main/               Processo principal do Electron: janela, diálogos, IPC
├── preload/            Ponte segura (contextIsolation) exposta como window.gittools
├── shared/             Tipos, contrato da API, marcadores de conflito, configurações e idiomas
│   ├── settings.ts     Formato, valores padrão e validação das configurações
│   └── i18n/           Traduções (usadas pelo motor git, pelo processo principal e pela interface)
│       ├── locales.ts  Lista de idiomas e detecção do idioma do sistema
│       ├── translator.ts  Parâmetros {nome} e plurais (Intl.PluralRules)
│       └── messages/   Um arquivo por idioma; pt-BR.ts é a referência
└── renderer/           Interface em React
    ├── src/fileTree.ts  Árvore de pastas das listas de arquivos
    ├── src/diffNav.ts   Navegação entre alterações/arquivos dos diffs (botões e atalhos)
    ├── src/workbench.ts Áreas e abas da janela (esquerda, centro, direita, embaixo) e como mover abas
    └── src/components/ Histórico com grafo, detalhes do commit, diff com seleção de linhas, alterações,
                        Cherry-pick Studio, editor de conflitos, comparação, blame/histórico,
                        rebase interativo, log do git, janela de diff e atalhos
        └── settings/   Central de Configurações: sections.tsx registra as seções
```

- O GitTools usa o **git instalado na máquina** (não reimplementa o Git), então respeita suas
  configurações, credenciais e hooks. Todas as operações são as mesmas que você faria no terminal.
- A interface só chama métodos de uma lista explícita (`REPO_METHODS`); o processo de interface não tem acesso ao Node.
- Cherry-pick de **branch inteira** usa `git log --cherry-mark` para descobrir e pular commits que já
  existem no destino com o mesmo conteúdo.
- Cherry-pick de **arquivos** aplica o diff de cada commit restrito aos arquivos escolhidos
  (`git diff <pai> <commit> -- arquivos | git apply --3way`), ou copia a versão do arquivo (`git checkout <commit> -- arquivo`).
- Cherry-pick de **linhas** monta um patch parcial: linhas adicionadas não escolhidas são removidas do
  patch e linhas removidas não escolhidas viram contexto. O mesmo algoritmo (invertido) faz o
  *unstage* e o *descartar* de linhas.
- As contagens `+/−` vêm de `git diff --numstat` (e da contagem de linhas para arquivos novos não
  rastreados); o modo *Arquivo inteiro* pede o diff com contexto ilimitado (`-U1000000`).
- O **rebase interativo** gera a lista de tarefas do `git rebase -i` a partir da tela; mensagens
  novas são aplicadas com `exec git commit --amend -F <arquivo>`, então nada depende de editor.

### Como adicionar um idioma

1. Copie `src/shared/i18n/messages/en.ts` para `src/shared/i18n/messages/<código>.ts` e traduza os textos.
   O TypeScript acusa qualquer chave faltando ou sobrando, e `npm test` confere se os parâmetros
   (`{count}`, `{branch}`…) foram mantidos.
2. Registre o arquivo em `src/shared/i18n/messages/index.ts`.
3. Acrescente o código em `LOCALE_IDS` e uma entrada em `LOCALES` (`src/shared/i18n/locales.ts`),
   com `dir: 'rtl'` se o idioma for escrito da direita para a esquerda.

Plurais seguem as regras do Unicode CLDR: use `{ one, other }`, ou as formas que o idioma tiver
(`zero`, `two`, `few`, `many`); `zero`, quando existe, é usado para o número 0 em qualquer idioma.

### Como adicionar uma opção de configuração

1. Acrescente o campo em `Settings`, o valor em `DEFAULT_SETTINGS` e a validação em
   `normalizeSettings` (`src/shared/settings.ts`).
2. Mostre o campo numa seção existente ou crie uma nova e registre-a em
   `src/renderer/src/components/settings/sections.tsx`. A central cuida da navegação, da prévia,
   da validação e do salvamento.

## Ideias para o futuro

- Gerenciar remotos pela interface
- Assinatura de commits (GPG/SSH) e edição de tags
- Histórico de operações com "desfazer" (baseado no reflog)

## Licença

[MIT](LICENSE)
