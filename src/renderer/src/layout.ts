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

/**
 * Lote de gravações: durante um arrasto o valor muda a cada movimento do mouse, mas só o último vale. Com lote
 * aberto a memória e os assinantes são atualizados na hora; o disco recebe cada chave uma vez, ao fechar o lote.
 */
let batchDepth = 0
/** Chaves mudadas dentro do lote, à espera de gravação. */
const pending = new Set<string>()

export function beginLayoutBatch() {
  batchDepth += 1
}

export function endLayoutBatch() {
  if (batchDepth === 0) return
  batchDepth -= 1
  if (batchDepth > 0) return
  const keys = [...pending]
  pending.clear()
  for (const key of keys) persist(key, cache.get(key))
}

/** Grava no armazenamento agora; `undefined` remove a chave. */
function persist(key: string, value: unknown) {
  try {
    if (value === undefined) storage()?.removeItem(PREFIX + key)
    else storage()?.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Sem armazenamento disponível: o layout vale só até fechar o aplicativo.
  }
}

/** Grava já, ou (dentro de um lote) marca a chave para ser gravada ao fechar o lote. */
function store(key: string, value: unknown) {
  if (batchDepth > 0) pending.add(key)
  else persist(key, value)
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
  store(key, value)
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

/** Chaves do layout atual (sem as preferências), no disco e na memória. */
function layoutKeys(): string[] {
  const keys = new Set<string>()
  const s = storage()
  if (s) {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key?.startsWith(PREFIX) && !key.startsWith(PREF_PREFIX)) keys.add(key.slice(PREFIX.length))
    }
  }
  for (const [key, value] of cache) if (value !== undefined && !key.startsWith('pref.')) keys.add(key)
  return [...keys]
}

/** Foto do layout de agora (arranjo dos painéis, tamanhos, seções recolhidas…), para ser guardada e reaplicada depois. */
export function snapshotLayout(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of layoutKeys()) {
    const value = readLayout(key)
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Troca o layout de agora por uma foto guardada (o que a foto não tem volta ao padrão). */
export function applyLayoutSnapshot(snapshot: Record<string, unknown>) {
  for (const key of layoutKeys()) cache.set(key, undefined)
  const s = storage()
  try {
    for (const key of layoutKeys()) s?.removeItem(PREFIX + key)
  } catch {
    // Sem armazenamento disponível: vale só até fechar o aplicativo.
  }
  // A remoção acima é imediata (a leitura volta ao disco para chaves fora da memória); as gravações da foto seguem o lote.
  for (const [key, value] of Object.entries(snapshot)) {
    if (key.startsWith('pref.') || value === undefined) continue
    cache.set(key, value)
    store(key, value)
  }
  notify()
}

/** Avisa quando qualquer valor do layout muda (é o que `useLayout` usa; vale também dentro de um lote). */
export function subscribeLayout(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Como useState, mas guardado no layout. `parse` valida o que foi lido (e dá o padrão). */
export function useLayout<T>(key: string, parse: (value: unknown) => T): [T, (next: T | undefined | ((prev: T) => T | undefined)) => void] {
  const raw = useSyncExternalStore(subscribeLayout, () => readLayout(key))
  const set = (next: T | undefined | ((prev: T) => T | undefined)) =>
    writeLayout(key, typeof next === 'function' ? (next as (prev: T) => T | undefined)(parse(readLayout(key))) : next)
  return [parse(raw), set]
}
