import { describe, expect, it } from 'vitest'
import { CATALOGS } from '../src/shared/i18n/messages'
import {
  TOOLBAR_ITEM_IDS,
  TOOLBAR_ITEM_LABELS,
  isToolbarItemShown,
  parseHiddenToolbarItems,
  toggleToolbarItem
} from '../src/renderer/src/toolbarItems'

describe('itens da barra de ferramentas', () => {
  it('tem os ids esperados, sem repetição', () => {
    expect(TOOLBAR_ITEM_IDS).toEqual(['repo', 'branch', 'screens', 'fetch', 'pull', 'push', 'new', 'editor', 'studio'])
    expect(new Set(TOOLBAR_ITEM_IDS).size).toBe(TOOLBAR_ITEM_IDS.length)
  })

  it('todo item tem um rótulo que existe no catálogo pt-BR', () => {
    const pt = CATALOGS['pt-BR'] as unknown as Record<string, unknown>
    for (const id of TOOLBAR_ITEM_IDS) {
      const path = TOOLBAR_ITEM_LABELS[id].split('.')
      let node: unknown = pt
      for (const part of path) node = (node as Record<string, unknown> | undefined)?.[part]
      expect(typeof node, `${id} -> ${TOOLBAR_ITEM_LABELS[id]}`).toBe('string')
    }
  })

  it('padrão: tudo visível (nada salvo ou valor inválido)', () => {
    expect(parseHiddenToolbarItems(undefined)).toEqual([])
    expect(parseHiddenToolbarItems(null)).toEqual([])
    expect(parseHiddenToolbarItems('push')).toEqual([])
    expect(parseHiddenToolbarItems({ push: true })).toEqual([])
  })

  it('descarta ids desconhecidos e repetidos, e devolve na ordem da barra', () => {
    expect(parseHiddenToolbarItems(['studio', 'nope', 'fetch', 'studio', 42, null])).toEqual(['fetch', 'studio'])
    expect(parseHiddenToolbarItems(['sponsor', 'menu'])).toEqual([])
  })

  it('alterna a visibilidade sem mudar as outras', () => {
    const hidden = toggleToolbarItem([], 'push')
    expect(hidden).toEqual(['push'])
    expect(isToolbarItemShown(hidden, 'push')).toBe(false)
    expect(isToolbarItemShown(hidden, 'pull')).toBe(true)

    const shown = toggleToolbarItem(hidden, 'push')
    expect(shown).toEqual([])
    expect(isToolbarItemShown(shown, 'push')).toBe(true)
  })

  it('mantém a lista de escondidos na ordem da barra, não na ordem dos cliques', () => {
    let hidden = toggleToolbarItem([], 'studio')
    hidden = toggleToolbarItem(hidden, 'branch')
    hidden = toggleToolbarItem(hidden, 'fetch')
    expect(hidden).toEqual(['branch', 'fetch', 'studio'])
  })

  it('não mexe na lista original', () => {
    const original = ['fetch'] as const
    toggleToolbarItem(original, 'pull')
    expect(original).toEqual(['fetch'])
  })
})
