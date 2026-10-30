import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { GitToolsBridge } from '../shared/api'

const bridge: GitToolsBridge = {
  openRepository: (path) => ipcRenderer.invoke('app:openRepository', path),
  openRepositories: () => ipcRenderer.invoke('app:openRepositories'),
  switchRepository: (root) => ipcRenderer.invoke('app:switchRepository', root),
  closeRepository: (root) => ipcRenderer.invoke('app:closeRepository', root),
  cherryPickAcross: (sourceRoot, targetRoot, shas, options) => ipcRenderer.invoke('app:cherryPickAcross', sourceRoot, targetRoot, shas, options),
  applyAcross: (sourceRoot, targetRoot, request) => ipcRenderer.invoke('app:applyAcross', sourceRoot, targetRoot, request),
  currentRepository: () => ipcRenderer.invoke('app:currentRepository'),
  initRepository: () => ipcRenderer.invoke('app:initRepository'),
  recentRepositories: () => ipcRenderer.invoke('app:recentRepositories'),
  removeRecentRepository: (path) => ipcRenderer.invoke('app:removeRecentRepository', path),
  setRepositoryFavorite: (path, favorite) => ipcRenderer.invoke('app:setRepositoryFavorite', path, favorite),
  openFile: (relativePath, root) => ipcRenderer.invoke('app:openFile', relativePath, root),
  detectEditors: () => ipcRenderer.invoke('app:detectEditors'),
  chooseEditor: () => ipcRenderer.invoke('app:chooseEditor'),
  openInEditor: (relativePath, root) => ipcRenderer.invoke('app:openInEditor', relativePath, root),
  testEditor: (setting, root) => ipcRenderer.invoke('app:testEditor', setting, root),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('app:saveSettings', settings),
  appInfo: () => ipcRenderer.invoke('app:info'),
  gitLog: () => ipcRenderer.invoke('app:gitLog'),
  onGitCommand: (listener) => {
    const handler = (_e: unknown, entry: Parameters<typeof listener>[0]) => listener(entry)
    ipcRenderer.on('git:command', handler)
    return () => ipcRenderer.removeListener('git:command', handler)
  },
  openDiffWindow: (request) => ipcRenderer.invoke('app:openDiffWindow', request),
  chooseFolder: (title) => ipcRenderer.invoke('app:chooseFolder', title),
  defaultCloneFolder: () => ipcRenderer.invoke('app:defaultCloneFolder'),
  cloneRepository: (url, parent, name) => ipcRenderer.invoke('app:cloneRepository', url, parent, name),
  gitIdentity: (root) => ipcRenderer.invoke('app:gitIdentity', root),
  setGitIdentity: (scope, identity, root) => ipcRenderer.invoke('app:setGitIdentity', scope, identity, root),
  runGitCommand: (commandLine, root) => ipcRenderer.invoke('app:runGit', commandLine, root),
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('repo:invoke', method, args)) as GitToolsBridge['invoke'],
  invokeOn: ((root: string, method: string, ...args: unknown[]) =>
    ipcRenderer.invoke('repo:invoke', method, args, root)) as GitToolsBridge['invokeOn'],
  onRepositoryChanged: (listener) => {
    // O watcher manda `{ root }`; o aviso de foco da janela não manda nada.
    const handler = (_e: unknown, payload?: { root?: string }) => listener(payload?.root)
    ipcRenderer.on('repo:changed', handler)
    return () => ipcRenderer.removeListener('repo:changed', handler)
  }
}

contextBridge.exposeInMainWorld('gittools', bridge)
