import { useId, useMemo, useState } from 'react'
import type { Granularity } from '../metrics'
import { axisDate, bucketLabel, compact, niceTicks, spacedIndexes } from './format'
import { ChartBox, Legend, monotonePath, roundedTop, type TipContent } from './core'

export interface Series {
  id: string
  label: string
  color: string
  y: number[]
}

export type TimeMode = 'area' | 'line' | 'bar' | 'step' | 'stream'

interface Props {
  x: number[]
  series: Series[]
  mode: TimeMode
  /** Empilha as séries (área e barras). Em `stream` é sempre empilhado. */
  stacked?: boolean
  g: Granularity
  format?: (n: number) => string
  /** Marca o ponto mais alto (só com uma série). */
  peak?: boolean
  /** Rótulo de acessibilidade. */
  label: string
  /** Formatam as datas do eixo e do tooltip quando o padrão (por dia, semana ou mês) não serve (ex.: minutos). */
  axisLabel?: (ms: number) => string
  titleLabel?: (ms: number) => string
}

const M = { l: 38, r: 14, t: 12, b: 24 }

/** Gráfico de tempo: área, linha, degraus, barras ou "stream"; com cruzeta, tooltip único e legenda. */
export function TimeChart({ x, series, mode, stacked = false, g, format = compact, peak = false, label, axisLabel, titleLabel }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.id)), [series, hidden])
  const stack = stacked || mode === 'stream'
  const n = x.length
  const span = n > 1 ? (x[n - 1] - x[0]) / 86_400_000 : 1

  const geometry = useMemo(() => {
    // Linha de base e topo de cada série em cada ponto.
    const base: number[][] = []
    const top: number[][] = []
    const totals = x.map((_, i) => visible.reduce((s, v) => s + (v.y[i] ?? 0), 0))
    let lo = 0
    let hi = 0
    visible.forEach((s, si) => {
      base[si] = []
      top[si] = []
      for (let i = 0; i < n; i++) {
        const below = stack ? (si ? top[si - 1][i] : mode === 'stream' ? -totals[i] / 2 : 0) : 0
        base[si][i] = below
        top[si][i] = below + (s.y[i] ?? 0)
        lo = Math.min(lo, base[si][i], top[si][i])
        hi = Math.max(hi, base[si][i], top[si][i])
      }
    })
    return { base, top, totals, lo, hi: hi || 1 }
  }, [visible, x, n, stack, mode])

  return (
    <div className="chart-col">
      <Legend items={series.map((s) => ({ id: s.id, label: s.label, color: s.color, key: mode === 'line' || mode === 'step' ? 'line' : 'box' }))} hidden={hidden} onToggle={(id) => setHidden((prev) => toggle(prev, id, series.length))} />
      <ChartBox>
        {({ w, h }, tip) => {
          const plotW = Math.max(10, w - M.l - M.r)
          const plotH = Math.max(10, h - M.t - M.b)
          const ticks = mode === 'stream' ? [] : niceTicks(geometry.hi, plotH < 140 ? 3 : 4)
          const yMax = mode === 'stream' ? geometry.hi : Math.max(ticks[ticks.length - 1], geometry.hi)
          const yMin = mode === 'stream' ? geometry.lo : 0
          const sy = (v: number) => M.t + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH
          const band = plotW / Math.max(1, n)
          const sx = (i: number) => (mode === 'bar' ? M.l + band * (i + 0.5) : n === 1 ? M.l + plotW / 2 : M.l + (plotW * i) / (n - 1))
          const labelIdx = spacedIndexes(n, Math.max(2, Math.floor(plotW / 84)))

          const point = (si: number, i: number): [number, number] => [sx(i), sy(geometry.top[si][i])]
          const pathFor = (si: number) => {
            const pts = x.map((_, i) => point(si, i))
            if (mode === 'step') return pts.map(([px, py], i) => (i ? `H${px}V${py}` : `M${px},${py}`)).join('')
            return monotonePath(pts)
          }
          const areaFor = (si: number) => {
            const upper = x.map((_, i) => point(si, i))
            const lower = x.map((_, i) => [sx(i), sy(geometry.base[si][i])] as [number, number]).reverse()
            if (mode === 'step') {
              const up = upper.map(([px, py], i) => (i ? `H${px}V${py}` : `M${px},${py}`)).join('')
              const low = lower.map(([px, py], i) => (i ? `H${px}V${py}` : `L${px},${py}`)).join('')
              return `${up}${low}Z`
            }
            return `${monotonePath(upper)}L${lower[0][0]},${lower[0][1]}${lower
              .slice(1)
              .map(([px, py]) => `L${px},${py}`)
              .join('')}Z`
          }

          const onMove = (e: React.PointerEvent<SVGRectElement>) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - rect.left
            const i = mode === 'bar' ? Math.floor(px / band) : Math.round((px / plotW) * (n - 1))
            const idx = Math.max(0, Math.min(n - 1, i))
            setHover(idx)
            const entries = visible.map((s) => ({ s, v: s.y[idx] ?? 0 }))
            if (stack && visible.length > 1) entries.sort((a, b) => b.v - a.v)
            const rows = entries.map(({ s, v }) => ({ color: s.color, key: (mode === 'line' || mode === 'step' ? 'line' : 'box') as 'line' | 'box', label: s.label, value: format(v) }))
            const content: TipContent = { title: (titleLabel ?? ((ms: number) => bucketLabel(ms, g)))(x[idx]), rows: rows.length > 8 ? rows.slice(0, 8) : rows }
            if (visible.length > 1 && stack) content.note = `Σ ${format(geometry.totals[idx])}`
            tip.show(M.l + (mode === 'bar' ? band * (idx + 0.5) : n === 1 ? plotW / 2 : (plotW * idx) / (n - 1)), e.clientY - rect.top + M.t, content)
          }
          const leave = () => {
            setHover(null)
            tip.hide()
          }

          const peakIndex = peak && visible.length === 1 ? visible[0].y.indexOf(Math.max(...visible[0].y)) : -1
          const barW = Math.max(2, Math.min(24, band * 0.66))

          return (
            <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
              <defs>
                {visible.map((s, si) => (
                  <linearGradient key={s.id} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={s.color} stopOpacity={stack ? 0.85 : 0.26} />
                    <stop offset="1" stopColor={s.color} stopOpacity={stack ? 0.55 : 0.02} />
                  </linearGradient>
                ))}
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line className="chart-grid" x1={M.l} x2={M.l + plotW} y1={sy(t)} y2={sy(t)} />
                  <text className="chart-tick" x={M.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
                    {compact(t)}
                  </text>
                </g>
              ))}
              <line className="chart-axis" x1={M.l} x2={M.l + plotW} y1={mode === 'stream' ? sy(0) : sy(0)} y2={mode === 'stream' ? sy(0) : sy(0)} style={{ opacity: mode === 'stream' ? 0.35 : 1 }} />
              {labelIdx.map((i) => (
                <text key={i} className="chart-tick" x={sx(i)} y={h - 6} textAnchor={i === 0 && mode !== 'bar' ? 'start' : i === n - 1 && mode !== 'bar' ? 'end' : 'middle'}>
                  {axisLabel ? axisLabel(x[i]) : axisDate(x[i], g, span)}
                </text>
              ))}

              {mode === 'bar' &&
                visible.map((s, si) => {
                  const groupW = stack ? barW : barW
                  const each = stack ? groupW : Math.max(2, (groupW - (visible.length - 1) * 2) / visible.length)
                  return x.map((_, i) => {
                    const v = s.y[i] ?? 0
                    if (v <= 0) return null
                    const cx = sx(i) - groupW / 2 + (stack ? 0 : si * (each + 2))
                    const y0 = sy(geometry.base[si][i])
                    const y1 = sy(geometry.top[si][i])
                    const gap = stack && si > 0 ? 2 : 0
                    const hh = Math.max(1.5, y0 - y1 - gap)
                    const last = stack ? si === visible.length - 1 || visible.slice(si + 1).every((o) => !(o.y[i] > 0)) : true
                    return <path key={`${s.id}-${i}`} d={last ? roundedTop(cx, y0 - gap - hh, each, hh, 4) : `M${cx},${y0 - gap}V${y0 - gap - hh}H${cx + each}V${y0 - gap}Z`} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />
                  })
                })}

              {(mode === 'area' || mode === 'stream' || (mode === 'step' && stack)) &&
                visible.map((s, si) => (
                  <g key={s.id}>
                    <path d={areaFor(si)} fill={`url(#${uid}-g${si})`} stroke={stack ? 'var(--dash-surface)' : 'none'} strokeWidth={stack ? 1.5 : 0} />
                    {!stack && <path d={pathFor(si)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
                  </g>
                ))}
              {(mode === 'line' || (mode === 'step' && !stack)) &&
                visible.map((s, si) => (
                  <g key={s.id}>
                    {mode === 'step' && <path d={areaFor(si)} fill={`url(#${uid}-g${si})`} />}
                    <path d={pathFor(si)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                ))}

              {mode !== 'bar' && n > 0 &&
                visible.map((s, si) => (
                  <circle key={`end-${s.id}`} cx={sx(n - 1)} cy={sy(geometry.top[si][n - 1])} r={4} fill={s.color} stroke="var(--dash-surface)" strokeWidth={2} />
                ))}
              {peakIndex >= 0 && mode !== 'bar' && (
                <g>
                  <circle cx={sx(peakIndex)} cy={sy(geometry.top[0][peakIndex])} r={4} fill="var(--dash-surface)" stroke={visible[0].color} strokeWidth={2} />
                  <text className="chart-annot" x={Math.min(Math.max(sx(peakIndex), M.l + 18), M.l + plotW - 18)} y={sy(geometry.top[0][peakIndex]) - 10} textAnchor="middle">
                    {format(visible[0].y[peakIndex])}
                  </text>
                </g>
              )}

              {hover !== null && (
                <g pointerEvents="none">
                  {mode !== 'bar' && <line className="chart-cross" x1={sx(hover)} x2={sx(hover)} y1={M.t} y2={M.t + plotH} />}
                  {mode !== 'bar' &&
                    visible.map((s, si) => <circle key={s.id} cx={sx(hover)} cy={sy(geometry.top[si][hover])} r={4.5} fill={s.color} stroke="var(--dash-surface)" strokeWidth={2} />)}
                </g>
              )}
              <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={leave} />
            </svg>
          )
        }}
      </ChartBox>
    </div>
  )
}

/** Liga/desliga uma série; nunca deixa o gráfico sem nenhuma. */
function toggle(prev: Set<string>, id: string, total: number): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else if (next.size < total - 1) next.add(id)
  return next
}
