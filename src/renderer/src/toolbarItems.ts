// Itens da barra superior que o usuário pode mostrar ou esconder (pelo menu ⚙/☰ → Barra de ferramentas).
// Só a lógica pura fica aqui, para ser testada; o que é desenhado está em components/Toolbar.tsx.

import type { MessageKey } from '../../shared/i18n'

/** Ids dos itens, na ordem em que aparecem na barra. O Sponsor e o botão de menu não entram: estão sempre à vista. */
export const TOOLBAR_ITEM_IDS = ['repo', 'branch', 'screens', 'fetch', 'pull', 'push', 'new', 'editor', 'studio'] as const

export type ToolbarItemId = (typeof TOOLBAR_ITEM_IDS)[number]

/** Nome de cada item no menu (mesmas chaves das outras partes da interface). */
export const TOOLBAR_ITEM_LABELS: Record<ToolbarItemId, MessageKey> = {
  repo: 'toolbar.itemRepo',
  branch: 'toolbar.currentBranch',
  screens: 'workbench.screens',
  fetch: 'toolbar.fetch',
  pull: 'toolbar.pull',
  push: 'toolbar.push',
  new: 'toolbar.new',
  editor: 'common.openInEditor',
  studio: 'studio.name'
}

/** Lê o valor salvo: só ids conhecidos, sem repetição e na ordem da barra. O que não for válido é ignorado. */
export function parseHiddenToolbarItems(value: unknown): ToolbarItemId[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>(TOOLBAR_ITEM_IDS)
  const hidden = new Set(value.filter((v): v is string => typeof v === 'string' && known.has(v)))
  return TOOLBAR_ITEM_IDS.filter((id) => hidden.has(id))
}

/** Um item está à vista quando não está na lista de escondidos. */
export function isToolbarItemShown(hidden: readonly ToolbarItemId[], id: ToolbarItemId): boolean {
  return !hidden.includes(id)
}

/** Inverte a visibilidade de um item; a lista volta na ordem da barra. */
export function toggleToolbarItem(hidden: readonly ToolbarItemId[], id: ToolbarItemId): ToolbarItemId[] {
  const next = isToolbarItemShown(hidden, id) ? [...hidden, id] : hidden.filter((h) => h !== id)
  return parseHiddenToolbarItems(next)
}
