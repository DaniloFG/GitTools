import { describe, expect, it } from 'vitest'
import type { FileDiff, DiffHunk, DiffLine } from '../src/shared/types'
import { lineKey, splitRows } from '../src/shared/diffKeys'
import { BLOCK_ROWS, buildRows, changeBlocks, chunkRows, longestCodeChars, rowKeys, rowKind, type DiffRow } from '../src/renderer/src/diffBlocks'
import { marksFromRows, type RulerIndexRow } from '../src/renderer/src/changeRuler'

const line = (kind: DiffLine['kind'], content: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, content, oldLine, newLine })

/**
 * Arquivo com dois hunks.
 * Hunk 0 (linhas do diff): contexto, duas remoções sobrando, uma remoção emparelhada com uma adição, contexto.
 * Hunk 1: contexto e uma adição sobrando.
 */
function sampleFile(): FileDiff {
  const hunks: DiffHunk[] = [
    {
      oldStart: 1,
      oldCount: 5,
      newStart: 1,
      newCount: 3,
      section: 'function a()',
      lines: [
        line('context', 'um', 1, 1),
        line('del', 'dois', 2, null),
        line('del', 'tres', 3, null),
        line('del', 'quatro', 4, null),
        line('add', 'DOIS', null, 2),
        line('context', 'cinco', 5, 3)
      ]
    },
    {
      oldStart: 20,
      oldCount: 1,
      newStart: 21,
      newCount: 2,
      section: '',
      lines: [line('context', 'vinte', 20, 21), line('add', 'novo', null, 22)]
    }
  ]
  return { oldPath: null, newPath: null, path: 'a.ts', changeType: 'modified', binary: false, headerLines: [], hunks, additions: 2, deletions: 3 }
}

/** Sequência que o DiffView montava antes: o cabeçalho do hunk e depois as linhas (ou os pares lado a lado). */
function legacySequence(file: FileDiff, layout: 'inline' | 'split'): DiffRow[] {
  const out: DiffRow[] = []
  file.hunks.forEach((hunk, h) => {
    out.push({ kind: 'hunk', hunk: h })
    if (layout === 'split') splitRows(hunk).forEach((r) => out.push({ kind: 'split', hunk: h, left: r.left, right: r.right }))
    else hunk.lines.forEach((_, l) => out.push({ kind: 'line', hunk: h, line: l }))
  })
  return out
}

describe('buildRows', () => {
  it('cima e baixo: a mesma sequência de linhas que o diff montava', () => {
    const file = sampleFile()
    expect(buildRows(file, 'inline')).toEqual(legacySequence(file, 'inline'))
    // 2 cabeçalhos + 6 linhas do hunk 0 + 2 do hunk 1.
    expect(buildRows(file, 'inline')).toHaveLength(10)
  })

  it('lado a lado: a mesma sequência de pares que splitRows dá a cada hunk', () => {
    const file = sampleFile()
    expect(buildRows(file, 'split')).toEqual(legacySequence(file, 'split'))
    // Hunk 0: contexto, par (remoção+adição), duas remoções sobrando, contexto.
    expect(buildRows(file, 'split').filter((r) => r.kind === 'split' && r.hunk === 0)).toHaveLength(5)
  })

  it('arquivo sem hunks não tem linhas', () => {
    expect(buildRows({ ...sampleFile(), hunks: [] }, 'inline')).toEqual([])
  })
})

describe('chunkRows', () => {
  it('cobre todas as linhas, sem sobreposição, com o último bloco menor', () => {
    expect(BLOCK_ROWS).toBe(40)
    expect(chunkRows(81)).toEqual([
      { start: 0, end: 40 },
      { start: 40, end: 80 },
      { start: 80, end: 81 }
    ])
  })

  it('zero linhas não tem blocos; tamanho inválido vira 1', () => {
    expect(chunkRows(0)).toEqual([])
    expect(chunkRows(Number.NaN)).toEqual([])
    expect(chunkRows(2, 0)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 }
    ])
  })

  it('25 mil linhas em bem menos de 20 ms (linear)', () => {
    const t0 = performance.now()
    const blocks = chunkRows(25_000)
    expect(blocks).toHaveLength(625)
    expect(performance.now() - t0).toBeLessThan(20)
  })
})

