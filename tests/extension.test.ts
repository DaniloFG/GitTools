import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fakeVscode from './support/vscode'
import { fake, Memento, Uri, type FakePanel } from './support/vscode'
import { createRepo } from './helpers'
import { runGit } from '../src/core/exec'
import { GitRepository } from '../src/core/repository'
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
/** Pasta da extensão (globalStorage incluído). Passar `root` simula outra janela usando a mesma pasta. */
function extensionContext(options: { root?: string; workspaceState?: Memento } = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'gittools-ext-'))
  if (!options.root) dirs.push(root)
  mkdirSync(join(root, 'dist', 'webview', 'assets'), { recursive: true })
  writeFileSync(join(root, 'dist', 'webview', 'index.html'), INDEX)
  const subscriptions: { dispose(): void }[] = []
  return {
    context: {
      subscriptions,
      extensionUri: Uri.file(root),
      globalStorageUri: Uri.file(join(root, 'storage')),
      // Estado da janela: um Memento novo é uma janela nova (vazia); o mesmo objeto é a mesma janela.
      workspaceState: options.workspaceState ?? new Memento(),
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

async function start(options: { root?: string; workspaceState?: Memento } = {}) {
  const { context, subscriptions } = extensionContext(options)
  activate(context as never)
  // Cada janela usa os próprios comandos (a última ativação substitui os registros em `fake.commands`).
  const handlers = new Map(fake.commands)
  return { context, subscriptions, run: (id: string, ...args: unknown[]) => handlers.get(id)!(...args) }
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

  it('cada janela do VS Code guarda os próprios projetos: uma janela nova começa sem nenhum e não mexe na outra', async () => {
    const a = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    const b = await createRepo()
    await b.commit('b', { 'b.txt': 'b\n' })
    // As duas janelas compartilham o globalStorage, como no VS Code.
    const shared = mkdtempSync(join(tmpdir(), 'gittools-ext-'))
    dirs.push(shared)

    fake.workspaceFolders = undefined
    const windowA = await start({ root: shared, workspaceState: new Memento() })
    await windowA.run('gittools.open')
    const panelA = fake.panels[0]
    expect((await ask(panelA, 'app:openRepository', a.dir)).ok).toBe(true)

    const windowB = await start({ root: shared, workspaceState: new Memento() })
    await windowB.run('gittools.open')
    const panelB = fake.panels[1]
    const openB = await ask(panelB, 'app:openRepositories')
    expect(openB.result).toEqual({ repos: [], active: null })
    expect((await ask(panelB, 'app:currentRepository')).result).toBeNull()
    // Recentes continuam globais: a janela B vê o repositório que a A abriu.
    expect(((await ask(panelB, 'app:recentRepositories')).result as { path: string }[]).map((r) => r.path)).toEqual([a.repo.root])

    expect((await ask(panelB, 'app:openRepository', b.dir)).ok).toBe(true)
    const openA = (await ask(panelA, 'app:openRepositories')).result as { repos: { root: string }[]; active: string }
    expect(openA.repos.map((r) => r.root)).toEqual([a.repo.root])
    expect(openA.active).toBe(a.repo.root)
    // Nada foi gravado na pasta de dados compartilhada: o estado fica no estado de cada janela.
    expect(existsSync(join(shared, 'storage', 'workspace.json'))).toBe(false)
    windowA.subscriptions.forEach((s) => s.dispose())
    windowB.subscriptions.forEach((s) => s.dispose())
  })

  it('reabrir a mesma janela restaura os projetos e o ativo dela', async () => {
    const a = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    const b = await createRepo()
    await b.commit('b', { 'b.txt': 'b\n' })
    const shared = mkdtempSync(join(tmpdir(), 'gittools-ext-'))
    dirs.push(shared)
    const state = new Memento()

    fake.workspaceFolders = undefined
    const first = await start({ root: shared, workspaceState: state })
    await first.run('gittools.open')
    await ask(fake.panels[0], 'app:openRepository', a.dir)
    await ask(fake.panels[0], 'app:openRepository', b.dir)
    first.subscriptions.forEach((s) => s.dispose())

    // Outra janela, nova, que não deve pegar esses projetos.
    const other = await start({ root: shared, workspaceState: new Memento() })
    await other.run('gittools.open')
    expect((await ask(fake.panels[1], 'app:openRepositories')).result).toEqual({ repos: [], active: null })

    // A mesma janela voltando (mesmo estado): recupera os dois repositórios e o ativo (b).
    const again = await start({ root: shared, workspaceState: state })
    await again.run('gittools.open')
    const reopened = (await ask(fake.panels[2], 'app:openRepositories')).result as { repos: { root: string }[]; active: string }
    expect(reopened.repos.map((r) => r.root)).toEqual([a.repo.root, b.repo.root])
    expect(reopened.active).toBe(b.repo.root)
    again.subscriptions.forEach((s) => s.dispose())
    other.subscriptions.forEach((s) => s.dispose())
  })

  it('janela nova cuja pasta é um repositório abre só essa pasta (comportamento de antes)', async () => {
    const a = await createRepo()
    await a.commit('a', { 'a.txt': 'a\n' })
    const c = await createRepo()
    await c.commit('c', { 'c.txt': 'c\n' })
    const shared = mkdtempSync(join(tmpdir(), 'gittools-ext-'))
    dirs.push(shared)

    fake.workspaceFolders = undefined
    const first = await start({ root: shared, workspaceState: new Memento() })
    await first.run('gittools.open')
    await ask(fake.panels[0], 'app:openRepository', a.dir)

    fake.workspaceFolders = [{ uri: Uri.file(c.dir) }]
    const second = await start({ root: shared, workspaceState: new Memento() })
    await second.run('gittools.open')
    const open = (await ask(fake.panels[1], 'app:openRepositories')).result as { repos: { root: string }[] }
    expect(open.repos.map((r) => r.root)).toEqual([c.repo.root])
    first.subscriptions.forEach((s) => s.dispose())
    second.subscriptions.forEach((s) => s.dispose())
  })
})

function createFake(): FakePanel {
  // Um painel entregue pelo VS Code já existe antes de a extensão tocar nele.
  const before = fake.panels.length
  fakeVscode.window.createWebviewPanel('gittools', 'GitTools', 1, {})
  return fake.panels.splice(before, 1)[0]
}

/** Espera uma condição (o VS Code avisa por eventos assíncronos). */
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('a condição não aconteceu a tempo')
}

