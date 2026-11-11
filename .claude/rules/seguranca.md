---
paths:
  - "src/core/exec.ts"
  - "src/core/terminal.ts"
  - "src/core/paths.ts"
  - "src/core/config.ts"
  - "src/core/repository.ts"
  - "src/shared/terminal.ts"
  - "src/shared/api.ts"
  - "src/shared/channels.ts"
  - "src/backend/**/*"
  - "src/main/**/*"
  - "src/preload/**/*"
  - "extension/src/**/*"
  - "extension/package.json"
  - "src/renderer/index.html"
  - ".github/workflows/**/*"
  - "package.json"
---

# Segurança

O GitTools abre repositórios que o usuário não escreveu: nome de arquivo, branch, mensagem de commit, configuração
do git e conteúdo de diff são **entrada hostil**. As defesas abaixo existem hoje; nenhuma alteração pode
enfraquecê-las, e código novo segue o mesmo desenho.

## Defesas que existem e não regridem

| Defesa | Onde | O que garante |
| --- | --- | --- |
| Git sem shell | `runGit` em `src/core/exec.ts` (`spawn('git', args)`) | Argumento nunca é interpretado; sem prompt de credencial nem editor (`GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`) |
| Terminal validado | `validateGitCommand` em `src/shared/terminal.ts` e `src/core/terminal.ts` | Só comandos git; recusa opções que executam programa, `-c` com chave de programa e alias com `!` |
| Caminho preso ao repositório | `resolveInside` em `src/core/paths.ts` | Caminho relativo vindo da interface não sai da raiz (`..`, absoluto) |
| Canais fixos | `BRIDGE_CHANNELS` (registrados em `src/main/index.ts`) e `REPO_METHODS` (conferidos no `Backend`) | A interface só chama o que está na lista; método fora dela é recusado |
| Janela isolada | `webPreferences` em `src/main/index.ts` | `contextIsolation: true`, `nodeIntegration: false`; a ponte do preload expõe funções, nunca o `ipcRenderer` |
| Navegação fechada | `setWindowOpenHandler` em `src/main/index.ts` | Só `http(s)` abre, e no navegador do sistema; nada novo abre dentro do aplicativo |
| Política de conteúdo | `src/renderer/index.html` e `html()` em `extension/src/extension.ts` | Sem script de fora; no webview, script só com `nonce` e `default-src 'none'` |
| Editor externo | `src/main/editors.ts` | Sem shell, exceto `.cmd`/`.bat` no Windows, com tudo entre aspas; variáveis do Electron não vazam para o editor |

## Regras para código novo

- **Processo novo só por lista de argumentos.** Nada de `exec`, `execSync`, `shell: true` nem comando montado por
  concatenação. Texto que o git repassa a um shell (linhas `exec` do rebase, `GIT_SEQUENCE_EDITOR`) passa por
  `shellQuote`.
- **Valor vindo do repositório ou da interface nunca vira opção do git.** Caminhos vão depois de `--`; ref, sha e
  nome de remoto são validados ou passados em posição onde um `-` inicial não é lido como opção.
- **Todo canal novo valida o que recebe** no processo principal (tipo, tamanho, caminho com `resolveInside`): a
  interface não é confiável só por ser nossa. Método novo entra em `REPO_METHODS`; canal novo, em `BRIDGE_CHANNELS`.
- **Nunca afrouxe** `webPreferences`, a política de conteúdo, o `nonce` do webview ou o filtro de `http(s)`. Se a
  tarefa parecer exigir isso, pare e leve o custo ao dono.
- **Conteúdo do repositório é texto.** Nada de `dangerouslySetInnerHTML`, `innerHTML`, `eval` ou `new Function`
  (hoje não há nenhum no projeto). URL vinda de remoto ou de configuração só abre se for `http(s)`.
- **Segredo não aparece.** URL de remoto com credencial, token e variável de ambiente não vão para o log de comandos,
  mensagem de erro, print, teste nem commit. Prints e GIFs usam a identidade e os repositórios de exemplo do roteiro
  (`scripts/readme-media`).
- **Dependência é superfície de ataque.** Não acrescente nem atualize pacote sem mostrar motivo, tamanho e licença;
  instale com `npm ci`. `package-lock.json` só muda quando a tarefa é mexer em dependência.
- **Workflows**: segredo (`VSCE_PAT` e afins) só no passo que o usa; nenhum passo novo roda código de PR de fork com
  segredo; ação de terceiros entra com versão fixa.

## Como conferir

- Mudança em qualquer arquivo desta lista termina com a skill `security-review` sobre o diff, além do teste.
- Defesa nova ou alterada ganha teste que **tenta** o ataque (os modelos são `tests/terminal.test.ts`,
  `tests/paths.test.ts` e `tests/extension.test.ts`).
- Achado de segurança que não cabe na tarefa não é corrigido em silêncio nem ignorado: vai para o dono, com o
  arquivo, a linha e o risco.
