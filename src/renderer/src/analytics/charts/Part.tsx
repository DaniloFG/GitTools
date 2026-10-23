import { useState } from 'react'
import { compact, int, percent } from './format'
import { ChartBox } from './core'

export interface Slice {
  id: string
  label: string
  value: number
  color: string
}

function legendOf(slices: Slice[], total: number, format: (n: number) => string, hover: string | null, setHover: (id: string | null) => void) {
  return (
    <ul className="part-legend" role="list">
      {slices.map((s) => (
        <li key={s.id} className={hover && hover !== s.id ? 'dim' : ''} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>
          <span className="chart-key box" style={{ background: s.color }} aria-hidden />
          <span className="part-label" title={s.label}>
            {s.label}
          </span>
          <span className="part-value">{format(s.value)}</span>
          <span className="part-pct">{percent(total ? s.value / total : 0, 0)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Donut (no máximo 6 fatias + "Outros"): a parte de um todo de relance; o total fica no centro. */
export function Donut({ slices, centerLabel, format = compact, label }: { slices: Slice[]; centerLabel: string; format?: (n: number) => string; label: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  return (
    <ChartBox className="part-box">
      {({ w, h }, tip) => {
        const wide = w > h * 1.35
        const d = Math.max(60, Math.min(wide ? h - 8 : h - 70, wide ? w * 0.5 : w - 8, 230))
        const R = d / 2
        const thick = Math.max(12, Math.min(22, R * 0.26))
        const r = R - thick / 2
        const C = 2 * Math.PI * r
        let acc = 0
        const gap = slices.length > 1 ? 2.5 : 0
        return (
          <div className={`part ${wide ? 'wide' : ''}`}>
            <svg width={d} height={d} viewBox={`${-R} ${-R} ${d} ${d}`} role="img" aria-label={label} className="chart-svg">
              <circle r={r} fill="none" stroke="var(--dash-track)" strokeWidth={thick} />
              {slices.map((s) => {
                const len = total ? (s.value / total) * C : 0
                const dash = Math.max(0, len - gap)
                const off = -acc
                acc += len
                return (
                  <circle
                    key={s.id}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={hover === s.id ? thick + 3 : thick}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={off}
                    transform="rotate(-90)"
                    opacity={hover && hover !== s.id ? 0.4 : 1}
                    onPointerMove={(e) => {
                      setHover(s.id)
                      const rect = e.currentTarget.ownerSVGElement!.parentElement!.parentElement!.getBoundingClientRect()
                      tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: s.label, rows: [{ color: s.color, key: 'box', label: percent(total ? s.value / total : 0, 1), value: format(s.value) }] })
                    }}
                    onPointerLeave={() => {
                      setHover(null)
                      tip.hide()
                    }}
                  />
                )
              })}
              <text className="donut-total" textAnchor="middle" y={2}>
                {format === compact ? int(total) : format(total)}
              </text>
              <text className="donut-caption" textAnchor="middle" y={R * 0.28 + 8}>
                {centerLabel}
              </text>
            </svg>
            {legendOf(slices, total, format, hover, setHover)}
          </div>
        )
      }}
    </ChartBox>
  )
}

/** Waffle: 100 quadradinhos, cada um é 1% do todo (alternativa ao donut). */
export function Waffle({ slices, format = compact, label }: { slices: Slice[]; format?: (n: number) => string; label: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = slices.reduce((s, x) => s + x.value, 0)
  // Maior resto: distribui os 100 quadrados entre as fatias.
  const exact = slices.map((s) => (total ? (s.value / total) * 100 : 0))
  const cells = exact.map(Math.floor)
  let left = 100 - cells.reduce((a, b) => a + b, 0)
  exact
    .map((v, i) => [v - Math.floor(v), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0 && total) {
        cells[i]++
        left--
      }
    })
  const owner: string[] = []
  slices.forEach((s, i) => owner.push(...Array(cells[i]).fill(s.id)))
  return (
    <ChartBox className="part-box">
      {({ w, h }, tip) => {
        const wide = w > h * 1.35
        const side = Math.max(60, Math.min(wide ? h - 8 : h - 70, wide ? w * 0.5 : w - 8, 220))
        const cell = side / 10
        return (
          <div className={`part ${wide ? 'wide' : ''}`}>
            <svg width={side} height={side} role="img" aria-label={label} className="chart-svg">
              {owner.map((id, i) => {
                const s = slices.find((x) => x.id === id)!
                const col = i % 10
                const row = 9 - Math.floor(i / 10)
                return (
                  <rect
                    key={i}
                    x={col * cell + 1}
                    y={row * cell + 1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={Math.min(4, cell / 4)}
                    fill={s.color}
                    opacity={hover && hover !== id ? 0.35 : 1}
                    onPointerMove={(e) => {
                      setHover(id)
                      const rect = e.currentTarget.ownerSVGElement!.parentElement!.parentElement!.getBoundingClientRect()
                      tip.show(e.clientX - rect.left, e.clientY - rect.top, { title: s.label, rows: [{ color: s.color, key: 'box', label: percent(total ? s.value / total : 0, 1), value: format(s.value) }] })
                    }}
                    onPointerLeave={() => {
                      setHover(null)
                      tip.hide()
                    }}
                  />
                )
              })}
            </svg>
            {legendOf(slices, total, format, hover, setHover)}
          </div>
        )
      }}
    </ChartBox>
  )
}
