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

describe('continuar automaticamente após resolver conflitos', () => {
  it('vem desligado, e só liga se o usuário pedir `true`', () => {
    expect(DEFAULT_SETTINGS.autoContinueConflicts).toBe(false)
    expect(normalizeSettings({}).autoContinueConflicts).toBe(false)
    expect(normalizeSettings({ autoContinueConflicts: true }).autoContinueConflicts).toBe(true)
    expect(normalizeSettings({ autoContinueConflicts: 'sim' }).autoContinueConflicts).toBe(false)
  })
})

describe('conflitos: resumo ao terminar e abertura na partida', () => {
  it('vêm com o resumo mantido na tela e a tela abrindo sozinha na partida', () => {
    expect(DEFAULT_SETTINGS.conflictSummary).toBe('keep')
    expect(DEFAULT_SETTINGS.conflictStartup).toBe('open')
    expect(normalizeSettings({})).toMatchObject({ conflictSummary: 'keep', conflictStartup: 'open' })
  })

  it('guardam os valores válidos das duas opções', () => {
    expect(normalizeSettings({ conflictSummary: 'close' }).conflictSummary).toBe('close')
    expect(normalizeSettings({ conflictStartup: 'bannerOnly' }).conflictStartup).toBe('bannerOnly')
  })

  it('valor fora da lista (ou de outro tipo) cai no padrão de cada opção', () => {
    expect(normalizeSettings({ conflictSummary: 'fechar' }).conflictSummary).toBe('keep')
    expect(normalizeSettings({ conflictSummary: true }).conflictSummary).toBe('keep')
    expect(normalizeSettings({ conflictStartup: 'banner' }).conflictStartup).toBe('open')
    expect(normalizeSettings({ conflictStartup: null }).conflictStartup).toBe('open')
  })
})

describe('detecção de vários repositórios', () => {
  // Vem desligada: abrir o app não varre pasta e subpastas por padrão (desempenho). Só `true` literal liga.
  it('vem desligada, e só liga se o usuário pedir `true`', () => {
    expect(DEFAULT_SETTINGS.multiRepoDetection).toBe(false)
    expect(normalizeSettings({}).multiRepoDetection).toBe(false)
    expect(normalizeSettings({ multiRepoDetection: true }).multiRepoDetection).toBe(true)
    expect(normalizeSettings({ multiRepoDetection: 'sim' }).multiRepoDetection).toBe(false)
  })
})
