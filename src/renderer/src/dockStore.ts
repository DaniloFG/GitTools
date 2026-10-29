// O arranjo dos painéis fica guardado no layout (o botão "restaurar layout" volta ao padrão). Estas
// funções servem a quem está fora do React (atalhos, ações) e a quem precisa do estado atual.

import { parseDock, revealIn, SCREEN_IDS, showScreen, toggleScreenIn, type DockState, type ScreenId, type ViewId } from './dock'
import { readLayout, useLayout, writeLayout } from './layout'

const KEY = 'dock'
/** Menu do topo aberto. É preferência: não entra nos layouts salvos, e a restauração do padrão não a apaga. */
const SCREEN_KEY = 'pref.screen'

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

/** Menu do topo aberto agora. */
export function parseScreen(value: unknown): ScreenId {
  return (SCREEN_IDS as string[]).includes(value as string) ? (value as ScreenId) : 'history'
}
export const readScreen = (): ScreenId => parseScreen(readLayout(SCREEN_KEY))
export const useScreen = () => useLayout<ScreenId>(SCREEN_KEY, parseScreen)

/**
 * Abre um menu do topo: passa a ser a tela de agora e traz os painéis dele (os disponíveis). É a única troca de
 * menu; os painéis de outra tela não entram sozinhos (só se o usuário os fixou ali).
 */
export function openScreen(screen: ScreenId, available?: (view: ViewId) => boolean) {
  writeLayout(SCREEN_KEY, screen)
  updateDock((s) => showScreen(s, screen, available))
}

/** Mostra o painel na tela aberta (e a aba dele, se estava escondido ou atrás de outra). */
export const revealView = (view: ViewId) => updateDock((s) => revealIn(s, view, readScreen()))

/** Traz os painéis de uma tela, sem trocar de menu (ex.: a visão de Alterações mudou). */
export const revealScreen = (screen: ScreenId, available?: (view: ViewId) => boolean) => updateDock((s) => showScreen(s, screen, available))

/** Mostra ou esconde os painéis de uma tela (ex.: a barra de Branches) dentro do menu aberto. */
export const toggleScreenShown = (screen: ScreenId) => updateDock((s) => toggleScreenIn(s, screen, readScreen()))
