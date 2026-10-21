import { describe, expect, it } from 'vitest'
import { commitColors, computeGraph, graphFor, matchesCommit, refName } from '../src/renderer/src/graph'

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

describe('cores das trilhas', () => {
  it('uma trilha mantém a cor ao mudar de coluna, e cada branch nova ganha outra cor', () => {
    // x e y são pontas de branches diferentes; y muda para a coluna 0 quando x termina em base.
    const rows = computeGraph([
      { sha: 'x', parents: ['base'] },
      { sha: 'y', parents: ['y0'] },
      { sha: 'base', parents: [] },
      { sha: 'y0', parents: [] }
    ])
    expect(rows[0].color).not.toBe(rows[1].color)
    // y0 continua a trilha de y: mesma cor, mesmo que a coluna seja reaproveitada.
    expect(rows[3].color).toBe(rows[1].color)
    expect(rows[1].colorsOut[rows[1].column]).toBe(rows[1].color)
  })

  it('o primeiro pai herda a cor; o segundo pai de um merge abre uma trilha com cor nova', () => {
    const rows = computeGraph([
      { sha: 'm', parents: ['a', 'f'] },
      { sha: 'f', parents: ['base'] },
      { sha: 'a', parents: ['base'] },
      { sha: 'base', parents: [] }
    ])
    const main = rows[0].color
    expect(rows[2].color).toBe(main)
    expect(rows[3].color).toBe(main)
    expect(rows[1].color).not.toBe(main)
    expect(rows[0].colorsOut).toEqual([main, rows[1].color])
    // A trilha de f, que converge em base, chega com a cor dela.
    expect(rows[3].colorsIn[1]).toBe(rows[1].color)
  })

  it('reaproveita o cálculo da mesma lista e dá a cor de cada commit', () => {
    const log = [
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] }
    ]
    expect(graphFor(log)).toBe(graphFor(log))
    expect(commitColors(log).get('a')).toBe(commitColors(log).get('b'))
  })
})

describe('pesquisa no histórico', () => {
  const commit = { sha: 'abc1234def', parents: [], subject: 'Corrige o login', author: 'Ana', refs: ['HEAD -> feature/login', 'origin/main', 'tag: v1.2'] }

  it('acha pela branch, tag, mensagem, autor ou início do hash', () => {
    expect(matchesCommit(commit, 'feature/log')).toBe(true)
    expect(matchesCommit(commit, 'origin/main')).toBe(true)
    expect(matchesCommit(commit, 'v1.2')).toBe(true)
    expect(matchesCommit(commit, 'LOGIN')).toBe(true)
    expect(matchesCommit(commit, 'ana')).toBe(true)
    expect(matchesCommit(commit, 'abc12')).toBe(true)
    expect(matchesCommit(commit, '')).toBe(true)
  })

  it('exige todos os termos e não acha hash pelo meio', () => {
    expect(matchesCommit(commit, 'login ana')).toBe(true)
    expect(matchesCommit(commit, 'login bruno')).toBe(false)
    expect(matchesCommit(commit, 'def')).toBe(false)
    expect(refName('HEAD -> main')).toBe('main')
    expect(refName('tag: v1')).toBe('v1')
  })
})

describe('linha do HEAD', () => {
  it('mantém a cor da branch atual quando outra trilha converge no mesmo commit', () => {
    // hotfix (aparece antes) e main saem do mesmo commit m; o HEAD está em main.
    const log = [
      { sha: 'hotfix', parents: ['m'] },
      { sha: 'main', parents: ['m'] },
      { sha: 'm', parents: ['base'] },
      { sha: 'base', parents: [] }
    ]
    const plain = computeGraph(log)
    expect(plain[2].color).toBe(plain[0].color)
    const rows = computeGraph(log, 'main')
    expect(rows[2].color).toBe(rows[1].color)
    expect(rows[3].color).toBe(rows[1].color)
    expect(rows[2].column).toBe(rows[1].column)
  })
})
