// Lógica do GitTools que não depende de onde ele roda: repositórios abertos, configurações, recentes,
// log de comandos git, remotes, clone… O aplicativo Electron e a extensão do VS Code usam o mesmo
// `Backend`; cada um só fornece o `BackendHost` (diálogos, pastas, abrir arquivos, janelas).
//
// Vários repositórios podem estar abertos ao mesmo tempo. Um é o ativo (`activeRoot`), que a interface
// mostra; os pedidos aceitam um `root` para falar com qualquer um dos abertos. A lista aberta e o ativo
// ficam em workspace.json, para reabrir na próxima vez.

import { existsSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { REPO_METHODS, type AppInfo, type DiffWindowRequest, type EditorInfo, type RecentRepo, type RepoMethod } from '../shared/api'
import type { CherryPickOptions, CrossApply, GitCommandEntry, GitConfigScope, GitIdentity, OpenRepositories, OperationResult, RepoInfo } from '../shared/types'
import type { BridgeChannel } from '../shared/channels'
import { t } from '../shared/i18n'
import { normalizeSettings, type Settings } from '../shared/settings'
import { cloneRepository, getIdentities, setIdentity } from '../core/config'
import { onGitCommand, runGit } from '../core/exec'
import { comparablePath, resolveInside } from '../core/paths'
import { GitRepository } from '../core/repository'
import { runTerminalCommand } from '../core/terminal'

/** O que cada ambiente (Electron, VS Code) precisa fornecer. */
export interface BackendHost {
  /** Onde ficam settings.json, recent-repositories.json e workspace.json. */
  dataDir(): string
  homeDir(): string
  /** Pasta sugerida para clonar. */
  documentsDir(): string
  systemLocales(): string[]
  /** Versões mostradas em Configurações → Sobre. */
  versions(): Pick<AppInfo, 'host' | 'version' | 'vscode' | 'electron' | 'chrome' | 'node' | 'platform'>
  /**
   * Avisa a interface (todas as janelas): "git:command", ou "repo:changed" com `{ root }` do repositório
   * que mudou.
   */
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
  /** Chamado quando o repositório ativo muda (título da janela, por exemplo). */
  repositoryOpened?(info: RepoInfo): void
}

/** Repositórios abertos gravados em workspace.json. */
interface WorkspaceFile {
  /** Caminhos (root) na ordem em que foram abertos. */
  repos: string[]
  /** Root do ativo. */
  active: string | null
}

const GIT_LOG_LIMIT = 500

export class Backend {
  /** Repositórios abertos nesta sessão, pelo root de cada um. */
  readonly repos = new Map<string, GitRepository>()
  /** Root do repositório ativo (o que a interface mostra), ou null. */
  activeRoot: string | null = null
  private readonly watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>()
  private readonly gitLog: GitCommandEntry[] = []
  private readonly allowed = new Set<string>(REPO_METHODS)
  private stopLog: () => void
  /** Reabertura dos repositórios da última sessão: feita uma vez, na primeira chamada. */
  private restoring: Promise<void> | null = null
  /** Gravações de workspace.json em fila, na ordem em que foram pedidas. */
  private saving: Promise<void> = Promise.resolve()

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
    for (const root of [...this.watchers.keys()]) this.unwatch(root)
  }

  /** Repositório ativo, ou null se nenhum está aberto. */
  get repo(): GitRepository | null {
    return this.activeRoot === null ? null : (this.repos.get(this.activeRoot) ?? null)
  }

  // ------------------------------------------------------------- arquivos de dados

  private recentFile = () => join(this.host.dataDir(), 'recent-repositories.json')
  private settingsFile = () => join(this.host.dataDir(), 'settings.json')
  private workspaceFile = () => join(this.host.dataDir(), 'workspace.json')

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

  /** Lê workspace.json. Arquivo ausente ou corrompido vira "nada aberto", sem erro. */
  private async loadWorkspace(): Promise<WorkspaceFile> {
    try {
      const data = JSON.parse(await readFile(this.workspaceFile(), 'utf8')) as Partial<WorkspaceFile> | null
      const repos = Array.isArray(data?.repos) ? data.repos.filter((p): p is string => typeof p === 'string' && p.length > 0) : []
      return { repos, active: typeof data?.active === 'string' ? data.active : null }
    } catch {
      return { repos: [], active: null }
    }
  }

  /** Grava a lista aberta e o ativo. As gravações saem em fila; falha de disco não interrompe o pedido. */
  private saveWorkspace(): Promise<void> {
    const file: WorkspaceFile = { repos: [...this.repos.keys()], active: this.activeRoot }
    this.saving = this.saving
      .then(async () => {
        await mkdir(this.host.dataDir(), { recursive: true })
        await writeFile(this.workspaceFile(), JSON.stringify(file, null, 2))
      })
      .catch(() => undefined)
    return this.saving
  }

  private async gitVersion(): Promise<string | null> {
    try {
      const { stdout } = await runGit(this.host.homeDir(), ['--version'])
      return stdout.trim().replace(/^git version /, '')
    } catch {
      return null
    }
  }

  // ------------------------------------------------------------------ repositórios

  /**
   * Reabre os repositórios da última sessão que ainda existem (uma vez só). Os que sumiram, ou que não
   * são mais repositórios, saem da lista sem aviso.
   */
  restoreWorkspace(): Promise<void> {
    this.restoring ??= this.reopenSaved()
    return this.restoring
  }

  private async reopenSaved(): Promise<void> {
    const saved = await this.loadWorkspace()
    for (const path of saved.repos) {
      try {
        await this.adopt(await GitRepository.open(path))
      } catch {
        // A pasta sumiu ou deixou de ser um repositório: descarta sem avisar.
      }
    }
    if (this.activeRoot === null && saved.active !== null) this.activeRoot = this.keyOf(saved.active)
    if (this.activeRoot === null) this.activeRoot = this.repos.keys().next().value ?? null
    if (this.activeRoot !== null) this.host.repositoryOpened?.(await this.repos.get(this.activeRoot)!.info())
    if (saved.repos.length > 0) await this.saveWorkspace()
  }

  /** Inclui o repositório na sessão e começa a observá-lo. Se ele já está aberto, não duplica: devolve a chave existente. */
  private async adopt(repo: GitRepository): Promise<string> {
    const existing = this.keyOf(repo.root)
    if (existing !== null) return existing
    this.repos.set(repo.root, repo)
    await this.watchRepository(repo.root)
    return repo.root
  }

  /** Root de um repositório já aberto que corresponde a este caminho; null se não está aberto. */
  private keyOf(path: string): string | null {
    if (!path) return null
    const wanted = comparablePath(path)
    for (const root of this.repos.keys()) if (comparablePath(root) === wanted) return root
    return null
  }

  /** Repositório aberto com este caminho. Erro claro se não estiver aberto (nunca cai no ativo). */
  private requireRepo(root: string): GitRepository {
    const key = this.keyOf(root)
    if (key === null) throw new Error(t('multiRepo.notOpen', { root }))
    return this.repos.get(key)!
  }

  /** Repositório pedido por `root`; sem `root`, o ativo (null se não há nenhum). */
  private repoAt(root: unknown): GitRepository | null {
    if (root === undefined || root === null) return this.repo
    return this.requireRepo(String(root))
  }

  /** Torna ativo um repositório já aberto (e avisa o ambiente). */
  private async setActive(root: string): Promise<RepoInfo> {
    this.activeRoot = root
    const info = await this.repos.get(root)!.info()
    this.host.repositoryOpened?.(info)
    return info
  }

  /** Observa a pasta .git do repositório (HEAD, index, refs) para atualizar a interface quando algo muda por fora. */
  private async watchRepository(root: string): Promise<void> {
    this.unwatch(root)
    try {
      const { stdout } = await runGit(root, ['rev-parse', '--git-dir'])
      // Fechado (ou já observado) enquanto o git respondia: não cria o observador.
      if (!this.repos.has(root) || this.watchers.has(root)) return
      const watcher = watch(resolve(root, stdout.trim()), { recursive: false }, (_event, file) => this.onGitChange(root, file))
      watcher.on('error', () => {
        if (this.watchers.get(root)?.watcher === watcher) this.unwatch(root)
      })
      this.watchers.set(root, { watcher, timer: null })
    } catch {
      // Sem observação: a interface ainda atualiza ao ganhar foco e após cada operação.
    }
  }

  /** Mudança na pasta .git de `root`: avisa a interface depois de um intervalo (as rajadas viram um aviso só). */
  private onGitChange(root: string, file: string | null) {
    if (file && /\.lock$/.test(file)) return
    const entry = this.watchers.get(root)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      this.host.emit('repo:changed', { root })
    }, 250)
  }

  /** Para de observar um repositório (e o aviso pendente, se houver). */
  private unwatch(root: string) {
    const entry = this.watchers.get(root)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    this.watchers.delete(root)
  }

  /** Abre o repositório, ou só o ativa se já estiver aberto, e o guarda entre os recentes. */
  async setRepository(next: GitRepository): Promise<RepoInfo> {
    await this.restoreWorkspace()
    const root = await this.adopt(next)
    const info = await this.setActive(root)
    await this.rememberRepo(info.root, info.name)
    await this.saveWorkspace()
    return info
  }

  /** Repositórios abertos nesta sessão e o ativo. */
  async openRepositories(): Promise<OpenRepositories> {
    await this.restoreWorkspace()
    const repos = await Promise.all([...this.repos.values()].map((repo) => repo.info()))
    return { repos, active: this.activeRoot }
  }

  /** Torna ativo um repositório já aberto. */
  async switchRepository(root: string): Promise<RepoInfo> {
    await this.restoreWorkspace()
    const info = await this.setActive(this.requireRepo(root).root)
    await this.saveWorkspace()
    return info
  }

  /**
   * Fecha o repositório só nesta sessão (nada é apagado em disco). Se ele era o ativo, ativa o vizinho:
   * o da direita, como as abas do navegador, ou o da esquerda; sem vizinho, não há ativo.
   */
  async closeRepository(root: string): Promise<OpenRepositories> {
    await this.restoreWorkspace()
    const key = this.requireRepo(root).root
    const roots = [...this.repos.keys()]
    const index = roots.indexOf(key)
    this.unwatch(key)
    this.repos.delete(key)
    if (this.activeRoot === key) {
      const neighbor = index + 1 < roots.length ? roots[index + 1] : index > 0 ? roots[index - 1] : null
      this.activeRoot = null
      if (neighbor !== null) await this.setActive(neighbor)
    }
    await this.saveWorkspace()
    return this.openRepositories()
  }

  /** Traz commits de outro repositório aberto e os aplica na branch atual do destino (ambos abertos e diferentes). */
  async cherryPickAcross(sourceRoot: string, targetRoot: string, shas: string[], options?: CherryPickOptions): Promise<OperationResult> {
    await this.restoreWorkspace()
    const source = this.requireRepo(sourceRoot)
    const target = this.requireRepo(targetRoot)
    if (source === target) throw new Error(t('multiRepo.sameRepository'))
    return target.cherryPickFrom(source.root, shas, options)
  }

  /** Traz commits, arquivos ou linhas de outro repositório aberto para a branch atual do destino. */
  async applyAcross(sourceRoot: string, targetRoot: string, request: CrossApply): Promise<OperationResult> {
    await this.restoreWorkspace()
    const source = this.requireRepo(sourceRoot)
    const target = this.requireRepo(targetRoot)
    if (source === target) throw new Error(t('multiRepo.sameRepository'))
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])
    switch (request?.kind) {
      case 'commits':
        return target.cherryPickFrom(source.root, strings(request.shas), request.options)
      case 'files':
        return target.cherryPickFilesFrom(source.root, strings(request.shas), strings(request.paths), request.mode === 'version' ? 'version' : 'changes', request.options)
      case 'lines':
        return target.cherryPickLinesFrom(source.root, request.source, String(request.path ?? ''), Array.isArray(request.lines) ? request.lines : [], request.options)
      default:
        throw new Error(t('multiRepo.invalidRequest'))
    }
  }

  // ------------------------------------------------------------------------ canais

  /** Executa o pedido de um canal (`args` na ordem em que a interface os envia). */
  async invoke(channel: BridgeChannel, args: unknown[]): Promise<unknown> {
    const host = this.host
    await this.restoreWorkspace()
    switch (channel) {
      case 'app:openRepository': {
        let target = args[0] as string | undefined
        if (!target) {
          target = (await host.pickFolder({ title: t('main.openDialogTitle') })) ?? undefined
          if (!target) return null
        }
        return this.setRepository(await GitRepository.open(target))
      }
      case 'app:openRepositories':
        return this.openRepositories()
      case 'app:switchRepository':
        return this.switchRepository(String(args[0] ?? ''))
      case 'app:closeRepository':
        return this.closeRepository(String(args[0] ?? ''))
      case 'app:cherryPickAcross':
        return this.cherryPickAcross(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          Array.isArray(args[2]) ? args[2].map(String) : [],
          args[3] as CherryPickOptions | undefined
        )
      case 'app:applyAcross':
        return this.applyAcross(String(args[0] ?? ''), String(args[1] ?? ''), args[2] as CrossApply)
      case 'app:initRepository': {
        const folder = await host.pickFolder({ title: t('main.initDialogTitle'), create: true })
        return folder ? this.setRepository(await GitRepository.init(folder)) : null
      }
      case 'app:currentRepository':
        return this.repo?.info() ?? null
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
        // Argumentos: [caminho relativo, root?]
        const repo = this.repoAt(args[1])
        if (!repo) return
        await host.openPath(resolveInside(repo.root, String(args[0] ?? '')))
        return
      }
      case 'app:detectEditors':
        return host.detectEditors()
      case 'app:chooseEditor':
        return host.chooseEditor()
      case 'app:openInEditor': {
        // Argumentos: [caminho relativo, root?]
        const repo = this.repoAt(args[1])
        if (!repo) throw new Error(t('main.noRepository'))
        const relativePath = String(args[0] ?? '')
        // Sempre o caminho absoluto: o editor pode ser iniciado de outra pasta de trabalho.
        const full = resolveInside(repo.root, relativePath)
        // Arquivo que só existe em outro commit (ou foi removido) não tem o que abrir no disco.
        if (relativePath !== '.' && !existsSync(full)) throw new Error(t('main.fileNotFound', { path: relativePath }))
        return host.openInEditor(full, repo.root, await this.loadSettings())
      }
      case 'app:testEditor': {
        // Argumentos: [configuração, root?]
        const setting = String(args[0] ?? '')
        // Com repositório aberto, testa o mesmo caminho de "Abrir no editor": um arquivo, por caminho absoluto.
        const repo = this.repoAt(args[1])
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
        // Argumentos: [root?]
        return getIdentities(host.homeDir(), this.repoAt(args[0])?.root ?? null)
      case 'app:setGitIdentity': {
        // Argumentos: [escopo, identidade, root?]
        const scope = args[0] as GitConfigScope
        const identity = args[1] as GitIdentity
        return setIdentity(host.homeDir(), this.repoAt(args[2])?.root ?? null, scope === 'local' ? 'local' : 'global', {
          name: String(identity?.name ?? ''),
          email: String(identity?.email ?? '')
        })
      }
      case 'app:runGit': {
        // Argumentos: [linha de comando, root?]; com `root`, só o repositório aberto com ele (nunca cai no ativo).
        const repo = this.repoAt(args[1])
        if (!repo) throw new Error(t('main.noRepository'))
        return runTerminalCommand(repo.root, String(args[0] ?? ''))
      }
      case 'repo:invoke': {
        // Argumentos: [método, argumentos do método, root?]; sem root, vale o repositório ativo.
        const method = args[0] as RepoMethod
        if (!this.allowed.has(method)) throw new Error(t('main.unknownOperation', { method }))
        const repo = this.repoAt(args[2])
        if (!repo) throw new Error(t('main.noRepository'))
        const fn = repo[method] as (...a: unknown[]) => Promise<unknown>
        return fn.apply(repo, (args[1] as unknown[]) ?? [])
      }
    }
  }
}
