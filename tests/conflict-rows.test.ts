import { describe, expect, it } from 'vitest'
import { buildConflictRows, conflictKind, nextPending, type ConflictKind, type ConflictRow } from '../src/renderer/src/conflictRows'
import type { FileStatus } from '../src/shared/types'

function file(path: string, index: string, worktree: string): FileStatus {
  return { path, index, worktree, untracked: false, conflicted: true }
}

function row(path: string, resolved: ConflictRow['resolved'] = null): ConflictRow {
  return { path, kind: 'bothModified', resolved }
}

describe('conflictKind', () => {
  it('reconhece os sete pares que o git grava numa linha de conflito', () => {
    const cases: [string, string, ConflictKind][] = [
      ['U', 'U', 'bothModified'],
      ['A', 'A', 'bothAdded'],
      ['D', 'D', 'bothDeleted'],
      ['A', 'U', 'addedByUs'],
      ['U', 'A', 'addedByThem'],
      ['D', 'U', 'deletedByUs'],
      ['U', 'D', 'deletedByThem']
    ]
    for (const [index, worktree, kind] of cases) {
      expect(conflictKind(index, worktree)).toBe(kind)
    }
  })

  it('um arquivo modificado sem conflito não é conflito', () => {
    expect(conflictKind('M', ' ')).toBeNull()
  })

  it('outros pares não são conflito, nem códigos de mais de um caractere', () => {
    expect(conflictKind('M', 'U')).toBeNull()
    expect(conflictKind('?', '?')).toBeNull()
    expect(conflictKind('.', 'U')).toBeNull()
    // Sem a conferência de tamanho, 'UU' + '' seria lido como 'UU'.
    expect(conflictKind('UU', '')).toBeNull()
    expect(conflictKind('U', '')).toBeNull()
  })
})

describe('buildConflictRows', () => {
  it('uma linha por conflito, na ordem do status, e descarta o que não é conflito', () => {
    const rows = buildConflictRows(
      [file('b.ts', 'U', 'U'), file('c.ts', 'M', ' '), file('a.ts', 'A', 'A')],
      new Map()
    )
    expect(rows).toEqual([
      { path: 'b.ts', kind: 'bothModified', resolved: null },
      { path: 'a.ts', kind: 'bothAdded', resolved: null }
    ])
  })

  it('lista vazia gera linhas vazias', () => {
    expect(buildConflictRows([], new Map())).toEqual([])
  })

  it('lembra o lado escolhido de cada arquivo que tem decisão', () => {
    const rows = buildConflictRows(
      [file('a.ts', 'U', 'U'), file('b.ts', 'D', 'U')],
      new Map([
        ['a.ts', 'ours' as const],
        ['b.ts', 'theirs' as const]
      ])
    )
    expect(rows.map((r) => [r.path, r.resolved])).toEqual([
      ['a.ts', 'ours'],
      ['b.ts', 'theirs']
    ])
  })

  it('decisão de arquivo que não está em conflito não vira linha', () => {
    const rows = buildConflictRows([file('a.ts', 'U', 'U')], new Map([['fora.ts', 'ours' as const]]))
    expect(rows.map((r) => r.path)).toEqual(['a.ts'])
  })
})

describe('nextPending', () => {
  it('sem pendentes, null (com ou sem atual)', () => {
    const rows = [row('a.ts', 'ours'), row('b.ts', 'theirs')]
    expect(nextPending(rows, 'a.ts')).toBeNull()
    expect(nextPending(rows, null)).toBeNull()
    expect(nextPending([], null)).toBeNull()
  })

  it('avança para o próximo pendente, pulando os decididos', () => {
    const rows = [row('a.ts'), row('b.ts', 'ours'), row('c.ts')]
    expect(nextPending(rows, 'a.ts')).toBe('c.ts')
  })

  it('atual no último volta ao primeiro pendente', () => {
    const rows = [row('a.ts'), row('b.ts', 'ours'), row('c.ts')]
    expect(nextPending(rows, 'c.ts')).toBe('a.ts')
  })

  it('atual no último, sendo o único pendente, fica nele', () => {
    const rows = [row('a.ts', 'ours'), row('b.ts')]
    expect(nextPending(rows, 'b.ts')).toBe('b.ts')
  })

  it('atual fora da lista começa do primeiro pendente', () => {
    const rows = [row('a.ts', 'ours'), row('b.ts')]
    expect(nextPending(rows, 'fora.ts')).toBe('b.ts')
    expect(nextPending(rows, null)).toBe('b.ts')
  })
})
