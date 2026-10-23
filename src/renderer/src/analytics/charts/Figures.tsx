import { monotonePath, ChartBox, CRITICAL, GOOD, SERIOUS, WARNING, sequential, seriesColor, type TipRow } from './core'
import { compact, percent } from './format'
import { useState } from 'react'

export type Tone = 'good' | 'warning' | 'serious' | 'critical'

const TONE_COLOR: Record<Tone, string> = { good: GOOD, warning: WARNING, serious: SERIOUS, critical: CRITICAL }
const TONE_ICON: Record<Tone, string> = { good: '✓', warning: '▲', serious: '◆', critical: '✕' }

/** Estado (cor + ícone + texto: a cor nunca fica sozinha). */
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="status-pill" style={{ ['--tone' as string]: TONE_COLOR[tone] }}>
      <i aria-hidden>{TONE_ICON[tone]}</i>
      {children}
    </span>
  )
}

/** Linha de tendência miúda (os últimos pontos do período) com o ponto atual em destaque. */
export function Sparkline({ values, color = 'var(--dash-s1)', height = 30 }: { values: number[]; color?: string; height?: number }) {
  return (
    <ChartBox className="spark" style={{ height }}>
      {({ w, h }) => {
        if (values.length < 2) return null
        const max = Math.max(1, ...values)
        const pts: [number, number][] = values.map((v, i) => [3 + (i * (w - 8)) / (values.length - 1), h - 4 - (v / max) * (h - 8)])
        const line = monotonePath(pts)
        const last = pts[pts.length - 1]
        return (
          <svg width={w} height={h} aria-hidden className="chart-svg">
            <path d={`${line}L${last[0]},${h}L${pts[0][0]},${h}Z`} fill={color} opacity={0.12} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} stroke="var(--dash-surface)" strokeWidth={2} />
          </svg>
        )
      }}
    </ChartBox>
  )
}

/** Indicador: rótulo, valor grande, variação contra o período anterior e tendência. */
export function StatTile({ label, value, delta, values, hint }: { label: string; value: string; delta?: { text: string; good: boolean | null }; values?: number[]; hint?: string }) {
  return (
    <div className="stat-tile" title={hint}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${value.length > 9 ? 'long' : ''}`}>{value}</div>
      {delta && (
        <div className={`stat-delta ${delta.good === null ? '' : delta.good ? 'good' : 'bad'}`}>
          {delta.good !== null && <i aria-hidden>{delta.good ? '▲' : '▼'}</i>}
          {delta.text}
        </div>
      )}
      {values && values.length > 1 && <Sparkline values={values} />}
    </div>
  )
}

/** Medidor semicircular de uma razão (0–1) com a faixa de estado. */
export function Gauge({ value, tone, caption, status, label, target, text }: { value: number; tone: Tone; caption: string; status: string; label: string; target?: number; text?: string }) {
  return (
    <ChartBox className="gauge-box">
      {({ w, h }) => {
        const R = Math.max(40, Math.min((w - 24) / 2, h - 64, 150))
        const thick = Math.max(10, Math.min(18, R * 0.18))
        const r = R - thick / 2
        const cx = w / 2
        const cy = R + 10
        const arc = (t: number) => {
          const a = Math.PI * (1 - t)
          return [cx + r * Math.cos(a), cy - r * Math.sin(a)]
        }
        const [sx, sy] = arc(0)
        const [ex, ey] = arc(Math.max(0.001, Math.min(1, value)))
        const [tx, ty] = arc(1)
        const mark = target !== undefined ? arc(target) : null
        return (
          <div className="gauge">
            <svg width={w} height={cy + 14} role="img" aria-label={label} className="chart-svg">
              <path d={`M${sx},${sy}A${r},${r} 0 0 1 ${tx},${ty}`} fill="none" stroke="var(--dash-track)" strokeWidth={thick} strokeLinecap="round" />
              <path d={`M${sx},${sy}A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={TONE_COLOR[tone]} strokeWidth={thick} strokeLinecap="round" />
              {mark && <circle cx={mark[0]} cy={mark[1]} r={3} fill="var(--dash-text)" stroke="var(--dash-surface)" strokeWidth={2} />}
              <text className="gauge-value" x={cx} y={cy - R * 0.18} textAnchor="middle">
                {text ?? percent(value, 0)}
              </text>
              <text className="gauge-caption" x={cx} y={cy - R * 0.18 + 18} textAnchor="middle">
                {caption}
              </text>
            </svg>
            <StatusPill tone={tone}>{status}</StatusPill>
          </div>
        )
      }}
    </ChartBox>
  )
}

