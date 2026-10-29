import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inScreen, pinnedIn } from '../src/renderer/src/dock'
import { openScreen, readDock, readScreen, revealScreen, revealView, toggleScreenShown } from '../src/renderer/src/dockStore'
import { readLayout, resetLayout, snapshotLayout, writeLayout } from '../src/renderer/src/layout'

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
  beforeEach(() => {
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage()
  })
  afterEach(() => {
    resetLayout()
    writeLayout('pref.screen', undefined)
    ;(globalThis as { localStorage?: unknown }).localStorage = original
  })

  it('começa no Histórico e lembra o menu aberto', () => {
    expect(readScreen()).toBe('history')
    openScreen('files')
    expect(readScreen()).toBe('files')
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
    expect(readLayout('pref.screen')).toBe('compare')
  })
})
