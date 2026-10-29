import { describe, expect, it } from 'vitest'
import { dateSearchText, matchesCommit } from '../src/renderer/src/graph'
import { crossingAt, parseSplitState, rotateSplit, stateFromPosition, swapSplit } from '../src/renderer/src/panes'
import { moveItem, parseOrder } from '../src/renderer/src/order'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

describe('arranjo dos painéis', () => {
  it('troca os painéis de lugar e gira a divisória, guardando só o que difere do padrão', () => {
    expect(swapSplit({ size: 0.3 })).toEqual({ size: 0.3, swapped: true })
    expect(swapSplit({ size: 0.3, swapped: true })).toEqual({ size: 0.3 })
    expect(rotateSplit({}, 'row')).toEqual({ direction: 'column' })
    expect(rotateSplit({ direction: 'column', swapped: true }, 'row')).toEqual({ swapped: true })
    expect(parseSplitState({ swapped: true, direction: 'column' })).toEqual({ swapped: true, direction: 'column' })
    expect(parseSplitState({ swapped: 'sim', direction: 'diagonal' })).toEqual({})
  })

  it('redimensionar mantém o arranjo escolhido', () => {
    const limits = { available: 1000, min: [200, 300] as [number, number], collapsible: [true, true] as [boolean, boolean], fixed: false }
    expect(stateFromPosition(400, { swapped: true, direction: 'column', collapsed: 'first' }, limits)).toEqual({
      swapped: true,
      direction: 'column',
      size: 0.4
    })
  })

  it('acha as divisórias perpendiculares que se cruzam no ponto', () => {
    const others = [
      { item: 'horizontal', vertical: false, left: 100, top: 300, right: 500, bottom: 302 },
      { item: 'longe', vertical: false, left: 600, top: 300, right: 900, bottom: 302 },
      { item: 'paralela', vertical: true, left: 98, top: 0, right: 100, bottom: 800 }
    ]
    // Divisória vertical em x=100: a horizontal começa ali e a toca.
    expect(crossingAt(99, 301, true, others)).toEqual(['horizontal'])
    expect(crossingAt(99, 100, true, others)).toEqual([])
  })
})

describe('itens reordenáveis', () => {
  it('move um item para o lugar de outro', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveItem(['a', 'b'], 'a', 'x')).toEqual(['a', 'b'])
  })

  it('valida a ordem guardada e acrescenta itens novos no fim', () => {
    expect(parseOrder(['c', 'a', 'zz', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
    expect(parseOrder('lixo', ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('pesquisa por data e hora', () => {
  const date = new Date(2026, 9, 21, 14, 32).getTime()
  const commit = { sha: 'abc123', parents: [], subject: 'Corrige login', author: 'Ana', refs: [], date }

  it('acha o commit pela data em vários formatos e pela hora', () => {
    expect(dateSearchText(date, 'pt-BR')).toContain('21/10/2026')
    expect(matchesCommit(commit, '2026-10-21', 'pt-BR')).toBe(true)
    expect(matchesCommit(commit, '21/10/2026', 'pt-BR')).toBe(true)
    expect(matchesCommit(commit, '14:32', 'pt-BR')).toBe(true)
    expect(matchesCommit(commit, '21/10 14:3', 'pt-BR')).toBe(true)
    expect(matchesCommit(commit, '22/10/2026', 'pt-BR')).toBe(false)
    expect(matchesCommit(commit, '15:00', 'pt-BR')).toBe(false)
  })
})

describe('configurações de editor e diff', () => {
  it('normaliza editor e modo do diff', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ editor: '', diffLayout: 'inline' })
    expect(normalizeSettings({ editor: ' vscode ', diffLayout: 'split' })).toMatchObject({ editor: 'vscode', diffLayout: 'split' })
    expect(normalizeSettings({ editor: 3, diffLayout: 'diagonal' })).toMatchObject({ editor: '', diffLayout: 'inline' })
  })
})

describe('configuração das notificações', () => {
  it('tem padrão embaixo à direita e aceita só valores válidos', () => {
    expect(DEFAULT_SETTINGS.toast).toEqual({ horizontal: 'right', vertical: 'bottom', width: 380, height: 240 })
    expect(normalizeSettings({ toast: { horizontal: 'left', vertical: 'top', width: 500, height: 120 } }).toast).toEqual({
      horizontal: 'left',
      vertical: 'top',
      width: 500,
      height: 120
    })
    expect(normalizeSettings({ toast: { horizontal: 'meio', vertical: 3, width: 'larga', height: null } }).toast).toEqual(DEFAULT_SETTINGS.toast)
    expect(normalizeSettings({ toast: { width: 10, height: 99999 } }).toast).toMatchObject({ width: 240, height: 800 })
    expect(normalizeSettings({ toast: { width: 391 } }).toast.width).toBe(400)
    expect(normalizeSettings({}).toast).toEqual(DEFAULT_SETTINGS.toast)
  })
})