describe('rowKind', () => {
  it('cabeçalho e contexto não têm tipo; alterações têm add, del ou mod', () => {
    const file = sampleFile()
    const inline = buildRows(file, 'inline')
    expect(rowKind(file, inline[0])).toBeNull() // cabeçalho do hunk 0
    expect(rowKind(file, inline[1])).toBeNull() // contexto "um"
    expect(rowKind(file, inline[2])).toBe('del')
    expect(rowKind(file, inline[5])).toBe('add')

    // Lado a lado (linhas: 0 cabeçalho, 1 contexto, 2 par mod, 3 e 4 remoções, 5 contexto, 6 cabeçalho, 7 contexto, 8 adição sobrando).
    const split = buildRows(file, 'split')
    expect(rowKind(file, split[2])).toBe('mod')
    expect(rowKind(file, split[3])).toBe('del')
    expect(rowKind(file, split[8])).toBe('add')
    expect(rowKind(file, split[1])).toBeNull()
  })
})

describe('changeBlocks', () => {
  it('agrupa linhas alteradas seguidas; contexto e cabeçalho separam os blocos', () => {
    const file = sampleFile()
    // Linhas: 0 cab, 1 ctx, 2-4 remoções, 5 adição, 6 ctx, 7 cab, 8 ctx, 9 adição.
    expect(changeBlocks(file, buildRows(file, 'inline'))).toEqual([
      { start: 2, end: 6 },
      { start: 9, end: 10 }
    ])
  })

  it('a última alteração termina no fim da lista', () => {
    const file = sampleFile()
    const rows = buildRows(file, 'inline')
    const blocks = changeBlocks(file, rows)
    expect(blocks[blocks.length - 1].end).toBe(rows.length)
  })

  it('sem alterações não há blocos', () => {
    const file = sampleFile()
    file.hunks = [{ ...file.hunks[0], lines: [line('context', 'a', 1, 1)] }]
    expect(changeBlocks(file, buildRows(file, 'inline'))).toEqual([])
  })
})

describe('rowKeys', () => {
  it('cima e baixo: a chave da própria linha, se for alteração', () => {
    const file = sampleFile()
    const rows = buildRows(file, 'inline')
    expect(rowKeys(file, rows[0])).toEqual([])
    expect(rowKeys(file, rows[1])).toEqual([])
    expect(rowKeys(file, rows[2])).toEqual([lineKey(0, 1)])
  })

  it('lado a lado: as chaves dos dois lados que não forem contexto', () => {
    const file = sampleFile()
    const split = buildRows(file, 'split')
    expect(rowKeys(file, split[2])).toEqual([lineKey(0, 1), lineKey(0, 4)])
    expect(rowKeys(file, split[8])).toEqual([lineKey(1, 1)])
    expect(rowKeys(file, split[1])).toEqual([])
  })
})

describe('marcas da régua a partir das linhas', () => {
  it('uma marca por faixa de alteração seguida, na fração da posição dela', () => {
    const file = sampleFile()
    const rows = buildRows(file, 'inline')
    const indexed: RulerIndexRow[] = []
    rows.forEach((r, i) => {
      const kind = rowKind(file, r)
      if (kind !== null) indexed.push({ index: i, kind })
    })
    const marks = marksFromRows(indexed, rows.length, 0)
    // Linhas 2 a 5 (remoções e uma adição) viram uma marca só, com a cor juntada ('mod'); a linha 9 é outra.
    expect(marks).toEqual([
      { top: 0.2, height: 0.4, kind: 'mod' },
      { top: 0.9, height: 0.1, kind: 'add' }
    ])
  })
})

describe('longestCodeChars (largura do diff sem quebra de linha)', () => {
  const hunk = (...contents: string[]): DiffHunk => ({
    oldStart: 1,
    oldCount: contents.length,
    newStart: 1,
    newCount: contents.length,
    section: '',
    lines: contents.map((c, i) => line('context', c, i + 1, i + 1))
  })

  it('sem linhas, só a folga de 2 caracteres', () => {
    expect(longestCodeChars([])).toBe(2)
  })

  it('pega a maior linha de todos os hunks, mais a folga', () => {
    expect(longestCodeChars([hunk('abc', ''), hunk('abcdefghij')])).toBe(12)
  })

  it('cada tab conta como 8 colunas', () => {
    expect(longestCodeChars([hunk('\t\tx')])).toBe(3 + 14 + 2)
  })

  it('respeita o teto de 5000 caracteres', () => {
    expect(longestCodeChars([hunk('x'.repeat(20000))])).toBe(5000)
  })
})
