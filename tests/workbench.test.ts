import { describe, expect, it } from 'vitest'
import { activate, activeView, areaOf, DEFAULT_WORKBENCH, moveView, parseWorkbench } from '../src/renderer/src/workbench'
import { dockSplit, sideAt } from '../src/renderer/src/panes'

describe('áreas e abas', () => {
  it('valida o arranjo salvo e devolve telas que sumiram para a área padrão', () => {
    expect(parseWorkbench(undefined)).toEqual(DEFAULT_WORKBENCH)
    const parsed = parseWorkbench({ left: { views: ['history', 'history', 'xyz'] }, right: { views: ['branches'], active: 'nada' } })
    expect(parsed.left.views).toEqual(['history'])
    expect(parsed.right).toEqual({ views: ['branches'] })
    expect(parsed.center.views).toEqual(['changes', 'files', 'compare'])
    expect(parsed.bottom.views).toEqual(['gitlog'])
  })

  it('move uma aba para outra área e a deixa visível', () => {
    const next = moveView(DEFAULT_WORKBENCH, 'changes', 'right')
    expect(next.center.views).toEqual(['history', 'files', 'compare'])
    expect(next.right).toEqual({ views: ['changes'], active: 'changes' })
    expect(areaOf(next, 'changes')).toBe('right')
    expect(DEFAULT_WORKBENCH.right.views).toEqual([])
  })

  it('reordena dentro da mesma área usando a posição onde a aba foi solta', () => {
    // Soltar "history" depois de "files" (antes de "compare", índice 3 na lista original).
    expect(moveView(DEFAULT_WORKBENCH, 'history', 'center', 3).center.views).toEqual(['changes', 'files', 'history', 'compare'])
    expect(moveView(DEFAULT_WORKBENCH, 'compare', 'center', 0).center.views).toEqual(['compare', 'history', 'changes', 'files'])
  })

  it('ativa a aba na área dela e escolhe outra quando a ativa sai', () => {
    const a = activate(DEFAULT_WORKBENCH, 'files')
    expect(activeView(a, 'center')).toBe('files')
    const b = moveView(a, 'files', 'left', 0)
    expect(activeView(b, 'center')).toBe('history')
    expect(activeView(b, 'left')).toBe('files')
    expect(activeView(b, 'right')).toBeNull()
  })
})

describe('soltar um painel num lado', () => {
  it('escolhe o lado mais próximo do ponteiro', () => {
    const rect = { left: 0, top: 0, width: 400, height: 200 }
    expect(sideAt(10, 100, rect)).toBe('left')
    expect(sideAt(390, 100, rect)).toBe('right')
    expect(sideAt(200, 5, rect)).toBe('top')
    expect(sideAt(200, 195, rect)).toBe('bottom')
  })

  it('deixa o painel arrastado do lado escolhido', () => {
    // Padrão: lado a lado, primeiro à esquerda.
    expect(dockSplit({ size: 0.4 }, 'first', 'left', 'row')).toEqual({ size: 0.4 })
    expect(dockSplit({}, 'first', 'right', 'row')).toEqual({ swapped: true })
    expect(dockSplit({}, 'second', 'top', 'row')).toEqual({ swapped: true, direction: 'column' })
    expect(dockSplit({ collapsed: 'first' }, 'second', 'bottom', 'row')).toEqual({ direction: 'column' })
    // Em RTL, "esquerda" na tela é o fim da linha.
    expect(dockSplit({}, 'first', 'left', 'row', true)).toEqual({ swapped: true })
  })
})
