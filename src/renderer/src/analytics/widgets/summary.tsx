import { StatTile } from '../charts/Figures'
import { TimeChart, type Series } from '../charts/TimeChart'
import { compact, decimal, int, percent, signed } from '../charts/format'
import { bucketStart, cumulative, kpis, overTime, type Kpis } from '../metrics'
import { startOfDay } from '../model'
import { downsample, pctDelta, tk } from './helpers'
import type { Ctx, WidgetDef } from './types'

export function define<D>(w: WidgetDef<D>): WidgetDef {
  return w as unknown as WidgetDef
}

interface Tile {
  id: string
  value: number
  text: string
  delta: number | null
  values: number[]
  goodWhenUp: boolean | null
}

const TILES: { id: keyof Kpis; format: (n: number) => string; goodWhenUp: boolean | null; series?: (c: Ctx['cs'][number]) => number }[] = [
  { id: 'commits', format: int, goodWhenUp: true, series: () => 1 },
  { id: 'people', format: int, goodWhenUp: true },
  { id: 'activeDays', format: int, goodWhenUp: true },
  { id: 'additions', format: compact, goodWhenUp: null, series: (c) => c.add },
  { id: 'deletions', format: compact, goodWhenUp: null, series: (c) => c.del },
  { id: 'filesTouched', format: int, goodWhenUp: null },
  { id: 'perActiveDay', format: (n) => decimal(n, 1), goodWhenUp: null },
  { id: 'medianLines', format: int, goodWhenUp: null }
]

/** Dias com commit em cada intervalo (para a miniatura de tendência). */
function activeDaysSeries(ctx: Ctx): number[] {
  const x = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, () => 0).x
  const index = new Map(x.map((t, i) => [t, i]))
  const days = x.map(() => new Set<number>())
  for (const c of ctx.cs) {
    const i = index.get(bucketStart(c.time, ctx.g))
    if (i !== undefined) days[i].add(startOfDay(c.time))
  }
  return days.map((d) => d.size)
}

export const kpiWidget = define<Tile[]>({
  id: 'kpis',
  category: 'summary',
  views: ['tiles'],
  cols: 12,
  rows: 1,
  data: (ctx) => {
    const cur = kpis(ctx.cs)
    const old = kpis(ctx.prev)
    return TILES.map((tile) => {
      const value = cur[tile.id] as number
      const series = tile.series ? overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, tile.series).y : tile.id === 'activeDays' ? activeDaysSeries(ctx) : []
      return { id: tile.id, value, text: tile.format(value), delta: ctx.prev.length ? pctDelta(value, old[tile.id] as number) : null, values: downsample(series), goodWhenUp: tile.goodWhenUp }
    })
  },
  render: (tiles) => (
    <div className="tiles">
      {tiles.map((x) => (
        <StatTile
          key={x.id}
          label={tk(`dash.kpi.${x.id}`)}
          hint={tk(`dash.kpiHelp.${x.id}`)}
          value={x.text}
          values={x.values}
          delta={x.delta === null ? undefined : { text: `${x.delta >= 0 ? '+' : '−'}${percent(Math.abs(x.delta), 0)} ${tk('dash.vsPrevious')}`, good: x.goodWhenUp === null || x.delta === 0 ? null : (x.delta > 0) === x.goodWhenUp }}
        />
      ))}
    </div>
  ),
  table: (tiles) => ({
    columns: [
      { key: 'metric', label: tk('dash.table.metric') },
      { key: 'value', label: tk('dash.table.value'), numeric: true },
      { key: 'delta', label: tk('dash.vsPrevious'), numeric: true }
    ],
    rows: tiles.map((x) => [tk(`dash.kpi.${x.id}`), x.value, x.delta === null ? '' : percent(x.delta, 1)])
  })
})

interface TimeData {
  x: number[]
  series: Series[]
}

