// Ponto único de acesso a traduções, usado pelo processo principal, pelo motor git e pela interface.
// Cada processo tem o seu idioma atual; troque-o com setLocale() (catálogo já carregado) ou changeLocale().
//
// Os catálogos NÃO são importados aqui: os seis juntos eram metade do JavaScript da interface e iam inteiros
// também no processo principal e na extensão. Cada processo registra como carregar um catálogo
// (setCatalogLoader): a interface com import() (um pedaço do pacote por idioma) e o processo principal e a
// extensão lendo um JSON gerado no build. Só o idioma ativo e o de reserva são carregados.

import { DEFAULT_LOCALE, localeInfo, type LocaleId } from './locales'
import { createTranslator, type Translate } from './translator'
import { DEFAULT_SETTINGS, type DateFormatSetting } from '../settings'
import type { MessageKey, MessageParams, Messages } from './types'

export * from './locales'
export type { MessageKey, MessageParams, Messages } from './types'
export type { Translate } from './translator'

/**
 * Idioma de reserva: o inglês. O TypeScript já exige que todo catálogo tenha todas as chaves (o tipo vem do
 * pt-BR), então a reserva só cobre um catálogo gerado com defeito; uma segunda reserva (o pt-BR, como era
 * antes) custaria mais um download sem nunca ser usada.
 */
const FALLBACKS: LocaleId[] = [DEFAULT_LOCALE]

export type CatalogLoader = (locale: LocaleId) => Promise<Messages>

const catalogs: Partial<Record<LocaleId, Messages>> = {}
/** Carregamentos em andamento ou concluídos (pedir o mesmo idioma duas vezes não lê duas vezes). */
const pending = new Map<LocaleId, Promise<void>>()
let loader: CatalogLoader | null = null

let currentLocale: LocaleId = DEFAULT_LOCALE
let translate: Translate = createTranslator(currentLocale, catalogs, FALLBACKS)
/** Último idioma pedido a changeLocale (uma resposta atrasada não troca para um idioma já abandonado). */
let requested: LocaleId | null = null

/** Diz a este processo como carregar um catálogo (chamado uma vez, na entrada do processo). */
export function setCatalogLoader(load: CatalogLoader): void {
  loader = load
}

/**
 * Carregador do processo principal e da extensão: um JSON por idioma, gerado no build (`locales/<id>.json`).
 * Lá o pacote é um arquivo CommonJS só, onde import() não separa pedaços (o esbuild os embutiria no arquivo, e o
 * rollup os carregaria com require, uma leitura síncrona); `readText` é a leitura assíncrona do disco.
 */
export function jsonCatalogLoader(readText: (fileName: string) => Promise<string>): CatalogLoader {
  return async (locale) => JSON.parse(await readText(`${locale}.json`)) as Messages
}

/** Registra um catálogo já em memória (testes e quem já o tem carregado). */
export function registerCatalog(locale: LocaleId, messages: Messages): void {
  catalogs[locale] = messages
  pending.set(locale, Promise.resolve())
  // O tradutor guarda a lista de catálogos ao ser criado: refaz para enxergar o novo.
  translate = createTranslator(currentLocale, catalogs, FALLBACKS)
}

/** O catálogo do idioma já está em memória? (A reserva não é exigida: se ela falhar, o idioma ainda funciona.) */
export function hasLocale(locale: LocaleId): boolean {
  return catalogs[locale] !== undefined
}

function loadOne(locale: LocaleId): Promise<void> {
  let job = pending.get(locale)
  if (!job) {
    const load = loader
    job = load
      ? load(locale).then(
          (messages) => registerCatalog(locale, messages),
          (error: unknown) => {
            // Sem o catálogo os textos caem na reserva (ou na própria chave); tentar de novo na próxima troca.
            pending.delete(locale)
            console.error(`GitTools: catálogo de idioma "${locale}" não carregou`, error)
          }
        )
      : Promise.resolve()
    pending.set(locale, job)
  }
  return job
}

/**
 * Carrega o catálogo do idioma e, em paralelo, o de reserva, sem trocar o idioma atual. Com
 * `withFallbacks = false` só o do idioma: a interface usa no primeiro desenho e pede a reserva depois
 * (`loadFallbacks`), porque com catálogos completos a reserva quase nunca é lida.
 */
export function loadLocale(locale: LocaleId, withFallbacks = true): Promise<void> {
  const ids = withFallbacks ? [locale, ...FALLBACKS] : [locale]
  return Promise.all(ids.map(loadOne)).then(() => undefined)
}

/** Carrega os catálogos de reserva (a interface chama depois do primeiro desenho). */
export function loadFallbacks(): Promise<void> {
  return Promise.all(FALLBACKS.map(loadOne)).then(() => undefined)
}

/**
 * Troca o idioma atual se o catálogo já estiver carregado; senão começa a carregá-lo e mantém o atual
 * (nunca mostra chaves cruas). Devolve se trocou. Quem desenha a tela chama de novo quando `loadLocale` resolver.
 */
export function setLocale(locale: LocaleId): boolean {
  if (!hasLocale(locale)) {
    void loadLocale(locale)
    return false
  }
  if (locale !== currentLocale) {
    currentLocale = locale
    translate = createTranslator(locale, catalogs, FALLBACKS)
  }
  return true
}

/** Carrega o catálogo e só então troca (processo principal e extensão; a interface usa `useLocaleCatalog`). */
export async function changeLocale(locale: LocaleId): Promise<void> {
  requested = locale
  await loadLocale(locale)
  if (requested === locale) setLocale(locale)
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

/** Tradutor de um idioma específico (com o catálogo já carregado), sem mudar o idioma atual. */
export function translatorFor(locale: LocaleId): Translate {
  return createTranslator(locale, catalogs, FALLBACKS)
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
