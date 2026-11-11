import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inScreen, pinnedIn, setSizes } from '../src/renderer/src/dock'
import {
  forgetScreen,
  openScreen,
  readDock,
  readScreen,
  revealScreen,
  revealView,
  setScreenRoot,
  subscribeScreen,
  toggleScreenShown,
  updateDock
} from '../src/renderer/src/dockStore'
import { resetLayout, snapshotLayout, writeLayout } from '../src/renderer/src/layout'

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

describe('troca de menu e painéis fixados (estado guardado)', () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage
  let storage: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    storage = fakeStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    setScreenRoot('/repo')
  })
  afterEach(() => {
    resetLayout()
    // Esquece as abas usadas pelos testes (e a ativa), para um teste não herdar a tela do outro.
    for (const root of ['/repo', '/a', '/b', '/c']) forgetScreen(root)
    setScreenRoot('')
    ;(globalThis as { localStorage?: unknown }).localStorage = original
  })

  it('começa no Histórico e lembra o menu aberto na aba', () => {
    expect(readScreen()).toBe('history')
    openScreen('files')
    expect(readScreen()).toBe('files')
  })

  it('cada aba tem a sua tela: trocar de aba não leva o menu de uma para a outra', () => {
    setScreenRoot('/a')
    openScreen('files')
    setScreenRoot('/b')
    expect(readScreen()).toBe('history')
    setScreenRoot('/a')
    expect(readScreen()).toBe('files')
  })

  it('a tela escolhida não vai para o armazenamento (nova execução começa no Histórico)', () => {
    openScreen('files')
    expect([...storage.data.keys()].some((k) => k.endsWith('pref.screen'))).toBe(false)
  })

  it('aba fechada e reaberta volta ao Histórico', () => {
    setScreenRoot('/a')
    openScreen('files')
    forgetScreen('/a')
    setScreenRoot('/b')
    setScreenRoot('/a')
    expect(readScreen()).toBe('history')
  })

  it('setScreenRoot avisa os assinantes só quando a tela visível muda, e depois do render (microtask)', async () => {
    setScreenRoot('/a')
    openScreen('files')
    setScreenRoot('/repo')
    // O aviso de 'files' -> 'history' acima é uma microtask: espera ele sair antes de assinar.
    await Promise.resolve()
    let calls = 0
    const unsubscribe = subscribeScreen(() => {
      calls += 1
    })
    setScreenRoot('/a') // history -> files: muda
    expect(calls).toBe(0)
    await Promise.resolve()
    expect(calls).toBe(1)
    setScreenRoot('/b') // files -> history: muda
    await Promise.resolve()
    expect(calls).toBe(2)
    setScreenRoot('/c') // history -> history: não muda
    await Promise.resolve()
    expect(calls).toBe(2)
    unsubscribe()
  })

  it('sem aba ativa (troca para ""), a escolha não grava na aba fechada nem cria entrada nova', () => {
    setScreenRoot('/a')
    openScreen('files')
    forgetScreen('/a')
    setScreenRoot('')
    expect(readScreen()).toBe('history')
    openScreen('compare')
    expect(readScreen()).toBe('history')
    setScreenRoot('/a')
    expect(readScreen()).toBe('history')
  })

  it('subscribeScreen só avisa quando a tela muda de fato', () => {
    let calls = 0
    const unsubscribe = subscribeScreen(() => {
      calls += 1
    })
    openScreen('files')
    expect(calls).toBe(1)
    openScreen('files')
    expect(calls).toBe(1)
    unsubscribe()
    openScreen('compare')
    expect(calls).toBe(1)
  })

  it('mostrar um painel de outra tela, com ela aberta, fixa o painel nesta tela', () => {
    openScreen('files')
    revealView('changes.diff')
    expect(inScreen(readDock(), 'changes.diff', 'files')).toBe(true)
    expect(pinnedIn(readDock(), 'files')).toEqual(['changes.diff'])
    openScreen('history')
    expect(inScreen(readDock(), 'changes.diff', 'history')).toBe(false)
    openScreen('files')
    expect(inScreen(readDock(), 'changes.diff', 'files')).toBe(true)
  })

  it('a barra de Branches entra no menu aberto (fixada ali) e sai de volta', () => {
    openScreen('compare')
    toggleScreenShown('branches')
    expect(pinnedIn(readDock(), 'compare')).toEqual(['branches', 'tags', 'stashes'])
    toggleScreenShown('branches')
    expect(readDock().pinned).toEqual({})
  })

  it('os fixados entram no layout salvo, mas o menu aberto não', () => {
    openScreen('changes')
    revealView('commit.message')
    const snapshot = snapshotLayout()
    expect(Object.keys(snapshot).sort()).toEqual(['dock'])
    expect(snapshot.dock).toMatchObject({ pinned: { changes: ['commit.message'] } })
  })

  it('os tamanhos de cada tela entram no layout salvo', () => {
    openScreen('files')
    updateDock((s) => setSizes(s, 'd1', [1, 3], 'files'))
    expect(readDock().screenSizes).toEqual({ files: { d1: [1, 3] } })
    expect(snapshotLayout().dock).toMatchObject({ screenSizes: { files: { d1: [1, 3] } } })
  })

  it('o arranjo lido do disco é validado (sem fixados de versão antiga e com lixo)', () => {
    writeLayout('dock', { root: { kind: 'group', id: 'g', views: ['history'] }, pinned: { files: ['files.list', 42] } })
    expect(readDock().pinned).toEqual({})
    expect(readDock().version).toBe(2)
  })

  it('trazer uma tela não muda o que está fixado em outras', () => {
    openScreen('files')
    revealView('changes.diff')
    openScreen('compare')
    revealScreen('compare')
    expect(pinnedIn(readDock(), 'files')).toEqual(['changes.diff'])
    expect(readScreen()).toBe('compare')
  })
})
