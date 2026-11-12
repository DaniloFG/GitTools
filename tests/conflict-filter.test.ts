import { describe, expect, it } from 'vitest'
import { filterConflictRows, type ConflictFilter } from '../src/renderer/src/conflictFilter'
import type { ConflictKind, ConflictRow } from '../src/renderer/src/conflictRows'

const ALL: ConflictFilter = { kind: 'all', situation: 'all', query: '' }

function row(path: string, kind: ConflictKind = 'bothModified', resolved: ConflictRow['resolved'] = null): ConflictRow {
  return { path, kind, resolved }
}

const rows: ConflictRow[] = [
  row('src/a.ts', 'bothModified'),
  row('src/b.ts', 'bothAdded', 'ours'),
  row('docs/Ação.ts', 'deletedByUs', 'theirs'),
  row('lib/c.ts', 'bothDeleted')
]

const paths = (list: readonly ConflictRow[]) => list.map((r) => r.path)

describe('filterConflictRows', () => {
  it('sem nenhum filtro devolve a mesma referência do array', () => {
    expect(filterConflictRows(rows, ALL)).toBe(rows)
  })

  it('busca só com espaços conta como sem busca', () => {
    expect(filterConflictRows(rows, { ...ALL, query: '   ' })).toBe(rows)
  })

  it('lista vazia: sem filtro devolve a mesma lista, com filtro devolve vazia', () => {
    const empty: ConflictRow[] = []
    expect(filterConflictRows(empty, ALL)).toBe(empty)
    expect(filterConflictRows(empty, { ...ALL, query: 'a' })).toEqual([])
    expect(filterConflictRows(empty, { ...ALL, kind: 'bothAdded' })).toEqual([])
  })

  it('filtra por tipo', () => {
    expect(paths(filterConflictRows(rows, { ...ALL, kind: 'bothAdded' }))).toEqual(['src/b.ts'])
  })

  it('filtra por situação: pendente e decidido', () => {
    expect(paths(filterConflictRows(rows, { ...ALL, situation: 'pending' }))).toEqual(['src/a.ts', 'lib/c.ts'])
    expect(paths(filterConflictRows(rows, { ...ALL, situation: 'decided' }))).toEqual(['src/b.ts', 'docs/Ação.ts'])
  })

  it('combina tipo e situação; sem resultado devolve lista vazia', () => {
    expect(filterConflictRows(rows, { kind: 'bothModified', situation: 'decided', query: '' })).toEqual([])
  })

  it('sem resultado para a busca devolve lista vazia', () => {
    expect(filterConflictRows(rows, { ...ALL, query: 'zzz' })).toEqual([])
  })

  it('acha nome com acento sem acento e sem maiúsculas', () => {
    expect(paths(filterConflictRows(rows, { ...ALL, query: 'acao' }))).toEqual(['docs/Ação.ts'])
    expect(paths(filterConflictRows(rows, { ...ALL, query: 'AÇÃO' }))).toEqual(['docs/Ação.ts'])
    expect(paths(filterConflictRows(rows, { ...ALL, query: 'ação' }))).toEqual(['docs/Ação.ts'])
  })

  it('busca também pelo diretório, que a lista mostra', () => {
    expect(paths(filterConflictRows(rows, { ...ALL, query: 'lib/' }))).toEqual(['lib/c.ts'])
  })

  it('com 1.500 linhas, filtra certo e sem devolver cópia quando não há filtro', () => {
    const KINDS: ConflictKind[] = ['bothModified', 'bothAdded', 'bothDeleted', 'addedByUs', 'addedByThem', 'deletedByUs', 'deletedByThem']
    const big: ConflictRow[] = Array.from({ length: 1500 }, (_, i) => ({
      path: `pasta${i % 30}/arquivo${i}.ts`,
      kind: KINDS[i % KINDS.length],
      resolved: i % 3 === 0 ? 'ours' : null
    }))
    expect(filterConflictRows(big, ALL)).toBe(big)
    // i = 0, 7, ..., 1498: 215 linhas do primeiro tipo.
    expect(filterConflictRows(big, { ...ALL, kind: 'bothModified' })).toHaveLength(215)
    // i múltiplo de 3 (0 a 1497) está decidido: 500; os outros 1000 estão pendentes.
    expect(filterConflictRows(big, { ...ALL, situation: 'decided' })).toHaveLength(500)
    expect(filterConflictRows(big, { ...ALL, situation: 'pending' })).toHaveLength(1000)
    expect(paths(filterConflictRows(big, { ...ALL, query: 'arquivo1499' }))).toEqual(['pasta29/arquivo1499.ts'])
  })
})
