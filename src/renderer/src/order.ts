// Ordem de itens que o usuário reordena (sem React nem DOM, para poder ser testada à parte).

/** Ordem guardada válida: só ids conhecidos, sem repetição, e os que faltarem no fim (na ordem padrão). */
export function parseOrder<T extends string>(value: unknown, ids: readonly T[]): T[] {
  const known = new Set<string>(ids)
  const saved = Array.isArray(value) ? value.filter((v): v is T => typeof v === 'string' && known.has(v)) : []
  const unique = [...new Set(saved)]
  return [...unique, ...ids.filter((id) => !unique.includes(id))]
}

/** Move `id` para o lugar de `target` (os demais andam uma posição). */
export function moveItem<T>(list: readonly T[], id: T, target: T): T[] {
  const from = list.indexOf(id)
  const to = list.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...list]
  const next = [...list]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
