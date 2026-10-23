// Formatação de números, datas e durações nos gráficos (sempre no idioma atual da interface).

import { getCurrentLocale } from '../../i18n'
import type { Granularity } from '../metrics'

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${getCurrentLocale()}|${JSON.stringify(options)}`
  let f = cache.get(key) as Intl.NumberFormat | undefined
  if (!f) cache.set(key, (f = new Intl.NumberFormat(getCurrentLocale(), options)))
  return f
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${getCurrentLocale()}|${JSON.stringify(options)}`
  let f = cache.get(key) as Intl.DateTimeFormat | undefined
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat(getCurrentLocale(), options)))
  return f
}

/** 1.284 · 12,9 mil · 4,2 mi (compacto a partir de mil). */
export function compact(n: number): string {
  if (Math.abs(n) < 1000) return numberFormat({ maximumFractionDigits: n % 1 ? 1 : 0 }).format(n)
  return numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export const int = (n: number) => numberFormat({ maximumFractionDigits: 0 }).format(Math.round(n))
export const decimal = (n: number, digits = 1) => numberFormat({ maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n)
export const percent = (fraction: number, digits = 0) => numberFormat({ style: 'percent', maximumFractionDigits: digits }).format(fraction)

export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${compact(Math.abs(n))}`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${decimal(ms / 1000)} s`
  return `${decimal(ms / 60_000)} min`
}

export function bytes(n: number): string {
  if (n < 1024) return `${int(n)} B`
  if (n < 1024 * 1024) return `${decimal(n / 1024)} KB`
  return `${decimal(n / 1024 / 1024)} MB`
}

/** Rótulo curto do eixo para um balde de tempo. */
export function axisDate(ms: number, g: Granularity, spanDays: number): string {
  if (g === 'month') return dateFormat(spanDays > 400 ? { month: 'short', year: '2-digit' } : { month: 'short' }).format(ms)
  return dateFormat({ day: 'numeric', month: 'short' }).format(ms)
}

/** Rótulo completo do balde (para o tooltip): o dia, a semana que começa nele ou o mês. */
export function bucketLabel(ms: number, g: Granularity): string {
  if (g === 'month') return dateFormat({ month: 'long', year: 'numeric' }).format(ms)
  if (g === 'week') return dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(ms)
  return dateFormat({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(ms)
}

export const shortDate = (ms: number) => dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(ms)

/** Nomes dos dias da semana começando na segunda (curtos). */
export function weekdayNames(style: 'short' | 'narrow' = 'short'): string[] {
  // 5/1/2026 é uma segunda-feira.
  return Array.from({ length: 7 }, (_, i) => dateFormat({ weekday: style }).format(new Date(2026, 0, 5 + i)))
}

export function monthNames(): string[] {
  return Array.from({ length: 12 }, (_, i) => dateFormat({ month: 'short' }).format(new Date(2026, i, 1)))
}

/** Escolhe entre `{count}` rótulos espaçados por igual para o eixo (índices). */
export function spacedIndexes(length: number, want: number): number[] {
  if (length <= 0) return []
  if (length <= want) return Array.from({ length }, (_, i) => i)
  const step = (length - 1) / (want - 1)
  return Array.from({ length: want }, (_, i) => Math.round(i * step))
}

/** Marcas "redondas" para um eixo de 0 a `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / pow
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e9) / 1e9)
  return ticks
}
