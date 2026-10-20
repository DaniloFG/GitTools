// Idiomas disponíveis. Para adicionar um idioma: crie messages/<id>.ts, registre-o em
// messages/index.ts e acrescente uma entrada aqui.

export const LOCALE_IDS = ['pt-BR', 'en', 'es', 'zh-CN', 'hi', 'ar'] as const

export type LocaleId = (typeof LOCALE_IDS)[number]

export interface LocaleInfo {
  id: LocaleId
  /** Nome no próprio idioma (é assim que aparece no seletor). */
  nativeName: string
  englishName: string
  dir: 'ltr' | 'rtl'
}

export const LOCALES: LocaleInfo[] = [
  { id: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', dir: 'ltr' },
  { id: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { id: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { id: 'zh-CN', nativeName: '简体中文', englishName: 'Chinese (Simplified)', dir: 'ltr' },
  { id: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', dir: 'ltr' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl' }
]

export const DEFAULT_LOCALE: LocaleId = 'en'

export function localeInfo(id: LocaleId): LocaleInfo {
  return LOCALES.find((l) => l.id === id) ?? LOCALES[1]
}

export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value)
}

/** Escolhe o idioma suportado mais próximo de uma tag do sistema (ex.: "pt-PT" → "pt-BR"). */
export function matchLocale(tags: readonly string[]): LocaleId {
  for (const raw of tags) {
    const tag = raw.replace('_', '-').toLowerCase()
    const exact = LOCALE_IDS.find((id) => id.toLowerCase() === tag)
    if (exact) return exact
    const language = tag.split('-')[0]
    const partial = LOCALE_IDS.find((id) => id.toLowerCase().split('-')[0] === language)
    if (partial) return partial
  }
  return DEFAULT_LOCALE
}
