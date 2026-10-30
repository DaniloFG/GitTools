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

/** Estado observável pelo teste. */
export const fake = {
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
  fs: {
    stat: async (uri: Uri) => ({ type: statSync(uri.fsPath).isDirectory() ? FileType.Directory : FileType.File })
  }
}

export const env = { language: 'pt-br' }
export const version = '1.90.0-fake'
export const l10n = { t: (message: string) => message }
