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
| Resolver conflitos                            | Um painel aparece no topo: *Usar a atual*, *Usar a que entra*, *Abrir no editor*, *Resolvido*, e depois *Continuar*, *Pular* ou *Abortar*. |
| Outras operações                              | Checkout (duplo clique), criar/renomear/excluir branch, revert, reset, stash, fetch, pull e push (botão direito / barra superior). |

### Cherry-pick de linhas

![Seleção de linhas no Cherry-pick Studio](docs/screenshots/studio-linhas.png)

Selecione exatamente as linhas que quer levar. O GitTools monta um patch só com elas e aplica com
`git apply --3way` na branch de destino — se o contexto mudou, o Git faz a mescla de três vias e,
se mesmo assim houver conflito, ele aparece no painel de conflitos como em qualquer outra operação.

| Arrastar uma branch sobre outra | Conflito durante o cherry-pick |
| --- | --- |
| ![Menu ao soltar uma branch](docs/screenshots/arrastar-branch.png) | ![Painel de conflitos](docs/screenshots/conflito.png) |

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
│   └── repository.ts   Status, branches, log, stage, merge, rebase, cherry-pick (branch/commits/arquivos/linhas), conflitos, stash, remotos
├── main/               Processo principal do Electron: janela, diálogos, IPC
├── preload/            Ponte segura (contextIsolation) exposta como window.gittools
├── shared/             Tipos e contrato da API entre interface e processo principal
└── renderer/           Interface em React
    └── src/components/ Histórico com grafo, detalhes do commit, diff com seleção de linhas,
                        alterações, Cherry-pick Studio, painel de conflitos, diálogos
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

## Próximos passos

- Rebase interativo visual (reordenar, juntar e editar commits arrastando)
- Editor de conflitos lado a lado (atual × que entra × resultado)
- Comparar duas branches/commits quaisquer
- Blame por linha e histórico de um arquivo
- Atalhos de teclado e tema configurável

## Licença

[MIT](LICENSE)
