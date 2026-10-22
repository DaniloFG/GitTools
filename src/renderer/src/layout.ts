// Layout escolhido pelo usuário (tamanhos de painéis e janelas, seções recolhidas).
// Fica no armazenamento local do aplicativo para continuar igual na próxima vez.

import { useSyncExternalStore } from 'react'

/** O que usamos do localStorage (sem depender dos tipos do navegador, para os testes). */
type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const PREFIX = 'gittools.layout.'
const cache = new Map<string, unknown>()
const listeners = new Set<() => void>()

function storage(): LayoutStorage | null {
  try {
    return (globalThis as { localStorage?: LayoutStorage }).localStorage ?? null
  } catch {
    return null
  }
}

function notify() {
  for (const listener of listeners) listener()
}

export function readLayout(key: string): unknown {
  if (!cache.has(key)) {
    let value: unknown
    try {
      const raw = storage()?.getItem(PREFIX + key)
      value = raw == null ? undefined : JSON.parse(raw)
    } catch {
      value = undefined
    }
    cache.set(key, value)
  }
  return cache.get(key)
}

/** Grava um valor; `undefined` volta ao padrão. */
export function writeLayout(key: string, value: unknown) {
  cache.set(key, value)
  try {
    if (value === undefined) storage()?.removeItem(PREFIX + key)
    else storage()?.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Sem armazenamento disponível: o layout vale só até fechar o aplicativo.
  }
  notify()
}

/** Preferências de uso (ex.: "dar checkout ao criar branch"): ficam junto do layout, mas o botão de restaurar não as apaga. */
const PREF_PREFIX = PREFIX + 'pref.'

/** Volta todos os painéis e janelas ao tamanho padrão. */
export function resetLayout() {
  const s = storage()
  if (s) {
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key?.startsWith(PREFIX) && !key.startsWith(PREF_PREFIX)) keys.push(key)
    }
    for (const key of keys) s.removeItem(key)
  }
  for (const key of [...cache.keys()]) if (!key.startsWith('pref.')) cache.delete(key)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Como useState, mas guardado no layout. `parse` valida o que foi lido (e dá o padrão). */
export function useLayout<T>(key: string, parse: (value: unknown) => T): [T, (next: T | undefined | ((prev: T) => T | undefined)) => void] {
  const raw = useSyncExternalStore(subscribe, () => readLayout(key))
  const set = (next: T | undefined | ((prev: T) => T | undefined)) =>
    writeLayout(key, typeof next === 'function' ? (next as (prev: T) => T | undefined)(parse(readLayout(key))) : next)
  return [parse(raw), set]
}
