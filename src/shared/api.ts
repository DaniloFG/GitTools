import type {
  BranchCommit,
  BranchInfo,
  ChangedFile,
  CherryPickOptions,
  CommitDetails,
  CommitInfo,
  ConflictResolution,
  DiffSource,
  FileApplyMode,
  FileDiff,
  LineAction,
  LineKey,
  OperationResult,
  OperationState,
  PartialApplyOptions,
  RepoInfo,
  RepoStatus,
  StashInfo,
  TagInfo
} from './types'

export interface LogOptions {
  /** Ref a partir da qual listar; ignorado quando `all` é verdadeiro. */
  ref?: string
  all?: boolean
  limit?: number
}

/** Operações disponíveis sobre o repositório aberto (implementadas por GitRepository). */
export interface RepoApi {
  info(): Promise<RepoInfo>
  status(): Promise<RepoStatus>
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
  push(): Promise<string>

  // Stash
  stash(message?: string): Promise<void>
  stashApply(index: number, pop?: boolean): Promise<OperationResult>
  stashDrop(index: number): Promise<void>
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
  'stash',
  'stashApply',
  'stashDrop'
]

export interface RecentRepo {
  path: string
  name: string
  openedAt: number
}

/** API exposta pelo preload em `window.gittools`. */
export interface GitToolsBridge {
  openRepository(path?: string): Promise<RepoInfo | null>
  /** Repositório já aberto no processo principal (ex.: passado pela linha de comando). */
  currentRepository(): Promise<RepoInfo | null>
  initRepository(): Promise<RepoInfo | null>
  recentRepositories(): Promise<RecentRepo[]>
  openFile(relativePath: string): Promise<void>
  invoke<M extends RepoMethod>(method: M, ...args: Parameters<RepoApi[M]>): ReturnType<RepoApi[M]>
  onRepositoryChanged(listener: () => void): () => void
}
