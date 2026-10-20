import { describe, expect, it } from 'vitest'
import { CATALOGS } from '../src/shared/i18n/messages'
import { LOCALE_IDS, LOCALES, matchLocale, translatorFor } from '../src/shared/i18n'
import { createTranslator } from '../src/shared/i18n/translator'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings'

type Tree = { [key: string]: string | Tree }
const isPlural = (v: unknown): v is Record<string, string> => typeof v === 'object' && v !== null && 'other' in v

/** Todas as folhas: chave pontuada → textos (um por forma de plural). */
function leaves(tree: Tree, prefix = ''): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, [value])
    else if (isPlural(value)) out.set(path, Object.values(value))
    else for (const [k, v] of leaves(value, path)) out.set(k, v)
  }
  return out
}

const placeholders = (texts: string[]) => new Set(texts.flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))

describe('catálogos de idiomas', () => {
  const reference = leaves(CATALOGS['pt-BR'] as unknown as Tree)

  it('oferece pelo menos 6 idiomas, incluindo pt-BR e os mais falados', () => {
    expect(LOCALE_IDS).toEqual(expect.arrayContaining(['pt-BR', 'en', 'zh-CN', 'hi', 'es', 'ar']))
    expect(LOCALES.find((l) => l.id === 'ar')?.dir).toBe('rtl')
  })

  for (const id of LOCALE_IDS) {
    it(`${id}: tem exatamente as mesmas chaves do pt-BR, sem textos vazios`, () => {
      const catalog = leaves(CATALOGS[id] as unknown as Tree)
      expect([...catalog.keys()].sort()).toEqual([...reference.keys()].sort())
      for (const [key, texts] of catalog) for (const text of texts) expect(text.trim(), key).not.toBe('')
    })

    it(`${id}: só usa parâmetros que existem no texto original`, () => {
      const catalog = leaves(CATALOGS[id] as unknown as Tree)
      for (const [key, texts] of catalog) {
        const allowed = placeholders(reference.get(key)!)
        for (const name of placeholders(texts)) expect(allowed.has(name), `${id} ${key}: {${name}}`).toBe(true)
      }
    })
  }
})

describe('tradutor', () => {
  it('interpola parâmetros e escolhe o plural do idioma', () => {
    const pt = translatorFor('pt-BR')
    expect(pt('history.count', { count: 1 })).toBe('1 commit')
    expect(pt('history.count', { count: 3 })).toBe('3 commits')
    expect(pt('compare.onlyIn', { ref: 'main' })).toBe('Só em main')
    const ar = translatorFor('ar')
    expect(ar('history.count', { count: 1 })).toBe('إيداع واحد')
    expect(ar('history.count', { count: 2 })).toBe('إيداعان')
    const n = new Intl.NumberFormat('ar')
    expect(ar('history.count', { count: 5 })).toBe(`${n.format(5)} إيداعات`)
    expect(ar('history.count', { count: 11 })).toBe(`${n.format(11)} إيداعًا`)
  })

  it('usa a forma "zero" quando existe', () => {
    expect(translatorFor('en')('changes.stageLines', { count: 0 })).toBe('Stage lines')
    expect(translatorFor('en')('changes.stageLines', { count: 2 })).toBe('Stage 2 lines')
  })

  it('recorre aos idiomas de reserva e, por fim, à própria chave', () => {
    const t = createTranslator('es', { 'pt-BR': CATALOGS['pt-BR'] }, ['pt-BR'])
    expect(t('tabs.history')).toBe('Histórico')
    expect(t('nao.existe' as never)).toBe('nao.existe')
  })

  it('escolhe o idioma mais próximo do sistema', () => {
    expect(matchLocale(['pt-PT'])).toBe('pt-BR')
    expect(matchLocale(['es-MX', 'en-US'])).toBe('es')
    expect(matchLocale(['zh-TW'])).toBe('zh-CN')
    expect(matchLocale(['ar-EG'])).toBe('ar')
    expect(matchLocale(['hi_IN'])).toBe('hi')
    expect(matchLocale(['de-DE', 'fr-FR'])).toBe('en')
  })
})

describe('configurações', () => {
  it('normaliza valores inválidos ou ausentes', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ language: 'klingon', theme: 'roxo', zoom: 9, shortcuts: { a: 1, b: 'Ctrl+B' } })).toEqual({
      ...DEFAULT_SETTINGS,
      shortcuts: { b: 'Ctrl+B' }
    })
    expect(normalizeSettings({ language: 'ar', theme: 'dark', zoom: 1.25 })).toMatchObject({ language: 'ar', theme: 'dark', zoom: 1.25 })
  })
})
