// Extensão do VS Code: mostra a interface do GitTools num painel (webview) e fala com o git pelo mesmo
// `Backend` do aplicativo. Aqui ficam só as partes específicas do VS Code: painéis, diálogos e abrir
// arquivos no editor.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { Backend, type BackendHost } from '../../src/backend/backend'
import { isBridgeChannel, type HostToWebview, type WebviewToHost } from '../../src/shared/channels'
import { matchLocale, setLocale } from '../../src/shared/i18n'
import type { DiffWindowRequest } from '../../src/shared/api'
import type { Settings } from '../../src/shared/settings'
import { GitRepository } from '../../src/core/repository'
import { isIgnoredPath } from '../../src/core/discover'
import { findRepositoriesConcurrent, mapLimit, waitsForDiscovery } from './discover'

/** Dois caminhos apontam para a mesma pasta? (links simbólicos, como /var → /private/var no macOS, e maiúsculas do Windows) */
function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }
  const [x, y] = [real(a), real(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

const MAIN_VIEW = 'gittools'
const DIFF_VIEW = 'gittools.diff'
/** Chave, no estado da janela, dos repositórios abertos nela. */
const WORKSPACE_KEY = 'gittools.workspace'
/** Intervalo entre tentativas de abrir um .git recém-criado (um clone ainda está escrevendo o repositório). */
const NEW_REPO_RETRY_MS = 1500
/** Repositórios achados abertos ao mesmo tempo (um processo git cada): poucos, pois no Windows cada processo pesa. */
const OPEN_CONCURRENCY = 4

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `path` está dentro de `folder` (ou é a própria pasta)? */
function isInside(folder: string, path: string): boolean {
  const rel = relative(folder, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Idioma das mensagens do motor git: o das configurações do GitTools ou, em "sistema", o do VS Code. */
function applyLocale(settings: Settings) {
  setLocale(settings.language === 'system' ? matchLocale([vscode.env.language]) : settings.language)
}

class Controller {
  readonly backend: Backend
  private main: vscode.WebviewPanel | null = null
  private readonly panels = new Set<vscode.WebviewPanel>()
  /** A descoberta das pastas do VS Code foi feita nesta janela (uma vez; ver `useWorkspaceRepository`). */
  private workspaceReady: Promise<void> | null = null
  /** Observadores do workspace (novas pastas e repositórios criados dentro dele); null com a detecção desligada. */
  private detectors: vscode.Disposable[] | null = null

  constructor(private readonly context: vscode.ExtensionContext) {
    const host: BackendHost = {
      dataDir: () => context.globalStorageUri.fsPath,
      homeDir: () => homedir(),
      documentsDir: () => (existsSync(join(homedir(), 'Documents')) ? join(homedir(), 'Documents') : homedir()),
      systemLocales: () => [vscode.env.language],
      versions: () => ({
        host: 'vscode',
        version: String(context.extension.packageJSON.version),
        vscode: vscode.version,
        electron: '',
        chrome: '',
        node: process.versions.node,
        platform: `${process.platform} ${process.arch}`
      }),
      emit: (channel, payload) => this.post({ type: 'event', channel, payload }),
      pickFolder: async ({ title }) => {
        const picked = await vscode.window.showOpenDialog({ title, canSelectFolders: true, canSelectFiles: false, canSelectMany: false })
        return picked?.[0]?.fsPath ?? null
      },
      openPath: (fullPath) => this.openInVsCode(fullPath),
      openInEditor: (target, repoRoot) => (target === repoRoot ? this.revealProject(repoRoot) : this.openInVsCode(target)),
      testEditor: (_setting, target) => this.openInVsCode(target),
      detectEditors: () => [],
      chooseEditor: async () => null,
      openDiffWindow: (request) => this.openDiff(request),
      settingsChanged: (settings) => {
        applyLocale(settings)
        this.applyDetection(settings.multiRepoDetection)
      },
      repositoryOpened: (info) => {
        if (this.main) this.main.title = `GitTools — ${info.name}`
      },
      // Os projetos abertos são de cada janela do VS Code (o globalStorage é compartilhado por todas).
      workspaceStore: {
        read: () => context.workspaceState.get(WORKSPACE_KEY),
        write: (value) => context.workspaceState.update(WORKSPACE_KEY, value)
      }
    }
    this.backend = new Backend(host)
    void this.backend.loadSettings().then(applyLocale)
  }

  dispose() {
    this.stopDetectors()
    this.backend.dispose()
  }

  private post(message: HostToWebview) {
    for (const panel of this.panels) void panel.webview.postMessage(message)
  }

  /** Abre um arquivo no editor do VS Code, ao lado do painel do GitTools. */
  private async openInVsCode(fullPath: string): Promise<void> {
    const uri = vscode.Uri.file(fullPath)
    const stat = await vscode.workspace.fs.stat(uri)
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealFileInOS', uri)
      return
    }
    await vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Beside })
  }

  /** "Abrir no editor" sem arquivo: mostra o projeto no VS Code (nova janela se ele não está aberto). */
  private async revealProject(root: string): Promise<void> {
    const open = vscode.workspace.workspaceFolders?.some((f) => samePath(f.uri.fsPath, root))
    if (open) await vscode.commands.executeCommand('workbench.view.explorer')
    else await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true })
  }

  /**
   * Abre os repositórios do workspace do VS Code. Só uma vez por janela (depois disso vale a escolha do
   * usuário, e repositórios fechados de propósito não voltam). Os reabertos da última sessão continuam abertos.
   * A descoberta começa na primeira chamada; o painel não a espera (ver `attachMain` e `setup`).
   */
  useWorkspaceRepository(): Promise<void> {
    this.workspaceReady ??= this.backend.restoreWorkspace().then(() => this.discoverWorkspace())
    return this.workspaceReady
  }

  /** A descoberta começa (se ainda não começou) sem que ninguém a espere; um erro dela aparece como antes, numa mensagem. */
  private discoverInBackground(): void {
    this.useWorkspaceRepository().catch((error: unknown) => void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))
  }

  /** Conforme a configuração `multiRepoDetection`: todos os repositórios do workspace, ou só o primeiro (comportamento antigo). */
  private async discoverWorkspace(): Promise<void> {
    const settings = await this.backend.loadSettings()
    const folders = this.folderPaths()
    if (!settings.multiRepoDetection) {
      for (const folder of folders) {
        try {
          await this.backend.setRepository(await GitRepository.open(folder))
          return
        } catch {
          // Não é um repositório: tenta a próxima pasta.
        }
      }
      return
    }
    this.startDetectors()
    // Sem aviso à interface: todo pedido dela que depende dos repositórios já espera esta descoberta (ver
    // `setup`), então a primeira lista que ela recebe já está completa. Um "repo:changed" aqui só a faria reler tudo.
    await this.openFound(folders, false)
  }

  /**
   * Abre, cada um na sua aba, os repositórios achados nestas pastas, sem trocar o ativo. Sem nenhum ativo,
   * o primeiro achado vira o ativo. Repositórios já abertos não são duplicados (o Backend já cuida disso).
   * Os recentes e o estado da janela são gravados uma vez no fim, não uma vez por repositório.
   */
  private async openFound(folders: string[], notify = true): Promise<void> {
    const paths = await findRepositoriesConcurrent(folders)
    const repos = await mapLimit(paths, OPEN_CONCURRENCY, (path) =>
      GitRepository.open(path).catch(() => null) // Pasta que deixou de ser repositório, ou sem permissão: fica de fora.
    )
    const opened = repos.filter((repo): repo is GitRepository => repo !== null)
    if (opened.length === 0) return
    await this.backend.addRepositories(opened, { activateIfNone: true })
    if (notify) this.notifyRepositoryChanged()
  }

  /** Liga a detecção: novas pastas no workspace e repositórios criados (git init, clone) dentro dele. */
  private startDetectors(): void {
    if (this.detectors) return
    const watcher = vscode.workspace.createFileSystemWatcher('**/.git')
    this.detectors = [
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        void this.openFound(event.added.map((f) => f.uri.fsPath))
      }),
      watcher.onDidCreate((uri) => void this.openCreated(uri.fsPath)),
      watcher
    ]
  }

  /** Desliga a detecção (configuração desligada, ou a janela fechou). */
  private stopDetectors(): void {
    for (const d of this.detectors ?? []) d.dispose()
    this.detectors = null
  }

  /** A configuração mudou: liga ou desliga a detecção, e na ligação procura o que já existe no workspace. */
  private applyDetection(enabled: boolean): void {
    if (!enabled) {
      this.stopDetectors()
      return
    }
    if (this.detectors) return
    this.startDetectors()
    void this.openFound(this.folderPaths())
  }

  /** Um `.git` apareceu dentro do workspace: abre o repositório como aba nova, sem trocar o ativo. */
  private async openCreated(gitPath: string): Promise<void> {
    const root = dirname(gitPath)
    const folder = this.folderPaths().find((f) => isInside(f, root))
    if (!folder || isIgnoredPath(relative(folder, root))) return
    // Um clone ainda está escrevendo o repositório: tenta de novo algumas vezes antes de desistir.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(NEW_REPO_RETRY_MS)
      try {
        const repo = await GitRepository.open(root)
        await this.backend.addRepository(repo, { activate: false })
        if (this.backend.activeRoot === null) await this.backend.switchRepository(repo.root)
        this.notifyRepositoryChanged()
        return
      } catch {
        // Ainda não é um repositório completo: tenta de novo.
      }
    }
  }

  /** Pastas do workspace do VS Code, como caminhos do sistema. */
  private folderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  }

  /** Avisa o painel que a lista de repositórios mudou (a interface relê os abertos). */
  private notifyRepositoryChanged(): void {
    this.post({ type: 'event', channel: 'repo:changed' })
  }

  /** Abre (ou mostra) o painel principal do GitTools. */
  async open(): Promise<void> {
    // O painel aparece já; a descoberta começa em `attachMain` e segue por trás, e a interface mostra o
    // carregamento até ela acabar. Com o painel já aberto, a descoberta já começou.
    if (this.main) {
      this.main.reveal()
      return
    }
    this.attachMain(vscode.window.createWebviewPanel(MAIN_VIEW, 'GitTools', vscode.ViewColumn.Active, this.panelOptions()))
  }

  /** Painel principal já criado pelo VS Code (restaurado ao reabrir a janela). */
  attachMain(panel: vscode.WebviewPanel): void {
    this.discoverInBackground()
    this.main = panel
    panel.onDidDispose(() => {
      this.main = null
    })
    void this.backend
      .restoreWorkspace()
      .then(() => this.backend.repo?.info())
      .then((info) => {
        if (info) panel.title = `GitTools — ${info.name}`
      })
    this.setup(panel)
  }

  /** Painel com o diff de um arquivo, ao lado do principal. */
  openDiff(request: DiffWindowRequest): void {
    const panel = vscode.window.createWebviewPanel(DIFF_VIEW, request.title ?? request.path, vscode.ViewColumn.Beside, this.panelOptions())
    this.setup(panel, `?window=diff&request=${encodeURIComponent(JSON.stringify(request))}`)
  }

  /** Muda de repositório e recria o painel principal (a interface carrega o repositório ao iniciar). */
  async openRepository(path: string): Promise<void> {
    await this.backend.setRepository(await GitRepository.open(path))
    this.main?.dispose()
    await this.open()
  }

  /** Mostra as alterações do arquivo aberto no editor (staged se só houver staged, senão as não staged). */
  async showFileDiff(file: vscode.Uri): Promise<void> {
    await this.useWorkspaceRepository()
    const repo = this.backend.repo
    if (!repo) throw new Error(vscode.l10n.t('Open a git repository first.'))
    const path = relative(repo.root, file.fsPath).split(sep).join('/')
    if (path.startsWith('..')) throw new Error(vscode.l10n.t('This file is outside the open repository.'))
    const status = await repo.status()
    const staged = status.staged.some((f) => f.path === path) && !status.unstaged.some((f) => f.path === path)
    this.openDiff({ source: { kind: staged ? 'staged' : 'unstaged' }, path, title: path })
  }

  private panelOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    }
  }

  private setup(panel: vscode.WebviewPanel, search?: string): void {
    // Ícone na aba do painel (também nos painéis restaurados ao reabrir o VS Code).
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png')
    this.panels.add(panel)
    panel.onDidDispose(() => this.panels.delete(panel))
    panel.webview.html = this.html(panel.webview, search)
    panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (message?.type === 'close') {
        panel.dispose()
        return
      }
      if (message?.type !== 'request' || !isBridgeChannel(message.channel)) return
      const channel = message.channel
      // Enquanto a descoberta do workspace roda, os pedidos que dependem dos repositórios esperam por ela:
      // a interface segue no carregamento em vez de mostrar as boas-vindas e trocar logo depois.
      const ready = this.workspaceReady && waitsForDiscovery(channel) ? this.workspaceReady.catch(() => undefined) : Promise.resolve()
      ready.then(() => this.backend.invoke(channel, Array.isArray(message.args) ? message.args : [])).then(
        (result) => panel.webview.postMessage({ type: 'response', id: message.id, ok: true, result } satisfies HostToWebview),
        (error: unknown) =>
          panel.webview.postMessage({ type: 'response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies HostToWebview)
      )
    })
  }

  /** A página da interface (gerada pelo vite), com os endereços dos arquivos e a política de segurança do webview. */
  private html(webview: vscode.Webview, search?: string): string {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
    const base = webview.asWebviewUri(dist).toString()
    const nonce = randomBytes(16).toString('hex')
    const source = webview.cspSource
    const csp = `default-src 'none'; img-src ${source} data:; style-src ${source} 'unsafe-inline'; script-src ${source} 'nonce-${nonce}'; font-src ${source};`
    const boot = JSON.stringify({ search }).replace(/</g, '\\u003c')
    return readFileSync(join(dist.fsPath, 'index.html'), 'utf8')
      .replace(/<meta[^>]*Content-Security-Policy[^>]*>/is, '')
      .replace(/ crossorigin/g, '')
      .replace(/(src|href)="\.\/assets\//g, `$1="${base}/assets/`)
      .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}" />\n<script nonce="${nonce}">window.__gittoolsBoot = ${boot}</script>`)
  }
}

