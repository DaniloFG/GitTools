import { describe, expect, it } from 'vitest'
import {
  arrowBetween,
  DEFAULT_MERGE_LAYOUT,
  nextConflict,
  panePosition,
  parseMergeLayout,
  sourcesByPosition,
  swapPanes,
  withMode,
  type MergeLayout
} from '../src/renderer/src/mergeLayout'

const columns = (order: MergeLayout['order']): MergeLayout => ({ mode: 'columns', order })
const classic = (order: MergeLayout['order']): MergeLayout => ({ mode: 'classic', order })

describe('arranjo dos painéis de conflito', () => {
  it('valida o que foi guardado', () => {
    expect(parseMergeLayout(undefined)).toEqual(DEFAULT_MERGE_LAYOUT)
    expect(parseMergeLayout({ mode: 'classic' })).toEqual(classic(['ours', 'theirs', 'result']))
    expect(parseMergeLayout({ mode: 'columns', order: ['theirs', 'ours', 'result'] })).toEqual(columns(['theirs', 'ours', 'result']))
    expect(parseMergeLayout({ mode: 'columns', order: ['ours', 'ours', 'result'] })).toEqual(DEFAULT_MERGE_LAYOUT)
  })

  it('troca painéis de lugar e volta ao padrão ao mudar de visão', () => {
    const swapped = swapPanes(DEFAULT_MERGE_LAYOUT, 'result', 'theirs')
    expect(swapped.order).toEqual(['ours', 'theirs', 'result'])
    expect(swapPanes(swapped, 'ours', 'ours')).toBe(swapped)
    expect(withMode(swapped, 'classic')).toEqual(classic(['ours', 'theirs', 'result']))
    expect(withMode(swapped, 'columns')).toBe(swapped)
  })

  it('aponta as setas para onde o resultado está, em qualquer arranjo', () => {
    // Padrão do SmartGit: atual | resultado | que entra.
    expect(arrowBetween(DEFAULT_MERGE_LAYOUT, 'ours', 'result')).toBe('→')
    expect(arrowBetween(DEFAULT_MERGE_LAYOUT, 'theirs', 'result')).toBe('←')
    // Resultado na primeira coluna: as duas versões mandam o texto para a esquerda.
    const resultFirst = columns(['result', 'ours', 'theirs'])
    expect(arrowBetween(resultFirst, 'ours', 'result')).toBe('←')
    expect(arrowBetween(resultFirst, 'theirs', 'result')).toBe('←')
    expect(arrowBetween(resultFirst, 'result', 'theirs')).toBe('→')
    // Clássica: versões em cima, resultado embaixo no meio.
    const c = classic(['ours', 'theirs', 'result'])
    expect(arrowBetween(c, 'ours', 'result')).toBe('↘')
    expect(arrowBetween(c, 'theirs', 'result')).toBe('↙')
    expect(arrowBetween(c, 'result', 'ours')).toBe('↖')
    // Clássica com o resultado em cima à direita e a versão que entra embaixo.
    const c2 = classic(['ours', 'result', 'theirs'])
    expect(arrowBetween(c2, 'ours', 'result')).toBe('→')
    expect(arrowBetween(c2, 'theirs', 'result')).toBe('↗')
  })

  it('espelha as colunas em idiomas da direita para a esquerda', () => {
    expect(panePosition(DEFAULT_MERGE_LAYOUT, 'ours', true)).toEqual({ x: 2, y: 0 })
    expect(arrowBetween(DEFAULT_MERGE_LAYOUT, 'ours', 'result', true)).toBe('←')
    expect(arrowBetween(classic(['ours', 'theirs', 'result']), 'ours', 'result', true)).toBe('↙')
  })

  it('sabe qual versão está à esquerda e qual está à direita', () => {
    expect(sourcesByPosition(DEFAULT_MERGE_LAYOUT)).toEqual(['ours', 'theirs'])
    expect(sourcesByPosition(columns(['theirs', 'result', 'ours']))).toEqual(['theirs', 'ours'])
    expect(sourcesByPosition(columns(['result', 'theirs', 'ours']))).toEqual(['theirs', 'ours'])
    expect(sourcesByPosition(DEFAULT_MERGE_LAYOUT, true)).toEqual(['theirs', 'ours'])
    // Clássica com a versão atual embaixo (x = meio) e a que entra em cima à direita.
    expect(sourcesByPosition(classic(['result', 'theirs', 'ours']))).toEqual(['ours', 'theirs'])
  })
})

describe('navegação entre conflitos', () => {
  it('anda na ordem do arquivo e para nas pontas', () => {
    expect(nextConflict(0, 3, 1)).toBe(1)
    expect(nextConflict(2, 3, 1)).toBeNull()
    expect(nextConflict(0, 3, -1)).toBeNull()
    expect(nextConflict(-1, 3, 1)).toBe(0)
    expect(nextConflict(0, 0, 1)).toBeNull()
  })

  it('procura o próximo pendente dando a volta', () => {
    const resolved = new Set([1, 2])
    expect(nextConflict(0, 4, 1, (i) => resolved.has(i), true)).toBe(3)
    expect(nextConflict(3, 4, 1, (i) => resolved.has(i), true)).toBe(0)
    expect(nextConflict(0, 3, 1, () => true, true)).toBeNull()
    expect(nextConflict(0, 3, -1, (i) => i === 2, true)).toBe(1)
  })
})
