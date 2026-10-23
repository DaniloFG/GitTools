import type { Settings } from './settings'
import type {
  Analytics,
  AnalyticsOptions,
  BlameResult,
  GitCommandEntry,
  GitConfigScope,
  GitIdentities,
  GitIdentity,
  BranchCommit,
  BranchInfo,
  ChangedFile,
  CherryPickOptions,
  CommitDetails,
  CommitInfo,
  Comparison,
  ConflictDetails,
  ConflictResolution,
  DiffSource,
  FileApplyMode,
  FileContent,
  FileDiff,
  FileHistoryEntry,
  LineAction,
  LineKey,
  OperationResult,
  OperationState,
  PartialApplyOptions,
  PushOptions,
  RebasePlan,
  RebaseStep,
  RemoteInfo,
  RepoInfo,
  RepoStatus,
  StashInfo,
  TagInfo
} from './types'

export interface LogOptions {
  /** Ref a partir da qual listar; ignorado quando `all` é verdadeiro. */
  ref?: string
  /** Várias refs (as branches marcadas na barra lateral): lista só a história delas; vale mais que `ref`. */
  refs?: string[]
  all?: boolean
  limit?: number
}

/** Operações disponíveis sobre o repositório aberto (implementadas por GitRepository). */
export interface RepoApi {
  info(): Promise<RepoInfo>
  /** Com `withStats`, inclui as linhas adicionadas/removidas de cada arquivo. */
  status(withStats?: boolean): Promise<RepoStatus>
  branches(): Promise<BranchInfo[]>
  tags(): Promise<TagInfo[]>
  stashes(): Promise<StashInfo[]>
  log(options?: LogOptions): Promise<CommitInfo[]>
  commitDetails(sha: string): Promise<CommitDetails>
  diff(source: DiffSource): Promise<FileDiff[]>
  operationState(): Promise<OperationState>

  // Área de trabalho
  stageFiles(paths: string[]): Promise<void>
  unstageFiles(paths: string[]): Promise<void>
  discardFiles(paths: string[]): Promise<void>
  applyLines(source: DiffSource, path: string, lines: LineKey[], action: LineAction): Promise<OperationResult>
  commit(message: string, amend?: boolean): Promise<void>

  // Branches
  checkout(ref: string): Promise<void>
  createBranch(name: string, startPoint?: string, checkout?: boolean): Promise<void>
  deleteBranch(name: string, force?: boolean): Promise<void>
  renameBranch(oldName: string, newName: string): Promise<void>
  createTag(name: string, ref?: string, message?: string): Promise<void>
  deleteTag(name: string): Promise<void>
  merge(ref: string, target?: string, noFastForward?: boolean): Promise<OperationResult>
  rebase(branch: string, onto: string): Promise<OperationResult>

  // Cherry-pick
  branchCommits(source: string, target: string): Promise<BranchCommit[]>
  filesChangedBy(shas: string[]): Promise<ChangedFile[]>
  cherryPickCommits(target: string, shas: string[], options?: CherryPickOptions): Promise<OperationResult>
  cherryPickBranch(source: string, target: string, options?: CherryPickOptions): Promise<OperationResult>
  cherryPickFiles(
    target: string,
    shas: string[],
    paths: string[],
    mode: FileApplyMode,
    options?: PartialApplyOptions
  ): Promise<OperationResult>
  cherryPickLines(
    target: string,
    source: DiffSource,
    path: string,
    lines: LineKey[],
    options?: PartialApplyOptions
  ): Promise<OperationResult>

  // Conflitos e operações em andamento
  resolveConflict(path: string, resolution: ConflictResolution): Promise<void>
  continueOperation(): Promise<OperationResult>
  skipOperation(): Promise<OperationResult>
  abortOperation(): Promise<void>