export function activate(context: vscode.ExtensionContext) {
  const controller = new Controller(context)
  const run = (action: () => Promise<void>) => () =>
    action().catch((error: unknown) => void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)))

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  status.text = '$(git-branch) GitTools'
  status.command = 'gittools.open'
  status.tooltip = 'GitTools'
  status.show()

  context.subscriptions.push(
    status,
    { dispose: () => controller.dispose() },
    vscode.commands.registerCommand('gittools.open', run(() => controller.open())),
    vscode.commands.registerCommand(
      'gittools.openRepository',
      run(async () => {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false })
        if (picked?.[0]) await controller.openRepository(picked[0].fsPath)
      })
    ),
    vscode.commands.registerCommand('gittools.openFolderInGitTools', (uri?: vscode.Uri) => run(async () => uri && (await controller.openRepository(uri.fsPath)))()),
    vscode.commands.registerCommand('gittools.openFileDiff', (uri?: vscode.Uri) =>
      run(async () => {
        const file = uri ?? vscode.window.activeTextEditor?.document.uri
        if (!file || file.scheme !== 'file') throw new Error(vscode.l10n.t('Open a file first.'))
        await controller.showFileDiff(file)
      })()
    ),
    vscode.window.registerWebviewPanelSerializer(MAIN_VIEW, {
      deserializeWebviewPanel: async (panel) => {
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')] }
        controller.attachMain(panel)
      }
    })
  )
}

export function deactivate() {}