/** Barra de progresso (a trilha é um tom mais claro do mesmo azul; o preenchimento leva o estado). */
export function Meter({ value, tone, label, caption }: { value: number; tone?: Tone; label: string; caption?: string }) {
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: tone ? TONE_COLOR[tone] : 'var(--dash-s1)' }} />
      </div>
      {caption && <span className="meter-caption">{caption}</span>}
    </div>
  )
}

export interface FunnelStep {
  id: string
  label: string
  value: number
}

/** Funil: cada etapa é a parcela do total que passou; a rampa ordinal vai do mais claro ao mais escuro. */
export function Funnel({ steps, label, format = compact }: { steps: FunnelStep[]; label: string; format?: (n: number) => string }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <ChartBox>
      {({ w, h }, tip) => {
        const rowH = Math.min(40, Math.max(22, (h - 4) / steps.length))
        const max = Math.max(1, steps[0]?.value ?? 1)
        const labelW = Math.min(170, w * 0.36)
        const trackW = Math.max(30, w - labelW - 70)
        return (
          <svg width={w} height={rowH * steps.length + 4} role="img" aria-label={label} className="chart-svg">
            {steps.map((s, i) => {
              const y = i * rowH + 2
              const len = Math.max(3, (s.value / max) * trackW)
              const rows: TipRow[] = [{ color: sequential(0.35 + 0.6 * (i / Math.max(1, steps.length - 1))), key: 'box', label: percent(max ? s.value / max : 0, 1), value: format(s.value) }]
              return (
                <g
                  key={s.id}
                  opacity={hover && hover !== s.id ? 0.55 : 1}
                  onPointerMove={(e) => {
                    setHover(s.id)
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: s.label, rows })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    tip.hide()
                  }}
                >
                  <rect x={0} y={y} width={w} height={rowH} fill="transparent" />
                  <text className="chart-label" x={0} y={y + rowH / 2} dominantBaseline="middle">
                    {s.label.length > labelW / 6.4 ? `${s.label.slice(0, Math.floor(labelW / 6.4) - 1)}…` : s.label}
                  </text>
                  <rect x={labelW + 8} y={y + 4} width={len} height={rowH - 8} rx={4} fill={sequential(0.35 + 0.6 * (i / Math.max(1, steps.length - 1)))} />
                  <text className="chart-value" x={labelW + 8 + len + 8} y={y + rowH / 2} dominantBaseline="middle">
                    {format(s.value)} · {percent(max ? s.value / max : 0, 0)}
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

export interface RadarSeries {
  id: string
  label: string
  color: string
  /** Valores normalizados de 0 a 1, um por eixo. */
  values: number[]
  /** Valores reais para o tooltip. */
  display: string[]
}

/** Radar de perfis: poucas séries (até 4) sobre os mesmos eixos, cada eixo normalizado de 0 a 1. */
export function Radar({ axes, series, label }: { axes: string[]; series: RadarSeries[]; label: string }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="chart-col">
      <ul className="chart-legend" role="list">
        {series.map((s) => (
          <li key={s.id} className={hover && hover !== s.id ? 'dim' : ''} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
            <button type="button">
              <span className="chart-key box" style={{ background: s.color }} aria-hidden />
              <span className="chart-legend-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <ChartBox>
        {({ w, h }, tip) => {
          const R = Math.max(40, Math.min(w, h) / 2 - 28)
          const cx = w / 2
          const cy = h / 2
          const n = axes.length
          const pt = (i: number, v: number): [number, number] => [cx + R * v * Math.sin((2 * Math.PI * i) / n), cy - R * v * Math.cos((2 * Math.PI * i) / n)]
          return (
            <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
              {[0.25, 0.5, 0.75, 1].map((ring) => (
                <polygon key={ring} points={axes.map((_, i) => pt(i, ring).join(',')).join(' ')} className="chart-grid" fill="none" />
              ))}
              {axes.map((a, i) => {
                const [x, y] = pt(i, 1)
                const [lx, ly] = pt(i, 1.16)
                return (
                  <g key={a}>
                    <line className="chart-grid" x1={cx} y1={cy} x2={x} y2={y} />
                    <text className="chart-tick" x={lx} y={ly} textAnchor={Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end'} dominantBaseline="middle">
                      {a}
                    </text>
                  </g>
                )
              })}
              {series.map((s) => (
                <g
                  key={s.id}
                  opacity={hover && hover !== s.id ? 0.25 : 1}
                  onPointerMove={(e) => {
                    setHover(s.id)
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: s.label, rows: axes.map((a, i) => ({ color: s.color, key: 'dot', label: a, value: s.display[i] })) })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    tip.hide()
                  }}
                >
                  <polygon points={s.values.map((v, i) => pt(i, Math.max(0.02, v)).join(',')).join(' ')} fill={s.color} fillOpacity={0.14} stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                  {s.values.map((v, i) => (
                    <circle key={i} cx={pt(i, Math.max(0.02, v))[0]} cy={pt(i, Math.max(0.02, v))[1]} r={3.5} fill={s.color} stroke="var(--dash-surface)" strokeWidth={1.5} />
                  ))}
                </g>
              ))}
            </svg>
          )
        }}
      </ChartBox>
    </div>
  )
}

export interface TimelineItem {
  id: string
  label: string
  time: number
  rows: TipRow[]
}

/** Linha do tempo de marcos (releases): pontos sobre um eixo de datas, com rótulos só onde cabem. */
export function Timeline({ items, label, from, to, formatDate }: { items: TimelineItem[]; label: string; from: number; to: number; formatDate: (ms: number) => string }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <ChartBox>
      {({ w, h }, tip) => {
        const M = { l: 14, r: 14 }
        const y = h / 2
        const sx = (t: number) => M.l + ((t - from) / Math.max(1, to - from)) * (w - M.l - M.r)
        let lastLabel = -Infinity
        let flip = false
        return (
          <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
            <line className="chart-axis" x1={M.l} x2={w - M.r} y1={y} y2={y} />
            <text className="chart-tick" x={M.l} y={h - 4} textAnchor="start">
              {formatDate(from)}
            </text>
            <text className="chart-tick" x={w - M.r} y={h - 4} textAnchor="end">
              {formatDate(to)}
            </text>
            {items.map((it) => {
              const x = sx(it.time)
              const showLabel = x - lastLabel > 58
              const up = flip
              if (showLabel) {
                lastLabel = x
                flip = !flip
              }
              return (
                <g
                  key={it.id}
                  onPointerMove={(e) => {
                    setHover(it.id)
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                    tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: it.label, rows: it.rows })
                  }}
                  onPointerLeave={() => {
                    setHover(null)
                    tip.hide()
                  }}
                >
                  <circle cx={x} cy={y} r={14} fill="transparent" />
                  {showLabel && <line className="chart-grid" x1={x} x2={x} y1={y} y2={up ? y - 22 : y + 22} />}
                  <circle cx={x} cy={y} r={hover === it.id ? 6.5 : 5} fill="var(--dash-s1)" stroke="var(--dash-surface)" strokeWidth={2} />
                  {showLabel && (
                    <text className="chart-tick" x={x} y={up ? y - 28 : y + 36} textAnchor="middle">
                      {it.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )
      }}
    </ChartBox>
  )
}

/** Cores de série para uma lista de entidades, em ordem fixa. */
export const slotColors = (n: number) => Array.from({ length: n }, (_, i) => seriesColor(i))
