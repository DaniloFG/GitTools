# GitTools para VS Code

Git com interface visual dentro do VS Code: **arraste e clique** para fazer merge, rebase e cherry-pick
de branches inteiras, commits, arquivos ou até **linhas específicas**. É a mesma interface do
aplicativo GitTools, rodando num painel do VS Code.

## Como usar

- **GitTools: Abrir o GitTools** (`Ctrl+Alt+G`, ou `⌘⌥G` no macOS), o botão **⑂ GitTools** na barra de
  status ou o ícone no título do painel *Controle do código-fonte*.
- Se a pasta aberta no VS Code é um repositório git, ela é usada; senão use **GitTools: Abrir um
  repositório…**, ou clique com o botão direito numa pasta do Explorer → **Abrir esta pasta no GitTools**.
- **GitTools: Ver as alterações deste arquivo no GitTools** (botão no título do editor) abre o diff do
  arquivo atual num painel ao lado.
- Arquivos abertos pelo GitTools (*Abrir no editor*, ou o menu do arquivo) abrem no editor do próprio VS Code.

Tudo o que o aplicativo faz está aqui: histórico com grafo, Cherry-pick Studio, editor de conflitos lado
a lado, rebase interativo, comparar branches, blame, remotes, log dos comandos git e 6 idiomas. O tema
segue o do VS Code (em *Configurações → Aparência* dá para forçar claro ou escuro).

## Instalar

Procure por **GitTools** (publisher *DaniloFG*) na aba de extensões do VS Code, ou rode
`code --install-extension DaniloFG.gittools-vscode`. As atualizações chegam automaticamente.

## Requisitos

[Git](https://git-scm.com/) 2.23 ou mais novo no `PATH`. Não usa nenhuma conta nem serviço externo: todas as
operações são comandos do git instalado na máquina.

## Código-fonte

<https://github.com/DaniloFG/GitTools> — a pasta `extension/` contém a extensão; o motor git e a interface
são compartilhados com o aplicativo.
