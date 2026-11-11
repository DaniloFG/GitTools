import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyLayoutSnapshot,
  beginLayoutBatch,
  endLayoutBatch,
  readLayout,
  resetLayout,
  subscribeLayout,
  writeLayout
} from '../src/renderer/src/layout'

/** localStorage de mentira que conta as gravações e as remoções (os testes rodam sem navegador). */
function countingStorage() {
  const data = new Map<string, string>()
  const calls = { set: [] as string[], remove: [] as string[] }
  return {
    data,
    calls,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      calls.set.push(k)
      data.set(k, v)
    },
    removeItem(k: string) {
      calls.remove.push(k)
      data.delete(k)
    }
  }
}

const PREFIX = 'gittools.layout.'

describe('gravação em lote do layout', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage
  let storage: ReturnType<typeof countingStorage>

  beforeEach(() => {
    storage = countingStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
  })
  afterEach(() => {
    resetLayout()
    ;(globalThis as { localStorage?: unknown }).localStorage = original
  })

  it('dentro do lote a memória já tem o valor novo, e o disco não recebe gravação', () => {
    beginLayoutBatch()
    writeLayout('batch.a', { x: 1 })
    expect(readLayout('batch.a')).toEqual({ x: 1 })
    expect(storage.calls.set).toEqual([])
    expect(storage.calls.remove).toEqual([])
    expect(storage.data.has(PREFIX + 'batch.a')).toBe(false)
    endLayoutBatch()
  })

  it('ao fechar o lote, cada chave alterada é gravada uma vez com o último valor', () => {
    beginLayoutBatch()
    writeLayout('batch.a', 1)
    writeLayout('batch.a', 2)
    writeLayout('batch.b', 'b1')
    writeLayout('batch.a', 3)
    endLayoutBatch()
    expect(storage.calls.set).toEqual([PREFIX + 'batch.a', PREFIX + 'batch.b'])
    expect(storage.data.get(PREFIX + 'batch.a')).toBe('3')
    expect(storage.data.get(PREFIX + 'batch.b')).toBe('"b1"')
  })

  it('valor undefined fecha o lote removendo a chave do disco', () => {
    writeLayout('batch.c', 1)
    expect(storage.data.has(PREFIX + 'batch.c')).toBe(true)

    beginLayoutBatch()
    writeLayout('batch.c', undefined)
    expect(storage.calls.remove).toEqual([])
    endLayoutBatch()

    expect(storage.calls.remove).toEqual([PREFIX + 'batch.c'])
    expect(storage.data.has(PREFIX + 'batch.c')).toBe(false)
    expect(readLayout('batch.c')).toBeUndefined()
  })

  it('lotes aninhados gravam só quando o lote de fora fecha', () => {
    beginLayoutBatch()
    beginLayoutBatch()
    writeLayout('batch.n', 'dentro')
    endLayoutBatch()
    expect(storage.calls.set).toEqual([])
    writeLayout('batch.n', 'fora')
    endLayoutBatch()
    expect(storage.calls.set).toEqual([PREFIX + 'batch.n'])
    expect(storage.data.get(PREFIX + 'batch.n')).toBe('"fora"')
  })

  it('fora de lote, a gravação é imediata', () => {
    writeLayout('batch.now', 7)
    expect(storage.calls.set).toEqual([PREFIX + 'batch.now'])
    expect(storage.data.get(PREFIX + 'batch.now')).toBe('7')
  })

  it('os assinantes são avisados a cada gravação, mesmo dentro do lote', () => {
    let calls = 0
    const unsubscribe = subscribeLayout(() => calls++)
    beginLayoutBatch()
    writeLayout('batch.s', 1)
    writeLayout('batch.s', 2)
    writeLayout('batch.s', 3)
    expect(calls).toBe(3)
    expect(readLayout('batch.s')).toBe(3)
    endLayoutBatch()
    // Fechar o lote não muda a memória: ninguém é avisado de novo.
    expect(calls).toBe(3)
    unsubscribe()
  })

  it('resetLayout dentro do lote deixa o disco e a memória iguais', () => {
    writeLayout('batch.r1', 'velho')
    writeLayout('pref.keep', 'mantida')
    beginLayoutBatch()
    writeLayout('batch.r2', 'novo')
    resetLayout()
    expect(readLayout('batch.r1')).toBeUndefined()
    expect(readLayout('batch.r2')).toBeUndefined()
    endLayoutBatch()
    expect(storage.data.has(PREFIX + 'batch.r1')).toBe(false)
    expect(storage.data.has(PREFIX + 'batch.r2')).toBe(false)
    expect(readLayout('pref.keep')).toBe('mantida')
    expect(storage.data.get(PREFIX + 'pref.keep')).toBe('"mantida"')
  })

  it('applyLayoutSnapshot dentro do lote deixa só a foto no disco', () => {
    writeLayout('batch.old', 1)
    beginLayoutBatch()
    writeLayout('batch.a', 'antes')
    applyLayoutSnapshot({ 'batch.b': 2, 'batch.a': 'foto' })
    expect(readLayout('batch.old')).toBeUndefined()
    expect(readLayout('batch.a')).toBe('foto')
    expect(storage.data.has(PREFIX + 'batch.old')).toBe(false)
    endLayoutBatch()
    expect(storage.data.has(PREFIX + 'batch.old')).toBe(false)
    expect(storage.data.get(PREFIX + 'batch.a')).toBe('"foto"')
    expect(storage.data.get(PREFIX + 'batch.b')).toBe('2')
  })
})