  // Histórico
  revertCommit(sha: string): Promise<OperationResult>
  resetTo(sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>

  // Remotos
  fetch(): Promise<string>
  pull(): Promise<OperationResult>
  /** Envia a branch atual (ou `options.branch`) para o `remote` informado, ou o padrão dela; `options.force` força. */
  push(remote?: string, options?: PushOptions): Promise<string>
  remotes(): Promise<RemoteInfo[]>
  /** Devolve o nome usado; `fetchNow` já baixa o conteúdo do novo remote. */
  addRemote(name: string, url: string, fetchNow?: boolean): Promise<string>
  setRemoteUrl(name: string, url: string): Promise<void>
  renameRemote(name: string, newName: string): Promise<void>
  removeRemote(name: string): Promise<void>

  // Stash
  stash(message?: string): Promise<void>
  stashApply(index: number, pop?: boolean): Promise<OperationResult>
  stashDrop(index: number): Promise<void>

  // Editor de conflitos
  conflictDetails(path: string): Promise<ConflictDetails>
  saveConflictResolution(path: string, content: string): Promise<void>

  // Dashboards
  /** Lê o histórico inteiro (commits, autores, arquivos e linhas) para os dashboards de métricas. */
  analytics(options?: AnalyticsOptions): Promise<Analytics>

  // Comparação, arquivos, blame e histórico
  compare(from: string, to: string, sinceMergeBase?: boolean): Promise<Comparison>
  listFiles(): Promise<string[]>
  /** Lê um arquivo da pasta do projeto (para editar no editor embutido). */
  readFile(path: string): Promise<FileContent>
  /** Grava o texto de um arquivo da pasta do projeto (não faz stage). */
  writeFile(path: string, content: string): Promise<void>
  blame(path: string, rev?: string): Promise<BlameResult>
  fileHistory(path: string, limit?: number): Promise<FileHistoryEntry[]>
  restoreFile(sha: string, path: string): Promise<void>

  // Rebase interativo
  rebasePlan(fromSha: string): Promise<RebasePlan>
  interactiveRebase(base: string | null, steps: RebaseStep[]): Promise<OperationResult>
}

export type RepoMethod = keyof RepoApi

/** Lista explícita dos métodos que a interface pode chamar via IPC. */
export const REPO_METHODS: readonly RepoMethod[] = [
  'info',
  'status',
  'branches',
  'tags',
  'stashes',
  'log',
  'commitDetails',
  'diff',
  'operationState',
  'stageFiles',
  'unstageFiles',
  'discardFiles',
  'applyLines',
  'commit',
  'checkout',
  'createBranch',
  'deleteBranch',
  'renameBranch',
  'createTag',
  'deleteTag',
  'merge',
  'rebase',
  'branchCommits',
  'filesChangedBy',
  'cherryPickCommits',
  'cherryPickBranch',
  'cherryPickFiles',
  'cherryPickLines',
  'resolveConflict',
  'continueOperation',
  'skipOperation',
  'abortOperation',
  'revertCommit',
  'resetTo',
  'fetch',
  'pull',
  'push',
  'remotes',
  'addRemote',
  'setRemoteUrl',
  'renameRemote',
  'removeRemote',
  'stash',
  'stashApply',
  'stashDrop',
  'conflictDetails',
  'saveConflictResolution',
  'compare',
  'listFiles',
  'readFile',
  'writeFile',
  'analytics',
  'blame',
  'fileHistory',
  'restoreFile',
  'rebasePlan',
  'interactiveRebase'
]

/** Diff de um arquivo aberto numa janela própria. */
export interface DiffWindowRequest {
  source: DiffSource
  path: string
  /** Título da janela (padrão: o caminho do arquivo). */
  title?: string
}

export interface AppInfo {
  /** Onde o GitTools está rodando: o aplicativo (Electron) ou a extensão do VS Code. */
  host: 'electron' | 'vscode'
  /** Versão do VS Code, quando o GitTools roda como extensão dele. */
  vscode?: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** Versão do git encontrado no PATH, ou null se não foi encontrado. */
  git: string | null
  settingsFile: string
  /** Idiomas preferidos do sistema operacional, do mais para o menos preferido. */
  systemLocales: string[]
}

/** Editor de código encontrado no computador. */
export interface EditorInfo {
  id: string
  name: string
  /** Executável que abre o editor. */
  command: string
}

export interface RecentRepo {
  path: string
  name: string
  openedAt: number
  /** Fixado no grupo de favoritos (não sai da lista com o passar do tempo). */
  favorite?: boolean
}

/** API exposta pelo preload em `window.gittools`. */
export interface GitToolsBridge {
  openRepository(path?: string): Promise<RepoInfo | null>
  /** Repositório já aberto no processo principal (ex.: passado pela linha de comando). */
  currentRepository(): Promise<RepoInfo | null>
  initRepository(): Promise<RepoInfo | null>
  recentRepositories(): Promise<RecentRepo[]>
  /** Tira um repositório da lista de recentes (a pasta não é apagada). */
  removeRecentRepository(path: string): Promise<void>
  /** Move um repositório para o grupo de favoritos, ou o tira de lá. */
  setRepositoryFavorite(path: string, favorite: boolean): Promise<void>
  openFile(relativePath: string): Promise<void>
  /** Editores de código instalados neste computador. */
  detectEditors(): Promise<EditorInfo[]>
  /** Pede ao usuário o executável de um editor; null se cancelar. */
  chooseEditor(): Promise<string | null>
  /** Abre um arquivo (ou a pasta do repositório, com ".") no editor escolhido nas configurações. */
  openInEditor(relativePath: string): Promise<void>
  /** Abre a pasta do repositório com o editor informado (sem precisar salvar), para testá-lo. */
  testEditor(setting: string): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  /** Comandos git executados até agora (os mais recentes por último). */
  gitLog(): Promise<GitCommandEntry[]>
  /** Avisa quando um comando git começa ou termina. */
  onGitCommand(listener: (entry: GitCommandEntry) => void): () => void
  /** Abre o diff de um arquivo numa janela própria. */
  openDiffWindow(request: DiffWindowRequest): Promise<void>
  /** Pede uma pasta ao usuário; null se cancelar. */
  chooseFolder(title?: string): Promise<string | null>
  defaultCloneFolder(): Promise<string>
  /** Clona e abre o repositório. */
  cloneRepository(url: string, parent: string, name: string): Promise<RepoInfo>
  gitIdentity(): Promise<GitIdentities>
  setGitIdentity(scope: GitConfigScope, identity: GitIdentity): Promise<void>
  appInfo(): Promise<AppInfo>
  /** Aplica a escala da interface imediatamente. */
  setZoom(factor: number): void
  invoke<M extends RepoMethod>(method: M, ...args: Parameters<RepoApi[M]>): ReturnType<RepoApi[M]>
  onRepositoryChanged(listener: () => void): () => void
}
