import type { MessageKey } from '../../i18n'
import { t } from '../../i18n'
import type { BarRow } from '../charts/Bars'
import type { Ctx } from './types'

/** Tradução de uma chave montada em tempo de execução (os widgets são registrados por id). */
export const tk = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, params)

export const personRows = (ctx: Ctx, value: (id: string) => number, limit = 12): BarRow[] =>
  ctx.people
    .map((p) => ({ id: p.id, label: p.name, value: value(p.id), color: ctx.color(p.id), hint: p.email }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)

/** Reduz uma série longa a `max` pontos somando grupos vizinhos (para as miniaturas). */
export function downsample(values: number[], max = 24): number[] {
  if (values.length <= max) return values
  const size = values.length / max
  return Array.from({ length: max }, (_, i) => {
    let s = 0
    for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size); j++) s += values[j] ?? 0
    return s
  })
}

export const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null)
