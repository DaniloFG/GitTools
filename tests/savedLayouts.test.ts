import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyLayoutSnapshot, readLayout, resetLayout, snapshotLayout, writeLayout } from '../src/renderer/src/layout'
import { addSavedLayout, cleanName, findByName, MAX_SAVED_LAYOUTS, parseSavedLayouts, removeSavedLayout, renameSavedLayout } from '../src/renderer/src/savedLayouts'

/** localStorage de mentira (os testes rodam sem navegador). */
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  }
}

describe('layouts salvos', () => {
  it('guarda, substitui pelo mesmo nome, renomeia e apaga', () => {
    let list = addSavedLayout([], '  Revisão   de código ', { dock: 1 }, 10)
    expect(list).toEqual([{ id: 'l1', name: 'Revisão de código', savedAt: 10, data: { dock: 1 } }])

    // O mesmo nome (sem diferenciar maiúsculas) troca o conteúdo e mantém o lugar na lista.
    list = addSavedLayout(list, 'outro', { dock: 2 }, 20)
    list = addSavedLayout(list, 'REVISÃO de código', { dock: 3 }, 30)
    expect(list.map((l) => [l.id, l.name, l.savedAt, l.data])).toEqual([
      ['l1', 'REVISÃO de código', 30, { dock: 3 }],
      ['l2', 'outro', 20, { dock: 2 }]
    ])
    expect(findByName(list, 'Outro')?.id).toBe('l2')

    expect(renameSavedLayout(list, 'l2', 'novo').map((l) => l.name)).toEqual(['REVISÃO de código', 'novo'])
    // Nome vazio ou de outro layout é recusado.
    expect(renameSavedLayout(list, 'l2', '  ')).toBe(list)
    expect(renameSavedLayout(list, 'l2', 'revisão de código')).toBe(list)

    expect(removeSavedLayout(list, 'l1').map((l) => l.id)).toEqual(['l2'])
    // Ids não se repetem depois de apagar.
    expect(addSavedLayout(removeSavedLayout(list, 'l1'), 'terceiro', {}, 40).map((l) => l.id)).toEqual(['l2', 'l3'])
  })

  it('não salva sem nome e limita o tamanho do nome e da lista', () => {
    expect(addSavedLayout([], '   ', {}, 1)).toEqual([])
    expect(cleanName('x'.repeat(100))).toHaveLength(60)
    let list: ReturnType<typeof addSavedLayout> = []
    for (let i = 0; i < MAX_SAVED_LAYOUTS + 5; i++) list = addSavedLayout(list, `layout ${i}`, {}, i)
    expect(list).toHaveLength(MAX_SAVED_LAYOUTS)
    expect(list.at(-1)?.name).toBe(`layout ${MAX_SAVED_LAYOUTS + 4}`)
  })

  it('valida o que foi lido do disco', () => {
    expect(parseSavedLayouts(undefined)).toEqual([])
    expect(parseSavedLayouts('x')).toEqual([])
    expect(
      parseSavedLayouts([
        { id: 'a', name: 'ok', savedAt: 5, data: { dock: {} } },
        { id: 'a', name: 'repetido', data: {} },
        { id: 'b', name: '', data: {} },
        { id: 'c', name: 'sem dados' },
        { id: 'd', name: 'sem data', data: {} },
        null
      ])
    ).toEqual([
      { id: 'a', name: 'ok', savedAt: 5, data: { dock: {} } },
      { id: 'd', name: 'sem data', savedAt: 0, data: {} }
    ])
  })
})

describe('foto do layout', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage
  let storage: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    storage = fakeStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
  })
  afterEach(() => {
    resetLayout()
    ;(globalThis as { localStorage?: unknown }).localStorage = original
  })

  it('guarda o layout sem as preferências e o reaplica depois', () => {
    writeLayout('dock', { a: 1 })
    writeLayout('blame.gutter', 300)
    writeLayout('pref.changesMode', 'check')
    expect(snapshotLayout()).toEqual({ dock: { a: 1 }, 'blame.gutter': 300 })
    const snapshot = snapshotLayout()

    // O usuário mexe no layout e depois volta ao salvo: o que não estava na foto volta ao padrão.
    writeLayout('dock', { a: 2 })
    writeLayout('sidebar.tags.open', false)
    applyLayoutSnapshot(snapshot)
    expect(readLayout('dock')).toEqual({ a: 1 })
    expect(readLayout('blame.gutter')).toBe(300)
    expect(readLayout('sidebar.tags.open')).toBeUndefined()
    expect(storage.data.has('gittools.layout.sidebar.tags.open')).toBe(false)
    expect(JSON.parse(storage.data.get('gittools.layout.dock')!)).toEqual({ a: 1 })
    // As preferências não são tocadas.
    expect(readLayout('pref.changesMode')).toBe('check')
  })

  it('restaurar o layout padrão não apaga os layouts salvos', () => {
    writeLayout('dock', { a: 1 })
    writeLayout('pref.savedLayouts', [{ id: 'l1', name: 'meu', savedAt: 1, data: { dock: { a: 1 } } }])
    resetLayout()
    expect(readLayout('dock')).toBeUndefined()
    expect(parseSavedLayouts(readLayout('pref.savedLayouts'))).toHaveLength(1)
  })

  it('ignora preferências escondidas dentro de uma foto', () => {
    writeLayout('pref.changesMode', 'check')
    applyLayoutSnapshot({ dock: { b: 1 }, 'pref.changesMode': 'stage' })
    expect(readLayout('pref.changesMode')).toBe('check')
    expect(readLayout('dock')).toEqual({ b: 1 })
  })
})
