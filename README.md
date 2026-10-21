# GitTools

Ferramenta com interface gráfica (no estilo do GitLens) para usar o Git **arrastando e clicando**.
O foco é deixar simples o que costuma ser difícil no terminal, em especial o **cherry-pick**:
da branch inteira, de commits escolhidos, de **arquivos específicos** ou até de **linhas específicas** de um arquivo.

![Histórico com grafo de branches](docs/screenshots/historico.png)

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
| Stage/unstage/descartar **linhas**            | Selecione as linhas no diff e use *Stage linhas*, *Unstage linhas* ou *Descartar linhas*.                       |
| Descartar alterações de arquivos              | Arraste-os para a lixeira (com confirmação).                                                                   |
| Resolver conflitos                            | **Resolver lado a lado**: atual × resultado × que entra, bloco a bloco (ou o arquivo todo de uma vez). Depois *Continuar*, *Pular* ou *Abortar*. |
| Comparar duas branches, tags ou commits       | Aba **Comparar** (ou botão direito numa branch/commit): commits exclusivos de cada lado e diff dos arquivos, com opção de trazer linhas ou a versão do arquivo. |
| Saber quem mudou cada linha                   | Aba **Arquivos** → *Blame*. Clique no commit ao lado da linha para abri-lo.                                      |
| Ver o histórico de um arquivo                 | Aba **Arquivos** → *Histórico do arquivo* (segue renomeações). Restaure uma versão antiga ou traga só algumas linhas dela. |
| Reordenar, juntar, renomear ou remover commits | Botão direito num commit → **Rebase interativo**: arraste para reordenar e escolha a ação de cada commit.        |
| Outras operações                              | Checkout (duplo clique), criar/renomear/excluir branch, revert, reset, stash, fetch, pull e push (botão direito / barra superior). |
| Idioma, tema e atalhos                        | ⚙ **Configurações** (canto superior direito): idioma, tema claro/escuro/do sistema, tamanho da interface e atalhos de teclado personalizáveis (F1 lista todos). |

### Cherry-pick de linhas

![Seleção de linhas no Cherry-pick Studio](docs/screenshots/studio-linhas.png)

Selecione exatamente as linhas que quer levar. O GitTools monta um patch só com elas e aplica com
`git apply --3way` na branch de destino — se o contexto mudou, o Git faz a mescla de três vias e,
se mesmo assim houver conflito, ele aparece no painel de conflitos como em qualquer outra operação.

| Arrastar uma branch sobre outra | Conflito durante o cherry-pick |
| --- | --- |
| ![Menu ao soltar uma branch](docs/screenshots/arrastar-branch.png) | ![Painel de conflitos](docs/screenshots/conflito.png) |

### Editor de conflitos lado a lado

![Editor de conflitos](docs/screenshots/editor-de-conflitos.png)

Para cada bloco em conflito: *Usar a atual*, *Usar a que entra*, *Ambas* (em qualquer ordem), *Original*
(versão do ancestral comum) ou *Nenhuma* — e o resultado no centro pode ser editado à mão. Arquivos
binários ou removidos de um dos lados oferecem a escolha da versão inteira.

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

Nenhuma área tem tamanho fixo: cada tela se adapta ao que você quer ler.

- **Divisórias arrastáveis** entre a barra lateral, a lista e os detalhes — também entre os arquivos
  e o diff de um commit, a lista e o diff do histórico do arquivo, a lista de commits e as opções do
  Cherry-pick Studio e a navegação das Configurações. Duplo clique (ou `Enter`) volta ao tamanho
  padrão; com o foco na divisória, as setas ajustam o tamanho pelo teclado.
- **Recolher painéis**: os botões ◂ ▸ na divisória escondem um dos lados para o outro ocupar todo o
  espaço (ou arraste a divisória até a borda). `Ctrl+B` mostra/oculta a barra lateral.
- **Janelas redimensionáveis**: diálogos (Studio, editor de conflitos, rebase, configurações…) podem
  ser redimensionados pelas bordas e maximizados pelo botão □ ou com duplo clique no título.
- **Colunas ajustáveis** no editor de conflitos (atual × resultado × que entra) e na coluna do blame;
  grupos de arquivos em Alterações e seções da barra lateral podem ser recolhidos.
- O GitTools **lembra** do layout escolhido; ⚙ Configurações → Aparência → "Restaurar layout" volta
  tudo ao padrão. Em janelas estreitas, as barras quebram linha e colunas secundárias saem da lista.

### Configurações

![Central de Configurações](docs/screenshots/configuracoes.png)

Todas as opções gerais ficam num único lugar, separadas em seções: **Geral** (idioma),
**Aparência** (tema, tamanho e restaurar o layout dos painéis), **Atalhos de teclado** e **Sobre** (versões do GitTools, do git e
do sistema, local do arquivo de configurações e "Restaurar padrões").

### Atalhos de teclado

| Ação | Padrão |
| --- | --- |
| Histórico / Alterações / Arquivos / Comparar | `Ctrl+1` … `Ctrl+4` |
| Mostrar/ocultar a barra lateral | `Ctrl+B` |
| Cherry-pick Studio | `Ctrl+Shift+P` |
| Nova branch / Stash | `Ctrl+Shift+N` / `Ctrl+Shift+S` |
| Fetch / Pull / Push | `Ctrl+Shift+F` / `Ctrl+Shift+L` / `Ctrl+Shift+K` |
| Atualizar / Abrir repositório | `F5` / `Ctrl+O` |
| Configurações / Lista de atalhos | `Ctrl+,` / `F1` |
| Mover / estender a seleção no histórico | `↑` `↓` / `Shift+↑` `Shift+↓` |

No macOS, `Ctrl` corresponde a `⌘`. Todos podem ser trocados em ⚙ Configurações.

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
│   ├── exec.ts         Executa o git sem shell e sem prompts interativos
│   ├── diff.ts         Lê diffs unificados e monta patches parciais (linhas escolhidas)
│   └── repository.ts   Status, branches, log, stage, merge, rebase (inclusive interativo), cherry-pick
│                       (branch/commits/arquivos/linhas), conflitos, comparação, blame, histórico, stash, remotos
├── main/               Processo principal do Electron: janela, diálogos, IPC
├── preload/            Ponte segura (contextIsolation) exposta como window.gittools
├── shared/             Tipos, contrato da API, marcadores de conflito, configurações e idiomas
│   ├── settings.ts     Formato, valores padrão e validação das configurações
│   └── i18n/           Traduções (usadas pelo motor git, pelo processo principal e pela interface)
│       ├── locales.ts  Lista de idiomas e detecção do idioma do sistema
│       ├── translator.ts  Parâmetros {nome} e plurais (Intl.PluralRules)
│       └── messages/   Um arquivo por idioma; pt-BR.ts é a referência
└── renderer/           Interface em React
    └── src/components/ Histórico com grafo, detalhes do commit, diff com seleção de linhas, alterações,
                        Cherry-pick Studio, editor de conflitos, comparação, blame/histórico,
                        rebase interativo e atalhos
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

- Clonar repositórios e gerenciar remotos pela interface
- Assinatura de commits (GPG/SSH) e edição de tags
- Histórico de operações com "desfazer" (baseado no reflog)

## Licença

[MIT](LICENSE)
