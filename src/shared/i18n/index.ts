// Ponto único de acesso a traduções, usado pelo processo principal, pelo motor git e pela interface.
// Cada processo tem o seu idioma atual; troque-o com setLocale().

import { CATALOGS } from './messages'
import { DEFAULT_LOCALE, localeInfo, type LocaleId } from './locales'
import { createTranslator, type Translate } from './translator'
import type { MessageKey, MessageParams } from './types'

export * from './locales'
export type { MessageKey, MessageParams, Messages } from './types'
export type { Translate } from './translator'

const FALLBACKS: LocaleId[] = ['en', 'pt-BR']

let currentLocale: LocaleId = DEFAULT_LOCALE
let translate: Translate = createTranslator(currentLocale, CATALOGS, FALLBACKS)

export function setLocale(locale: LocaleId): void {
  currentLocale = locale
  translate = createTranslator(locale, CATALOGS, FALLBACKS)
}

export function getLocale(): LocaleId {
  return currentLocale
}

export function textDirection(): 'ltr' | 'rtl' {
  return localeInfo(currentLocale).dir
}

/** Traduz uma chave no idioma atual. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(key, params)
}

/** Tradutor de um idioma específico, sem mudar o idioma atual. */
export function translatorFor(locale: LocaleId): Translate {
  return createTranslator(locale, CATALOGS, FALLBACKS)
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(currentLocale)
}

/** Data e hora sem segundos (ex.: "21/10/2026 14:32"). */
export function formatShortDateTime(ms: number): string {
  return new Date(ms).toLocaleString(currentLocale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function getCurrentLocale(): string {
  return currentLocale
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(currentLocale)
}

/** "há 5 minutos", "5 minutes ago", "قبل 5 دقائق"… */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000)
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day')
  return formatDate(ms)
}
