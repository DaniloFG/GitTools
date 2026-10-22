import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { GitToolsBridge } from '../shared/api'

const bridge: GitToolsBridge = {
  openRepository: (path) => ipcRenderer.invoke('app:openRepository', path),
  currentRepository: () => ipcRenderer.invoke('app:currentRepository'),
  initRepository: () => ipcRenderer.invoke('app:initRepository'),
  recentRepositories: () => ipcRenderer.invoke('app:recentRepositories'),
  removeRecentRepository: (path) => ipcRenderer.invoke('app:removeRecentRepository', path),
  setRepositoryFavorite: (path, favorite) => ipcRenderer.invoke('app:setRepositoryFavorite', path, favorite),
  openFile: (relativePath) => ipcRenderer.invoke('app:openFile', relativePath),
  detectEditors: () => ipcRenderer.invoke('app:detectEditors'),
  chooseEditor: () => ipcRenderer.invoke('app:chooseEditor'),
  openInEditor: (relativePath) => ipcRenderer.invoke('app:openInEditor', relativePath),
  testEditor: (setting) => ipcRenderer.invoke('app:testEditor', setting),
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
  gitIdentity: () => ipcRenderer.invoke('app:gitIdentity'),
  setGitIdentity: (scope, identity) => ipcRenderer.invoke('app:setGitIdentity', scope, identity),
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('repo:invoke', method, args)) as GitToolsBridge['invoke'],
  onRepositoryChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('repo:changed', handler)
    return () => ipcRenderer.removeListener('repo:changed', handler)
  }
}

contextBridge.exposeInMainWorld('gittools', bridge)