/** Repositórios abertos e o ativo, como a interface os vê. */
async function openList(panel: FakePanel) {
  const reply = await ask(panel, 'app:openRepositories')
  return reply.result as { repos: { root: string }[]; active: string | null }
}

describe('detecção de vários repositórios no workspace', () => {
  it('abre todos os repositórios das pastas do workspace, com o ativo na primeira pasta', async () => {
    const primeira = await createRepo()
    await primeira.commit('um', { 'a.txt': 'a\n' })
    const segunda = await createRepo()
    await segunda.commit('dois', { 'b.txt': 'b\n' })
    fake.workspaceFolders = [{ uri: Uri.file(segunda.dir) }, { uri: Uri.file(primeira.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const list = await openList(fake.panels[0])
    expect(list.repos.map((r) => r.root)).toEqual([segunda.repo.root, primeira.repo.root])
    expect(list.active).toBe(segunda.repo.root)
  })

  it('acha um repositório aninhado dentro de uma pasta do workspace', async () => {
    const pasta = await createRepo()
    await pasta.commit('raiz', { 'a.txt': 'a\n' })
    const interno = join(pasta.dir, 'modulos', 'interno')
    mkdirSync(interno, { recursive: true })
    await runGit(interno, ['init', '-q'])
    fake.workspaceFolders = [{ uri: Uri.file(pasta.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const list = await openList(fake.panels[0])
    expect(list.repos.map((r) => r.root)).toEqual([pasta.repo.root, await realRoot(interno)])
    expect(list.active).toBe(pasta.repo.root)
  })

  it('com a detecção desligada, abre só o primeiro repositório (comportamento antigo)', async () => {
    const primeira = await createRepo()
    await primeira.commit('um', { 'a.txt': 'a\n' })
    const segunda = await createRepo()
    await segunda.commit('dois', { 'b.txt': 'b\n' })
    fake.workspaceFolders = [{ uri: Uri.file(primeira.dir) }, { uri: Uri.file(segunda.dir) }]
    const data = mkdtempSync(join(tmpdir(), 'gittools-ext-off-'))
    dirs.push(data)
    mkdirSync(join(data, 'storage'), { recursive: true })
    writeFileSync(join(data, 'storage', 'settings.json'), JSON.stringify({ multiRepoDetection: false }))
    const { run } = await start({ root: data })
    await run('gittools.open')
    const list = await openList(fake.panels[0])
    expect(list.repos.map((r) => r.root)).toEqual([primeira.repo.root])
    expect(fake.watchers).toHaveLength(0)
  })

  it('pasta nova no workspace abre como aba de fundo (sem trocar o ativo) e avisa a interface', async () => {
    const atual = await createRepo()
    await atual.commit('atual', { 'a.txt': 'a\n' })
    const nova = await createRepo()
    await nova.commit('nova', { 'b.txt': 'b\n' })
    fake.workspaceFolders = [{ uri: Uri.file(atual.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    fake.folderListeners.forEach((l) => l({ added: [{ uri: Uri.file(nova.dir) }], removed: [] }))
    await until(async () => (await openList(panel)).repos.length === 2)
    const list = await openList(panel)
    expect(list.repos.map((r) => r.root)).toEqual([atual.repo.root, nova.repo.root])
    expect(list.active).toBe(atual.repo.root)
    expect(panel.webview.posted).toContainEqual({ type: 'event', channel: 'repo:changed' })
  })

  it('repositório criado dentro do workspace (git init) abre na hora, sem trocar o ativo', async () => {
    const atual = await createRepo()
    await atual.commit('atual', { 'a.txt': 'a\n' })
    fake.workspaceFolders = [{ uri: Uri.file(atual.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    const watcher = fake.watchers.find((w) => w.pattern === '**/.git')!
    expect(watcher).toBeDefined()

    const sub = join(atual.dir, 'modulo')
    mkdirSync(sub)
    await runGit(sub, ['init', '-q'])
    // Um .git dentro de node_modules não é um repositório do usuário.
    const ignorado = join(atual.dir, 'node_modules', 'pacote')
    mkdirSync(ignorado, { recursive: true })
    await runGit(ignorado, ['init', '-q'])
    watcher.emitCreate(Uri.file(join(ignorado, '.git')))
    watcher.emitCreate(Uri.file(join(sub, '.git')))

    await until(async () => (await openList(panel)).repos.length === 2)
    const list = await openList(panel)
    expect(list.repos.map((r) => r.root)).toEqual([atual.repo.root, await realRoot(sub)])
    expect(list.active).toBe(atual.repo.root)
    expect(panel.webview.posted).toContainEqual({ type: 'event', channel: 'repo:changed' })
  })

  it('desligar a detecção pela configuração para de observar; ligar de novo volta a observar', async () => {
    const atual = await createRepo()
    await atual.commit('atual', { 'a.txt': 'a\n' })
    fake.workspaceFolders = [{ uri: Uri.file(atual.dir) }]
    const { run } = await start()
    await run('gittools.open')
    const panel = fake.panels[0]
    const watcher = fake.watchers[0]
    const settings = (await ask(panel, 'app:getSettings')).result as Record<string, unknown>
    await ask(panel, 'app:saveSettings', { ...settings, multiRepoDetection: false })
    expect(watcher.disposed).toBe(true)
    await ask(panel, 'app:saveSettings', { ...settings, multiRepoDetection: true })
    expect(fake.watchers.filter((w) => !w.disposed)).toHaveLength(1)
  })
})

/** Caminho real de uma pasta (o git informa o caminho sem links simbólicos). */
async function realRoot(path: string): Promise<string> {
  return GitRepository.open(path).then((r) => r.root)
}
