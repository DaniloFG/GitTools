import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fakeVscode from './support/vscode'
import { fake, Uri, type FakePanel } from './support/vscode'
import { createRepo } from './helpers'
import { activate } from '../extension/src/extension'

const INDEX = `<!doctype html><html><head>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'"
    />
    <title>GitTools</title>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
  </head><body><div id="root"></div></body></html>`

const dirs: string[] = []
function extensionContext() {
  const root = mkdtempSync(join(tmpdir(), 'gittools-ext-'))
  dirs.push(root)
  mkdirSync(join(root, 'dist', 'webview', 'assets'), { recursive: true })
  writeFileSync(join(root, 'dist', 'webview', 'index.html'), INDEX)
  const subscriptions: { dispose(): void }[] = []
  return {
    context: {
      subscriptions,
      extensionUri: Uri.file(root),
      globalStorageUri: Uri.file(join(root, 'storage')),
      extension: { packageJSON: { version: '9.9.9' } }
    },
    subscriptions
  }
}

/** Espera a resposta de um pedido enviado ao painel. */
async function ask(panel: FakePanel, channel: string, ...args: unknown[]) {
  const id = Math.floor(Math.random() * 1e9)
  panel.send({ type: 'request', id, channel, args })
  for (let i = 0; i < 200; i++) {
    const reply = panel.webview.posted.find((m) => (m as { type: string; id?: number }).type === 'response' && (m as { id: number }).id === id) as
      | { ok: boolean; result?: unknown; error?: string }
      | undefined
    if (reply) return reply
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('sem resposta')
}

beforeEach(() => fake.reset())
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function start() {
  const { context, subscriptions } = extensionContext()
  activate(context as never)
  return { context, subscriptions, run: (id: string, ...args: unknown[]) => fake.commands.get(id)!(...args) }
}

describe('extensão do VS Code', () => {
  it('registra os comandos e a barra de status', async () => {
    const { subscriptions } = await start()
    expect([...fake.commands.keys()].sort()).toEqual(['gittools.open', 'gittools.openFileDiff', 'gittools.openFolderInGitTools', 'gittools.openRepository'])
    expect(fake.serializers.has('gittools')).toBe(true)
    subscriptions.forEach((s) => s.dispose())
  })

  it('abre o painel com a página da interface: política de segurança e endereços do webview', async () => {
    const { run } = await start()
    await run('gittools.open')
    expect(fake.panels).toHaveLength(1)
    const html = fake.panels[0].webview.html.replaceAll('\\', '/')
    expect(html).not.toContain("default-src 'self'")
    expect(html).toContain("default-src 'none'")
    expect(html).toMatch(/script-src https:\/\/fake\.vscode-cdn\.net 'nonce-[0-9a-f]{32}'/)
    expect(html).toContain('src="https://file+.vscode-resource.fake.net')
    expect(html).toContain('/dist/webview/assets/index-abc.js"')
    expect(html).not.toContain('crossorigin')
    expect(html).toContain('window.__gittoolsBoot')
    expect((fake.panels[0].webview.options as { enableScripts: boolean }).enableScripts).toBe(true)
    // Abrir de novo só mostra o painel que já existe.
    await run('gittools.open')
    expect(fake.panels).toHaveLength(1)
  })

  it('usa a pasta do workspace quando ela é um repositório e responde aos pedidos da interface', async () => {
    const t = await createRepo()
    await t.commit('primeiro', { 'a.txt': 'a\n' })
    fake.workspaceFolders = [{ uri: Uri.file(t.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    const current = await ask(panel, 'app:currentRepository')
    expect(current.ok).toBe(true)
    expect((current.result as { root: string }).root).toBe(t.repo.root)
    const log = await ask(panel, 'repo:invoke', 'log', [{ all: true }])
    expect((log.result as { subject: string }[]).map((c) => c.subject)).toEqual(['primeiro'])
    expect(panel.title).toContain('GitTools')
    // A aba do painel mostra o ícone do GitTools (media/icon.png da extensão).
    expect((panel.iconPath as Uri).fsPath).toMatch(/media[\\/]icon\.png$/)
    // Eventos do git chegam ao painel.
    expect(panel.webview.posted.some((m) => (m as { type: string; channel?: string }).channel === 'git:command')).toBe(true)
  })

  it('devolve erros como resposta e ignora canais desconhecidos', async () => {
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    const failed = await ask(panel, 'repo:invoke', 'status', [])
    expect(failed.ok).toBe(false)
    expect(failed.error).toBeTruthy()
    panel.send({ type: 'request', id: 77, channel: 'app:rm-rf', args: [] })
    panel.send({ type: 'qualquer coisa' })
    await new Promise((r) => setTimeout(r, 30))
    expect(panel.webview.posted.some((m) => (m as { id?: number }).id === 77)).toBe(false)
  })

  it('abre arquivos no editor do VS Code, ao lado do painel', async () => {
    const t = await createRepo()
    await t.commit('c', { 'src/app.ts': 'x\n' })
    fake.workspaceFolders = [{ uri: Uri.file(t.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    expect((await ask(panel, 'app:openInEditor', 'src/app.ts')).ok).toBe(true)
    expect(fake.shown[0].path).toBe(join(t.repo.root, 'src', 'app.ts'))
    expect((fake.shown[0].options as { viewColumn: number }).viewColumn).toBe(fakeVscode.ViewColumn.Beside)
    const missing = await ask(panel, 'app:openInEditor', 'nao-existe.ts')
    expect(missing.ok).toBe(false)
    // Sem arquivo: mostra o projeto (já está aberto no VS Code → explorador).
    expect((await ask(panel, 'app:openInEditor', '.')).ok).toBe(true)
    expect(fake.executed.at(-1)?.command).toBe('workbench.view.explorer')
    // O editor de Configurações não faz sentido aqui.
    expect((await ask(panel, 'app:detectEditors')).result).toEqual([])
    const info = (await ask(panel, 'app:info')).result as { host: string; vscode: string; version: string }
    expect(info).toMatchObject({ host: 'vscode', vscode: '1.90.0-fake', version: '9.9.9' })
  })

  it.skipIf(process.platform === 'win32')('reconhece o projeto aberto mesmo quando a pasta do workspace é um link simbólico', async () => {
    const t = await createRepo()
    await t.commit('c', { 'a.txt': 'a\n' })
    const link = join(mkdtempSync(join(tmpdir(), 'gittools-link-')), 'projeto')
    dirs.push(join(link, '..'))
    symlinkSync(t.repo.root, link)
    fake.workspaceFolders = [{ uri: Uri.file(link) }]
    const { run } = await start()
    await run('gittools.open')
    expect((await ask(fake.panels[0], 'app:openInEditor', '.')).ok).toBe(true)
    expect(fake.executed.at(-1)?.command).toBe('workbench.view.explorer')
  })

  it('abre o diff de um arquivo em outro painel e fecha pelo pedido do webview', async () => {
    const t = await createRepo()
    await t.commit('c', { 'a.txt': 'a\n' })
    t.write('a.txt', 'b\n')
    fake.workspaceFolders = [{ uri: Uri.file(t.dir) }]
    fake.activeEditor = { document: { uri: Uri.file(join(t.repo.root, 'a.txt')) } }
    const { run } = await start()
    await run('gittools.openFileDiff')
    expect(fake.panels).toHaveLength(1)
    const diff = fake.panels[0]
    expect(diff.viewType).toBe('gittools.diff')
    const boot = /window\.__gittoolsBoot = (\{.*\})<\/script>/.exec(diff.webview.html)![1]
    const search = JSON.parse(boot).search as string
    const request = JSON.parse(new URLSearchParams(search).get('request')!)
    expect(request).toMatchObject({ path: 'a.txt', source: { kind: 'unstaged' } })
    expect(new URLSearchParams(search).get('window')).toBe('diff')
    diff.send({ type: 'close' })
    expect(diff.disposed).toBe(true)
  })

  it('pede ao usuário a pasta ao abrir um repositório e recria o painel', async () => {
    const a = await createRepo()
    const b = await createRepo()
    fake.workspaceFolders = [{ uri: Uri.file(a.dir) }]
    const { run } = await start()
    await run('gittools.open')
    fake.openDialogResult = [Uri.file(b.dir)]
    await run('gittools.openRepository')
    expect(fake.panels[0].disposed).toBe(true)
    expect(fake.panels).toHaveLength(2)
    const current = await ask(fake.panels[1], 'app:currentRepository')
    expect((current.result as { root: string }).root).toBe(b.repo.root)
  })

  it('mostra erro quando não há arquivo ou repositório', async () => {
    const { run } = await start()
    await run('gittools.openFileDiff')
    await new Promise((r) => setTimeout(r, 20))
    expect(fake.errors.length).toBe(1)
  })

  it('restaura o painel principal ao reabrir o VS Code', async () => {
    const t = await createRepo()
    fake.workspaceFolders = [{ uri: Uri.file(t.dir) }]
    await start()
    const panel = {} as FakePanel
    Object.assign(panel, createFake())
    await fake.serializers.get('gittools')!.deserializeWebviewPanel(panel, undefined)
    expect(panel.webview.html).toContain('window.__gittoolsBoot')
    expect((panel.iconPath as Uri).fsPath).toMatch(/media[\\/]icon\.png$/)
    expect((await ask(panel, 'app:currentRepository')).ok).toBe(true)
  })
})

function createFake(): FakePanel {
  // Um painel entregue pelo VS Code já existe antes de a extensão tocar nele.
  const before = fake.panels.length
  fakeVscode.window.createWebviewPanel('gittools', 'GitTools', 1, {})
  return fake.panels.splice(before, 1)[0]
}
