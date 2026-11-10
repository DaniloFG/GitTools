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
const SHORT_PARTS: DateOptions = { ...DATE_PARTS, hour: '2-digit', minute: '2-digit' }
const FULL_12H: DateOptions = { ...DATE_PARTS, ...TIME_PARTS, hour12: true }
const FULL_24H: DateOptions = { ...DATE_PARTS, ...TIME_PARTS, hour12: false }
const SHORT_12H: DateOptions = { ...SHORT_PARTS, hour12: true }
const SHORT_24H: DateOptions = { ...SHORT_PARTS, hour12: false }
// Mesmo resultado de `toLocaleString(idioma)` sem opções: data e hora, todos os campos numéricos.
const SYSTEM_DATE_TIME: DateOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }

// Criar um Intl.DateTimeFormat custa dezenas de vezes mais que usá-lo, e estas funções rodam por linha de lista.
// Guardamos um formatador por idioma e opções. As chaves são poucas (idiomas × formatos); o limite evita crescer sem fim.
const FORMATTER_CACHE_LIMIT = 64
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

/**
 * Formatador de data guardado para um idioma e opções. Escreve exatamente como
 * `date.toLocaleString(idioma, opções)` (ou `toLocaleDateString`, sem opções para só a data).
 */
export function dateFormatterFor(locale: string | undefined, options?: DateOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale ?? null, options ?? null])
  let formatter = dateFormatters.get(key)
  if (!formatter) {
    if (dateFormatters.size >= FORMATTER_CACHE_LIMIT) dateFormatters.clear()
    formatter = new Intl.DateTimeFormat(locale, options)
    dateFormatters.set(key, formatter)
  }
  return formatter
}

function relativeFormatterFor(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    if (relativeFormatters.size >= FORMATTER_CACHE_LIMIT) relativeFormatters.clear()
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormatters.set(locale, formatter)
  }
  return formatter
}

/** Data e hora com segundos (ex.: "2026-12-31 23:59:59"). */
export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') {
    const p = isoParts(d)
    return `${p.date} ${p.time}`
  }
  if (dateStyle === 'system') return dateFormatterFor(systemLocale, SYSTEM_DATE_TIME).format(d)
  return dateFormatterFor(currentLocale, dateStyle === '12h' ? FULL_12H : FULL_24H).format(d)
}

/** Data e hora sem segundos (ex.: "2026-12-31 23:59"). */
export function formatShortDateTime(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') {
    const p = isoParts(d)
    return `${p.date} ${p.short}`
  }
  if (dateStyle === 'system') return dateFormatterFor(systemLocale, SHORT_PARTS).format(d)
  return dateFormatterFor(currentLocale, dateStyle === '12h' ? SHORT_12H : SHORT_24H).format(d)
}

/** Data e hora da coluna do histórico: no formato ISO com segundos ("2026-12-31 23:59:59"); nos demais, sem segundos para caber. */
export function formatGridDateTime(ms: number): string {
  return dateStyle === 'iso' ? formatDateTime(ms) : formatShortDateTime(ms)
}

export function getCurrentLocale(): string {
  return currentLocale
}

/** Só a data (ex.: "2026-12-31"). */
export function formatDate(ms: number): string {
  const d = new Date(ms)
  if (dateStyle === 'iso') return isoParts(d).date
  // Sem opções: `toLocaleDateString(idioma)` equivale a `Intl.DateTimeFormat(idioma)`.
  return dateFormatterFor(dateStyle === 'system' ? systemLocale : currentLocale).format(d)
}

/** "há 5 minutos", "5 minutes ago", "قبل 5 دقائق"… */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000)
  const abs = Math.abs(seconds)
  const rtf = relativeFormatterFor(currentLocale)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day')
  return formatDate(ms)
}
