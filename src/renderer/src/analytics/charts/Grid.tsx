import { useMemo, useState } from 'react'
import { compact, decimal, monthNames, weekdayNames } from './format'
import { ChartBox, sequential } from './core'
import { DAY } from '../model'

/** Escala de intensidade (menos → mais) abaixo de um mapa de calor. */
export function ScaleLegend({ low, high }: { low: string; high: string }) {
  return (
    <div className="scale-legend" aria-hidden>
      <span>{low}</span>
      {[0.05, 0.25, 0.5, 0.75, 1].map((t) => (
        <i key={t} style={{ background: sequential(t) }} />
      ))}
      <span>{high}</span>
    </div>
  )
}

interface MatrixProps {
  /** Linhas × colunas de valores. */
  matrix: number[][]
  rows: string[]
  cols: string[]
  /** Quais colunas ganham rótulo no eixo (índices). */
  colTicks?: number[]
  format?: (n: number) => string
  label: string
  valueLabel: string
  low: string
  high: string
  /** `heat`: células coloridas; `punch`: círculos proporcionais (cartão perfurado). */
  kind?: 'heat' | 'punch'
  /** Largura reservada para os rótulos das linhas (px). */
  rowLabelWidth?: number
}

/** Mapa de calor de uma matriz (ex.: dia da semana × hora): uma célula por valor, com tooltip. */
export function Heatmap({ matrix, rows, cols, colTicks, format = compact, label, valueLabel, low, high, kind = 'heat', rowLabelWidth = 34 }: MatrixProps) {
  const [hover, setHover] = useState<string | null>(null)
  const max = useMemo(() => Math.max(1, ...matrix.flat()), [matrix])
  return (
    <div className="chart-col">
      <ChartBox>
        {({ w, h }, tip) => {
          const M = { l: rowLabelWidth, r: 6, t: 6, b: 22 }
          const cw = (w - M.l - M.r) / cols.length
          const ch = (h - M.t - M.b) / rows.length
          const cell = Math.min(cw, ch, 44)
          const gx = (cw - cell) / 2
          const ticks = colTicks ?? cols.map((_, i) => i).filter((i) => i % Math.max(1, Math.ceil(30 / cw)) === 0)
          return (
            <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
              {rows.map((r, ri) => (
                <text key={r} className="chart-tick" x={M.l - 8} y={M.t + ch * (ri + 0.5)} textAnchor="end" dominantBaseline="middle">
                  {rowLabelWidth > 40 && r.length > (rowLabelWidth - 12) / 6.2 ? `${r.slice(0, Math.floor((rowLabelWidth - 12) / 6.2) - 1)}…` : r}
                </text>
              ))}
              {ticks.map((ci) => (
                <text key={ci} className="chart-tick" x={M.l + cw * (ci + 0.5)} y={h - 6} textAnchor="middle">
                  {cols[ci]}
                </text>
              ))}
              {matrix.map((row, ri) =>
                row.map((v, ci) => {
                  const id = `${ri}-${ci}`
                  const cx = M.l + cw * ci + gx
                  const cy = M.t + ch * ri + (ch - cell) / 2
                  const t = v / max
                  const on = (e: React.PointerEvent) => {
                    setHover(id)
                    const rect = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: `${rows[ri]} · ${cols[ci]}`, rows: [{ color: sequential(Math.max(0.3, t)), key: 'box', label: valueLabel, value: format(v) }] })
                  }
                  const off = () => {
                    setHover(null)
                    tip.hide()
                  }
                  return kind === 'heat' ? (
                    <rect key={id} x={cx + 1} y={cy + 1} width={Math.max(2, cell - 2)} height={Math.max(2, cell - 2)} rx={Math.min(4, cell / 4)} fill={v ? sequential(0.12 + t * 0.88) : 'var(--dash-track)'} opacity={hover && hover !== id ? 0.55 : 1} onPointerMove={on} onPointerLeave={off} />
                  ) : (
                    <g key={id} onPointerMove={on} onPointerLeave={off}>
                      <rect x={cx} y={cy} width={cell} height={cell} fill="transparent" />
                      {v > 0 && <circle cx={cx + cell / 2} cy={cy + cell / 2} r={Math.max(1.5, Math.sqrt(t) * (cell / 2 - 1))} fill="var(--dash-s1)" opacity={hover && hover !== id ? 0.5 : 0.9} />}
                      {v === 0 && <circle cx={cx + cell / 2} cy={cy + cell / 2} r={1.5} fill="var(--dash-track)" />}
                    </g>
                  )
                })
              )}
            </svg>
          )
        }}
      </ChartBox>
      <ScaleLegend low={low} high={high} />
    </div>
  )
}

