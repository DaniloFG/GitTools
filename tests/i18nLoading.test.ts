import { describe, expect, it, vi } from 'vitest'
import type * as I18n from '../src/shared/i18n'
import type { LocaleId, Messages } from '../src/shared/i18n'
import { CATALOGS } from '../src/shared/i18n/messages'

/** Módulo de idiomas novo, sem os catálogos que tests/support/catalogs.ts registra (como num processo recém-aberto). */
async function freshI18n(): Promise<typeof I18n> {
  vi.resetModules()
  return import('../src/shared/i18n')
}

/** Carregador controlado pelo teste: cada pedido fica pendente até `release`. */
function manualLoader() {
  const calls: LocaleId[] = []
  const waiting = new Map<LocaleId, { resolve(m: Messages): void; reject(e: unknown): void }>()
  const load = (id: LocaleId) => {
    calls.push(id)
    return new Promise<Messages>((resolve, reject) => waiting.set(id, { resolve, reject }))
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))
  return {
    calls,
    load,
    async release(id: LocaleId) {
      waiting.get(id)!.resolve(CATALOGS[id])
      await settle()
    },
    async fail(id: LocaleId) {
      waiting.get(id)!.reject(new Error('sem arquivo'))
      await settle()
    }
  }
}

describe('catálogos sob demanda', () => {
  it('carrega só o idioma pedido e o de reserva, uma vez cada, e só então troca', async () => {
    const i18n = await freshI18n()
    const loader = manualLoader()
    i18n.setCatalogLoader(loader.load)

    // Sem catálogo, não troca (nada de chaves cruas no idioma novo) e começa a carregar.
    expect(i18n.setLocale('es')).toBe(false)
    expect(i18n.getLocale()).toBe('en')
    const loading = i18n.loadLocale('es')
    void i18n.loadLocale('es')
    expect(loader.calls.sort()).toEqual(['en', 'es'])

    await loader.release('es')
    await loader.release('en')
    await loading
    expect(i18n.setLocale('es')).toBe(true)
    expect(i18n.t('tabs.history')).toBe(i18n.translatorFor('es')('tabs.history'))
    expect(i18n.t('tabs.history')).toBe((CATALOGS.es as unknown as { tabs: { history: string } }).tabs.history)
    expect(loader.calls).toHaveLength(2)
  })

  it('changeLocale: uma resposta atrasada não troca para um idioma já abandonado', async () => {
    const i18n = await freshI18n()
    const loader = manualLoader()
    i18n.setCatalogLoader(loader.load)

    const slow = i18n.changeLocale('hi')
    const fast = i18n.changeLocale('ar')
    await loader.release('en')
    await loader.release('ar')
    await fast
    expect(i18n.getLocale()).toBe('ar')
    await loader.release('hi')
    await slow
    expect(i18n.getLocale()).toBe('ar')
    expect(i18n.textDirection()).toBe('rtl')
  })

  it('catálogo que não carrega: mantém o idioma atual e tenta de novo no próximo pedido', async () => {
    const i18n = await freshI18n()
    const loader = manualLoader()
    i18n.setCatalogLoader(loader.load)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const first = i18n.changeLocale('pt-BR')
    await loader.fail('pt-BR')
    await loader.release('en')
    await first
    expect(i18n.getLocale()).toBe('en')
    expect(i18n.t('tabs.history')).toBe('History')
    expect(error).toHaveBeenCalledOnce()

    const second = i18n.changeLocale('pt-BR')
    await loader.release('pt-BR')
    await second
    expect(i18n.getLocale()).toBe('pt-BR')
    expect(i18n.t('tabs.history')).toBe('Histórico')
    error.mockRestore()
  })

  it('jsonCatalogLoader lê `<id>.json` e devolve o mesmo catálogo', async () => {
    const i18n = await freshI18n()
    const read = vi.fn(async (name: string) => JSON.stringify(CATALOGS[name.replace('.json', '') as LocaleId]))
    i18n.setCatalogLoader(i18n.jsonCatalogLoader(read))
    await i18n.changeLocale('zh-CN')
    expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['en.json', 'zh-CN.json'])
    expect(i18n.getLocale()).toBe('zh-CN')
    expect(i18n.t('history.count', { count: 3 })).toBe(i18n.translatorFor('zh-CN')('history.count', { count: 3 }))
  })
})
