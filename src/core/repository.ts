import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { LogOptions, RepoApi } from '../shared/api'
import type {
  BlameResult,
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
  FileDiff,
  FileHistoryEntry,
  FileStatus,
  LineAction,
  LineKey,
  LineStats,
  OperationResult,
  OperationState,
  PartialApplyOptions,
  RebasePlan,
  RebaseStep,
  RemoteInfo,
  RepoInfo,
  RepoStatus,
  StashInfo,
  TagInfo
} from '../shared/types'
import { buildPartialPatch, parseDiff, quotePath } from './diff'
import { t } from '../shared/i18n'
import { GitError, runGit, type RunOptions } from './exec'
import { resolveInside } from './paths'

const DIFF_ARGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--full-index',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-U3'
]
/** Contexto do diff "arquivo inteiro": maior que qualquer arquivo de texto razoável. */
const FULL_CONTEXT = '-U1000000'
const diffArgs = (fullFile = false) => (fullFile ? DIFF_ARGS.map((a) => (a === '-U3' ? FULL_CONTEXT : a)) : DIFF_ARGS)
const FS = '\x1f'
const RS = '\x1e'
const COMMIT_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join('%x1f') + '%x1e'

type RefKind = 'ref' | 'commit' | 'branch' | 'branchName' | 'tagName'

function assertRef(ref: string, kind: RefKind = 'ref'): void {
  if (!ref || ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error(t(`core.invalidRef.${kind}`, { ref }))
}

function parseCommitFields(fields: string[]): CommitInfo {
  const [sha, parents, author, email, date, subject, refs] = fields
  return {
    sha,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    date: Number(date) * 1000,
    subject: subject ?? '',
    refs: refs ? refs.split(', ').filter(Boolean) : []
  }
}

function parseNameStatus(output: string): ChangedFile[] {
  const parts = output.split('\0').filter((p) => p !== '')
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]
    if (status[0] === 'R' || status[0] === 'C') {
      files.push({ status: status[0], oldPath: parts[i + 1], path: parts[i + 2] })
      i += 2
    } else {
      files.push({ status: status[0], path: parts[i + 1] })
      i += 1
    }
  }
  return files
}

/**
 * Lê a saída de `git diff --numstat -z`: linhas adicionadas/removidas por arquivo (pelo caminho novo).
 * Renomeações vêm como "a\td\t" seguido dos caminhos antigo e novo; binários como "-\t-\tcaminho".
 */
export function parseNumstat(output: string): Map<string, LineStats> {
  const stats = new Map<string, LineStats>()
  const parts = output.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(parts[i])
    if (!m) continue
    let path = m[3]
    if (path === '') {
      path = parts[i + 2] ?? ''
      i += 2
    }
    stats.set(path, m[1] === '-' ? { binary: true } : { additions: Number(m[1]), deletions: Number(m[2]) })
  }
  return stats
}

/** Junta as contagens de linhas a cada arquivo da lista (pelo caminho atual). */
function withStats<T extends { path: string }>(files: T[], stats: Map<string, LineStats>): T[] {
  return files.map((f) => ({ ...f, ...stats.get(f.path) }))
}

/** Soma contagens (ex.: o mesmo arquivo em vários commits). */
function addStats(a: LineStats, b: LineStats): LineStats {
  if (a.binary || b.binary) return { binary: true }
  return { additions: (a.additions ?? 0) + (b.additions ?? 0), deletions: (a.deletions ?? 0) + (b.deletions ?? 0) }
}

export function parseStatus(output: string): RepoStatus {
  const status: RepoStatus = {
    branch: null,
    detached: false,
    headSha: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicted: []
  }
  const parts = output.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (p.startsWith('# ')) {
      const [key, ...rest] = p.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.headSha = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        status.detached = value === '(detached)'
        status.branch = status.detached ? null : value
      } else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const fields = p.split(' ')
    let entry: FileStatus | null = null
    if (p[0] === '1') {
      entry = { path: fields.slice(8).join(' '), index: fields[1][0], worktree: fields[1][1], untracked: false, conflicted: false }
    } else if (p[0] === '2') {
      entry = {
        path: fields.slice(9).join(' '),
        origPath: parts[++i],
        index: fields[1][0],
        worktree: fields[1][1],
        untracked: false,
        conflicted: false
      }
    } else if (p[0] === 'u') {
      entry = { path: fields.slice(10).join(' '), index: fields[1][0], worktree: fields[1][1], untracked: false, conflicted: true }
    } else if (p[0] === '?') {
      entry = { path: p.slice(2), index: '?', worktree: '?', untracked: true, conflicted: false }
    }
    if (!entry) continue
    if (entry.conflicted) status.conflicted.push(entry)
    else if (entry.untracked) status.unstaged.push(entry)
    else {
      // Cópias: o mesmo arquivo pode ter contagens diferentes no stage e fora dele.
      if (entry.index !== '.') status.staged.push({ ...entry })
      if (entry.worktree !== '.') status.unstaged.push({ ...entry })
    }
  }
  return status
}

/** Coloca um caminho entre aspas simples para o shell que o git usa nos editores e em `exec`. */
function shellQuote(path: string): string {
  return `'${path.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`
}

