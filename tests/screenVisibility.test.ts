import { describe, expect, it } from 'vitest'
import { CATALOGS } from '../src/shared/i18n/messages'
import { SCREEN_IDS } from '../src/renderer/src/dock'
import {
  TOP_SCREEN_IDS,
  TOP_SCREEN_LABELS,
  isScreenShown,
  parseHiddenScreens,
  toggleScreen,
  type TopScreenId
} from '../src/renderer/src/screenVisibility'

/** Lê uma chave pontuada (ex.: 'toolbar.screensMenu') de um catálogo; ausente vira undefined. */
function textAt(catalog: unknown, key: string): unknown {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe('telas do topo que podem ser escondidas', () => {
  it('tem as telas na ordem da barra, sem repetição', () => {
    expect(TOP_SCREEN_IDS).toEqual(['history', 'changes', 'files', 'compare', 'branches', 'gitlog', 'dashboards'])
    expect(new Set(TOP_SCREEN_IDS).size).toBe(TOP_SCREEN_IDS.length)
  })

  it('cobre todas as telas do dock (uma tela nova do dock aparece no menu)', () => {
    for (const id of SCREEN_IDS) expect(TOP_SCREEN_IDS).toContain(id)
  })

  it('Settings e Sponsor não são ocultáveis', () => {
    expect(TOP_SCREEN_IDS as readonly string[]).not.toContain('settings')
    expect(TOP_SCREEN_IDS as readonly string[]).not.toContain('sponsor')
  })

  it('todo id tem um rótulo que existe no catálogo pt-BR', () => {
    for (const id of TOP_SCREEN_IDS) {
      const label = TOP_SCREEN_LABELS[id]
      expect(typeof textAt(CATALOGS['pt-BR'], label), `${id} -> ${label}`).toBe('string')
    }
  })

  it('os rótulos novos do menu existem nos seis catálogos', () => {
    for (const locale of Object.keys(CATALOGS) as (keyof typeof CATALOGS)[]) {
      for (const key of ['toolbar.dynamicPanels', 'toolbar.screensMenu']) {
        expect(typeof textAt(CATALOGS[locale], key), `${locale} ${key}`).toBe('string')
      }
    }
  })

  it('padrão: tudo visível (nada salvo ou valor inválido)', () => {
    expect(parseHiddenScreens(undefined)).toEqual([])
    expect(parseHiddenScreens(null)).toEqual([])
    expect(parseHiddenScreens('files')).toEqual([])
    expect(parseHiddenScreens({ files: true })).toEqual([])
    expect(parseHiddenScreens(42)).toEqual([])
  })

  it('descarta ids desconhecidos, repetidos e não-texto, e devolve na ordem da barra', () => {
    expect(parseHiddenScreens(['gitlog', 'nope', 'changes', 'gitlog', 42, null, 'dashboards'])).toEqual(['changes', 'gitlog', 'dashboards'])
  })

  it('Settings, Sponsor e menu salvos à mão são descartados', () => {
    expect(parseHiddenScreens(['settings', 'sponsor', 'menu'])).toEqual([])
  })

  it('alterna a visibilidade e volta, sem mexer nas outras', () => {
    const hidden = toggleScreen([], 'files')
    expect(hidden).toEqual(['files'])
    expect(isScreenShown(hidden, 'files', 'history')).toBe(false)
    expect(isScreenShown(hidden, 'compare', 'history')).toBe(true)

    const shown = toggleScreen(hidden, 'files')
    expect(shown).toEqual([])
    expect(isScreenShown(shown, 'files', 'history')).toBe(true)
  })

  it('mantém a lista de escondidas na ordem da barra, não na ordem dos cliques', () => {
    let hidden: TopScreenId[] = toggleScreen([], 'dashboards')
    hidden = toggleScreen(hidden, 'branches')
    hidden = toggleScreen(hidden, 'history')
    expect(hidden).toEqual(['history', 'branches', 'dashboards'])
  })

  it('não mexe na lista original', () => {
    const original: readonly TopScreenId[] = ['files']
    toggleScreen(original, 'compare')
    expect(original).toEqual(['files'])
  })

  it('a tela aberta agora continua à vista mesmo escondida', () => {
    const hidden: TopScreenId[] = ['changes', 'dashboards']
    expect(isScreenShown(hidden, 'changes', 'changes')).toBe(true)
    expect(isScreenShown(hidden, 'dashboards', 'dashboards')).toBe(true)
    expect(isScreenShown(hidden, 'changes', 'history')).toBe(false)
  })

  it('ocultar todas: só a tela aberta fica à vista', () => {
    let hidden: TopScreenId[] = []
    for (const id of TOP_SCREEN_IDS) hidden = toggleScreen(hidden, id)
    expect(hidden).toEqual(TOP_SCREEN_IDS)
    expect(TOP_SCREEN_IDS.filter((id) => isScreenShown(hidden, id, 'files'))).toEqual(['files'])
  })
})
