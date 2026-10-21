import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { REPO_METHODS, type AppInfo, type RecentRepo, type RepoMethod } from '../shared/api'
import { matchLocale, setLocale, t } from '../shared/i18n'
import { normalizeSettings, type Settings } from '../shared/settings'
import { runGit } from '../core/exec'
import { GitRepository } from '../core/repository'

// Nome fixo: a pasta de dados (configurações, recentes) é a mesma em desenvolvimento e instalado.
app.setName('GitTools')

let window: BrowserWindow | null = null
let repo: GitRepository | null = null
let watcher: FSWatcher | null = null

const recentFile = () => join(app.getPath('userData'), 'recent-repositories.json')
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<Settings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsFile(), 'utf8')))
  } catch {
    return normalizeSettings({})
  }
}

const systemLocales = () => [...app.getPreferredSystemLanguages(), app.getLocale()]

/** Aplica no processo principal o que depende das configurações: tema nativo e idioma das mensagens. */
function applySettings(settings: Settings) {
  nativeTheme.themeSource = settings.theme
  setLocale(settings.language === 'system' ? matchLocale(systemLocales()) : settings.language)
}

async function gitVersion(): Promise<string | null> {
  try {
    const { stdout } = await runGit(app.getPath('home'), ['--version'])
    return stdout.trim().replace(/^git version /, '')
  } catch {
    return null
  }
}

async function loadRecent(): Promise<RecentRepo[]> {
  try {
    return JSON.parse(await readFile(recentFile(), 'utf8')) as RecentRepo[]
  } catch {
    return []
  }
}

async function rememberRepo(root: string, name: string): Promise<void> {
  const list = (await loadRecent()).filter((r) => r.path !== root)
  list.unshift({ path: root, name, openedAt: Date.now() })
  await writeFile(recentFile(), JSON.stringify(list.slice(0, 15), null, 2))
}

/** Observa a pasta .git (HEAD, index, refs) para atualizar a interface quando algo muda por fora. */
async function watchRepository(current: GitRepository): Promise<void> {
  watcher?.close()
  watcher = null
  let timer: NodeJS.Timeout | null = null
  try {
    const { stdout } = await runGit(current.root, ['rev-parse', '--git-dir'])
    const gitDir = resolve(current.root, stdout.trim())
    watcher = watch(gitDir, { recursive: false }, (_event, file) => {
      if (file && /\.lock$/.test(file)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => window?.webContents.send('repo:changed'), 250)
    })
  } catch {
    // Sem observação: a interface ainda atualiza ao ganhar foco e após cada operação.
  }
}

async function setRepository(next: GitRepository) {
  repo = next
  const info = await next.info()
  await rememberRepo(info.root, info.name)
  await watchRepository(next)
  window?.setTitle(`${info.name} — GitTools`)
  return info
}

function registerIpc() {
  ipcMain.handle('app:openRepository', async (_e, path?: string) => {
    let target = path
    if (!target) {
      const result = await dialog.showOpenDialog(window!, {
        title: t('main.openDialogTitle'),
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return null
      target = result.filePaths[0]
    }
    return setRepository(await GitRepository.open(target))
  })

  ipcMain.handle('app:initRepository', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: t('main.initDialogTitle'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return setRepository(await GitRepository.init(result.filePaths[0]))
  })

  ipcMain.handle('app:getSettings', () => loadSettings())

  ipcMain.handle('app:saveSettings', async (_e, settings: unknown) => {
    const normalized = normalizeSettings(settings)
    await writeFile(settingsFile(), JSON.stringify(normalized, null, 2))
    applySettings(normalized)
  })

  ipcMain.handle(
    'app:info',
    async (): Promise<AppInfo> => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      git: await gitVersion(),
      settingsFile: settingsFile(),
      systemLocales: systemLocales()
    })
  )

  ipcMain.handle('app:currentRepository', () => repo?.info() ?? null)

  ipcMain.handle('app:recentRepositories', () => loadRecent())

  ipcMain.handle('app:openFile', async (_e, relativePath: string) => {
    if (!repo) return
    const full = resolve(repo.root, relativePath)
    if (!full.startsWith(repo.root + sep) && full !== repo.root) throw new Error(t('main.outsideRepository'))
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })

  const allowed = new Set<string>(REPO_METHODS)
  ipcMain.handle('repo:invoke', async (_e, method: RepoMethod, args: unknown[]) => {
    if (!allowed.has(method)) throw new Error(t('main.unknownOperation', { method }))
    if (!repo) throw new Error(t('main.noRepository'))
    const fn = repo[method] as (...a: unknown[]) => Promise<unknown>
    return fn.apply(repo, args)
  })
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  window.on('focus', () => window?.webContents.send('repo:changed'))
  window.on('closed', () => (window = null))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  registerIpc()
  applySettings(await loadSettings())
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
      await setRepository(await GitRepository.open(arg))
    } catch {
      // Ignora argumentos que não são repositórios.
    }
  }
  createWindow()
  if (repo) window?.setTitle(`${(await repo.info()).name} — GitTools`)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher?.close()
  if (process.platform !== 'darwin') app.quit()
})
