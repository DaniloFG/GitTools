import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

describe('configurações de exibição', () => {
  it('por padrão mostra as letras de status e o diff só com o trecho alterado', () => {
    expect(DEFAULT_SETTINGS.statusLetters).toBe(true)
    expect(DEFAULT_SETTINGS.diffFullFile).toBe(false)
    expect(normalizeSettings({}).statusLetters).toBe(true)
    expect(normalizeSettings({}).diffFullFile).toBe(false)
  })

  it('guarda as escolhas do usuário e ignora valores inválidos', () => {
    expect(normalizeSettings({ statusLetters: false, diffFullFile: true })).toMatchObject({ statusLetters: false, diffFullFile: true })
    expect(normalizeSettings({ statusLetters: 'não', diffFullFile: 'sim' })).toMatchObject({ statusLetters: true, diffFullFile: false })
  })

  it('o assistente de git no editor vem ligado e só desliga se o usuário pedir', () => {
    expect(DEFAULT_SETTINGS.inlineBlame).toBe(true)
    expect(normalizeSettings({}).inlineBlame).toBe(true)
    expect(normalizeSettings({ inlineBlame: false }).inlineBlame).toBe(false)
    expect(normalizeSettings({ inlineBlame: 'não' }).inlineBlame).toBe(true)
  })
})
