// Caminhos cujo diff o usuário liberou sem teto ("mostrar mesmo assim"). Fica só na memória da janela:
// vale para a sessão do aplicativo e não é gravado em disco. Cada janela tem a sua lista.

import { useSyncExternalStore } from 'react'

const allowed = new Set<string>()
const listeners = new Set<() => void>()

/** Libera o diff sem teto deste caminho; os consumidores que o mostram pedem de novo. */
export function allowFullDiff(path: string): void {
  if (allowed.has(path)) return
  allowed.add(path)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Se o diff deste caminho foi liberado sem teto. Sem caminho, nunca é liberado. */
export function useDiffUncapped(path: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => path !== undefined && allowed.has(path))
}
