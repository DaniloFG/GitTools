import { describe, expect, it } from 'vitest'
import { readLayout, resetLayout, writeLayout } from '../src/renderer/src/layout'
import { clampSize, parseColumns, parseSplitState, resizeColumns, stateFromPosition } from '../src/renderer/src/panes'

const limits = { available: 1000, min: [200, 300] as [number, number], collapsible: [true, true] as [boolean, boolean], fixed: false }

describe('painéis redimensionáveis', () => {
  it('respeita o mínimo de cada painel', () => {
    expect(clampSize(500, 1000, 200, 300)).toBe(500)
    expect(clampSize(100, 1000, 200, 300)).toBe(200)
    expect(clampSize(900, 1000, 200, 300)).toBe(700)
  })

  it('divide o espaço na proporção dos mínimos quando a janela é pequena demais', () => {
    expect(clampSize(400, 250, 200, 300)).toBe(100)
    expect(clampSize(400, 0, 200, 300)).toBe(400)
  })

  it('guarda fração do espaço, ou pixels nos painéis fixos', () => {
    expect(stateFromPosition(400, {}, limits)).toEqual({ size: 0.4 })
    expect(stateFromPosition(260.4, {}, { ...limits, fixed: true })).toEqual({ size: 260 })
    expect(stateFromPosition(950, {}, { ...limits, collapsible: [true, false] })).toEqual({ size: 0.7 })
  })

  it('recolhe o painel ao arrastar além da metade do mínimo e o mostra de novo ao voltar', () => {
    const collapsed = stateFromPosition(50, { size: 0.3 }, limits)
    expect(collapsed).toEqual({ size: 0.3, collapsed: 'first' })
    expect(stateFromPosition(900, { size: 0.3 }, limits)).toEqual({ size: 0.3, collapsed: 'second' })
    expect(stateFromPosition(500, collapsed, limits)).toEqual({ size: 0.5 })
    expect(stateFromPosition(50, {}, { ...limits, collapsible: [false, true] })).toEqual({ size: 0.2 })
  })

  it('ignora valores guardados inválidos', () => {
    expect(parseSplitState({ size: 0.4, collapsed: 'first' })).toEqual({ size: 0.4, collapsed: 'first' })
    expect(parseSplitState({ size: -1, collapsed: 'middle' })).toEqual({})
    expect(parseSplitState('lixo')).toEqual({})
    expect(parseColumns([1, 2, 1], 3)).toEqual([1, 2, 1])
    expect(parseColumns([1, 0, 1], 3)).toBeNull()
    expect(parseColumns([1, 1], 3)).toBeNull()
  })

  it('redimensiona duas colunas vizinhas sem mudar a soma nem passar do mínimo', () => {
    expect(resizeColumns([1, 1, 1], 0, 0.5, 0.25)).toEqual([1.5, 0.5, 1])
    expect(resizeColumns([1, 1, 1], 1, 5, 0.25)).toEqual([1, 1.75, 0.25])
    expect(resizeColumns([1, 1, 1], 0, -5, 0.25)).toEqual([0.25, 1.75, 1])
  })
})

describe('layout guardado', () => {
  it('lê, grava e restaura o padrão (mesmo sem armazenamento local)', () => {
    expect(readLayout('teste.a')).toBeUndefined()
    writeLayout('teste.a', { size: 0.3 })
    writeLayout('teste.b', true)
    expect(readLayout('teste.a')).toEqual({ size: 0.3 })
    writeLayout('teste.b', undefined)
    expect(readLayout('teste.b')).toBeUndefined()
    resetLayout()
    expect(readLayout('teste.a')).toBeUndefined()
  })
})