function parseBlame(path: string, output: string): BlameResult {
  const result: BlameResult = { path, lines: [], commits: {} }
  const rows = output.split('\n')
  let current: string | null = null
  let finalLine = 0
  for (const row of rows) {
    if (row.startsWith('\t')) {
      if (current) result.lines.push({ sha: current, line: finalLine, content: row.slice(1) })
      continue
    }
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)/.exec(row)
    if (header) {
      current = header[1]
      finalLine = Number(header[2])
      result.commits[current] ??= { sha: current, author: '', email: '', date: 0, summary: '' }
      continue
    }
    if (!current) continue
    const commit = result.commits[current]
    const space = row.indexOf(' ')
    const key = space === -1 ? row : row.slice(0, space)
    const value = space === -1 ? '' : row.slice(space + 1)
    if (key === 'author') commit.author = value
    else if (key === 'author-mail') commit.email = value.replace(/^<|>$/g, '')
    else if (key === 'author-time') commit.date = Number(value) * 1000
    else if (key === 'summary') commit.summary = value
  }
  return result
}

/** Acesso de alto nível a um repositório git, usado pela interface gráfica. */
/** Valida nome e URL de um remote antes de passá-los ao git (nada que pareça opção ou tenha espaços). */
function checkRemote(name: string, url: string): { name: string; url: string } {
  const cleanName = String(name ?? '').trim()
  const cleanUrl = String(url ?? '').trim()
  if (!/^[A-Za-z0-9][\w.-]*$/.test(cleanName) || cleanName.endsWith('.lock') || cleanName.includes('..')) throw new Error(t('remotes.invalidName'))
  if (!cleanUrl || cleanUrl.startsWith('-') || /[\0\r\n]/.test(cleanUrl)) throw new Error(t('remotes.invalidUrl'))
  return { name: cleanName, url: cleanUrl }
}

export class GitRepository implements RepoApi {
  private emptyTreeSha: string | null = null

  constructor(readonly root: string) {}

  static async open(path: string): Promise<GitRepository> {
    const { stdout } = await runGit(path, ['rev-parse', '--show-toplevel'])
    // No Windows o git informa "C:/pasta"; guardar no formato do sistema evita comparações de texto erradas.
    return new GitRepository(resolve(stdout.trim()))
  }

  static async init(path: string): Promise<GitRepository> {
    await runGit(path, ['init'])
    return GitRepository.open(path)
  }

  private git(args: string[], options?: RunOptions) {
    return runGit(this.root, args, options)
  }

  // ---------------------------------------------------------------- leitura

  async info(): Promise<RepoInfo> {
    return { root: this.root, name: basename(this.root) }
  }

  /** Situação da área de trabalho. Com `withStats`, inclui quantas linhas cada arquivo ganhou e perdeu. */
  async status(includeStats = false): Promise<RepoStatus> {
    const { stdout } = await this.git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    const status = parseStatus(stdout)
    if (!includeStats) return status
    const [unstaged, staged] = await Promise.all([
      this.git(['diff', '--numstat', '-z', '--no-color', '--no-ext-diff', '--']).then((r) => parseNumstat(r.stdout)),
      this.git(['diff', '--cached', '--numstat', '-z', '-M', '--no-color', '--no-ext-diff', '--']).then((r) => parseNumstat(r.stdout))
    ])
    status.staged = withStats(status.staged, staged)
    status.unstaged = await Promise.all(
      status.unstaged.map(async (f) => (f.untracked ? { ...f, ...(await this.untrackedStats(f.path)) } : { ...f, ...unstaged.get(f.path) }))
    )
    return status
  }

  /** Arquivo novo: todas as linhas são adições (arquivos muito grandes ou binários não são contados). */
  private async untrackedStats(path: string): Promise<LineStats> {
    try {
      const full = join(this.root, path)
      const stat = await lstat(full)
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return {}
      const buffer = await readFile(full)
      if (buffer.subarray(0, 8000).includes(0)) return { binary: true }
      const text = buffer.toString('utf8')
      const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      return { additions: lines, deletions: 0 }
    } catch {
      return {}
    }
  }

