// O arranjo dos painéis fica guardado no layout (o botão "restaurar layout" volta ao padrão). Estas
// funções servem a quem está fora do React (atalhos, ações) e a quem precisa do estado atual.

import { activateView, parseDock, showScreen, toggleView, type DockState, type ScreenId, type ViewId } from './dock'
import { readLayout, useLayout, writeLayout } from './layout'

const KEY = 'dock'

/** O que lemos do disco é validado uma vez por valor guardado (o mesmo objeto devolve o mesmo arranjo). */
const parsed = new WeakMap<object, DockState>()
export function parseDockCached(value: unknown): DockState {
  if (value && typeof value === 'object') {
    const hit = parsed.get(value)
    if (hit) return hit
    const next = parseDock(value)
    parsed.set(value, next)
    return next
  }
  return parseDock(value)
}

/** Arranjo atual e como trocá-lo (aceita o novo arranjo ou uma função do anterior para o novo). */
export function useDock() {
  return useLayout<DockState>(KEY, parseDockCached)
}

export function readDock(): DockState {
  return parseDockCached(readLayout(KEY))
}

/** Muda o arranjo a partir de qualquer lugar; devolver o mesmo estado não grava nada. */
export function updateDock(change: (state: DockState) => DockState) {
  const current = readDock()
  const next = change(current)
  if (next !== current) writeLayout(KEY, next)
}

/** Mostra o painel (e a aba dele, se estava escondido ou atrás de outra). */
export const revealView = (view: ViewId) => updateDock((s) => activateView(s, view))

/** Traz os painéis de uma tela. `available` diz quais existem agora (ex.: Staged só na visão de listas separadas). */
export const revealScreen = (screen: ScreenId, available?: (view: ViewId) => boolean) => updateDock((s) => showScreen(s, screen, available))

export const toggleViewShown = (view: ViewId) => updateDock((s) => toggleView(s, view))
