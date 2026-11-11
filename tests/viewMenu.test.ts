import { describe, expect, it } from 'vitest'
import { withActionsSubmenu } from '../src/renderer/src/viewMenu'

const sub = { label: 'Opções', items: [{ label: 'Abrir em janela', onClick: () => {} }] }
const base = [{ label: 'Lado a lado', onClick: () => {} }]

describe('menu ⋯ do painel de diff', () => {
  it('sem ações, devolve o menu como estava', () => {
    expect(withActionsSubmenu(base)).toBe(base)
    expect(withActionsSubmenu(base, { label: 'Opções', items: [] })).toBe(base)
  })
  it('com ações, acrescenta separador e o submenu "Opções" no fim', () => {
    const out = withActionsSubmenu(base, sub)
    expect(out).toHaveLength(3)
    expect(out[1]).toBe('separator')
    expect(out[2]).toMatchObject({ label: 'Opções', submenu: sub.items })
  })
  it('sem opções de visualização (arquivo binário), o submenu vem sem separador', () => {
    expect(withActionsSubmenu([], sub)).toEqual([{ label: 'Opções', submenu: sub.items }])
  })
})
