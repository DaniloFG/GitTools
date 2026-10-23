// Peças comuns dos gráficos: medida do espaço, tooltip, legenda e cores da paleta.

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** Cor da categoria `slot` (0–7); depois da oitava, cinza "Outros" — nunca uma cor gerada. */
export const seriesColor = (slot: number): string => (slot >= 0 && slot < 8 ? `var(--dash-s${slot + 1})` : 'var(--dash-other)')
export const OTHER_COLOR = 'var(--dash-other)'
export const GOOD = 'var(--dash-good)'
export const WARNING = 'var(--dash-warning)'
export const SERIOUS = 'var(--dash-serious)'
export const CRITICAL = 'var(--dash-critical)'

/** Cor sequencial (azul): 0 = quase nada, 1 = o máximo. */
export const sequential = (t: number): string => `color-mix(in oklab, var(--dash-seq-hi) ${Math.round(Math.max(0, Math.min(1, t)) * 100)}%, var(--dash-seq-lo))`

/** Divergente: negativo (vermelho) ← cinza → positivo (azul). */
export const diverging = (t: number): string =>
  t >= 0 ? `color-mix(in oklab, var(--dash-div-pos) ${Math.round(Math.min(1, t) * 100)}%, var(--dash-div-mid))` : `color-mix(in oklab, var(--dash-div-neg) ${Math.round(Math.min(1, -t) * 100)}%, var(--dash-div-mid))`

export interface Size {
  w: number
  h: number
}

/** Mede o elemento (e acompanha quando ele muda de tamanho). */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((prev) => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

export interface TipRow {
  /** Cor da marca ao lado do rótulo. */
  color?: string
  /** Forma da marca: traço (linha), quadrado ou ponto. */
  key?: 'line' | 'box' | 'dot'
  label: string
  value: string
}

export interface TipContent {
  title?: string
  rows: TipRow[]
  note?: string
}

export interface TipApi {
  /** Mostra o tooltip junto do ponto (x, y) em pixels do gráfico. */
  show(x: number, y: number, content: TipContent): void
  hide(): void
}

/** Espaço do gráfico: mede o tamanho, e hospeda o tooltip (um só, com todos os valores). */
export function ChartBox({ children, className = '', style }: { children: (size: Size, tip: TipApi) => ReactNode; className?: string; style?: CSSProperties }) {
  const [ref, size] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<{ x: number; y: number; content: TipContent } | null>(null)
  const api = useMemo<TipApi>(() => ({ show: (x, y, content) => setTip({ x, y, content }), hide: () => setTip(null) }), [])
  return (
    <div ref={ref} className={`chart-box ${className}`} style={style}>
      {size.w > 0 && size.h > 0 && children(size, api)}
      {tip && <Tooltip x={tip.x} y={tip.y} bounds={size} content={tip.content} />}
    </div>
  )
}

function Tooltip({ x, y, bounds, content }: { x: number; y: number; bounds: Size; content: TipContent }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 14
    // Do lado direito do ponteiro; se não couber, do esquerdo. Sobe se encostar embaixo.
    const left = x + gap + width > bounds.w ? Math.max(4, x - gap - width) : x + gap
    const top = Math.max(4, Math.min(y - height / 2, bounds.h - height - 4))
    setPos({ left, top })
  }, [x, y, bounds.w, bounds.h, content])
  return (
    <div ref={ref} className="chart-tip" style={{ left: pos.left, top: pos.top }} role="status">
      {content.title && <div className="chart-tip-title">{content.title}</div>}
      {content.rows.map((row, i) => (
        <div key={i} className="chart-tip-row">
          <span className={`chart-key ${row.key ?? 'dot'}`} style={{ background: row.color ?? 'var(--dash-s1)' }} aria-hidden />
          <strong>{row.value}</strong>
          <span className="chart-tip-label">{row.label}</span>
        </div>
      ))}
      {content.note && <div className="chart-tip-note">{content.note}</div>}
    </div>
  )
}

export interface LegendItem {
  id: string
  label: string
  color: string
  key?: 'line' | 'box' | 'dot'
}

/** Legenda: com 2 séries ou mais está sempre presente; clicar liga e desliga a série. */
export function Legend({ items, hidden, onToggle, active }: { items: LegendItem[]; hidden?: Set<string>; onToggle?: (id: string) => void; active?: string | null }) {
  if (items.length < 2) return null
  return (
    <ul className="chart-legend" role="list">
      {items.map((item) => {
        const off = hidden?.has(item.id)
        return (
          <li key={item.id} className={`${off ? 'off' : ''} ${active && active !== item.id ? 'dim' : ''}`}>
            <button type="button" onClick={() => onToggle?.(item.id)} disabled={!onToggle} aria-pressed={onToggle ? !off : undefined} title={item.label}>
              <span className={`chart-key ${item.key ?? 'box'}`} style={{ background: item.color }} aria-hidden />
              <span className="chart-legend-label">{item.label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Caminho SVG suave (interpolação monótona: nunca passa dos pontos, como as curvas de painéis modernos). */
export function monotonePath(points: [number, number][]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${points[0][0]},${points[0][1]}`
  const dx: number[] = []
  const dy: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0]
    dy[i] = points[i + 1][1] - points[i][1]
    m[i] = dy[i] / (dx[i] || 1)
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  t[n - 1] = m[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / m[i]
      const b = t[i + 1] / m[i]
      const s = a * a + b * b
      if (s > 9) {
        const k = 3 / Math.sqrt(s)
        t[i] = k * a * m[i]
        t[i + 1] = k * b * m[i]
      }
    }
  }
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${points[i][0] + h},${points[i][1] + t[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - t[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`
  }
  return d
}

/** Ordem de empilhamento e arredondamento: retângulo com cantos de cima arredondados (`r`) e base reta. */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/** Idem, arredondado no lado direito (barras horizontais). */
export function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h / 2, w))
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}

/** Dobra a cauda de uma lista em "Outros" (nunca gera cor nova). */
export function foldTop<T extends { value: number }>(rows: T[], keep: number, other: (rest: T[]) => T): T[] {
  if (rows.length <= keep) return rows
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  return [...sorted.slice(0, keep), other(sorted.slice(keep))]
}
