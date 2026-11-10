// Versão mínima da API do VS Code, só com o que a extensão do GitTools usa, para testá-la sem o VS Code.

import { statSync } from 'node:fs'
import { join } from 'node:path'

type Listener<T> = (value: T) => unknown

export class Uri {
  constructor(readonly fsPath: string, readonly scheme = 'file') {}
  static file(path: string) {
    return new Uri(path)
  }
  static joinPath(base: Uri, ...parts: string[]) {
    return new Uri(join(base.fsPath, ...parts))
  }
  toString() {
    return `fake-webview://${this.fsPath}`
  }
}

/**
 * Memento do VS Code (`workspaceState`, `globalState`). Um novo `Memento` é uma janela nova, com estado vazio;
 * passar o mesmo objeto para outra ativação simula reabrir a mesma janela. Como no VS Code, os valores são
 * guardados como JSON.
 */
export class Memento {
  private readonly values = new Map<string, string>()
  get<T>(key: string, fallback?: T): T | undefined {
    const raw = this.values.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key)
    else this.values.set(key, JSON.stringify(value))
  }
  keys(): readonly string[] {
    return [...this.values.keys()]
  }
}

export const ViewColumn = { Active: -1, Beside: -2, One: 1 }
export const StatusBarAlignment = { Left: 1, Right: 2 }
export const FileType = { File: 1, Directory: 2 }

export interface FakePanel {
  viewType: string
  title: string
  /** Ícone mostrado na aba do painel. */
  iconPath?: Uri | { light: Uri; dark: Uri }
  viewColumn: number
  webview: {
    html: string
    options: unknown
    cspSource: string
    posted: unknown[]
    asWebviewUri(uri: Uri): Uri
    postMessage(message: unknown): Promise<boolean>
    onDidReceiveMessage(listener: Listener<unknown>): { dispose(): void }
  }
  disposed: boolean
  /** O webview envia uma mensagem à extensão. */
  send(message: unknown): void
  reveal(): void
  dispose(): void
  onDidDispose(listener: () => void): { dispose(): void }
}

/** Observador de arquivos criado pela extensão (`createFileSystemWatcher`). `emitCreate` simula a criação de um arquivo. */
export interface FakeWatcher {
  pattern: string
  disposed: boolean
  emitCreate(uri: Uri): void
}

/** Estado observável pelo teste. */
export const fake = {
  /** Ouvintes de `workspace.onDidChangeWorkspaceFolders`. */
  folderListeners: new Set<(event: { added: { uri: Uri }[]; removed: { uri: Uri }[] }) => unknown>(),
  /** Observadores de arquivos criados pela extensão, na ordem em que foram criados. */
  watchers: [] as FakeWatcher[],
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executed: [] as { command: string; args: unknown[] }[],
  panels: [] as FakePanel[],
  serializers: new Map<string, { deserializeWebviewPanel(panel: FakePanel, state: unknown): Promise<void> }>(),
  shown: [] as { path: string; options: unknown }[],
  errors: [] as string[],
  openDialogResult: undefined as Uri[] | undefined,
  workspaceFolders: undefined as { uri: Uri }[] | undefined,
  activeEditor: undefined as { document: { uri: Uri } } | undefined,
  reset() {
    this.commands.clear()
    this.executed.length = 0
    this.panels.length = 0
    this.serializers.clear()
    this.shown.length = 0
    this.errors.length = 0
    this.openDialogResult = undefined
    this.workspaceFolders = undefined
    this.activeEditor = undefined
    this.folderListeners.clear()
    this.watchers.length = 0
  }
}

function createPanel(viewType: string, title: string, viewColumn: number, options: unknown): FakePanel {
  const messageListeners: Listener<unknown>[] = []
  const disposeListeners: (() => void)[] = []
  const panel: FakePanel = {
    viewType,
    title,
    viewColumn,
    disposed: false,
    webview: {
      html: '',
      options,
      cspSource: 'https://fake.vscode-cdn.net',
      posted: [],
      asWebviewUri: (uri) => Object.assign(new Uri(uri.fsPath), { toString: () => `https://file+.vscode-resource.fake.net${uri.fsPath}` }),
      postMessage: async (message) => {
        panel.webview.posted.push(message)
        return true
      },
      onDidReceiveMessage: (listener) => {
        messageListeners.push(listener)
        return { dispose: () => undefined }
      }
    },
    send: (message) => messageListeners.forEach((l) => l(message)),
    reveal: () => undefined,
    dispose: () => {
      if (panel.disposed) return
      panel.disposed = true
      disposeListeners.forEach((l) => l())
    },
    onDidDispose: (listener) => {
      disposeListeners.push(listener)
      return { dispose: () => undefined }
    }
  }
  fake.panels.push(panel)
  return panel
}

export const commands = {
  registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
    fake.commands.set(id, handler)
    return { dispose: () => fake.commands.delete(id) }
  },
  executeCommand: async (command: string, ...args: unknown[]) => void fake.executed.push({ command, args })
}

export const window = {
  createStatusBarItem: () => ({ text: '', command: '', tooltip: '', show: () => undefined, dispose: () => undefined }),
  createWebviewPanel: createPanel,
  registerWebviewPanelSerializer: (viewType: string, serializer: { deserializeWebviewPanel(panel: FakePanel, state: unknown): Promise<void> }) => {
    fake.serializers.set(viewType, serializer)
    return { dispose: () => undefined }
  },
  showOpenDialog: async () => fake.openDialogResult,
  showErrorMessage: async (message: string) => void fake.errors.push(message),
  showTextDocument: async (uri: Uri, options: unknown) => void fake.shown.push({ path: uri.fsPath, options }),
  get activeTextEditor() {
    return fake.activeEditor
  }
}

export const workspace = {
  get workspaceFolders() {
    return fake.workspaceFolders
  },
  onDidChangeWorkspaceFolders: (listener: (event: { added: { uri: Uri }[]; removed: { uri: Uri }[] }) => unknown) => {
    fake.folderListeners.add(listener)
    return { dispose: () => void fake.folderListeners.delete(listener) }
  },
  createFileSystemWatcher: (pattern: string) => {
    const created: ((uri: Uri) => unknown)[] = []
    const watcher: FakeWatcher = {
      pattern,
      disposed: false,
      emitCreate: (uri) => created.forEach((l) => l(uri))
    }
    fake.watchers.push(watcher)
    return {
      onDidCreate: (listener: (uri: Uri) => unknown) => {
        created.push(listener)
        return { dispose: () => undefined }
      },
      onDidChange: () => ({ dispose: () => undefined }),
      onDidDelete: () => ({ dispose: () => undefined }),
      dispose: () => {
        watcher.disposed = true
      }
    }
  },
  fs: {
    stat: async (uri: Uri) => ({ type: statSync(uri.fsPath).isDirectory() ? FileType.Directory : FileType.File })
  }
}

export const env = { language: 'pt-br' }
export const version = '1.90.0-fake'
export const l10n = { t: (message: string) => message }
