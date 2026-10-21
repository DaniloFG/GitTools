import { describe, expect, it } from 'vitest'
import { comboFromEvent, matchesShortcut, resolveBindings, worksInInputs, type KeyInput } from '../src/renderer/src/shortcuts'

const key = (init: Partial<KeyInput>): KeyInput => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init })

describe('atalhos', () => {
  it('normaliza combinações independentemente do layout', () => {
    expect(comboFromEvent(key({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+1')
    expect(comboFromEvent(key({ key: 'p', code: 'KeyP', metaKey: true }))).toBe('Ctrl+P')
    expect(comboFromEvent(key({ key: ',', code: 'Comma', ctrlKey: true }))).toBe('Ctrl+,')
    expect(comboFromEvent(key({ key: 'F5', code: 'F5' }))).toBe('F5')
    expect(comboFromEvent(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
  })

  it('aplica personalizações sobre os padrões', () => {
    const b = resolveBindings({ studio: 'Ctrl+K' })
    expect(b.studio).toBe('Ctrl+K')
    expect(b['view.history']).toBe('Ctrl+1')
  })

  it('só permite atalhos com modificador ou F-teclas dentro de campos de texto', () => {
    expect(worksInInputs('Ctrl+1')).toBe(true)
    expect(worksInInputs('F1')).toBe(true)
    expect(worksInInputs('Shift+A')).toBe(false)
  })
})

describe('pesquisa de atalhos', () => {
  it('acha pelo nome da ação, sem diferenciar acentos e maiúsculas', () => {
    expect(matchesShortcut('Atualizar', 'F5', { text: 'atualiz' })).toBe(true)
    expect(matchesShortcut('Configurações', 'Ctrl+,', { text: 'configuracoes' })).toBe(true)
    expect(matchesShortcut('Push', 'Ctrl+Shift+K', { text: 'pull' })).toBe(false)
  })

  it('acha pelas teclas digitadas ou gravadas', () => {
    expect(matchesShortcut('Barra lateral', 'Ctrl+B', { text: 'ctrl+b' })).toBe(true)
    expect(matchesShortcut('Studio', 'Ctrl+Shift+P', { text: 'ctrl shift p' })).toBe(true)
    expect(matchesShortcut('Studio', 'Ctrl+Shift+P', { text: '', combo: 'Ctrl+Shift+P' })).toBe(true)
    expect(matchesShortcut('Barra lateral', 'Ctrl+B', { text: '', combo: 'Ctrl+Shift+P' })).toBe(false)
    expect(matchesShortcut('Barra lateral', 'Ctrl+B', { text: 'studio', combo: 'Ctrl+B' })).toBe(false)
  })
})
