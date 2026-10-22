import { describe, expect, it } from 'vitest'
import { historySignature, keepIfEqual, mergeData } from '../src/renderer/src/stable'
import type { BranchInfo, CommitInfo, OperationState, RepoStatus, StashInfo, TagInfo } from '../src/shared/types'

interface RepoData {
  status: RepoStatus
  branches: BranchInfo[]
  tags: TagInfo[]
  stashes: StashInfo[]
  log: CommitInfo[]
  operation: OperationState
}

const status = (patch: Partial<RepoStatus> = {}): RepoStatus => ({
  branch: 'main',
  detached: false,
  headSha: 'aaa',
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  conflicted: [],
  ...patch
})
const branch = (name: string, sha: string): BranchInfo => ({
  name,
  fullRef: `refs/heads/${name}`,
  remote: null,
  sha,
  upstream: null,
  ahead: 0,
  behind: 0,
  current: name === 'main',
  date: 0,
  subject: ''
})
const data = (patch: Partial<RepoData> = {}): RepoData => ({
  status: status(),
  branches: [branch('main', 'aaa')],
  tags: [],
  stashes: [],
  log: [],
  operation: { kind: 'none' },
  ...patch
})

describe('keepIfEqual', () => {
  it('mantém a referência antiga quando o conteúdo é igual e usa a nova quando mudou', () => {
    const prev = { a: [1, 2] }
    expect(keepIfEqual(prev, { a: [1, 2] })).toBe(prev)
    const next = { a: [1, 3] }
    expect(keepIfEqual(prev, next)).toBe(next)
    expect(keepIfEqual(undefined, next)).toBe(next)
  })
})

describe('mergeData', () => {
  it('devolve exatamente o objeto anterior quando nada mudou (a tela não é redesenhada)', () => {
    const prev = data()
    expect(mergeData(prev, data())).toBe(prev)
  })

  it('reaproveita só as partes iguais quando algo mudou', () => {
    const prev = data()
    const next = mergeData(prev, data({ status: status({ ahead: 2 }) }))
    expect(next).not.toBe(prev)
    expect(next.status.ahead).toBe(2)
    expect(next.branches).toBe(prev.branches)
    expect(next.log).toBe(prev.log)
  })

  it('sem dados anteriores usa os novos', () => {
    const next = data()
    expect(mergeData(null, next)).toBe(next)
  })
})

describe('historySignature', () => {
  const sig = (s = status(), b = [branch('main', 'aaa')], tags = [{ name: 'v1', sha: 'ttt' }], scope = 'all') => historySignature(scope, s, b, tags)

  it('não muda com alterações que não mexem no histórico (arquivos, ahead/behind)', () => {
    const base = sig()
    expect(sig(status({ ahead: 3, behind: 1, upstream: 'origin/main' }))).toBe(base)
  })

  it('muda quando o HEAD, uma branch, uma tag, a branch atual ou o escopo mudam', () => {
    const base = sig()
    expect(sig(status({ headSha: 'bbb' }))).not.toBe(base)
    expect(sig(status(), [branch('main', 'bbb')])).not.toBe(base)
    expect(sig(status(), [branch('main', 'aaa'), branch('x', 'aaa')])).not.toBe(base)
    expect(sig(status(), undefined, [{ name: 'v1', sha: 'outro' }])).not.toBe(base)
    expect(sig(status({ branch: 'x' }))).not.toBe(base)
    expect(sig(status({ branch: null, detached: true }))).not.toBe(base)
    expect(sig(status(), undefined, undefined, 'head')).not.toBe(base)
  })
})
