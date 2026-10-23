import { useState } from 'react'
import { compact, niceTicks } from './format'
import { ChartBox, type TipRow } from './core'

export interface Dot {
  id: string
  label: string
  x: number
  y: number
  /** Tamanho (bolha); sem ele, todos os pontos têm o mesmo raio. */
  size?: number
  color: string
  rows: TipRow[]
}

/** Dispersão / bolhas: o ponteiro só precisa estar *perto* de um ponto (camada de "mais próximo"), não em cima dele. */
export function Scatter({ dots, xLabel, yLabel, xFormat = compact, yFormat = compact, label, labelTop = 5 }: { dots: Dot[]; xLabel: string; yLabel: string; xFormat?: (n: number) => string; yFormat?: (n: number) => string; label: string; labelTop?: number }) {
  const [hover, setHover] = useState<string | null>(null)
  return (
    <ChartBox>
      {({ w, h }, tip) => {
        const M = { l: 44, r: 16, t: 12, b: 34 }
        const plotW = w - M.l - M.r
        const plotH = h - M.t - M.b
        const xt = niceTicks(Math.max(1, ...dots.map((d) => d.x)), 4)
        const yt = niceTicks(Math.max(1, ...dots.map((d) => d.y)), 4)
        const xMax = xt[xt.length - 1]
        const yMax = yt[yt.length - 1]
        const maxSize = Math.max(1, ...dots.map((d) => d.size ?? 1))
        const sx = (v: number) => M.l + (v / xMax) * plotW
        const sy = (v: number) => M.t + plotH - (v / yMax) * plotH
        const radius = (d: Dot) => (d.size === undefined ? 6 : 5 + Math.sqrt(d.size / maxSize) * 13)
        const labelled = new Set([...dots].sort((a, b) => (b.size ?? b.y) - (a.size ?? a.y)).slice(0, labelTop).map((d) => d.id))
        const nearest = (px: number, py: number) => {
          let best: Dot | null = null
          let dist = 48 * 48
          for (const d of dots) {
            const dd = (sx(d.x) - px) ** 2 + (sy(d.y) - py) ** 2
            if (dd < dist) {
              dist = dd
              best = d
            }
          }
          return best
        }
        return (
          <svg width={w} height={h} role="img" aria-label={label} className="chart-svg">
            {yt.map((t) => (
              <g key={`y${t}`}>
                <line className="chart-grid" x1={M.l} x2={M.l + plotW} y1={sy(t)} y2={sy(t)} />
                <text className="chart-tick" x={M.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {xt.map((t) => (
              <text key={`x${t}`} className="chart-tick" x={sx(t)} y={M.t + plotH + 16} textAnchor="middle">
                {xFormat(t)}
              </text>
            ))}
            <line className="chart-axis" x1={M.l} x2={M.l + plotW} y1={M.t + plotH} y2={M.t + plotH} />
            <text className="chart-axis-title" x={M.l + plotW} y={h - 3} textAnchor="end">
              {xLabel} →
            </text>
            <text className="chart-axis-title" x={M.l} y={M.t - 2} textAnchor="start">
              ↑ {yLabel}
            </text>
            {dots.map((d) => (
              <g key={d.id} opacity={hover && hover !== d.id ? 0.45 : 1} pointerEvents="none">
                <circle cx={sx(d.x)} cy={sy(d.y)} r={radius(d)} fill={d.color} fillOpacity={d.size === undefined ? 1 : 0.78} stroke="var(--dash-surface)" strokeWidth={2} />
                {labelled.has(d.id) && (
                  <text className="chart-annot" x={sx(d.x) + radius(d) + 5} y={sy(d.y)} dominantBaseline="middle">
                    {d.label}
                  </text>
                )}
              </g>
            ))}
            <rect
              x={M.l - 6}
              y={M.t - 6}
              width={plotW + 12}
              height={plotH + 12}
              fill="transparent"
              onPointerMove={(e) => {
                const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                const d = nearest(e.clientX - rect.left, e.clientY - rect.top)
                setHover(d?.id ?? null)
                if (d) tip.show(sx(d.x), sy(d.y), { title: d.label, rows: d.rows })
                else tip.hide()
              }}
              onPointerLeave={() => {
                setHover(null)
                tip.hide()
              }}
            />
          </svg>
        )
      }}
    </ChartBox>
  )
}
