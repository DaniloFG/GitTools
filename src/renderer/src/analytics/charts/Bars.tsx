import { useState } from 'react'
import { compact, niceTicks, percent } from './format'
import { ChartBox, Legend, roundedRight, roundedTop } from './core'
import type { Series } from './TimeChart'

export interface BarRow {
  id: string
  label: string
  value: number
  color?: string
  /** Texto secundário (aparece no tooltip). */
  hint?: string
}

const ROW = 26

/** Ranking de barras horizontais finas, com o valor na ponta; cabem tantas linhas quanto o espaço permitir. */
export function BarList({ rows, format = compact, variant = 'bar', color = 'var(--dash-s1)', label, share }: { rows: BarRow[]; format?: (n: number) => string; variant?: 'bar' | 'lollipop'; color?: string; label: string; share?: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <ChartBox>
      {({ w, h }, tip) => {
        const fit = Math.max(1, Math.floor(h / ROW))
        const shown = rows.slice(0, fit)
        const max = Math.max(1, ...shown.map((r) => r.value))
        const labelW = Math.min(180, Math.max(70, w * 0.34))
        const valueW = 54
        const trackW = Math.max(20, w - labelW - valueW - 20)
        return (
          <svg width={w} height={shown.length * ROW + 4} role="img" aria-label={label} className="chart-svg">
            {shown.map((r, i) => {
              const y = i * ROW + 2
              const len = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * trackW)
              const fill = r.color ?? color
              const mid = y + ROW / 2
              return (
                <g
                  key={r.id}
                  className="chart-row"
                  opacity={hover && hover !== r.id ? 0.5 : 1}
                  onPointerMove={(e) => {
                    setHover(r.id)
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, {
                      title: r.label,
                      rows: [{ color: fill, key: 'box', label: share ? percent(total ? r.value / total : 0, 1) : (r.hint ?? ''), value: format(r.value) }],
                      note: share && r.hint ? r.hint : undefined
                    })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    tip.hide()
                  }}
                >
                  <rect x={0} y={y} width={w} height={ROW} fill="transparent" />
                  <text className="chart-label" x={0} y={mid} dominantBaseline="middle">
                    {truncate(r.label, Math.floor(labelW / 6.4))}
                  </text>
                  <line className="chart-track" x1={labelW + 8} x2={labelW + 8 + trackW} y1={mid} y2={mid} />
                  {variant === 'bar' ? (
                    <path d={roundedRight(labelW + 8, mid - 5, len, 10, 4)} fill={fill} />
                  ) : (
                    <>
                      <line x1={labelW + 8} x2={labelW + 8 + len} y1={mid} y2={mid} stroke={fill} strokeWidth={2} strokeLinecap="round" />
                      <circle cx={labelW + 8 + len} cy={mid} r={5} fill={fill} stroke="var(--dash-surface)" strokeWidth={2} />
                    </>
                  )}
                  <text className="chart-value" x={labelW + 8 + trackW + 10} y={mid} dominantBaseline="middle">
                    {format(r.value)}
                  </text>
                </g>
              )
            })}
          </svg>
        )
      }}
    </ChartBox>
  )
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

export type ColumnSeries = Series

/** Colunas verticais (agrupadas ou empilhadas) para categorias, como faixas de tamanho ou dias da semana. */
export function Columns({ categories, series, stacked = false, format = compact, label, highlight }: { categories: string[]; series: ColumnSeries[]; stacked?: boolean; format?: (n: number) => string; label: string; highlight?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const visible = series.filter((s) => !hidden.has(s.id))
  return (
    <div className="chart-col">
      <Legend
        items={series.map((s) => ({ id: s.id, label: s.label, color: s.color }))}
        hidden={hidden}
        onToggle={(id) =>
          setHidden((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else if (next.size < series.length - 1) next.add(id)
            return next
          })
        }
      />
      <ChartBox>
        {({ w, h }, tip) => {
          const M = { l: 38, r: 10, t: 16, b: 24 }
          const plotW = w - M.l - M.r
          const plotH = h - M.t - M.b
          const n = categories.length
          const totals = categories.map((_, i) => visible.reduce((s, v) => s + (v.y[i] ?? 0), 0))
          const maxVal = stacked ? Math.max(1, ...totals) : Math.max(1, ...visible.flatMap((s) => s.y))
          const ticks = niceTicks(maxVal, plotH < 140 ? 3 : 4)
          const top = Math.max(ticks[ticks.length - 1], maxVal)
          const sy = (v: number) => M.t + plotH - (v / top) * plotH
          const band = plotW / Math.max(1, n)
          const groupW = Math.min(24 * (stacked ? 1 : Math.max(1, visible.length)), band * 0.7)
          const each = stacked ? groupW : Math.max(3, (groupW - (visible.length - 1) * 2) / visible.length)
          const showLabels = n <= 14 && visible.length === 1 && each >= 16
          return (
            <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
              {ticks.map((t) => (
                <g key={t}>
                  <line className="chart-grid" x1={M.l} x2={M.l + plotW} y1={sy(t)} y2={sy(t)} />
                  <text className="chart-tick" x={M.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
                    {compact(t)}
                  </text>
                </g>
              ))}
              <line className="chart-axis" x1={M.l} x2={M.l + plotW} y1={sy(0)} y2={sy(0)} />
              {categories.map((c, i) => {
                const cx = M.l + band * (i + 0.5)
                let acc = 0
                return (
                  <g key={c} opacity={hover === null || hover === i ? 1 : 0.5}>
                    <text className="chart-tick" x={cx} y={h - 6} textAnchor="middle">
                      {truncate(c, Math.max(3, Math.floor(band / 6)))}
                    </text>
                    {visible.map((s, si) => {
                      const v = s.y[i] ?? 0
                      if (v <= 0) return null
                      const x0 = stacked ? cx - groupW / 2 : cx - groupW / 2 + si * (each + 2)
                      const y1 = sy(stacked ? acc + v : v)
                      const y0 = sy(stacked ? acc : 0)
                      const gap = stacked && acc > 0 ? 2 : 0
                      const hh = Math.max(1.5, y0 - y1 - gap)
                      const lastInStack = !stacked || visible.slice(si + 1).every((o) => !(o.y[i] > 0))
                      if (stacked) acc += v
                      const fill = highlight !== undefined && highlight !== i && visible.length === 1 ? 'var(--dash-other)' : s.color
                      return (
                        <g key={s.id}>
                          <path d={lastInStack ? roundedTop(x0, y0 - gap - hh, each, hh, 4) : `M${x0},${y0 - gap}V${y0 - gap - hh}H${x0 + each}V${y0 - gap}Z`} fill={fill} />
                          {showLabels && (
                            <text className="chart-value" x={x0 + each / 2} y={y0 - gap - hh - 5} textAnchor="middle">
                              {format(v)}
                            </text>
                          )}
                        </g>
                      )
                    })}
                    <rect
                      x={cx - band / 2}
                      y={M.t}
                      width={band}
                      height={plotH + M.b}
                      fill="transparent"
                      onPointerMove={(e) => {
                        setHover(i)
                        const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                        tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: c, rows: visible.map((s) => ({ color: s.color, key: 'box' as const, label: s.label, value: format(s.y[i] ?? 0) })), note: stacked && visible.length > 1 ? `Σ ${format(totals[i])}` : undefined })
                      }}
                      onPointerLeave={() => {
                        setHover(null)
                        tip.hide()
                      }}
                    />
                  </g>
                )
              })}
            </svg>
          )
        }}
      </ChartBox>
    </div>
  )
}
