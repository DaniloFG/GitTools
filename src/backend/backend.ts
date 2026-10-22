// Lógica do GitTools que não depende de onde ele roda: repositório aberto, configurações, recentes,
// log de comandos git, remotes, clone… O aplicativo Electron e a extensão do VS Code usam o mesmo
// `Backend`; cada um só fornece o `BackendHost` (diálogos, pastas, abrir arquivos, janelas).

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { REPO_METHODS, type AppInfo, type DiffWindowRequest, type EditorInfo, type RecentRepo, type RepoMethod } from '../shared/api'
import type { GitCommandEntry, GitConfigScope, GitIdentity, RepoInfo } from '../shared/types'
import type { BridgeChannel } from '../shared/channels'
import { t } from '../shared/i18n'
import { normalizeSettings, type Settings } from '../shared/settings'
import { cloneRepository, getIdentities, setIdentity } from '../core/config'
import { onGitCommand, runGit } from '../core/exec'
import { resolveInside } from '../core/paths'
import { GitRepository } from '../core/repository'

/** O que cada ambiente (Electron, VS Code) precisa fornecer. */
export interface BackendHost {
  /** Onde ficam settings.json e recent-repositories.json. */
  dataDir(): string
  homeDir(): string
  /** Pasta sugerida para clonar. */
  documentsDir(): string
  systemLocales(): string[]
  /** Versões mostradas em Configurações → Sobre. */
  versions(): Pick<AppInfo, 'host' | 'version' | 'vscode' | 'electron' | 'chrome' | 'node' | 'platform'>
  /** Avisa a interface (todas as janelas): "git:command" ou "repo:changed". */
  emit(channel: 'git:command' | 'repo:changed', payload?: unknown): void
  /** Pergunta uma pasta ao usuário; null se cancelar. */
  pickFolder(options: { title: string; create?: boolean }): Promise<string | null>
  /** Abre um arquivo com o programa padrão do sistema (ou no editor do ambiente). */
  openPath(fullPath: string): Promise<void>
  /** "Abrir no editor": `target` é sempre um caminho absoluto dentro do repositório (ou o repositório). */
  openInEditor(target: string, repoRoot: string, settings: Settings): Promise<void>
  /** Abre `target` com o editor da configuração `setting`, sem salvá-la (botão Testar). */
  testEditor(setting: string, target: string, cwd: string): Promise<void>
  detectEditors(): EditorInfo[]
  chooseEditor(): Promise<string | null>
  openDiffWindow(request: DiffWindowRequest): void
  /** Chamado ao salvar as configurações (tema nativo, idioma das mensagens…). */
  settingsChanged(settings: Settings): void
  /** Chamado quando o repositório aberto muda (título da janela, por exemplo). */
  repositoryOpened?(info: RepoInfo): void
}

const GIT_LOG_LIMIT = 500

export class Backend {
  repo: GitRepository | null = null
  private watcher: FSWatcher | null = null
  private readonly gitLog: GitCommandEntry[] = []
  private readonly allowed = new Set<string>(REPO_METHODS)
  private stopLog: () => void

  constructor(private readonly host: BackendHost) {
    // Log de comandos git em tempo real: guarda os últimos e repassa cada início/fim para a interface.
    this.stopLog = onGitCommand((entry) => {
      const index = this.gitLog.findIndex((e) => e.id === entry.id)
      if (index >= 0) this.gitLog[index] = entry
      else {
        this.gitLog.push(entry)
        if (this.gitLog.length > GIT_LOG_LIMIT) this.gitLog.splice(0, this.gitLog.length - GIT_LOG_LIMIT)
      }
      this.host.emit('git:command', entry)
    })
  }

  dispose() {
    this.stopLog()
    this.watcher?.close()
    this.watcher = null
  }

  // ------------------------------------------------------------- arquivos de dados

  private recentFile = () => join(this.host.dataDir(), 'recent-repositories.json')
  private settingsFile = () => join(this.host.dataDir(), 'settings.json')

  async loadSettings(): Promise<Settings> {
    try {
      return normalizeSettings(JSON.parse(await readFile(this.settingsFile(), 'utf8')))
    } catch {
      return normalizeSettings({})
    }
  }

  private async loadRecent(): Promise<RecentRepo[]> {
    try {
      return JSON.parse(await readFile(this.recentFile(), 'utf8')) as RecentRepo[]
    } catch {
      return []
    }
  }

  /** Grava a lista: os favoritos ficam sempre; dos demais, só os 15 mais recentes. */
  private async saveRecent(list: RecentRepo[]): Promise<void> {
    let others = 0
    const kept = list.filter((r) => r.favorite || ++others <= 15)
    await mkdir(this.host.dataDir(), { recursive: true })
    await writeFile(this.recentFile(), JSON.stringify(kept, null, 2))
  }

  private async rememberRepo(root: string, name: string): Promise<void> {
    const all = await this.loadRecent()
    const favorite = all.find((r) => r.path === root)?.favorite
    const list = all.filter((r) => r.path !== root)
    list.unshift({ path: root, name, openedAt: Date.now(), ...(favorite ? { favorite } : {}) })
    await this.saveRecent(list)
  }

  private async gitVersion(): Promise<string | null> {
    try {
      const { stdout } = await runGit(this.host.homeDir(), ['--version'])
      return stdout.trim().replace(/^git version /, '')
    } catch {
      return null
    }
  }

  // ------------------------------------------------------------------ repositório

