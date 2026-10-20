import { describe, expect, it } from 'vitest'
import { computeGraph } from '../src/renderer/src/graph'

describe('computeGraph', () => {
  it('mantém um histórico linear em uma coluna', () => {
    const rows = computeGraph([
      { sha: 'c', parents: ['b'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] }
    ])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[2].lanesOut).toEqual([])
  })

  it('abre uma trilha para o segundo pai de um merge e fecha ao convergir', () => {
    const rows = computeGraph([
      { sha: 'm', parents: ['a', 'f'] },
      { sha: 'f', parents: ['base'] },
      { sha: 'a', parents: ['base'] },
      { sha: 'base', parents: [] }
    ])
    expect(rows[0].lanesOut).toEqual(['a', 'f'])
    expect(rows[1].column).toBe(1)
    expect(rows[2].column).toBe(0)
    expect(rows[2].lanesOut).toEqual(['base', 'base'])
    expect(rows[3].column).toBe(0)
    expect(rows[3].lanesOut).toEqual([])
  })

  it('coloca pontas de branches diferentes em colunas diferentes', () => {
    const rows = computeGraph([
      { sha: 'x', parents: ['base'] },
      { sha: 'y', parents: ['base'] },
      { sha: 'base', parents: [] }
    ])
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0])
  })
})
