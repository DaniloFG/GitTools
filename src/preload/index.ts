import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { GitToolsBridge } from '../shared/api'

const bridge: GitToolsBridge = {
  openRepository: (path) => ipcRenderer.invoke('app:openRepository', path),
  currentRepository: () => ipcRenderer.invoke('app:currentRepository'),
  initRepository: () => ipcRenderer.invoke('app:initRepository'),
  recentRepositories: () => ipcRenderer.invoke('app:recentRepositories'),
  openFile: (relativePath) => ipcRenderer.invoke('app:openFile', relativePath),
  detectEditors: () => ipcRenderer.invoke('app:detectEditors'),
  chooseEditor: () => ipcRenderer.invoke('app:chooseEditor'),
  openInEditor: (relativePath) => ipcRenderer.invoke('app:openInEditor', relativePath),
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('app:saveSettings', settings),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, factor))),
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('repo:invoke', method, args)) as GitToolsBridge['invoke'],
  onRepositoryChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('repo:changed', handler)
    return () => ipcRenderer.removeListener('repo:changed', handler)
  }
}

contextBridge.exposeInMainWorld('gittools', bridge)