  /** Observa a pasta .git (HEAD, index, refs) para atualizar a interface quando algo muda por fora. */
  private async watchRepository(current: GitRepository): Promise<void> {
    this.watcher?.close()
    this.watcher = null
    let timer: NodeJS.Timeout | null = null
    try {
      const { stdout } = await runGit(current.root, ['rev-parse', '--git-dir'])
      const gitDir = resolve(current.root, stdout.trim())
      this.watcher = watch(gitDir, { recursive: false }, (_event, file) => {
        if (file && /\.lock$/.test(file)) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => this.host.emit('repo:changed'), 250)
      })
    } catch {
      // Sem observação: a interface ainda atualiza ao ganhar foco e após cada operação.
    }
  }

  /** Passa a trabalhar neste repositório (e o guarda entre os recentes). */
  async setRepository(next: GitRepository): Promise<RepoInfo> {
    this.repo = next
    const info = await next.info()
    await this.rememberRepo(info.root, info.name)
    await this.watchRepository(next)
    this.host.repositoryOpened?.(info)
    return info
  }

  // ------------------------------------------------------------------------ canais

  /** Executa o pedido de um canal (`args` na ordem em que a interface os envia). */
  async invoke(channel: BridgeChannel, args: unknown[]): Promise<unknown> {
    const host = this.host
    const repo = this.repo
    switch (channel) {
      case 'app:openRepository': {
        let target = args[0] as string | undefined
        if (!target) {
          target = (await host.pickFolder({ title: t('main.openDialogTitle') })) ?? undefined
          if (!target) return null
        }
        return this.setRepository(await GitRepository.open(target))
      }
      case 'app:initRepository': {
        const folder = await host.pickFolder({ title: t('main.initDialogTitle'), create: true })
        return folder ? this.setRepository(await GitRepository.init(folder)) : null
      }
      case 'app:currentRepository':
        return repo?.info() ?? null
      case 'app:recentRepositories':
        return this.loadRecent()
      case 'app:removeRecentRepository': {
        const path = String(args[0] ?? '')
        return this.saveRecent((await this.loadRecent()).filter((r) => r.path !== path))
      }
      case 'app:setRepositoryFavorite': {
        const path = String(args[0] ?? '')
        const favorite = args[1] === true
        return this.saveRecent(
          (await this.loadRecent()).map((r) => {
            if (r.path !== path) return r
            const { favorite: _old, ...rest } = r
            return favorite ? { ...rest, favorite } : rest
          })
        )
      }
      case 'app:getSettings':
        return this.loadSettings()
      case 'app:saveSettings': {
        const normalized = normalizeSettings(args[0])
        await mkdir(host.dataDir(), { recursive: true })
        await writeFile(this.settingsFile(), JSON.stringify(normalized, null, 2))
        host.settingsChanged(normalized)
        return
      }
      case 'app:info':
        return {
          ...host.versions(),
          git: await this.gitVersion(),
          settingsFile: this.settingsFile(),
          systemLocales: host.systemLocales()
        } satisfies AppInfo
      case 'app:openFile': {
        if (!repo) return
        await host.openPath(resolveInside(repo.root, String(args[0] ?? '')))
        return
      }
      case 'app:detectEditors':
        return host.detectEditors()
      case 'app:chooseEditor':
        return host.chooseEditor()
      case 'app:openInEditor': {
        if (!repo) throw new Error(t('main.noRepository'))
        const relativePath = String(args[0] ?? '')
        // Sempre o caminho absoluto: o editor pode ser iniciado de outra pasta de trabalho.
        const full = resolveInside(repo.root, relativePath)
        // Arquivo que só existe em outro commit (ou foi removido) não tem o que abrir no disco.
        if (relativePath !== '.' && !existsSync(full)) throw new Error(t('main.fileNotFound', { path: relativePath }))
        return host.openInEditor(full, repo.root, await this.loadSettings())
      }
      case 'app:testEditor': {
        const setting = String(args[0] ?? '')
        // Com repositório aberto, testa o mesmo caminho de "Abrir no editor": um arquivo, por caminho absoluto.
        if (repo) {
          const { stdout } = await runGit(repo.root, ['ls-files', '-z', '--cached'])
          const first = stdout.split('\0').find(Boolean)
          if (first) return host.testEditor(setting, resolveInside(repo.root, first), repo.root)
        }
        const folder = repo?.root ?? host.homeDir()
        return host.testEditor(setting, folder, folder)
      }
      case 'app:gitLog':
        return this.gitLog
      case 'app:openDiffWindow': {
        const request = args[0] as DiffWindowRequest
        if (!request || typeof request.path !== 'string' || !request.source) throw new Error(t('main.unknownOperation', { method: 'openDiffWindow' }))
        host.openDiffWindow(request)
        return
      }
      case 'app:chooseFolder':
        return host.pickFolder({ title: (args[0] as string | undefined) ?? t('clone.folder'), create: true })
      case 'app:defaultCloneFolder':
        return host.documentsDir()
      case 'app:cloneRepository': {
        const path = await cloneRepository(String(args[0] ?? ''), String(args[1] ?? ''), String(args[2] ?? ''))
        return this.setRepository(await GitRepository.open(path))
      }
      case 'app:gitIdentity':
        return getIdentities(host.homeDir(), repo?.root ?? null)
      case 'app:setGitIdentity': {
        const scope = args[0] as GitConfigScope
        const identity = args[1] as GitIdentity
        return setIdentity(host.homeDir(), repo?.root ?? null, scope === 'local' ? 'local' : 'global', {
          name: String(identity?.name ?? ''),
          email: String(identity?.email ?? '')
        })
      }
      case 'repo:invoke': {
        const method = args[0] as RepoMethod
        if (!this.allowed.has(method)) throw new Error(t('main.unknownOperation', { method }))
        if (!repo) throw new Error(t('main.noRepository'))
        const fn = repo[method] as (...a: unknown[]) => Promise<unknown>
        return fn.apply(repo, (args[1] as unknown[]) ?? [])
      }
    }
  }
}
