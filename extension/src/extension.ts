// Extensão do VS Code: mostra a interface do GitTools num painel (webview) e fala com o git pelo mesmo
// `Backend` do aplicativo. Aqui ficam só as partes específicas do VS Code: painéis, diálogos e abrir
// arquivos no editor.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import * as vscode from 'vscode'
import { Backend, type BackendHost } from '../../src/backend/backend'
import { isBridgeChannel, type HostToWebview, type WebviewToHost } from '../../src/shared/channels'
import { matchLocale, setLocale } from '../../src/shared/i18n'
import type { DiffWindowRequest } from '../../src/shared/api'
import type { Settings } from '../../src/shared/settings'
import { GitRepository } from '../../src/core/repository'

const MAIN_VIEW = 'gittools'
const DIFF_VIEW = 'gittools.diff'

/** Idioma das mensagens do motor git: o das configurações do GitTools ou, em "sistema", o do VS Code. */
function applyLocale(settings: Settings) {
  setLocale(settings.language === 'system' ? matchLocale([vscode.env.language]) : settings.language)
}

class Controller {
  readonly backend: Backend
  private main: vscode.WebviewPanel | null = null
  private readonly panels = new Set<vscode.WebviewPanel>()

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
      settingsChanged: applyLocale,
      repositoryOpened: (info) => {
        if (this.main) this.main.title = `GitTools — ${info.name}`
      }
    }
    this.backend = new Backend(host)
    void this.backend.loadSettings().then(applyLocale)
  }

  dispose() {
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
    const open = vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === root)
    if (open) await vscode.commands.executeCommand('workbench.view.explorer')
    else await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true })
  }

  /** Usa a pasta aberta no VS Code se ela for um repositório git (e ainda não há outro aberto). */
  async useWorkspaceRepository(): Promise<void> {
    if (this.backend.repo) return
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        await this.backend.setRepository(await GitRepository.open(folder.uri.fsPath))
        return
      } catch {
        // Não é um repositório: tenta a próxima pasta.
      }
    }
  }

  /** Abre (ou mostra) o painel principal do GitTools. */
  async open(): Promise<void> {
    await this.useWorkspaceRepository()
    if (this.main) {
      this.main.reveal()
      return
    }
    this.attachMain(vscode.window.createWebviewPanel(MAIN_VIEW, 'GitTools', vscode.ViewColumn.Active, this.panelOptions()))
  }

  /** Painel principal já criado pelo VS Code (restaurado ao reabrir a janela). */
  attachMain(panel: vscode.WebviewPanel): void {
    this.main = panel
    panel.onDidDispose(() => {
      this.main = null
    })
    void this.backend.repo?.info().then((info) => (panel.title = `GitTools — ${info.name}`))
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
    this.panels.add(panel)
    panel.onDidDispose(() => this.panels.delete(panel))
    panel.webview.html = this.html(panel.webview, search)
    panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
      if (message?.type === 'close') {
        panel.dispose()
        return
      }
      if (message?.type !== 'request' || !isBridgeChannel(message.channel)) return
      this.backend.invoke(message.channel, Array.isArray(message.args) ? message.args : []).then(
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
        await controller.useWorkspaceRepository()
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')] }
        controller.attachMain(panel)
      }
    })
  )
}

export function deactivate() {}
