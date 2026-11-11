import { describe, expect, it } from 'vitest'
import type { BlameCommit, RepoStatus } from '../src/shared/types'
import { blameColors, blameRowFlags, blameSignature, isUncommitted } from '../src/renderer/src/blameRows'

const commit = (sha: string, date: number): BlameCommit => ({ sha, author: 'a', email: 'a@x', date, summary: `s ${sha}` })
const UNC = '0000000000000000000000000000000000000000'

describe('blameColors', () => {
  it('o commit mais antigo fica com 15% e o mais novo com 100%', () => {
    const colors = blameColors({ aaa: commit('aaa', 100), bbb: commit('bbb', 200), ccc: commit('ccc', 300) })
    expect(colors.get('aaa')).toBe('color-mix(in srgb, var(--accent) 15%, transparent)')
    expect(colors.get('bbb')).toBe('color-mix(in srgb, var(--accent) 58%, transparent)')
    expect(colors.get('ccc')).toBe('color-mix(in srgb, var(--accent) 100%, transparent)')
  })

  it('linha não commitada fica no máximo e não entra no intervalo de datas', () => {
    const colors = blameColors({ aaa: commit('aaa', 100), bbb: commit('bbb', 200), [UNC]: commit(UNC, 1_000_000) })
    expect(colors.get(UNC)).toBe('color-mix(in srgb, var(--accent) 100%, transparent)')
    expect(colors.get('aaa')).toBe('color-mix(in srgb, var(--accent) 15%, transparent)')
  })

  it('um único commit (sem intervalo de datas) fica no máximo, e sem commits não há cores', () => {
    expect(blameColors({ aaa: commit('aaa', 100) }).get('aaa')).toBe('color-mix(in srgb, var(--accent) 100%, transparent)')
    expect(blameColors({}).size).toBe(0)
  })
})

describe('blameRowFlags', () => {
  it('a primeira linha de cada bloco de commit é a "first"; a segunda mostra o resumo', () => {
    const lines = [{ sha: 'A' }, { sha: 'A' }, { sha: 'A' }, { sha: 'B' }, { sha: 'B' }]
    expect(blameRowFlags(lines, 0)).toEqual({ first: true, second: false })
    expect(blameRowFlags(lines, 1)).toEqual({ first: false, second: true })
    expect(blameRowFlags(lines, 2)).toEqual({ first: false, second: false })
    expect(blameRowFlags(lines, 3)).toEqual({ first: true, second: false })
    expect(blameRowFlags(lines, 4)).toEqual({ first: false, second: true })
  })

  it('um bloco de uma linha só tem "first" e nenhuma "second"', () => {
    const lines = [{ sha: 'A' }, { sha: 'B' }]
    expect(blameRowFlags(lines, 1)).toEqual({ first: true, second: false })
  })

  it('uma linha que abre um bloco no início de outro bloco de 40 linhas continua certa (olha a lista inteira)', () => {
    // Bloco de linhas 40..79 começa no meio de um commit: a linha 40 não é "first", a 41 é "second".
    const lines = Array.from({ length: 100 }, (_, i) => ({ sha: i < 45 ? 'A' : 'B' }))
    expect(blameRowFlags(lines, 40)).toEqual({ first: false, second: false })
    expect(blameRowFlags(lines, 45)).toEqual({ first: true, second: false })
    expect(blameRowFlags(lines, 46)).toEqual({ first: false, second: true })
  })
})

const status = (over: Partial<RepoStatus> = {}): Pick<RepoStatus, 'headSha' | 'staged' | 'unstaged' | 'conflicted'> => ({
  headSha: 'h1',
  staged: [],
  unstaged: [],
  conflicted: [],
  ...over
})
const fs = (path: string, over: Record<string, unknown> = {}) => ({ path, index: '.', worktree: 'M', untracked: false, conflicted: false, additions: 1, deletions: 1, ...over })

describe('blameSignature', () => {
  it('igual enquanto o HEAD e o arquivo não mudam, mesmo com mudança em outro arquivo', () => {
    const a = blameSignature('/r', status({ unstaged: [fs('x.ts')] }), 'x.ts', undefined)
    const b = blameSignature('/r', status({ unstaged: [fs('x.ts'), fs('outro.ts', { additions: 9 })] }), 'x.ts', undefined)
    expect(b).toBe(a)
  })

  it('muda quando o HEAD muda', () => {
    expect(blameSignature('/r', status({ headSha: 'h2' }), 'x.ts', undefined)).not.toBe(blameSignature('/r', status(), 'x.ts', undefined))
  })

  it('muda quando o próprio arquivo entra, sai ou muda de contagem no status', () => {
    const base = blameSignature('/r', status(), 'x.ts', undefined)
    expect(blameSignature('/r', status({ unstaged: [fs('x.ts')] }), 'x.ts', undefined)).not.toBe(base)
    expect(blameSignature('/r', status({ unstaged: [fs('x.ts', { additions: 2 })] }), 'x.ts', undefined)).not.toBe(
      blameSignature('/r', status({ unstaged: [fs('x.ts')] }), 'x.ts', undefined)
    )
    expect(blameSignature('/r', status({ staged: [fs('x.ts', { index: 'M', worktree: '.' })] }), 'x.ts', undefined)).not.toBe(
      blameSignature('/r', status({ unstaged: [fs('x.ts')] }), 'x.ts', undefined)
    )
  })

  it('com rev, só o arquivo e a versão importam (mudança de status não relê uma versão antiga)', () => {
    const a = blameSignature('/r', status({ headSha: 'h1' }), 'x.ts', 'abc')
    expect(blameSignature('/r', status({ headSha: 'h2', unstaged: [fs('x.ts')] }), 'x.ts', 'abc')).toBe(a)
    expect(blameSignature('/r', status(), 'x.ts', 'def')).not.toBe(a)
  })

  it('trocar de repositório sempre muda a assinatura', () => {
    expect(blameSignature('/r1', status(), 'x.ts', undefined)).not.toBe(blameSignature('/r2', status(), 'x.ts', undefined))
    expect(blameSignature('/r1', status(), 'x.ts', 'abc')).not.toBe(blameSignature('/r2', status(), 'x.ts', 'abc'))
  })
})

describe('isUncommitted', () => {
  it('reconhece o sha de zeros do git e nenhum outro', () => {
    expect(isUncommitted(UNC)).toBe(true)
    expect(isUncommitted('abc1234')).toBe(false)
  })
})
