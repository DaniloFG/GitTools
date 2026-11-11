---
name: run-gittools
description: Abre a interface de verdade do GitTools (Chromium ligado ao Backend real, num repositório de exemplo) para ver uma mudança funcionando, conferir comportamento, erros de console e nós no DOM, e tirar print. Use para rodar, abrir, ver na tela, testar de ponta a ponta (e2e) ou confirmar que uma mudança de interface funciona; é a receita que /run e /verify seguem neste projeto.
argument-hint: "[o que conferir]"
---

# Ver o GitTools funcionando

O que conferir: $ARGUMENTS

O projeto já tem o arranjo: `scripts/readme-media/harness.mjs` sobe a interface compilada num Chromium e a liga ao
`Backend` de verdade, sem Electron e sem tela. É o mesmo arranjo de `scripts/perf/ui.mjs` e dos prints do README.
Não instale Playwright, não rode `playwright install` e não acrescente dependência: o roteiro acha o Chromium e o
módulo `playwright` do ambiente (`CHROMIUM` e `PLAYWRIGHT_MODULE` apontam para outros, se precisar).

## 1. Preparar

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci   # só se não houver node_modules
npm run build:extension                  # sempre que a interface (src/renderer) mudou
```

O `Backend` é compilado a cada execução do roteiro; a interface, não: ela vem de `extension/dist/webview`.

## 2. Escrever o roteiro da conferência

Um arquivo `.mjs` **fora do repositório** (pasta de rascunho da sessão), escrito para a mudança. Ponto de partida,
já conferido neste projeto:

```js
// node conferir.mjs <raiz do GitTools>
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const root = process.argv[2]
const { newApp } = await import(pathToFileURL(join(root, 'scripts/readme-media/lib.mjs')).href)
const app = await newApp({ lang: 'pt-BR' }) // repositório de exemplo; host: 'vscode' para o visual da extensão
const { page, backend, errors } = app
let failed = false
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}
try {
  await page.waitForSelector('.toolbar')

  // ... a interação que a mudança pede: page.click, page.keyboard, page.locator(...) ...
  // ... e a asserção sobre o que o usuário vê depois dela ...

  const nodes = await page.evaluate(() => document.querySelectorAll('*').length)
  check('nós no DOM ≤ 5.000', nodes <= 5000, String(nodes))
  const git = await backend.invoke('app:gitLog', [])
  console.log(`INFO  processos git até aqui: ${git.length}`)
  // O servidor do roteiro não tem favicon: um 404 por carga é esperado. Mais de um é recurso faltando.
  const notFound = errors.filter((e) => /status of 404/.test(e))
  const real = errors.filter((e) => !/status of 404/.test(e))
  check('sem erros na página', real.length === 0 && notFound.length <= 1, [...real, `${notFound.length}× 404`].join(' | '))
  await page.screenshot({ path: join(process.cwd(), 'tela.png') })
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
```

O que o arranjo oferece:

- `newApp({ lang, host, viewport, wip, layout, settings, setup })` em `scripts/readme-media/lib.mjs`: cria o
  repositório de exemplo (`createDemoRepo`) e abre a interface. `setup(dir)` prepara o repositório antes de abrir.
- `launch({ repo, more, language, theme, ... })` em `harness.mjs`: abre a interface num repositório seu (crie um
  temporário com o caso que a mudança precisa: conflito, muitos arquivos, HEAD destacado).
- `createStressRepo()` e `applyScenario()` em `scripts/perf/stress-repo.mjs`: o repositório grande (20 mil commits,
  mais de mil refs, 6 mil arquivos), para conferir tela com volume.
- `backend.invoke(canal, args)`: fala com o `Backend` por fora da página (`'app:gitLog'` lista os processos git).
- `errors`: erros da página e do console desde a carga.

## 3. Conferir de verdade

- **Exercite o que mudou**, pelo caminho do usuário (clique, tecla, arrasto), e afirme o resultado visível. Abrir a
  tela e não ver erro não prova a mudança.
- **Tente quebrar**: lista vazia, item com nome longo ou com acento, a ação repetida depressa, a janela estreita
  (`viewport`), o outro idioma (`lang: 'en'`), o outro hospedeiro (`host: 'vscode'`).
- **Olhe o print** com a ferramenta de leitura de imagem: texto cortado, sobreposição e tema errado não aparecem em
  asserção.
- Caminho quente (rolar, arrastar, digitar, abrir diff grande) também é medido: skill `medir`.

## 4. Relatar

Para cada conferência: o que foi feito na tela, o que se esperava e o que aconteceu, com a linha `OK`/`FALHA` da
saída. Diga o que **não** foi conferido. O roteiro e o print ficam fora do repositório; conferência que vale repetir
em outros trabalhos é proposta ao dono como roteiro versionado, não commitada por conta própria.

## O aplicativo Electron

`npm run dev` abre o aplicativo de verdade, mas precisa de tela: serve na máquina do dono, não em sessão de nuvem.
O que só existe no Electron (janelas, diálogos, menus, `src/main`, `src/preload`) é coberto por teste de integração
em `tests/` e pela revisão; diga isso como "não conferido na tela" quando for o caso.
