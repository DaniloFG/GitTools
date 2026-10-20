import { existsSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { LogOptions, RepoApi } from '../shared/api'
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
  FileStatus,
  LineAction,
  LineKey,
  OperationResult,
  OperationState,
  PartialApplyOptions,
  RepoInfo,
  RepoStatus,
  StashInfo,
  TagInfo
} from '../shared/types'
import { buildPartialPatch, parseDiff, quotePath } from './diff'
import { GitError, runGit, type RunOptions } from './exec'

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
const FS = '\x1f'
const RS = '\x1e'
const COMMIT_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join('%x1f') + '%x1e'

function assertRef(ref: string, what = 'referência'): void {
  if (!ref || ref.startsWith('-') || /[\s\0]/.test(ref)) throw new Error(`${what} inválida: "${ref}"`)
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
      if (entry.index !== '.') status.staged.push(entry)
      if (entry.worktree !== '.') status.unstaged.push(entry)
    }
  }
  return status
}

/** Acesso de alto nível a um repositório git, usado pela interface gráfica. */
export class GitRepository implements RepoApi {
  private emptyTreeSha: string | null = null

  constructor(readonly root: string) {}

  static async open(path: string): Promise<GitRepository> {
    const { stdout } = await runGit(path, ['rev-parse', '--show-toplevel'])
    return new GitRepository(stdout.trim())
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

  async status(): Promise<RepoStatus> {
    const { stdout } = await this.git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])
    return parseStatus(stdout)
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
    const { stdout } = await this.git(['diff', '--name-status', '-z', '-M', '--no-color', base, sha, '--'])
    return parseNameStatus(stdout)
  }

  async filesChangedBy(shas: string[]): Promise<ChangedFile[]> {
    const seen = new Map<string, ChangedFile>()
    for (const sha of shas) {
      const details = await this.commitDetails(sha)
      for (const file of details.files) if (!seen.has(file.path)) seen.set(file.path, file)
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
    switch (source.kind) {
      case 'unstaged': {
        if (source.path && (await this.isUntracked(source.path))) return [await this.untrackedDiff(source.path)]
        return parseDiff((await this.git([...DIFF_ARGS, ...pathArgs])).stdout)
      }
      case 'staged':
        return parseDiff((await this.git([...DIFF_ARGS, '--cached', '-M', ...pathArgs])).stdout)
      case 'commit': {
        assertRef(source.sha, 'commit')
        const parent = await this.parentOf(source.sha)
        return parseDiff((await this.git([...DIFF_ARGS, '-M', parent, source.sha, ...pathArgs])).stdout)
      }
      case 'range':
        assertRef(source.from)
        assertRef(source.to)
        return parseDiff((await this.git([...DIFF_ARGS, '-M', source.from, source.to, ...pathArgs])).stdout)
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
    if (!file) throw new Error(`Não há alterações em "${path}".`)
    return file
  }

  async applyLines(source: DiffSource, path: string, lines: LineKey[], action: LineAction): Promise<OperationResult> {
    const file = await this.findFile(source, path)
    const reverse = action === 'unstage' || action === 'discard'
    const patch = buildPartialPatch(file, lines, reverse)
    if (!patch) throw new Error('Nenhuma linha alterada foi selecionada.')
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
    const verb = { stage: 'adicionadas ao stage', unstage: 'removidas do stage', discard: 'descartadas', apply: 'aplicadas' }[action]
    return { ok: true, message: `${lines.length} linha(s) ${verb}.`, conflicts: [] }
  }

  async commit(message: string, amend = false): Promise<void> {
    if (!message.trim()) throw new Error('Escreva uma mensagem de commit.')
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
    assertRef(name, 'nome de branch')
    if (startPoint) assertRef(startPoint)
    const start = startPoint ? [startPoint] : []
    if (checkout) await this.git(['checkout', '-b', name, ...start, '--'])
    else await this.git(['branch', name, ...start])
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    assertRef(name, 'branch')
    await this.git(['branch', force ? '-D' : '-d', name])
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    assertRef(oldName, 'branch')
    assertRef(newName, 'nome de branch')
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
      message: `${prefix}${status.conflicted.length ? 'Há conflitos para resolver.' : 'A operação parou e precisa da sua decisão.'}\n${detail}`,
      conflicts: status.conflicted.map((f) => f.path)
    }
  }

  async merge(ref: string, target?: string, noFastForward = false): Promise<OperationResult> {
    assertRef(ref)
    if (target) await this.ensureOnBranch(target)
    try {
      const { stdout } = await this.git(['merge', '--no-edit', ...(noFastForward ? ['--no-ff'] : []), ref])
      return { ok: true, message: stdout.trim() || `Merge de ${ref} concluído.`, conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async rebase(branch: string, onto: string): Promise<OperationResult> {
    assertRef(branch, 'branch')
    assertRef(onto)
    try {
      await this.git(['rebase', onto, branch])
      return { ok: true, message: `${branch} agora está sobre ${onto}.`, conflicts: [] }
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
    if (!shas.length) throw new Error('Selecione ao menos um commit.')
    const { ordered, parents } = await this.orderCommits(shas)
    await this.ensureOnBranch(target)
    const hasMerge = ordered.some((s) => (parents.get(s)?.length ?? 0) > 1)
    const args = ['cherry-pick']
    if (options.recordOrigin) args.push('-x')
    if (options.noCommit) args.push('--no-commit')
    if (hasMerge) args.push('-m', '1')
    try {
      await this.git([...args, ...ordered])
      return { ok: true, message: `${ordered.length} commit(s) aplicado(s) em ${target}.`, conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async cherryPickBranch(source: string, target: string, options: CherryPickOptions = {}): Promise<OperationResult> {
    const commits = (await this.branchCommits(source, target)).filter((c) => !c.alreadyApplied)
    if (!commits.length) return { ok: true, message: `Nada a aplicar: ${target} já contém tudo de ${source}.`, conflicts: [] }
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
      throw new Error('Já existem alterações no stage. Faça commit ou unstage delas antes de aplicar com commit automático.')
    }
  }

  async cherryPickFiles(
    target: string,
    shas: string[],
    paths: string[],
    mode: FileApplyMode,
    options: PartialApplyOptions = {}
  ): Promise<OperationResult> {
    if (!shas.length) throw new Error('Selecione ao menos um commit.')
    if (!paths.length) throw new Error('Selecione ao menos um arquivo.')
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
            `Conflito ao aplicar ${sha.slice(0, 8)}${left ? ` (${left} commit(s) restantes não foram aplicados)` : ''}. `
          )
        }
      }
    }

    if (options.commitMessage) await this.commit(options.commitMessage)
    const what = mode === 'version' ? 'Versão dos arquivos copiada' : 'Alterações dos arquivos aplicadas'
    return {
      ok: true,
      message: `${what} em ${target}${options.commitMessage ? ' e commit criado' : ' (no stage, pronto para commit)'}.`,
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
    if (source.kind !== 'commit' && source.kind !== 'range') throw new Error('A origem das linhas deve ser um commit ou intervalo.')
    await this.ensureOnBranch(target)
    await this.assertCanCommitAfter(options)
    const result = await this.applyLines(source, path, lines, 'apply')
    if (!result.ok) return result
    if (options.commitMessage) await this.commit(options.commitMessage)
    return {
      ok: true,
      message: `${lines.length} linha(s) aplicada(s) em ${target}${options.commitMessage ? ' e commit criado' : ' (no stage, pronto para commit)'}.`,
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
    if (status.conflicted.length) throw new Error('Ainda há conflitos. Resolva todos os arquivos antes de continuar.')
    const commands: Record<string, string[]> = {
      'cherry-pick': ['cherry-pick', '--continue'],
      revert: ['revert', '--continue'],
      rebase: ['rebase', '--continue'],
      merge: ['commit', '--no-edit']
    }
    const command = commands[op.kind]
    if (!command) throw new Error('Não há operação em andamento.')
    try {
      await this.git(command)
      return { ok: true, message: 'Operação concluída.', conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async skipOperation(): Promise<OperationResult> {
    const op = await this.operationState()
    if (op.kind === 'none' || op.kind === 'merge') throw new Error('Esta operação não permite pular.')
    try {
      await this.git([op.kind, '--skip'])
      return { ok: true, message: 'Commit pulado.', conflicts: [] }
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
      throw new Error('Não há operação em andamento.')
    }
    await this.git([op.kind, '--abort'])
  }

  // --------------------------------------------------------------- histórico

  async revertCommit(sha: string): Promise<OperationResult> {
    const { parents } = await this.orderCommits([sha])
    const isMerge = ([...parents.values()][0]?.length ?? 0) > 1
    try {
      await this.git(['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha])
      return { ok: true, message: `Commit ${sha.slice(0, 8)} revertido.`, conflicts: [] }
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
    return (stderr || stdout).trim() || 'Fetch concluído.'
  }

  async pull(): Promise<OperationResult> {
    try {
      const { stdout } = await this.git(['pull', '--no-edit'])
      return { ok: true, message: stdout.trim() || 'Pull concluído.', conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async push(): Promise<string> {
    const status = await this.status()
    if (!status.branch) throw new Error('Faça checkout de uma branch para enviar (push).')
    let args = ['push']
    if (!status.upstream) {
      const { stdout } = await this.git(['remote'])
      const remotes = stdout.split('\n').filter(Boolean)
      if (!remotes.length) throw new Error('Este repositório não tem remotos configurados.')
      const remote = remotes.includes('origin') ? 'origin' : remotes[0]
      args = ['push', '-u', remote, status.branch]
    }
    const { stderr, stdout } = await this.git(args)
    return (stderr || stdout).trim() || 'Push concluído.'
  }

  // ------------------------------------------------------------------- stash

  async stash(message?: string): Promise<void> {
    await this.git(['stash', 'push', '--include-untracked', ...(message ? ['-m', message] : [])])
  }

  async stashApply(index: number, pop = false): Promise<OperationResult> {
    try {
      await this.git(['stash', pop ? 'pop' : 'apply', `stash@{${Number(index)}}`])
      return { ok: true, message: pop ? 'Stash aplicado e removido.' : 'Stash aplicado.', conflicts: [] }
    } catch (error) {
      return this.conflictResult(error)
    }
  }

  async stashDrop(index: number): Promise<void> {
    await this.git(['stash', 'drop', `stash@{${Number(index)}}`])
  }
}
