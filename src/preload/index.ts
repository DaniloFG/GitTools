import { contextBridge, ipcRenderer } from 'electron'
import type { GitToolsBridge } from '../shared/api'

const bridge: GitToolsBridge = {
  openRepository: (path) => ipcRenderer.invoke('app:openRepository', path),
  currentRepository: () => ipcRenderer.invoke('app:currentRepository'),
  initRepository: () => ipcRenderer.invoke('app:initRepository'),
  recentRepositories: () => ipcRenderer.invoke('app:recentRepositories'),
  openFile: (relativePath) => ipcRenderer.invoke('app:openFile', relativePath),
  invoke: ((method: string, ...args: unknown[]) => ipcRenderer.invoke('repo:invoke', method, args)) as GitToolsBridge['invoke'],
  onRepositoryChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('repo:changed', handler)
    return () => ipcRenderer.removeListener('repo:changed', handler)
  }
}

contextBridge.exposeInMainWorld('gittools', bridge)
