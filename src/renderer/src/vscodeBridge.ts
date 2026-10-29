// Ponte da interface quando ela roda num webview do VS Code (extensão GitTools): faz o papel do
// preload do Electron, enviando cada pedido à extensão com postMessage e esperando a resposta.

import type { GitToolsBridge } from '../../shared/api'
import type { BridgeChannel, HostToWebview, WebviewRequest } from '../../shared/channels'
import type { GitCommandEntry } from '../../shared/types'

interface VsCodeApi {
  postMessage(message: unknown): void
}
declare const acquireVsCodeApi: (() => VsCodeApi) | undefined

/** Dados que a extensão deixa na página ao criá-la (ex.: o que a janela de diff deve mostrar). */
declare global {
  interface Window {
    __gittoolsBoot?: { search?: string }
  }
}

let api: VsCodeApi | null = null

/** A interface está dentro do VS Code? */
export const insideVsCode = () => typeof acquireVsCodeApi === 'function'

/** Tema do VS Code (claro/escuro) lido das classes que ele coloca no body do webview. */
export function vsCodeTheme(): 'dark' | 'light' | null {
  if (!insideVsCode()) return null
  const body = document.body.classList
  return body.contains('vscode-light') || body.contains('vscode-high-contrast-light') ? 'light' : 'dark'
}

/** Fecha o painel deste webview (a janela de diff); false fora do VS Code. */
export function closeVsCodePanel(): boolean {
  if (!api) return false
  api.postMessage({ type: 'close' })
  return true
}

/** Instala `window.gittools` com as mesmas funções do preload; não faz nada fora do VS Code. */
export function installVsCodeBridge(): boolean {
  if (!insideVsCode() || (window as { gittools?: unknown }).gittools) return false
  api = acquireVsCodeApi!()
  const host = api
  let nextId = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const commandListeners = new Set<(entry: GitCommandEntry) => void>()
  const changeListeners = new Set<() => void>()

  window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.type === 'response') {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      if (message.ok) waiting.resolve(message.result)
      else waiting.reject(new Error(message.error))
    } else if (message.type === 'event') {
      if (message.channel === 'git:command') commandListeners.forEach((l) => l(message.payload as GitCommandEntry))
      else changeListeners.forEach((l) => l())
    }
  })
  // O painel voltou a ser mostrado ou ganhou o foco: o repositório pode ter mudado por fora.
  const refresh = () => document.visibilityState !== 'hidden' && changeListeners.forEach((l) => l())
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)

  const call = (channel: BridgeChannel, ...args: unknown[]) =>
    new Promise<never>((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const request: WebviewRequest = { type: 'request', id, channel, args }
      host.postMessage(request)
    })

  const bridge: GitToolsBridge = {
    openRepository: (path) => call('app:openRepository', path),
    currentRepository: () => call('app:currentRepository'),
    initRepository: () => call('app:initRepository'),
    recentRepositories: () => call('app:recentRepositories'),
    removeRecentRepository: (path) => call('app:removeRecentRepository', path),
    setRepositoryFavorite: (path, favorite) => call('app:setRepositoryFavorite', path, favorite),
    openFile: (relativePath) => call('app:openFile', relativePath),
    detectEditors: () => call('app:detectEditors'),
    chooseEditor: () => call('app:chooseEditor'),
    openInEditor: (relativePath) => call('app:openInEditor', relativePath),
    testEditor: (setting) => call('app:testEditor', setting),
    getSettings: () => call('app:getSettings'),
    saveSettings: (settings) => call('app:saveSettings', settings),
    appInfo: () => call('app:info'),
    gitLog: () => call('app:gitLog'),
    onGitCommand: (listener) => {
      commandListeners.add(listener)
      return () => void commandListeners.delete(listener)
    },
    openDiffWindow: (request) => call('app:openDiffWindow', request),
    chooseFolder: (title) => call('app:chooseFolder', title),
    defaultCloneFolder: () => call('app:defaultCloneFolder'),
    cloneRepository: (url, parent, name) => call('app:cloneRepository', url, parent, name),
    gitIdentity: () => call('app:gitIdentity'),
    setGitIdentity: (scope, identity) => call('app:setGitIdentity', scope, identity),
    runGitCommand: (commandLine) => call('app:runGit', commandLine),
    // O zoom do webview segue o do VS Code.
    setZoom: () => undefined,
    invoke: ((method: string, ...args: unknown[]) => call('repo:invoke', method, args)) as GitToolsBridge['invoke'],
    onRepositoryChanged: (listener) => {
      changeListeners.add(listener)
      return () => void changeListeners.delete(listener)
    }
  }
  ;(window as { gittools?: GitToolsBridge }).gittools = bridge
  return true
}
