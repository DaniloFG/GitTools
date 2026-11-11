// Montagem do menu ⋯ de um painel (opções de visualização + submenu de ações). Lógica pura, sem React, para ser testada.

/** Mesma forma de `MenuItem` (components/ContextMenu.tsx), sem importá-lo: o teste roda sem React. Genérico para manter o tipo do chamador. */
export function withActionsSubmenu<T extends string | { label: string }>(
  items: T[],
  submenu?: { label: string; items: T[] }
): Array<T | { label: string; submenu: T[] }> {
  if (!submenu || submenu.items.length === 0) return items
  const entry = { label: submenu.label, submenu: submenu.items }
  return items.length > 0 ? [...items, 'separator' as T, entry] : [entry]
}
