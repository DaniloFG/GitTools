import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, TOAST_HEIGHT, TOAST_SIZES, TOAST_WIDTH } from '../src/shared/settings'

describe('notificações (toasts)', () => {
  it('configurações antigas, salvas antes das novas opções, continuam válidas', () => {
    const old = { toast: { horizontal: 'left', vertical: 'top', width: 380, height: 240 } }
    expect(normalizeSettings(old).toast).toEqual({ horizontal: 'left', vertical: 'top', width: 380, height: 240 })
    expect(normalizeSettings({ toast: { horizontal: 'center', vertical: 'bottom', width: 720, height: 480 } }).toast).toMatchObject({
      horizontal: 'center',
      vertical: 'bottom',
      width: 720,
      height: 480
    })
  })

  it('aceita a posição no meio (vertical) e combina com o centro (horizontal)', () => {
    expect(normalizeSettings({ toast: { vertical: 'middle', horizontal: 'center' } }).toast).toMatchObject({ vertical: 'middle', horizontal: 'center' })
    expect(normalizeSettings({ toast: { vertical: 'meio' } }).toast.vertical).toBe(DEFAULT_SETTINGS.toast.vertical)
  })

  it('permite tamanhos acima do máximo antigo, até o novo limite', () => {
    expect(normalizeSettings({ toast: { width: 1200, height: 800 } }).toast).toMatchObject({ width: 1200, height: 800 })
    expect(normalizeSettings({ toast: { width: 5000, height: 5000 } }).toast).toMatchObject({ width: TOAST_WIDTH.max, height: TOAST_HEIGHT.max })
    expect(normalizeSettings({ toast: { width: 333, height: 61 } }).toast).toMatchObject({ width: 340, height: 60 })
  })

  it('os tamanhos prontos cabem nos limites dos controles deslizantes', () => {
    for (const size of Object.values(TOAST_SIZES)) {
      expect(normalizeSettings({ toast: size }).toast).toMatchObject(size)
      expect(size.width).toBeLessThanOrEqual(TOAST_WIDTH.max)
      expect(size.height).toBeLessThanOrEqual(TOAST_HEIGHT.max)
    }
  })
})

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
