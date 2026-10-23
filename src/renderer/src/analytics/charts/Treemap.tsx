import { useMemo, useState } from 'react'
import type { TreeNode } from '../metrics'
import { compact } from './format'
import { ChartBox, seriesColor, OTHER_COLOR } from './core'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Item<T> {
  value: number
  data: T
}

/** Treemap "squarified": retângulos o mais quadrados possível, em ordem decrescente de valor. */
export function squarify<T>(items: Item<T>[], rect: Rect): { rect: Rect; data: T }[] {
  const total = items.reduce((s, i) => s + i.value, 0)
  const out: { rect: Rect; data: T }[] = []
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out
  const area = rect.w * rect.h
  const scaled = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((i) => ({ ...i, a: (i.value / total) * area }))
  let { x, y, w, h } = rect
  let row: typeof scaled = []
  const worst = (r: typeof scaled, side: number) => {
    const s = r.reduce((t, i) => t + i.a, 0)
    const max = Math.max(...r.map((i) => i.a))
    const min = Math.min(...r.map((i) => i.a))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  const place = (r: typeof scaled) => {
    const s = r.reduce((t, i) => t + i.a, 0)
    if (w >= h) {
      const cw = s / h
      let cy = y
      for (const i of r) {
        const ch = i.a / cw
        out.push({ rect: { x, y: cy, w: cw, h: ch }, data: i.data })
        cy += ch
      }
      x += cw
      w -= cw
    } else {
      const ch = s / w
      let cx = x
      for (const i of r) {
        const cw = i.a / ch
        out.push({ rect: { x: cx, y, w: cw, h: ch }, data: i.data })
        cx += cw
      }
      y += ch
      h -= ch
    }
  }
  for (const item of scaled) {
    const side = Math.min(w, h)
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item)
    else {
      place(row)
      row = [item]
    }
  }
  if (row.length) place(row)
  return out
}

interface Leaf {
  node: TreeNode
  group: number
  groupName: string
}

/** Treemap de duas camadas: pastas de primeiro nível (uma cor cada) e, dentro delas, os arquivos ou subpastas. */
export function Treemap({ root, format = compact, label, valueLabel }: { root: TreeNode; format?: (n: number) => string; label: string; valueLabel: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const groups = useMemo(() => expandDominant(root), [root])
  return (
    <ChartBox>
      {({ w, h }, tip) => {
        const GAP = 3
        const top = squarify(groups.map((g) => ({ value: g.value, data: g })), { x: 0, y: 0, w, h })
        return (
          <svg width={w} height={h} role="img" aria-label={label} className="chart-svg treemap">
            {top.map(({ rect, data: group }, gi) => {
              const color = gi < 7 ? seriesColor(gi) : OTHER_COLOR
              const header = rect.h > 46 && rect.w > 60 ? 16 : 0
              const inner: Rect = { x: rect.x + GAP / 2, y: rect.y + GAP / 2 + header, w: rect.w - GAP, h: rect.h - GAP - header }
              const leaves: Item<Leaf>[] = (group.children ?? [group]).map((c) => ({ value: c.value, data: { node: c, group: gi, groupName: group.name } }))
              const cells = squarify(leaves, inner)
              return (
                <g key={group.path || group.name}>
                  {cells.map(({ rect: r, data }) => {
                    const id = data.node.path || data.node.name
                    const lw = r.w - 2
                    const lh = r.h - 2
                    const fits = lw > 46 && lh > 22
                    return (
                      <g
                        key={id}
                        opacity={hover && hover !== id ? 0.6 : 1}
                        onPointerMove={(e) => {
                          setHover(id)
                          const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                          tip.show(e.clientX - box.left, e.clientY - box.top, { title: data.node.path || data.node.name, rows: [{ color, key: 'box', label: valueLabel, value: format(data.node.value) }], note: group.name !== data.node.name ? group.name : undefined })
                        }}
                        onPointerLeave={() => {
                          setHover(null)
                          tip.hide()
                        }}
                      >
                        <rect x={r.x + 1} y={r.y + 1} width={Math.max(0, lw)} height={Math.max(0, lh)} rx={4} fill={color} opacity={0.82} />
                        {fits && (
                          <text className="treemap-label" x={r.x + 7} y={r.y + 15} style={{ fill: gi === 3 ? '#0b0b0b' : '#fff' }}>
                            {clip(data.node.name, Math.floor((lw - 10) / 6.4))}
                          </text>
                        )}
                        {fits && lh > 36 && (
                          <text className="treemap-sub" x={r.x + 7} y={r.y + 29} style={{ fill: gi === 3 ? '#0b0b0b' : '#fff' }}>
                            {format(data.node.value)}
                          </text>
                        )}
                      </g>
                    )
                  })}
                  {header > 0 && (
                    <text className="treemap-group" x={rect.x + 6} y={rect.y + 13}>
                      {clip(group.name, Math.floor((rect.w - 12) / 6.4))}
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

/**
 * Grupos de primeiro nível do treemap. Quando uma pasta sozinha tem mais da metade do total (ex.: `src`), ela é
 * aberta nos filhos dela: assim as cores separam as pastas que interessam, não uma cor só para quase tudo.
 */
export function expandDominant(root: TreeNode): TreeNode[] {
  let groups = root.children?.length ? [...root.children] : [root]
  for (let i = 0; i < 2; i++) {
    const total = groups.reduce((s, g) => s + g.value, 0)
    const big = groups.find((g) => g.children?.length && g.value > total * 0.5)
    if (!big) break
    groups = groups.flatMap((g) => (g === big ? big.children!.map((c) => ({ ...c, name: `${big.name}/${c.name}` })) : [g]))
  }
  return groups
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)
