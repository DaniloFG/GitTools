import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { REPO_METHODS, type AppInfo, type DiffWindowRequest, type RecentRepo, type RepoMethod } from '../shared/api'
import type { GitCommandEntry, GitConfigScope, GitIdentity } from '../shared/types'
import { matchLocale, setLocale, t } from '../shared/i18n'
import { normalizeSettings, type Settings } from '../shared/settings'
import { cloneRepository, getIdentities, setIdentity } from '../core/config'
import { onGitCommand, runGit } from '../core/exec'
import { GitRepository } from '../core/repository'
import { resolveInside } from '../core/paths'
import { detectEditors, launchEditor, resolveEditor } from './editors'

// Nome fixo: a pasta de dados (configurações, recentes) é a mesma em desenvolvimento e instalado.
app.setName('GitTools')

let window: BrowserWindow | null = null
let repo: GitRepository | null = null
let watcher: FSWatcher | null = null

/** Envia uma mensagem para todas as janelas (principal e de diff). */
function broadcast(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

// Log de comandos git em tempo real: guarda os últimos e repassa cada início/fim para a interface.
const GIT_LOG_LIMIT = 500
const gitLog: GitCommandEntry[] = []
onGitCommand((entry) => {
  const index = gitLog.findIndex((e) => e.id === entry.id)
  if (index >= 0) gitLog[index] = entry
  else {
    gitLog.push(entry)
    if (gitLog.length > GIT_LOG_LIMIT) gitLog.splice(0, gitLog.length - GIT_LOG_LIMIT)
  }
  broadcast('git:command', entry)
})

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
    const full = resolveInside(repo.root, relativePath)
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })

  ipcMain.handle('app:detectEditors', () => detectEditors())

  ipcMain.handle('app:chooseEditor', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: t('main.chooseEditorTitle'),
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: t('main.programs'), extensions: ['exe', 'cmd', 'bat'] }] } : {})
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle('app:openInEditor', async (_e, relativePath: string) => {
    if (!repo) throw new Error(t('main.noRepository'))
    // Sempre o caminho absoluto: o editor pode ser iniciado de outra pasta de trabalho.
    const full = resolveInside(repo.root, relativePath)
    const { editor } = await loadSettings()
    if (!editor) throw new Error(t('main.noEditor'))
    const command = resolveEditor(editor)
    if (!command) throw new Error(t('main.editorNotFound', { editor }))
    // Arquivo que só existe em outro commit (ou foi removido) não tem o que abrir no disco.
    if (!existsSync(full)) throw new Error(t('main.fileNotFound', { path: relativePath }))
    await launchEditor(command, full, repo.root)
  })

  ipcMain.handle('app:gitLog', () => gitLog)

  ipcMain.handle('app:openDiffWindow', (_e, request: DiffWindowRequest) => {
    if (!request || typeof request.path !== 'string' || !request.source) throw new Error(t('main.unknownOperation', { method: 'openDiffWindow' }))
    openDiffWindow(request)
  })

  ipcMain.handle('app:chooseFolder', async (_e, title?: string) => {
    const result = await dialog.showOpenDialog(window!, { title: title ?? t('clone.folder'), properties: ['openDirectory', 'createDirectory'] })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })

  ipcMain.handle('app:defaultCloneFolder', () => {
    try {
      return app.getPath('documents')
    } catch {
      return app.getPath('home')
    }
  })

  ipcMain.handle('app:cloneRepository', async (_e, url: string, parent: string, name: string) => {
    const path = await cloneRepository(String(url ?? ''), String(parent ?? ''), String(name ?? ''))
    return setRepository(await GitRepository.open(path))
  })

  ipcMain.handle('app:gitIdentity', () => getIdentities(app.getPath('home'), repo?.root ?? null))

  ipcMain.handle('app:setGitIdentity', (_e, scope: GitConfigScope, identity: GitIdentity) =>
    setIdentity(app.getPath('home'), repo?.root ?? null, scope === 'local' ? 'local' : 'global', {
      name: String(identity?.name ?? ''),
      email: String(identity?.email ?? '')
    })
  )

  // Testa um editor antes de salvar a configuração: abre a pasta do repositório (ou a pasta pessoal).
  ipcMain.handle('app:testEditor', async (_e, setting: string) => {
    const command = resolveEditor(String(setting ?? ''))
    if (!command) throw new Error(t('main.editorNotFound', { editor: setting }))
    // Com repositório aberto, testa o mesmo caminho de "Abrir no editor": um arquivo, por caminho absoluto.
    if (repo) {
      const { stdout } = await runGit(repo.root, ['ls-files', '-z', '--cached'])
      const first = stdout.split('\0').find(Boolean)
      if (first) return launchEditor(command, resolveInside(repo.root, first), repo.root)
    }
    const folder = repo?.root ?? app.getPath('home')
    await launchEditor(command, folder, folder)
  })

  const allowed = new Set<string>(REPO_METHODS)
  ipcMain.handle('repo:invoke', async (_e, method: RepoMethod, args: unknown[]) => {
    if (!allowed.has(method)) throw new Error(t('main.unknownOperation', { method }))
    if (!repo) throw new Error(t('main.noRepository'))
    const fn = repo[method] as (...a: unknown[]) => Promise<unknown>
    return fn.apply(repo, args)
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
