import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { REPO_METHODS, type RecentRepo, type RepoMethod } from '../shared/api'
import { runGit } from '../core/exec'
import { GitRepository } from '../core/repository'

let window: BrowserWindow | null = null
let repo: GitRepository | null = null
let watcher: FSWatcher | null = null

const recentFile = () => join(app.getPath('userData'), 'recent-repositories.json')

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
        title: 'Abrir repositório git',
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return null
      target = result.filePaths[0]
    }
    return setRepository(await GitRepository.open(target))
  })

  ipcMain.handle('app:initRepository', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Criar repositório git nesta pasta',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return setRepository(await GitRepository.init(result.filePaths[0]))
  })

  ipcMain.handle('app:currentRepository', () => repo?.info() ?? null)

  ipcMain.handle('app:recentRepositories', () => loadRecent())

  ipcMain.handle('app:openFile', async (_e, relativePath: string) => {
    if (!repo) return
    const full = resolve(repo.root, relativePath)
    if (!full.startsWith(repo.root + sep)) throw new Error('Caminho fora do repositório.')
    const error = await shell.openPath(full)
    if (error) throw new Error(error)
  })

  const allowed = new Set<string>(REPO_METHODS)
  ipcMain.handle('repo:invoke', async (_e, method: RepoMethod, args: unknown[]) => {
    if (!allowed.has(method)) throw new Error(`Operação desconhecida: ${method}`)
    if (!repo) throw new Error('Nenhum repositório aberto.')
    const fn = repo[method] as (...a: unknown[]) => Promise<unknown>
    return fn.apply(repo, args)
  })
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'GitTools',
    backgroundColor: '#1b1d23',
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