  async branches(): Promise<BranchInfo[]> {
    const format = [
      '%(refname)',
      '%(refname:short)',
      '%(objectname)',
      '%(upstream:short)',
      '%(upstream:track,nobracket)',
      '%(HEAD)',
      '%(committerdate:unix)',
      '%(contents:subject)'
    ].join('%1f')
    const { stdout } = await this.git(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'])
    const branches: BranchInfo[] = []
    for (const line of stdout.split('\n')) {
      if (!line) continue
      const [fullRef, name, sha, upstream, track, head, date, subject] = line.split(FS)
      if (fullRef.endsWith('/HEAD')) continue
      const remote = fullRef.startsWith('refs/remotes/') ? fullRef.split('/')[2] : null
      branches.push({
        name,
        fullRef,
        remote,
        sha,
        upstream: upstream || null,
        ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
        behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
        current: head === '*',
        date: Number(date) * 1000,
        subject: subject ?? ''
      })
    }
    return branches
  }

  async tags(): Promise<TagInfo[]> {
    const { stdout } = await this.git([
      'for-each-ref',
      '--sort=-creatordate',
      '--format=%(refname:short)%1f%(objectname)%1f%(*objectname)',
      'refs/tags'
    ])
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, sha, peeled] = line.split(FS)
        return { name, sha: peeled || sha }
      })
  }

  async stashes(): Promise<StashInfo[]> {
    const { stdout } = await this.git(['stash', 'list', '--format=%gd%x1f%H%x1f%at%x1f%gs'])
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        const [ref, sha, date, message] = line.split(FS)
        return { ref, index, sha, date: Number(date) * 1000, message }
      })
  }

  async log(options: LogOptions = {}): Promise<CommitInfo[]> {
    const status = await this.status()
    if (!status.headSha && !options.all) return []
    const args = ['log', `--format=${COMMIT_FORMAT}`, '--topo-order', `-n${options.limit ?? 500}`]
    if (options.all) {
      args.push('--branches', '--remotes', '--tags')
      if (status.headSha) args.push('HEAD')
    } else {
      const ref = options.ref ?? 'HEAD'
      assertRef(ref)
      args.push(ref)
    }
    args.push('--')
    const { stdout } = await this.git(args)
    return stdout
      .split(RS)
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => parseCommitFields(r.split(FS)))
  }

  async commitDetails(sha: string): Promise<CommitDetails> {
    assertRef(sha, 'commit')
    const { stdout } = await this.git([
      'show',
      '-s',
      `--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1f%cn%x1f%b`,
      sha,
      '--'
    ])
    const fields = stdout.split(FS)
    const info = parseCommitFields(fields)
    const files = await this.changedFiles(info.sha, info.parents)
    return { ...info, committer: fields[7], body: (fields[8] ?? '').trim(), files }
  }

  private async changedFiles(sha: string, parents: string[]): Promise<ChangedFile[]> {
    const base = parents[0] ?? (await this.emptyTree())
    return this.filesBetween(base, sha)
  }

  /** Arquivos diferentes entre duas versões, com as linhas adicionadas/removidas de cada um. */
  private async filesBetween(from: string, to: string): Promise<ChangedFile[]> {
    const [names, numstat] = await Promise.all([
      this.git(['diff', '--name-status', '-z', '-M', '--no-color', from, to, '--']),
      this.git(['diff', '--numstat', '-z', '-M', '--no-color', '--no-ext-diff', from, to, '--'])
    ])
    return withStats(parseNameStatus(names.stdout), parseNumstat(numstat.stdout))
  }

  async filesChangedBy(shas: string[]): Promise<ChangedFile[]> {
    const seen = new Map<string, ChangedFile>()
    for (const sha of shas) {
      const details = await this.commitDetails(sha)
      for (const file of details.files) {
        const previous = seen.get(file.path)
        // O mesmo arquivo em vários commits: soma as linhas de todos.
        seen.set(file.path, previous ? { ...previous, ...addStats(previous, file) } : file)
      }
    }
    return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  private async emptyTree(): Promise<string> {
    if (!this.emptyTreeSha) {
      const { stdout } = await this.git(['hash-object', '-t', 'tree', '--stdin'], { input: '' })
      this.emptyTreeSha = stdout.trim()
    }
    return this.emptyTreeSha
  }

  private async parentOf(sha: string): Promise<string> {
    const { stdout } = await this.git(['rev-list', '--parents', '-n1', sha, '--'])
    const [, parent] = stdout.trim().split(' ')
    return parent ?? (await this.emptyTree())
  }

  async diff(source: DiffSource): Promise<FileDiff[]> {
    const pathArgs = source.path ? ['--', source.path] : ['--']
    const args = diffArgs(source.fullFile)
    switch (source.kind) {
      case 'unstaged': {
        if (source.path && (await this.isUntracked(source.path))) return [await this.untrackedDiff(source.path)]
        return parseDiff((await this.git([...args, ...pathArgs])).stdout)
      }
      case 'staged':
        return parseDiff((await this.git([...args, '--cached', '-M', ...pathArgs])).stdout)
      case 'commit': {
        assertRef(source.sha, 'commit')
        const parent = await this.parentOf(source.sha)
        return parseDiff((await this.git([...args, '-M', parent, source.sha, ...pathArgs])).stdout)
      }
      case 'range':
        assertRef(source.from)
        assertRef(source.to)
        return parseDiff((await this.git([...args, '-M', source.from, source.to, ...pathArgs])).stdout)
    }
  }

  private async isUntracked(path: string): Promise<boolean> {
    const { stdout } = await this.git(['ls-files', '--others', '--exclude-standard', '-z', '--', path])
    return stdout.split('\0').includes(path)
  }

  /** Diff sintético para um arquivo não rastreado (tudo é adição). */
  private async untrackedDiff(path: string): Promise<FileDiff> {
    const full = join(this.root, path)
    const stat = await lstat(full)
    const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
    const header = [
      `diff --git ${quotePath(`a/${path}`)} ${quotePath(`b/${path}`)}`,
      `new file mode ${mode}`,
      '--- /dev/null',
      `+++ ${quotePath(`b/${path}`)}`
    ]
    const file: FileDiff = {
      oldPath: null,
      newPath: path,
      path,
      changeType: 'added',
      binary: false,
      headerLines: header,
      hunks: [],
      additions: 0,
      deletions: 0
    }
    if (stat.isSymbolicLink()) {
      file.binary = true
      return file
    }
    const buffer = await readFile(full)
    if (buffer.subarray(0, 8000).includes(0)) {
      file.binary = true
      return file
    }
    const text = buffer.toString('utf8')
    if (text.length === 0) return file
    const lines = text.split('\n')
    const endsWithNewline = lines[lines.length - 1] === ''
    if (endsWithNewline) lines.pop()
    file.hunks.push({
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: lines.length,
      section: '',
      lines: lines.map((content, i) => ({ kind: 'add', content, oldLine: null, newLine: i + 1 }))
    })
    if (!endsWithNewline) file.hunks[0].lines[lines.length - 1].noNewline = true
    file.additions = lines.length
    return file
  }

  async operationState(): Promise<OperationState> {
    const names = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer/todo']
    const { stdout } = await this.git(['rev-parse', ...names.flatMap((n) => ['--git-path', n])])
    const paths = stdout.split('\n').filter(Boolean).map((p) => resolve(this.root, p))
    const [merge, cherry, revert, rebaseMerge, rebaseApply, sequencer] = paths
    const readHead = async (p: string) => (await readFile(p, 'utf8')).trim()
    const readNumber = async (p: string) => Number((await readFile(p, 'utf8').catch(() => '0')).trim())

    if (existsSync(rebaseMerge)) {
      return {
        kind: 'rebase',
        step: await readNumber(join(rebaseMerge, 'msgnum')),
        total: await readNumber(join(rebaseMerge, 'end'))
      }
    }
    if (existsSync(rebaseApply)) {
      return {
        kind: 'rebase',
        step: await readNumber(join(rebaseApply, 'next')),
        total: await readNumber(join(rebaseApply, 'last'))
      }
    }
    if (existsSync(cherry)) return { kind: 'cherry-pick', head: await readHead(cherry) }
    if (existsSync(revert)) return { kind: 'revert', head: await readHead(revert) }
    if (existsSync(merge)) return { kind: 'merge', head: await readHead(merge) }
    if (existsSync(sequencer)) {
      const todo = await readFile(sequencer, 'utf8')
      return { kind: /^\s*revert\b/.test(todo) ? 'revert' : 'cherry-pick' }
    }
    return { kind: 'none' }
  }

  // ------------------------------------------------------- área de trabalho

  async stageFiles(paths: string[]): Promise<void> {
    if (paths.length) await this.git(['add', '-A', '--', ...paths])
  }

  async unstageFiles(paths: string[]): Promise<void> {
    if (!paths.length) return
    const status = await this.status()
    if (status.headSha) await this.git(['restore', '--staged', '--', ...paths])
    else await this.git(['rm', '--cached', '-r', '-q', '--', ...paths])
  }

  async discardFiles(paths: string[]): Promise<void> {
    if (!paths.length) return
    const status = await this.status()
    const untracked = new Set(status.unstaged.filter((f) => f.untracked).map((f) => f.path))
    const tracked = paths.filter((p) => !untracked.has(p))
    const fresh = paths.filter((p) => untracked.has(p))
    if (tracked.length) await this.git(['restore', '--worktree', '--', ...tracked])
    if (fresh.length) await this.git(['clean', '-f', '-q', '--', ...fresh])
  }

  private async findFile(source: DiffSource, path: string): Promise<FileDiff> {
    const files = await this.diff({ ...source, path })
    const file = files.find((f) => f.path === path || f.oldPath === path)
    if (!file) throw new Error(t('core.noChangesIn', { path }))
    return file
  }

  async applyLines(source: DiffSource, path: string, lines: LineKey[], action: LineAction): Promise<OperationResult> {
    const file = await this.findFile(source, path)
    const reverse = action === 'unstage' || action === 'discard'
    const patch = buildPartialPatch(file, lines, reverse)
    if (!patch) throw new Error(t('core.noLinesSelected'))
    const args = ['apply', '--whitespace=nowarn']
    if (action === 'stage' || action === 'unstage') args.push('--cached')
    if (reverse) args.push('-R')
    if (action === 'apply') args.push('--3way')
    args.push('-')
    try {
      await this.git(args, { input: patch })
    } catch (error) {
      if (action === 'apply') return this.conflictResult(error)
      throw error
    }
    return { ok: true, message: t(`core.lines.${action}`, { count: lines.length }), conflicts: [] }
  }

  async commit(message: string, amend = false): Promise<void> {
    if (!message.trim()) throw new Error(t('core.commitMessageRequired'))
    await this.git(['commit', '-F', '-', ...(amend ? ['--amend'] : [])], { input: message })
  }

  // --------------------------------------------------------------- branches

  private async refExists(ref: string): Promise<boolean> {
    const { exitCode } = await this.git(['show-ref', '--verify', '--quiet', ref], { okExitCodes: [0, 1] })
    return exitCode === 0
  }

  async checkout(ref: string): Promise<void> {
    assertRef(ref)
    if (!(await this.refExists(`refs/heads/${ref}`)) && (await this.refExists(`refs/remotes/${ref}`))) {
      const local = ref.slice(ref.indexOf('/') + 1)
      if (await this.refExists(`refs/heads/${local}`)) await this.git(['checkout', local, '--'])
      else await this.git(['checkout', '--track', ref, '--'])
      return
    }
    await this.git(['checkout', ref, '--'])
  }

  private async ensureOnBranch(target: string): Promise<void> {
    assertRef(target, 'branch')
    const status = await this.status()
    if (!status.detached && status.branch === target) return
    await this.git(['checkout', target, '--'])
  }

  async createBranch(name: string, startPoint?: string, checkout = false): Promise<void> {
    assertRef(name, 'branchName')
    if (startPoint) assertRef(startPoint)
    const start = startPoint ? [startPoint] : []
    if (checkout) await this.git(['checkout', '-b', name, ...start, '--'])
    else await this.git(['branch', name, ...start])
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    assertRef(name, 'branch')
    await this.git(['branch', force ? '-D' : '-d', name])
  }

  /** Cria uma tag; com mensagem, a tag é anotada. */
  async createTag(name: string, ref = 'HEAD', message?: string): Promise<void> {
    assertRef(name, 'tagName')
    assertRef(ref)
    const text = message?.trim()
    await this.git(text ? ['tag', '-a', name, '-m', text, ref] : ['tag', name, ref])
  }

  async deleteTag(name: string): Promise<void> {
    assertRef(name, 'tagName')
    await this.git(['tag', '-d', name])
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    assertRef(oldName, 'branch')
    assertRef(newName, 'branchName')
    await this.git(['branch', '-m', oldName, newName])
  }

  /** Converte uma falha em resultado com conflitos, quando a falha deixou conflitos para resolver. */
  private async conflictResult(error: unknown, prefix = ''): Promise<OperationResult> {
    const status = await this.status()
    const op = await this.operationState()
    if (status.conflicted.length === 0 && op.kind === 'none') throw error
    const detail = error instanceof GitError ? error.message : String(error)
    return {
      ok: false,
      message: `${prefix}${status.conflicted.length ? t('core.conflictsToResolve') : t('core.operationStopped')}\n${detail}`,
      conflicts: status.conflicted.map((f) => f.path)
    }
  }

  async merge(ref: string, target?: string, noFastForward = false): Promise<OperationResult> {
    assertRef(ref)
    if (target) await this.ensureOnBranch(target)
    try {
      await this.git(['merge', '--no-edit', ...(noFastForward ? ['--no-ff'] : []), ref])
      return { ok: true, message: t('core.mergeDone', { ref }), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async rebase(branch: string, onto: string): Promise<OperationResult> {
    assertRef(branch, 'branch')
    assertRef(onto)
    try {
      await this.git(['rebase', onto, branch])
      return { ok: true, message: t('core.rebaseDone', { branch, onto }), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  // ------------------------------------------------------------ cherry-pick

  async branchCommits(source: string, target: string): Promise<BranchCommit[]> {
    assertRef(source)
    assertRef(target)
    const { stdout } = await this.git([
      'log',
      '--cherry-mark',
      '--right-only',
      '--no-merges',
      '--topo-order',
      `--format=%m%x1f${COMMIT_FORMAT}`,
      `${target}...${source}`,
      '--'
    ])
    return stdout
      .split(RS)
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((r) => {
        const [mark, ...fields] = r.split(FS)
        return { ...parseCommitFields(fields), alreadyApplied: mark === '=' }
      })
  }

  /** Ordena commits do mais antigo para o mais novo e informa se há merges entre eles. */
  private async orderCommits(shas: string[]): Promise<{ ordered: string[]; parents: Map<string, string[]> }> {
    shas.forEach((s) => assertRef(s, 'commit'))
    const { stdout } = await this.git(['rev-list', '--no-walk=sorted', '--parents', ...shas, '--'])
    const parents = new Map<string, string[]>()
    const ordered = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ...ps] = line.split(' ')
        parents.set(sha, ps)
        return sha
      })
      .reverse()
    return { ordered, parents }
  }

  async cherryPickCommits(target: string, shas: string[], options: CherryPickOptions = {}): Promise<OperationResult> {
    if (!shas.length) throw new Error(t('core.selectCommit'))
    const { ordered, parents } = await this.orderCommits(shas)
    await this.ensureOnBranch(target)
    const hasMerge = ordered.some((s) => (parents.get(s)?.length ?? 0) > 1)
    const args = ['cherry-pick']
    if (options.recordOrigin) args.push('-x')
    if (options.noCommit) args.push('--no-commit')
    if (hasMerge) args.push('-m', '1')
    try {
      await this.git([...args, ...ordered])
      return { ok: true, message: t('core.commitsApplied', { count: ordered.length, target }), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async cherryPickBranch(source: string, target: string, options: CherryPickOptions = {}): Promise<OperationResult> {
    const commits = (await this.branchCommits(source, target)).filter((c) => !c.alreadyApplied)
    if (!commits.length) return { ok: true, message: t('core.nothingToApply', { target, source }), conflicts: [] }
    return this.cherryPickCommits(
      target,
      commits.map((c) => c.sha),
      options
    )
  }

  private async assertCanCommitAfter(options: PartialApplyOptions): Promise<void> {
    if (!options.commitMessage) return
    const status = await this.status()
    if (status.staged.length || status.conflicted.length) {
      throw new Error(t('core.stagedChangesExist'))
    }
  }

  async cherryPickFiles(
    target: string,
    shas: string[],
    paths: string[],
    mode: FileApplyMode,
    options: PartialApplyOptions = {}
  ): Promise<OperationResult> {
    if (!shas.length) throw new Error(t('core.selectCommit'))
    if (!paths.length) throw new Error(t('core.selectFile'))
    const { ordered, parents } = await this.orderCommits(shas)
    await this.ensureOnBranch(target)
    await this.assertCanCommitAfter(options)

    if (mode === 'version') {
      const newest = ordered[ordered.length - 1]
      const present: string[] = []
      const removed: string[] = []
      for (const path of paths) {
        const { exitCode } = await this.git(['cat-file', '-e', `${newest}:${path}`], { okExitCodes: [0, 1, 128] })
        ;(exitCode === 0 ? present : removed).push(path)
      }
      if (present.length) await this.git(['checkout', newest, '--', ...present])
      if (removed.length) await this.git(['rm', '-q', '--ignore-unmatch', '--', ...removed])
    } else {
      for (const [i, sha] of ordered.entries()) {
        const base = parents.get(sha)?.[0] ?? (await this.emptyTree())
        const { stdout: patch } = await this.git([...DIFF_ARGS, '--binary', base, sha, '--', ...paths])
        if (!patch.trim()) continue
        try {
          await this.git(['apply', '--3way', '--whitespace=nowarn', '-'], { input: patch })
        } catch (error) {
          const left = ordered.length - i - 1
          return this.conflictResult(
            error,
            `${t('core.conflictApplying', { sha: sha.slice(0, 8) })}${left ? ` ${t('core.commitsNotApplied', { count: left })}` : ''} `
          )
        }
      }
    }

    if (options.commitMessage) await this.commit(options.commitMessage)
    const key = mode === 'version' ? 'core.filesCopied' : 'core.filesApplied'
    return {
      ok: true,
      message: `${t(key, { target })} ${options.commitMessage ? t('core.commitCreated') : t('core.leftStaged')}`,
      conflicts: []
    }
  }

  async cherryPickLines(
    target: string,
    source: DiffSource,
    path: string,
    lines: LineKey[],
    options: PartialApplyOptions = {}
  ): Promise<OperationResult> {
    if (source.kind !== 'commit' && source.kind !== 'range') throw new Error(t('core.linesSourceInvalid'))
    await this.ensureOnBranch(target)
    await this.assertCanCommitAfter(options)
    const result = await this.applyLines(source, path, lines, 'apply')
    if (!result.ok) return result
    if (options.commitMessage) await this.commit(options.commitMessage)
    return {
      ok: true,
      message: `${t('core.linesAppliedTo', { count: lines.length, target })} ${options.commitMessage ? t('core.commitCreated') : t('core.leftStaged')}`,
      conflicts: []
    }
  }

  // --------------------------------------------- conflitos e operações

  async resolveConflict(path: string, resolution: ConflictResolution): Promise<void> {
    if (resolution === 'resolved') {
      await this.git(['add', '--', path])
      return
    }
    try {
      await this.git(['checkout', `--${resolution}`, '--', path])
      await this.git(['add', '--', path])
    } catch (error) {
      // O lado escolhido removeu o arquivo: resolver = remover.
      if (error instanceof GitError && /does not have (our|their) version/.test(error.message)) {
        await this.git(['rm', '-q', '--', path])
      } else throw error
    }
  }

  async continueOperation(): Promise<OperationResult> {
    const [op, status] = await Promise.all([this.operationState(), this.status()])
    if (status.conflicted.length) throw new Error(t('core.stillConflicts'))
    const commands: Record<string, string[]> = {
      'cherry-pick': ['cherry-pick', '--continue'],
      revert: ['revert', '--continue'],
      rebase: ['rebase', '--continue'],
      merge: ['commit', '--no-edit']
    }
    const command = commands[op.kind]
    if (!command) throw new Error(t('core.noOperation'))
    try {
      await this.git(command)
      return { ok: true, message: t('core.operationDone'), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async skipOperation(): Promise<OperationResult> {
    const op = await this.operationState()
    if (op.kind === 'none' || op.kind === 'merge') throw new Error(t('core.cannotSkip'))
    try {
      await this.git([op.kind, '--skip'])
      return { ok: true, message: t('core.commitSkipped'), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async abortOperation(): Promise<void> {
    const op = await this.operationState()
    if (op.kind === 'none') {
      // Conflitos de um "git apply --3way" não deixam operação registrada: volta ao HEAD.
      const status = await this.status()
      if (status.conflicted.length) {
        await this.git(['checkout', 'HEAD', '--', ...status.conflicted.map((f) => f.path)])
        return
      }
      throw new Error(t('core.noOperation'))
    }
    await this.git([op.kind, '--abort'])
  }

  // --------------------------------------------------------------- histórico

  async revertCommit(sha: string): Promise<OperationResult> {
    const { parents } = await this.orderCommits([sha])
    const isMerge = ([...parents.values()][0]?.length ?? 0) > 1
    try {
      await this.git(['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha])
      return { ok: true, message: t('core.reverted', { sha: sha.slice(0, 8) }), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async resetTo(sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    assertRef(sha, 'commit')
    await this.git(['reset', `--${mode}`, sha, '--'])
  }

  // ----------------------------------------------------------------- remotos

  async fetch(): Promise<string> {
    const { stderr, stdout } = await this.git(['fetch', '--all', '--prune'])
    return (stderr || stdout).trim() || t('core.fetchDone')
  }

  async pull(): Promise<OperationResult> {
    try {
      await this.git(['pull', '--no-edit'])
      return { ok: true, message: t('core.pullDone'), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  /** Remotes configurados, com a URL de buscar e a de enviar (que pode ser diferente). */
  async remotes(): Promise<RemoteInfo[]> {
    const { stdout } = await this.git(['remote', '-v'])
    const byName = new Map<string, RemoteInfo>()
    for (const line of stdout.split('\n')) {
      const match = /^(\S+)\t(.*) \((fetch|push)\)$/.exec(line)
      if (!match) continue
      const [, name, url, kind] = match
      const info = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
      if (kind === 'fetch') info.fetchUrl = url
      else info.pushUrl = url
      byName.set(name, info)
    }
    return [...byName.values()]
  }

  async addRemote(name: string, url: string, fetchNow = false): Promise<string> {
    const clean = checkRemote(name, url)
    await this.git(['remote', 'add', ...(fetchNow ? ['-f'] : []), '--', clean.name, clean.url])
    return clean.name
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    const clean = checkRemote(name, url)
    await this.git(['remote', 'set-url', '--', clean.name, clean.url])
  }

  async renameRemote(name: string, newName: string): Promise<void> {
    const clean = checkRemote(name, 'x')
    const next = checkRemote(newName, 'x')
    await this.git(['remote', 'rename', '--', clean.name, next.name])
  }

  async removeRemote(name: string): Promise<void> {
    await this.git(['remote', 'remove', '--', checkRemote(name, 'x').name])
  }

  /** Envia a branch atual; sem `remote`, usa o upstream (ou o origin, ou o primeiro remote, na primeira vez). */
  async push(remote?: string): Promise<string> {
    const status = await this.status()
    if (!status.branch) throw new Error(t('core.pushNeedsBranch'))
    let args = ['push']
    if (remote) {
      args = ['push', '-u', '--', checkRemote(remote, 'x').name, status.branch]
    } else if (!status.upstream) {
      const { stdout } = await this.git(['remote'])
      const remotes = stdout.split('\n').filter(Boolean)
      if (!remotes.length) throw new Error(t('core.noRemotes'))
      const first = remotes.includes('origin') ? 'origin' : remotes[0]
      args = ['push', '-u', first, status.branch]
    }
    const { stderr, stdout } = await this.git(args)
    return (stderr || stdout).trim() || t('core.pushDone')
  }

  // ------------------------------------------------------------------- stash

  async stash(message?: string): Promise<void> {
    await this.git(['stash', 'push', '--include-untracked', ...(message ? ['-m', message] : [])])
  }

  async stashApply(index: number, pop = false): Promise<OperationResult> {
    try {
      await this.git(['stash', pop ? 'pop' : 'apply', `stash@{${Number(index)}}`])
      return { ok: true, message: pop ? t('core.stashPopped') : t('core.stashApplied'), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async stashDrop(index: number): Promise<void> {
    await this.git(['stash', 'drop', `stash@{${Number(index)}}`])
  }

  // ---------------------------------------------------- editor de conflitos

  async conflictDetails(path: string): Promise<ConflictDetails> {
    const stage = async (n: number) => {
      const { stdout, exitCode } = await this.git(['show', `:${n}:${path}`], { okExitCodes: [0, 128] })
      return exitCode === 0 ? stdout : null
    }
    const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
    const buffer = await readFile(join(this.root, path)).catch(() => null)
    const working = buffer ? buffer.toString('utf8') : null
    const binary = !!buffer?.subarray(0, 8000).includes(0) || [base, ours, theirs].some((t) => t?.includes('\0'))
    return { path, base, ours, theirs, working, binary }
  }

  /** Grava o conteúdo resolvido de um arquivo em conflito e marca como resolvido. */
  async saveConflictResolution(path: string, content: string): Promise<void> {
    const full = resolveInside(this.root, path)
    await writeFile(full, content, 'utf8')
    await this.git(['add', '--', path])
  }

  // ------------------------------------------------------------- comparação

  async compare(from: string, to: string, sinceMergeBase = false): Promise<Comparison> {
    assertRef(from)
    assertRef(to)
    const { stdout: mb, exitCode } = await this.git(['merge-base', from, to], { okExitCodes: [0, 1] })
    const mergeBase = exitCode === 0 ? mb.trim() : null
    const [onlyFrom, onlyTo, files] = await Promise.all([
      this.log({ ref: `${to}..${from}`, limit: 300 }),
      this.log({ ref: `${from}..${to}`, limit: 300 }),
      this.filesBetween(sinceMergeBase && mergeBase ? mergeBase : from, to)
    ])
    return { from, to, mergeBase, onlyFrom, onlyTo, files }
  }

  // ---------------------------------------------- arquivos, blame e histórico

  async listFiles(): Promise<string[]> {
    const { stdout } = await this.git(['ls-files', '-z'])
    return stdout.split('\0').filter(Boolean)
  }

  async blame(path: string, rev?: string): Promise<BlameResult> {
    if (rev) assertRef(rev)
    const { stdout } = await this.git(['blame', '--porcelain', ...(rev ? [rev] : []), '--', path])
    return parseBlame(path, stdout)
  }

  async fileHistory(path: string, limit = 300): Promise<FileHistoryEntry[]> {
    const { stdout } = await this.git([
      'log',
      '--follow',
      `-n${limit}`,
      `--format=%x1e${COMMIT_FORMAT.replace('%x1e', '')}`,
      '--name-only',
      '--',
      path
    ])
    // Linhas adicionadas/removidas no arquivo em cada commit (o --follow acompanha renomeações).
    const { stdout: numstat } = await this.git(['log', '--follow', `-n${limit}`, '--format=%x1e%H', '--numstat', '--', path])
    const stats = new Map<string, LineStats>()
    for (const record of numstat.split(RS)) {
      const [sha, ...lines] = record.trim().split('\n')
      const m = lines.map((l) => /^(-|\d+)\t(-|\d+)\t/.exec(l)).find(Boolean)
      if (sha && m) stats.set(sha, m[1] === '-' ? { binary: true } : { additions: Number(m[1]), deletions: Number(m[2]) })
    }
    const entries: FileHistoryEntry[] = []
    let currentPath = path
    for (const record of stdout.split(RS)) {
      if (!record.trim()) continue
      const [header, ...rest] = record.split('\n')
      const name = rest.map((l) => l.trim()).find(Boolean)
      if (name) currentPath = name
      const commit = parseCommitFields(header.split(FS))
      entries.push({ ...commit, ...stats.get(commit.sha), path: currentPath })
    }
    return entries
  }

  /** Volta um arquivo para a versão que ele tinha num commit (fica no stage). */
  async restoreFile(sha: string, path: string): Promise<void> {
    assertRef(sha, 'commit')
    await this.git(['checkout', sha, '--', path])
  }

  // ------------------------------------------------------ rebase interativo

  async rebasePlan(fromSha: string): Promise<RebasePlan> {
    assertRef(fromSha, 'commit')
    const status = await this.status()
    if (!status.branch) throw new Error(t('core.rebaseNeedsBranch'))
    const { exitCode } = await this.git(['merge-base', '--is-ancestor', fromSha, 'HEAD'], { okExitCodes: [0, 1] })
    if (exitCode !== 0) throw new Error(t('core.commitNotInBranch', { sha: fromSha.slice(0, 8), branch: status.branch }))
    const { stdout } = await this.git(['rev-list', '--parents', '-n1', fromSha, '--'])
    const base = stdout.trim().split(' ')[1] ?? null
    const range = base ? `${base}..HEAD` : 'HEAD'
    const { stdout: merges } = await this.git(['rev-list', '--merges', '--count', range, '--'])
    const commits = (await this.log({ ref: range, limit: 1000 })).filter((c) => c.parents.length <= 1).reverse()
    return { base, commits, hasMerges: Number(merges.trim()) > 0 }
  }

  async interactiveRebase(base: string | null, steps: RebaseStep[]): Promise<OperationResult> {
    if (base) assertRef(base, 'commit')
    if (!steps.length) throw new Error(t('core.nothingToRewrite'))
    const first = steps.find((s) => s.action !== 'drop')
    if (first && (first.action === 'squash' || first.action === 'fixup')) {
      throw new Error(t('core.firstCannotSquash'))
    }
    const { stdout: dirPath } = await this.git(['rev-parse', '--git-path', 'gittools-rebase'])
    const dir = resolve(this.root, dirPath.trim())
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })

    const todo: string[] = []
    for (const [i, step] of steps.entries()) {
      assertRef(step.sha, 'commit')
      const amend = async () => {
        const file = join(dir, `msg-${i}.txt`)
        await writeFile(file, step.message!, 'utf8')
        todo.push(`exec git commit --amend --allow-empty -F ${shellQuote(file)}`)
      }
      if (step.action === 'reword') {
        todo.push(`pick ${step.sha}`)
        if (step.message?.trim()) await amend()
      } else {
        todo.push(`${step.action} ${step.sha}`)
        if (step.action === 'squash' && step.message?.trim()) await amend()
      }
    }
    const todoFile = join(dir, 'todo.txt')
    await writeFile(todoFile, todo.join('\n') + '\n', 'utf8')
    try {
      await this.git(['rebase', '-i', '--autostash', base ?? '--root'], {
        env: { GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todoFile)}` }
      })
      return { ok: true, message: t('core.historyRewritten'), conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }
}
