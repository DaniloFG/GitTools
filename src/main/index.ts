import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DiffWindowRequest } from '../shared/api'
import { matchLocale, setLocale, t } from '../shared/i18n'
import type { Settings } from '../shared/settings'
import { Backend, type BackendHost } from '../backend/backend'
import { BRIDGE_CHANNELS } from '../shared/channels'
import { GitRepository } from '../core/repository'
import { detectEditors, launchEditor, resolveEditor } from './editors'

// Nome fixo: a pasta de dados (configurações, recentes) é a mesma em desenvolvimento e instalado.
app.setName('GitTools')

let window: BrowserWindow | null = null

/** Envia uma mensagem para todas as janelas (principal e de diff). */
function broadcast(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

const systemLocales = () => [...app.getPreferredSystemLanguages(), app.getLocale()]

/** Aplica no processo principal o que depende das configurações: tema nativo e idioma das mensagens. */
function applySettings(settings: Settings) {
  nativeTheme.themeSource = settings.theme
  setLocale(settings.language === 'system' ? matchLocale(systemLocales()) : settings.language)
}

const host: BackendHost = {
  dataDir: () => app.getPath('userData'),
  homeDir: () => app.getPath('home'),
  documentsDir: () => {
    try {
      return app.getPath('documents')
    } catch {
      return app.getPath('home')
    }
  },
  systemLocales,
  versions: () => ({
    host: 'electron',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`
  }),
  emit: (channel, payload) => broadcast(channel, payload),
  pickFolder: async ({ title, create }) => {
    const result = await dialog.showOpenDialog(window!, { title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  },
  openPath: async (fullPath) => {
    const error = await shell.openPath(fullPath)
    if (error) throw new Error(error)
  },
  openInEditor: async (target, repoRoot, settings) => {
    if (!settings.editor) throw new Error(t('main.noEditor'))
    const command = resolveEditor(settings.editor)
    if (!command) throw new Error(t('main.editorNotFound', { editor: settings.editor }))
    await launchEditor(command, target, repoRoot)
  },
  testEditor: async (setting, target, cwd) => {
    const command = resolveEditor(setting)
    if (!command) throw new Error(t('main.editorNotFound', { editor: setting }))
    await launchEditor(command, target, cwd)
  },
  detectEditors,
  chooseEditor: async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: t('main.chooseEditorTitle'),
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: t('main.programs'), extensions: ['exe', 'cmd', 'bat'] }] } : {})
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  },
  openDiffWindow: (request) => openDiffWindow(request),
  settingsChanged: applySettings,
  repositoryOpened: (info) => window?.setTitle(`${info.name} — GitTools`)
}

const backend = new Backend(host)

function registerIpc() {
  for (const channel of BRIDGE_CHANNELS) ipcMain.handle(channel, (_e, ...args: unknown[]) => backend.invoke(channel, args))
}

/** Carrega a interface numa janela; `query` escolhe o que ela mostra (ex.: só um diff). */
function loadRenderer(target: BrowserWindow, query?: Record<string, string>) {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    void target.loadURL(url.toString())
  } else void target.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
})

/** Janela própria com o diff de um arquivo (pode ir para outro monitor; várias ao mesmo tempo). */
function openDiffWindow(request: DiffWindowRequest) {
  const diff = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 320,
    title: `${request.title ?? request.path} — GitTools`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d23' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  })
  diff.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  loadRenderer(diff, { window: 'diff', request: JSON.stringify(request) })
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    // Mínimo pequeno: os painéis se ajustam (ou podem ser recolhidos) em janelas estreitas.
    minWidth: 640,
    minHeight: 420,
    title: 'GitTools',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d23' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  })
  window.on('focus', () => window?.webContents.send('repo:changed'))
  window.on('closed', () => (window = null))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(window)
}

app.whenReady().then(async () => {
  registerIpc()
  applySettings(await backend.loadSettings())
  // Menu mínimo: mantém copiar/colar (e ferramentas de desenvolvedor só em modo dev);
  // os demais atalhos são tratados pela interface e podem ser personalizados.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      ...(app.isPackaged ? [] : [{ role: 'viewMenu' as const }])
    ])
  )
  // Permite abrir direto um repositório: `gittools /caminho/do/repo`.
  const arg = process.argv
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .map((a) => resolve(a))
    .reverse()
    .find((a) => a !== app.getAppPath() && existsSync(a) && statSync(a).isDirectory())
  if (arg) {
    try {
      await backend.setRepository(await GitRepository.open(arg))
    } catch {
      // Ignora argumentos que não são repositórios.
    }
  }
  createWindow()
  if (backend.repo) window?.setTitle(`${(await backend.repo.info()).name} — GitTools`)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  backend.dispose()
  if (process.platform !== 'darwin') app.quit()
})