export const commitsOverTime = define<TimeData>({
  id: 'commits-over-time',
  category: 'summary',
  views: ['area', 'line', 'bar', 'step'],
  cols: 8,
  rows: 2,
  data: (ctx) => {
    const s = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to)
    return { x: s.x, series: [{ id: 'commits', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', y: s.y }] }
  },
  render: (d, view, ctx) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} g={ctx.g} peak label={tk('dash.w.commits-over-time')} />,
  table: (d) => ({
    columns: [{ key: 'date', label: tk('dash.table.date') }, { key: 'commits', label: tk('dash.kpi.commits'), numeric: true }],
    rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), d.series[0].y[i]])
  })
})

export const cumulativeCommits = define<TimeData>({
  id: 'cumulative',
  category: 'summary',
  views: ['area', 'line', 'step'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const s = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to)
    return { x: s.x, series: [{ id: 'total', label: tk('dash.kpi.commits'), color: 'var(--dash-s3)', y: cumulative(s.y) }] }
  },
  render: (d, view, ctx) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} g={ctx.g} label={tk('dash.w.cumulative')} />,
  table: (d) => ({ columns: [{ key: 'date', label: tk('dash.table.date') }, { key: 'total', label: tk('dash.table.cumulative'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), d.series[0].y[i]]) })
})

export const churnOverTime = define<TimeData>({
  id: 'churn',
  category: 'summary',
  views: ['bar', 'area', 'line'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const add = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, (c) => c.add)
    const del = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, (c) => c.del)
    return {
      x: add.x,
      series: [
        { id: 'add', label: tk('dash.kpi.additions'), color: 'var(--dash-s3)', y: add.y },
        { id: 'del', label: tk('dash.kpi.deletions'), color: 'var(--dash-s2)', y: del.y }
      ]
    }
  },
  render: (d, view, ctx) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} g={ctx.g} label={tk('dash.w.churn')} />,
  table: (d) => ({ columns: [{ key: 'date', label: tk('dash.table.date') }, { key: 'add', label: tk('dash.kpi.additions'), numeric: true }, { key: 'del', label: tk('dash.kpi.deletions'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), d.series[0].y[i], d.series[1].y[i]]) })
})

export const codeGrowth = define<TimeData>({
  id: 'growth',
  category: 'summary',
  views: ['area', 'line', 'step'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const net = overTime(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, (c) => c.add - c.del)
    return { x: net.x, series: [{ id: 'net', label: tk('dash.table.netLines'), color: 'var(--dash-s7)', y: cumulative(net.y).map((v) => Math.max(0, v)) }] }
  },
  render: (d, view, ctx) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} g={ctx.g} format={(n) => signed(n)} label={tk('dash.w.growth')} />,
  table: (d) => ({ columns: [{ key: 'date', label: tk('dash.table.date') }, { key: 'net', label: tk('dash.table.netLines'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), d.series[0].y[i]]) })
})

/** Média móvel de commits por dia (suaviza picos de fim de semana e de sprint). */
export const velocity = define<TimeData>({
  id: 'velocity',
  category: 'time',
  views: ['line', 'area', 'step'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const s = overTime(ctx.cs, 'day', ctx.range.from, ctx.range.to)
    const win = 14
    const avg = s.y.map((_, i) => {
      const from = Math.max(0, i - win + 1)
      return s.y.slice(from, i + 1).reduce((a, b) => a + b, 0) / (i - from + 1)
    })
    return { x: s.x, series: [{ id: 'avg', label: tk('dash.table.movingAvg'), color: 'var(--dash-s5)', y: avg.map((v) => Math.round(v * 100) / 100) }] }
  },
  render: (d, view) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} g="day" format={(n) => decimal(n, 1)} peak label={tk('dash.w.velocity')} />,
  table: (d) => ({ columns: [{ key: 'date', label: tk('dash.table.date') }, { key: 'avg', label: tk('dash.table.movingAvg'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), d.series[0].y[i]]) })
})
