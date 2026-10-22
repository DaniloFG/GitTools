import { describe, expect, it } from 'vitest'
import { buildEntries, sumStats, summarizeChanges } from '../src/renderer/src/changeEntries'
import type { FileStatus } from '../src/shared/types'

const file = (path: string, extra: Partial<FileStatus> = {}): FileStatus => ({ path, index: '.', worktree: 'M', untracked: false, conflicted: false, ...extra })

describe('arquivos alterados', () => {
  it('junta as duas listas: arquivo com partes nos dois lados aparece uma vez', () => {
    const entries = buildEntries({ unstaged: [file('a.txt'), file('b.txt')], staged: [file('b.txt', { index: 'M', worktree: '.' }), file('c.txt', { index: 'A', worktree: '.' })] })
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(entries[0].staged).toBeUndefined()
    expect(entries[1].staged && entries[1].unstaged).toBeTruthy()
    expect(entries[2].unstaged).toBeUndefined()
  })

  it('guarda o nome antigo de renomeações', () => {
    const [e] = buildEntries({ unstaged: [], staged: [file('novo.txt', { origPath: 'velho.txt', index: 'R' })] })
    expect(e.origPath).toBe('velho.txt')
  })

  it('soma as linhas das duas partes', () => {
    expect(sumStats({ additions: 2, deletions: 1 }, { additions: 3, deletions: 0 })).toEqual({ additions: 5, deletions: 1 })
    expect(sumStats({ additions: 2, deletions: 1 })).toEqual({ additions: 2, deletions: 1 })
    expect(sumStats({ binary: true }, { additions: 1 })).toEqual({ binary: true })
    expect(sumStats({}, {})).toEqual({})
  })

  it('resume: sem alterações tudo é zero; conflitos contam como arquivos', () => {
    expect(summarizeChanges({ unstaged: [], staged: [], conflicted: [] })).toMatchObject({ files: 0, unstaged: 0, staged: 0, conflicted: 0 })
    const s = summarizeChanges({ unstaged: [file('a')], staged: [file('a', { index: 'M' }), file('b', { index: 'A' })], conflicted: [file('c', { conflicted: true })] })
    expect(s).toMatchObject({ files: 3, unstaged: 1, staged: 2, conflicted: 1 })
  })
})