/** Calendário de atividade (colunas = semanas, linhas = dias da semana), no estilo dos gráficos de contribuição. */
export function CalendarHeat({ perDay, from, to, label, valueLabel, low, high }: { perDay: Map<number, number>; from: number; to: number; label: string; valueLabel: string; low: string; high: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const weekdays = useMemo(() => weekdayNames('narrow'), [])
  const months = useMemo(() => monthNames(), [])
  const levels = useMemo(() => {
    const values = [...perDay.values()].sort((a, b) => a - b)
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 1
    return [q(0.25), q(0.5), q(0.75), q(0.92)]
  }, [perDay])
  const level = (v: number) => (v === 0 ? 0 : v <= levels[0] ? 1 : v <= levels[1] ? 2 : v <= levels[2] ? 3 : v <= levels[3] ? 4 : 5)
  return (
    <div className="chart-col">
      <ChartBox>
        {({ w, h }, tip) => {
          const start = new Date(from)
          start.setHours(0, 0, 0, 0)
          start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
          const days = Math.ceil((to - start.getTime()) / DAY) + 1
          const weeks = Math.ceil(days / 7)
          const M = { l: 18, t: 16, r: 2, b: 2 }
          const cell = Math.max(5, Math.min(30, Math.floor((w - M.l - M.r) / weeks), Math.floor((h - M.t - M.b) / 7)))
          const step = cell
          const gap = cell > 20 ? 4 : cell > 9 ? 3 : 1.5
          const out: React.ReactNode[] = []
          const monthLabels: React.ReactNode[] = []
          let lastMonth = -1
          for (let wk = 0; wk < weeks; wk++) {
            for (let d = 0; d < 7; d++) {
              const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + wk * 7 + d)
              const t = date.getTime()
              if (t < from - DAY || t > to) continue
              const v = perDay.get(t) ?? 0
              const lv = level(v)
              out.push(
                <rect
                  key={t}
                  x={M.l + wk * step}
                  y={M.t + d * step}
                  width={cell - gap}
                  height={cell - gap}
                  rx={Math.min(5, cell / 4)}
                  fill={lv === 0 ? 'var(--dash-track)' : sequential(0.18 + (lv - 1) * 0.2)}
                  opacity={hover === null || hover === t ? 1 : 0.6}
                  onPointerMove={(e) => {
                    setHover(t)
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), rows: [{ color: lv ? sequential(0.18 + (lv - 1) * 0.2) : 'var(--dash-track)', key: 'box', label: valueLabel, value: decimal(v, 0) }] })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    tip.hide()
                  }}
                />
              )
              if (d === 0 && date.getMonth() !== lastMonth && date.getDate() <= 7) {
                lastMonth = date.getMonth()
                monthLabels.push(
                  <text key={`m${t}`} className="chart-tick" x={M.l + wk * step} y={10}>
                    {months[date.getMonth()]}
                  </text>
                )
              }
            }
          }
          return (
            <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
              {[0, 2, 4].map((d) => (
                <text key={d} className="chart-tick" x={0} y={M.t + d * step + cell / 2} dominantBaseline="middle">
                  {weekdays[d]}
                </text>
              ))}
              {monthLabels}
              {out}
            </svg>
          )
        }}
      </ChartBox>
      <ScaleLegend low={low} high={high} />
    </div>
  )
}
