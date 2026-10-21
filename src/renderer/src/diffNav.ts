// Navegação entre alterações (e entre arquivos) dos diffs, por botões e atalhos de teclado.
// O atalho não sabe qual diff está na tela: ele avisa, e o diff certo (o visível sob o último clique
// ou foco) responde. Com a janela de diff separada, cada janela tem os seus diffs.

import { useEffect, useRef } from 'react'

export { stepIndex } from './cycle'

export type DiffNavKind = 'change' | 'file'

export interface DiffNavHandler {
  /** Elemento do diff; só responde quando está visível. */
  el: () => HTMLElement | null
  go(kind: DiffNavKind, delta: 1 | -1): void
}

const handlers = new Set<DiffNavHandler>()
let lastTouched: Node | null = null

if (typeof window !== 'undefined') {
  const remember = (e: Event) => {
    lastTouched = e.target instanceof Node ? e.target : null
  }
  window.addEventListener('pointerdown', remember, true)
  window.addEventListener('focusin', remember, true)
}

const isVisible = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.getClientRects().length > 0

/** Pede ao diff visível (o do último clique/foco, se houver vários) que vá para a alteração/arquivo seguinte ou anterior. */
export function emitDiffNav(kind: DiffNavKind, delta: 1 | -1): boolean {
  const visible = [...handlers].filter((h) => isVisible(h.el()))
  if (visible.length === 0) return false
  const target = visible.find((h) => lastTouched && h.el()!.contains(lastTouched)) ?? visible[visible.length - 1]
  target.go(kind, delta)
  return true
}

/** Registra um diff como destino da navegação. */
export function useDiffNav(handler: DiffNavHandler) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const entry: DiffNavHandler = { el: () => latest.current.el(), go: (kind, delta) => latest.current.go(kind, delta) }
    handlers.add(entry)
    return () => {
      handlers.delete(entry)
    }
  }, [])
}

/** Ação de atalho (ex.: "diff.nextChange") → o que pedir ao diff. */
export const DIFF_NAV_ACTIONS: Record<string, [DiffNavKind, 1 | -1]> = {
  'diff.nextChange': ['change', 1],
  'diff.prevChange': ['change', -1],
  'diff.nextFile': ['file', 1],
  'diff.prevFile': ['file', -1]
}
