// Itens que o usuário reordena arrastando (abas, colunas do histórico, seções da barra lateral).
// A ordem escolhida fica guardada no layout.

import { useLayout } from './layout'
import { moveItem, parseOrder } from './order'

export { moveItem, parseOrder }

/** Ordem de um grupo de itens, guardada no layout sob `key`. */
export function useOrder<T extends string>(key: string, ids: readonly T[]) {
  const [order, setOrder] = useLayout(`order.${key}`, (value) => parseOrder(value, ids))
  return [order, (id: T, target: T) => setOrder((prev) => moveItem(prev, id, target))] as const
}

const THRESHOLD = 5

/**
 * Começa a arrastar um item de um grupo reordenável. Os itens do grupo têm `data-reorder={group}` e
 * `data-reorder-id={id}`; enquanto o mouse passa sobre outro item do grupo, `onMove(id, alvo)` é chamado.
 * Um clique simples (sem arrastar) continua funcionando normalmente.
 */
export function startReorder(e: React.PointerEvent, group: string, id: string, onMove: (id: string, target: string) => void) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('input, select, textarea')) return
  const x0 = e.clientX
  const y0 = e.clientY
  let active = false
  const move = (event: PointerEvent) => {
    if (!active) {
      if (Math.hypot(event.clientX - x0, event.clientY - y0) < THRESHOLD) return
      active = true
      document.body.classList.add('reordering')
    }
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-reorder="${CSS.escape(group)}"]`)
    const target = over?.dataset.reorderId
    if (target && target !== id) onMove(id, target)
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    if (!active) return
    document.body.classList.remove('reordering')
    // O clique que vem depois de soltar não deve acionar o item (ex.: trocar de aba).
    const swallow = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
