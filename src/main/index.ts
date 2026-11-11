import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DiffWindowRequest } from '../shared/api'
import { changeLocale, jsonCatalogLoader, matchLocale, setCatalogLoader, t } from '../shared/i18n'
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
  // Carrega o catálogo (JSON ao lado do pacote, leitura assíncrona) e só então troca; até lá vale o anterior.
  void changeLocale(settings.language === 'system' ? matchLocale(systemLocales()) : settings.language)
}

// Catálogos de idioma: um JSON por idioma em out/main/locales, gerado pelo build (ver electron.vite.config.ts).
setCatalogLoader(jsonCatalogLoader((name) => readFile(join(__dirname, 'locales', name), 'utf8')))

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

/**
 * Termina quando a abertura acabou: sessão anterior reaberta e o repositório da linha de comando (se houver)
 * aberto e ativo. A janela é criada antes disso, então a interface pode pedir dados enquanto o git ainda
 * responde; os pedidos esperam esta promessa em vez de ver a lista sem o repositório da linha de comando.
 * Nunca falha: um erro da reabertura reaparece no próprio pedido, como antes (`restoreWorkspace`).
 */
let startupDone: Promise<void> = Promise.resolve()

function registerIpc() {
  for (const channel of BRIDGE_CHANNELS)
    ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
      await startupDone
      return backend.invoke(channel, args)
    })
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

// As configurações começam a ser lidas já, enquanto o Electron inicia. A janela depende delas só pela cor de
// fundo (`nativeTheme.shouldUseDarkColors` segue `themeSource`, que vem do tema salvo; tamanho e posição não
// são salvos), e é um arquivo só: medido, a resposta chega ~8 ms depois do `ready` e `applySettings` leva
// ~1 ms. Vale esperar por isso para não piscar a cor errada; o que custa processos git fica para depois.
const settingsRead = backend.loadSettings()

/** Caminho da linha de comando (`gittools /caminho/do/repo`), se for uma pasta. */
function pathFromArgs(): string | undefined {
  return process.argv
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .map((a) => resolve(a))
    .reverse()
    .find((a) => a !== app.getAppPath() && existsSync(a) && statSync(a).isDirectory())
}

/** Reabre a sessão anterior e abre o repositório da linha de comando, já com a janela carregando. */
async function openAtStartup(arg: string | undefined): Promise<void> {
  // Começa a reabrir a sessão agora, junto com o carregamento da interface (antes só começava no primeiro
  // pedido dela). O resultado é o mesmo: `setRepository` espera a reabertura antes de pôr o da linha de
  // comando no fim das abas e torná-lo ativo.
  const restoring = backend.restoreWorkspace().catch(() => undefined)
  if (arg) {
    try {
      await backend.setRepository(await GitRepository.open(arg))
    } catch {
      // Ignora argumentos que não são repositórios.
    }
  }
  await restoring
}

app.whenReady().then(async () => {
  registerIpc()
  applySettings(await settingsRead)
  // Menu mínimo: mantém copiar/colar (e ferramentas de desenvolvedor só em modo dev);
  // os demais atalhos são tratados pela interface e podem ser personalizados.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      ...(app.isPackaged ? [] : [{ role: 'viewMenu' as const }])
    ])
  )
  // A janela vem primeiro: abrir um processo git já custa tempo do processo principal (medido: com um
  // caminho na linha de comando, a janela saía 35–60 ms depois do `ready` quando o git era chamado antes
  // dela). A abertura dos repositórios corre junto com o carregamento da interface. `startupDone` é
  // atribuído no mesmo passo síncrono, antes de qualquer pedido da interface poder chegar. O título com o
  // nome do repositório vem de `repositoryOpened`, que já encontra a janela criada.
  createWindow()
  startupDone = openAtStartup(pathFromArgs())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  backend.dispose()
  if (process.platform !== 'darwin') app.quit()
})
