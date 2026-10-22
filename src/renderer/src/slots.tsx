// Onde cada painel aparece. Os painéis não são filhos uns dos outros: cada tela (a lista de commits, o diff,
// a descrição…) é desenhada por quem guarda o estado dela e levada, por um portal, até o lugar onde o
// usuário encaixou o painel. Mudar o painel de lugar não perde o estado de nenhum outro.

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ViewId } from './dock'

const targets = new Map<ViewId, HTMLElement>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** O Dock chama isto com o elemento que recebe o painel (ou null quando ele sai da tela). */
export function setSlot(view: ViewId, element: HTMLElement | null) {
  if (element) {
    if (targets.get(view) === element) return
    targets.set(view, element)
  } else if (targets.has(view)) targets.delete(view)
  else return
  for (const listener of [...listeners]) listener()
}

/** Elemento onde o painel está sendo mostrado agora (null = escondido ou atrás de outra aba). */
export function useSlot(view: ViewId): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => targets.get(view) ?? null)
}

/** Algum destes painéis está na tela? */
export function useAnyShown(views: readonly ViewId[]): boolean {
  return useSyncExternalStore(subscribe, () => views.some((v) => targets.has(v)))
}

/** Conteúdo de um painel: só é desenhado enquanto o painel está na tela. */
export function PaneSlot({ id, children }: { id: ViewId; children: ReactNode }) {
  const element = useSlot(id)
  return element ? createPortal(children, element) : null
}

/** Só monta quem guarda o estado de uma tela enquanto algum painel dela está na tela. */
export function WhenShown({ views, children }: { views: readonly ViewId[]; children: ReactNode }) {
  return useAnyShown(views) ? <>{children}</> : null
}
