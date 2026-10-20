// Tipos compartilhados entre o processo principal (Electron/Node) e a interface (React).

export interface RepoInfo {
  root: string
  name: string
}

export type LineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: LineKind
  content: string
  oldLine: number | null
  newLine: number | null
  /** A linha não termina com quebra de linha ("\ No newline at end of file"). */
  noNewline?: boolean
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  section: string
  lines: DiffLine[]
}

export type FileChangeType = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'

export interface FileDiff {
  oldPath: string | null
  newPath: string | null
  /** Caminho "principal" do arquivo (o novo, ou o antigo quando o arquivo foi removido). */
  path: string
  changeType: FileChangeType
  binary: boolean
  /** Linhas de cabeçalho originais (diff --git, index, ---, +++ ...). */
  headerLines: string[]
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

/** Identificador de uma linha dentro de um FileDiff: "<índice do hunk>:<índice da linha>". */
export type LineKey = string

/** De onde vem um diff exibido na interface. */
export type DiffSource =
  | { kind: 'unstaged'; path?: string }
  | { kind: 'staged'; path?: string }
  | { kind: 'commit'; sha: string; path?: string }
  | { kind: 'range'; from: string; to: string; path?: string }

export interface FileStatus {
  path: string
  origPath?: string
  /** Código do índice (X) no formato porcelain: '.', 'M', 'A', 'D', 'R', 'C', 'U', '?'. */
  index: string
  /** Código da árvore de trabalho (Y). */
  worktree: string
  untracked: boolean
  conflicted: boolean
}

export interface RepoStatus {
  branch: string | null
  detached: boolean
  headSha: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: FileStatus[]
  unstaged: FileStatus[]
  conflicted: FileStatus[]
}

export interface BranchInfo {
  name: string
  fullRef: string
  remote: string | null
  sha: string
  upstream: string | null
  ahead: number
  behind: number
  current: boolean
  date: number
  subject: string
}

export interface TagInfo {
  name: string
  sha: string
}

export interface StashInfo {
  ref: string
  index: number
  sha: string
  date: number
  message: string
}

export interface CommitInfo {
  sha: string
  parents: string[]
  author: string
  email: string
  date: number
  subject: string
  refs: string[]
}

export interface ChangedFile {
  status: string
  path: string
  oldPath?: string
}

export interface CommitDetails extends CommitInfo {
  body: string
  committer: string
  files: ChangedFile[]
}

export interface BranchCommit extends CommitInfo {
  /** O commit já existe (com o mesmo patch) na branch de destino. */
  alreadyApplied: boolean
}

export type OperationKind = 'none' | 'merge' | 'cherry-pick' | 'revert' | 'rebase'

export interface OperationState {
  kind: OperationKind
  /** Commit sendo aplicado (cherry-pick/revert/merge), quando conhecido. */
  head?: string
  /** Para rebase: passo atual e total. */
  step?: number
  total?: number
}

export interface OperationResult {
  ok: boolean
  message: string
  conflicts: string[]
}

export type ConflictResolution = 'ours' | 'theirs' | 'resolved'

export type LineAction = 'stage' | 'unstage' | 'discard' | 'apply'

export interface CherryPickOptions {
  /** Adiciona "(cherry picked from commit ...)" na mensagem (git cherry-pick -x). */
  recordOrigin?: boolean
  /** Aplica as alterações sem criar commits (git cherry-pick --no-commit). */
  noCommit?: boolean
}

export interface PartialApplyOptions {
  /** Se informado, cria um commit com esta mensagem após aplicar. */
  commitMessage?: string
}

export type FileApplyMode = 'changes' | 'version'

// ------------------------------------------------------------- conflitos

export interface ConflictDetails {
  path: string
  /** Versão do ancestral comum (stage 1), quando existe. */
  base: string | null
  /** Versão da branch atual / HEAD (stage 2). Null se o arquivo foi removido desse lado. */
  ours: string | null
  /** Versão que está entrando (stage 3). Null se o arquivo foi removido desse lado. */
  theirs: string | null
  /** Conteúdo atual do arquivo na pasta, com os marcadores de conflito. */
  working: string | null
  binary: boolean
}

// ------------------------------------------------------------ comparação

export interface Comparison {
  from: string
  to: string
  mergeBase: string | null
  /** Commits que existem só em `from`. */
  onlyFrom: CommitInfo[]
  /** Commits que existem só em `to`. */
  onlyTo: CommitInfo[]
  /** Arquivos alterados de `from` (ou do ancestral comum, se pedido) até `to`. */
  files: ChangedFile[]
}

// ---------------------------------------------------- blame e histórico

export interface BlameCommit {
  sha: string
  author: string
  email: string
  date: number
  summary: string
}

export interface BlameLine {
  sha: string
  /** Número da linha no arquivo atual. */
  line: number
  content: string
}

export interface BlameResult {
  path: string
  lines: BlameLine[]
  commits: Record<string, BlameCommit>
}

export interface FileHistoryEntry extends CommitInfo {
  /** Caminho do arquivo neste commit (muda quando o arquivo foi renomeado). */
  path: string
}

// --------------------------------------------------- rebase interativo

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseStep {
  sha: string
  action: RebaseAction
  /** Nova mensagem (para reword, ou para o resultado de um squash). */
  message?: string
}

export interface RebasePlan {
  /** Commit a partir do qual a branch será reescrita (null = desde o primeiro commit). */
  base: string | null
  /** Commits a reescrever, do mais antigo para o mais novo. */
  commits: CommitInfo[]
  /** O intervalo contém commits de merge (eles serão achatados pelo rebase). */
  hasMerges: boolean
}
