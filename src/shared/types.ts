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
/** Opções comuns a qualquer diff. */
interface DiffSourceOptions {
  path?: string
  /** Mostra o arquivo inteiro (todo o contexto), não só as linhas em volta das alterações. */
  fullFile?: boolean
}

export type DiffSource =
  | ({ kind: 'unstaged' } & DiffSourceOptions)
  | ({ kind: 'staged' } & DiffSourceOptions)
  | ({ kind: 'commit'; sha: string } & DiffSourceOptions)
  | ({ kind: 'range'; from: string; to: string } & DiffSourceOptions)

/** Quantas linhas um arquivo ganhou e perdeu (git diff --numstat). Ausente quando não foi calculado. */
export interface LineStats {
  additions?: number
  deletions?: number
  /** Arquivo binário: o git não conta linhas. */
  binary?: boolean
}

export interface FileStatus extends LineStats {
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

/** Como forçar um push: `lease` (--force-with-lease, recusa se o remoto mudou) ou `force` (--force, sobrescreve). */
export type PushForce = 'lease' | 'force'

export interface PushOptions {
  force?: PushForce
  /** Branch local a enviar (padrão: a atual, sem precisar de checkout). */
  branch?: string
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

export interface ChangedFile extends LineStats {
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

/** Resultado de resolver vários arquivos em conflito de uma vez. */
export interface BulkResolutionResult {
  /** Quantos arquivos deixaram de estar em conflito. */
  resolved: number
  /** Arquivos que continuam em conflito (ou nem estavam), com o motivo. */
  failed: { path: string; message: string }[]
}

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

// ---------------------------------------------------------------- análises (dashboards)

/** Um commit com tudo o que os dashboards precisam (autor, committer, tamanho da mensagem, arquivos alterados). */
export interface AnalyticsCommit {
  sha: string
  /** Quantidade de pais (2 ou mais = merge). */
  parents: number
  /** Autor e e-mail já resolvidos pelo .mailmap do repositório. */
  author: string
  email: string
  committer: string
  committerEmail: string
  /** Data do autor, em ms. */
  time: number
  /** Data do commit (committer), em ms. */
  commitTime: number
  subject: string
  /** Tamanho do corpo da mensagem (sem o título e sem os trailers), em caracteres. */
  bodyLength: number
  /** Há "Signed-off-by:" nos trailers. */
  signedOff: boolean
  /** Quantidade de "Co-authored-by:" nos trailers. */
  coAuthors: number
  /** Tags que apontam para o commit. */
  tags: string[]
  /** Arquivos alterados: [índice em `Analytics.paths`, linhas adicionadas, linhas removidas]; binários têm -1 nas duas. */
  files: [number, number, number][]
}

export interface AnalyticsOptions {
  /** O que ler: todas as branches e tags (padrão) ou só o histórico do HEAD. */
  scope?: 'all' | 'head'
  /** Máximo de commits lidos (os mais recentes). */
  limit?: number
}

export interface Analytics {
  scope: 'all' | 'head'
  commits: AnalyticsCommit[]
  /** Caminhos dos arquivos citados em `commits[].files`. */
  paths: string[]
  /** Havia mais commits do que o limite. */
  truncated: boolean
  /** Arquivos da versão atual (HEAD) com o tamanho em bytes. */
  tree: { path: string; size: number }[]
  generatedAt: number
}

/** Conteúdo de um arquivo da pasta do projeto, para o editor embutido. */
export interface FileContent {
  path: string
  /** Texto do arquivo; null quando não dá para editar como texto (binário ou grande demais). */
  content: string | null
  binary: boolean
  /** Maior que o limite do editor embutido. */
  tooLarge: boolean
  /** Tamanho em bytes. */
  size: number
}

export interface FileHistoryEntry extends CommitInfo, LineStats {
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

// ------------------------------------------------------- log de comandos

/** Um comando git executado pelo GitTools (para o log em tempo real). */
export interface GitCommandEntry {
  id: number
  /** Argumentos passados ao git (sem as opções internas "-c ..."). */
  args: string[]
  cwd: string
  startedAt: number
  /** Ausente enquanto o comando está rodando. */
  durationMs?: number
  exitCode?: number
  /** O comando falhou (códigos esperados, como o 1 de "config --get" sem valor, não contam). */
  failed?: boolean
  /** Primeira linha do erro, quando o comando falhou. */
  error?: string
}

/** Um remote do repositório (git remote -v). */
export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

// --------------------------------------------------------- identidade git

export interface GitIdentity {
  name: string
  email: string
}

/** user.name / user.email globais (~/.gitconfig) e do repositório aberto. */
export interface GitIdentities {
  global: GitIdentity
  /** null quando não há repositório aberto. */
  local: GitIdentity | null
  /** O que o git realmente usa no repositório (local se houver, senão global). */
  effective: GitIdentity | null
}

export type GitConfigScope = 'global' | 'local'
