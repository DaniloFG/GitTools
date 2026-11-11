import { describe, expect, it, vi } from 'vitest'
import { CATALOGS } from '../../src/shared/i18n/messages'
import { createTranslator } from '../../src/shared/i18n/translator'
import { LOCALE_IDS } from '../../src/shared/i18n'

describe('interface: catálogos por import()', () => {
  it('cada idioma carrega o próprio catálogo e traduz igual ao catálogo estático', async () => {
    vi.resetModules()
    const i18n = await import('../../src/renderer/src/i18n')
    // Módulo recém-carregado: nenhum catálogo em memória até alguém pedir.
    for (const id of LOCALE_IDS) expect(i18n.hasLocale(id)).toBe(false)
    for (const id of LOCALE_IDS) {
      await i18n.changeLocale(id)
      expect(i18n.getLocale()).toBe(id)
      const reference = createTranslator(id, CATALOGS, ['en'])
      expect(i18n.t('history.count', { count: 2 })).toBe(reference('history.count', { count: 2 }))
      expect(i18n.t('tabs.history')).toBe(reference('tabs.history'))
    }
  })
})
