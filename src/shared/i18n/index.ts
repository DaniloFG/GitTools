// Ponto único de acesso a traduções, usado pelo processo principal, pelo motor git e pela interface.
// Cada processo tem o seu idioma atual; troque-o com setLocale().

import { CATALOGS } from './messages'
import { DEFAULT_LOCALE, localeInfo, type LocaleId } from './locales'
import { createTranslator, type Translate } from './translator'
import { DEFAULT_SETTINGS, type DateFormatSetting } from '../settings'
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

/** Como as datas aparecem: `iso` (2026-12-31 23:59:59), `system` (formato do sistema), `24h` ou `12h` (no idioma da interface). */
let dateStyle: DateFormatSetting = DEFAULT_SETTINGS.dateFormat
/** Idioma preferido do sistema operacional, usado quando o formato é "system". */
let systemLocale: string | undefined

export function setDateFormat(style: DateFormatSetting, system?: string): void {
  dateStyle = style
  systemLocale = system
}

/** Muda quando o jeito de escrever datas muda (para componentes memorizados saberem que precisam redesenhar). */
export function dateFormatKey(): string {
  return `${dateStyle}|${systemLocale ?? ''}|${currentLocale}`
}

const pad = (n: number) => String(n).padStart(2, '0')

function isoParts(d: Date): { date: string; time: string; short: string } {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return { date, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, short: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

type DateOptions = Intl.DateTimeFormatOptions
const DATE_PARTS: DateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
const TIME_PARTS: DateOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' }

/** Data e hora com segundos (ex.: "2026-12-31 23:59:59"). */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') {
    const p = isoParts(d)
    return `${p.date} ${p.time}`
  }
  if (dateStyle === 'system') return d.toLocaleString(systemLocale)
  return d.toLocaleString(currentLocale, { ...DATE_PARTS, ...TIME_PARTS, hour12: dateStyle === '12h' })
}

/** Data e hora sem segundos (ex.: "2026-12-31 23:59"). */
export function formatShortDateTime(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') {
    const p = isoParts(d)
    return `${p.date} ${p.short}`
  }
  const short: DateOptions = { ...DATE_PARTS, hour: '2-digit', minute: '2-digit' }
  if (dateStyle === 'system') return d.toLocaleString(systemLocale, short)
  return d.toLocaleString(currentLocale, { ...short, hour12: dateStyle === '12h' })
}

export function getCurrentLocale(): string {
  return currentLocale
}

/** Só a data (ex.: "2026-12-31"). */
export function formatDate(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') return isoParts(d).date
  return d.toLocaleDateString(dateStyle === 'system' ? systemLocale : currentLocale)
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
