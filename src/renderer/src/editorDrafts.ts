// Textos em edição no editor embutido que ainda não foram salvos. Ficam aqui (e não no componente) para
// não se perderem quando o usuário troca de arquivo ou de tela e volta depois.

import { useSyncExternalStore } from 'react'

const drafts = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0

const keyOf = (root: string, path: string) => `${root}\0${path}`

function notify() {
  version++
  for (const listener of [...listeners]) listener()
}

export function getDraft(root: string, path: string): string | undefined {
  return drafts.get(keyOf(root, path))
}

export function setDraft(root: string, path: string, text: string | undefined) {
  const key = keyOf(root, path)
  if (text === undefined) {
    if (!drafts.delete(key)) return
  } else {
    if (drafts.get(key) === text) return
    drafts.set(key, text)
  }
  notify()
}

/** Caminhos com alterações não salvas neste repositório. */
export function draftPaths(root: string): string[] {
  const prefix = `${root}\0`
  return [...drafts.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reage a qualquer mudança nos rascunhos (devolve um número que muda a cada alteração). */
export function useDraftsVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}
