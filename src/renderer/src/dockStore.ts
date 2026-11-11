// O arranjo dos painéis fica guardado no layout (o botão "restaurar layout" volta ao padrão). Estas
// funções servem a quem está fora do React (atalhos, ações) e a quem precisa do estado atual.

import { useSyncExternalStore } from 'react'
import { parseDock, revealIn, showScreen, toggleScreenIn, type DockState, type ScreenId, type ViewId } from './dock'
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

/**
 * Menu do topo aberto em cada aba (issue #62). Não vai para o layout: cada repositório (identificado pela raiz)
 * tem a sua tela, e a escolha não é gravada, então toda aba nova e toda execução começam no Histórico. Fica só em
 * memória. O arranjo `dock` continua global: é preferência de layout, e os layouts salvos dependem dele.
 */
const screenByRoot = new Map<string, ScreenId>()
/** Raiz da aba ativa; '' antes da primeira aba. Definida por RepoView (`setScreenRoot`), como `setActiveRoot` em git.ts. */
let screenRoot = ''
const screenListeners = new Set<() => void>()

function notifyScreen() {
  for (const listener of screenListeners) listener()
}

/** Avisa quando a tela da aba ativa muda (é o que `useScreen` usa). */
export function subscribeScreen(listener: () => void) {
  screenListeners.add(listener)
  return () => {
    screenListeners.delete(listener)
  }
}

/** Menu do topo aberto na aba ativa (o Histórico, se a aba ainda não abriu outro). */
export function readScreen(): ScreenId {
  return screenByRoot.get(screenRoot) ?? 'history'
}

/**
 * Grava a tela da aba ativa; sem mudança, não avisa ninguém. Sem aba ativa ('') não grava nada: a tela não tem a
 * quem pertencer, e uma gravação ali criaria uma entrada que nenhuma aba lê.
 */
function writeScreen(screen: ScreenId) {
  if (screenRoot === '' || readScreen() === screen) return
  screenByRoot.set(screenRoot, screen)
  notifyScreen()
}

/**
 * Define a aba ativa (RepoView chama ao montar, junto de `setActiveRoot`; App chama com '' sem repositório). Se a
 * tela visível muda, avisa os assinantes depois do render: o React não aceita atualizar um componente enquanto
 * renderiza outro. Quem renderiza nesta passada já lê a tela certa, porque `readScreen` é consultado direto.
 */
export function setScreenRoot(root: string) {
  if (root === screenRoot) return
  const before = readScreen()
  screenRoot = root
  if (readScreen() !== before) queueMicrotask(notifyScreen)
}

/**
 * Esquece a tela de uma aba fechada: a aba reaberta volta ao Histórico, e o Map não cresce com as abas da execução.
 * Se era a aba ativa, não há mais aba ativa ('').
 */
export function forgetScreen(root: string) {
  const before = readScreen()
  screenByRoot.delete(root)
  if (root === screenRoot) screenRoot = ''
  if (readScreen() !== before) queueMicrotask(notifyScreen)
}

/**
 * Menu do topo da aba ativa. O segundo item só troca a tela, sem mexer no arranjo (como o setter de antes, que
 * gravava só o menu); quem abre um menu com painéis chama `openScreen`.
 */
export function useScreen(): [ScreenId, (next: ScreenId) => void] {
  const screen = useSyncExternalStore(subscribeScreen, readScreen)
  return [screen, writeScreen]
}

/**
 * Abre um menu do topo: passa a ser a tela de agora e traz os painéis dele (os disponíveis). É a única troca de
 * menu; os painéis de outra tela não entram sozinhos (só se o usuário os fixou ali).
 */
export function openScreen(screen: ScreenId, available?: (view: ViewId) => boolean) {
  writeScreen(screen)
  updateDock((s) => showScreen(s, screen, available))
}

/** Mostra o painel na tela aberta (e a aba dele, se estava escondido ou atrás de outra). */
export const revealView = (view: ViewId) => updateDock((s) => revealIn(s, view, readScreen()))

/** Traz os painéis de uma tela, sem trocar de menu (ex.: a visão de Alterações mudou). */
export const revealScreen = (screen: ScreenId, available?: (view: ViewId) => boolean) => updateDock((s) => showScreen(s, screen, available))

/** Mostra ou esconde os painéis de uma tela (ex.: a barra de Branches) dentro do menu aberto. */
export const toggleScreenShown = (screen: ScreenId) => updateDock((s) => toggleScreenIn(s, screen, readScreen()))
