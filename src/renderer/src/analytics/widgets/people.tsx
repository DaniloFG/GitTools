import { BarList, Columns, type BarRow } from '../charts/Bars'
import { Gauge, Meter, Radar, type Tone } from '../charts/Figures'
import { Heatmap } from '../charts/Grid'
import { Donut, Waffle, type Slice } from '../charts/Part'
import { Scatter, type Dot } from '../charts/Scatter'
import { TimeChart, type Series } from '../charts/TimeChart'
import { Treemap } from '../charts/Treemap'
import { OTHER_COLOR, foldTop } from '../charts/core'
import { compact, int, shortDate } from '../charts/format'
import { busFactor, byPerson, newcomers, overTimeByPerson, OTHERS, topFolder, type PersonRow } from '../metrics'
import { personRows, tk } from './helpers'
import { define } from './summary'

const METRICS = (['commits', 'lines', 'files', 'days'] as const).map((id) => ({ id, label: `dash.metric.${id}` as never }))

const metricOf = (row: PersonRow, metric: string) => (metric === 'lines' ? row.add + row.del : metric === 'files' ? row.files : metric === 'days' ? row.activeDays : row.commits)

interface TopData {
  rows: BarRow[]
  all: PersonRow[]
  metric: string
}

const slices = (rows: BarRow[]): Slice[] => {
  const folded = foldTop(rows, 5, (rest) => ({ id: OTHERS, label: tk('dash.others'), value: rest.reduce((s, r) => s + r.value, 0), color: OTHER_COLOR }))
  return folded.map((r) => ({ id: r.id, label: r.label, value: r.value, color: r.color ?? OTHER_COLOR }))
}

export const topPeople = define<TopData>({
  id: 'top-people',
  category: 'people',
  views: ['list', 'lollipop', 'donut', 'waffle', 'treemap', 'columns'],
  cols: 4,
  rows: 2,
  options: [{ key: 'metric', label: 'dash.option.metric', values: METRICS }],
  data: (ctx, opt) => {
    const metric = opt.metric ?? 'commits'
    const all = byPerson(ctx.cs)
    const by = new Map(all.map((r) => [r.id, r]))
    return { rows: personRows(ctx, (id) => (by.get(id) ? metricOf(by.get(id)!, metric) : 0), 30), all, metric }
  },
  render: (d, view) => {
    const label = tk('dash.w.top-people')
    if (view === 'donut') return <Donut slices={slices(d.rows)} centerLabel={tk(`dash.metric.${d.metric}`)} label={label} />
    if (view === 'waffle') return <Waffle slices={slices(d.rows)} label={label} />
    if (view === 'treemap') return <Treemap root={{ name: '/', path: '', value: d.rows.reduce((s, r) => s + r.value, 0), children: d.rows.map((r) => ({ name: r.label, path: r.id, value: r.value })) }} label={label} valueLabel={tk(`dash.metric.${d.metric}`)} />
    if (view === 'columns')
      return (
        <Columns
          categories={d.rows.slice(0, 10).map((r) => r.label.split(' ')[0])}
          series={[{ id: 'v', label: tk(`dash.metric.${d.metric}`), color: 'var(--dash-s1)', y: d.rows.slice(0, 10).map((r) => r.value) }]}
          label={label}
        />
      )
    return <BarList rows={d.rows} variant={view === 'lollipop' ? 'lollipop' : 'bar'} label={label} share={d.metric === 'commits'} />
  },
  table: (d, ctx) => ({
    columns: [
      { key: 'person', label: tk('dash.table.person') },
      { key: 'commits', label: tk('dash.kpi.commits'), numeric: true },
      { key: 'add', label: tk('dash.kpi.additions'), numeric: true },
      { key: 'del', label: tk('dash.kpi.deletions'), numeric: true },
      { key: 'files', label: tk('dash.metric.files'), numeric: true },
      { key: 'days', label: tk('dash.kpi.activeDays'), numeric: true }
    ],
    rows: d.all.map((r) => [ctx.name(r.id), r.commits, r.add, r.del, r.files, r.activeDays])
  })
})

interface PeopleTimeData {
  x: number[]
  series: Series[]
}

export const peopleOverTime = define<PeopleTimeData>({
  id: 'people-time',
  category: 'people',
  views: ['area', 'stream', 'bar', 'line'],
  cols: 8,
  rows: 2,
  data: (ctx) => {
    const top = ctx.people.slice(0, 7).map((p) => p.id)
    const r = overTimeByPerson(ctx.cs, ctx.g, ctx.range.from, ctx.range.to, top)
    // Média de 3 pontos: tira o serrilhado dos intervalos curtos sem esconder as tendências.
    const smooth = (y: number[]) => y.map((_, i) => (y[Math.max(0, i - 1)] + y[i] + y[Math.min(y.length - 1, i + 1)]) / 3)
    return { x: r.x, series: r.series.map((s) => ({ id: s.id, label: s.id === OTHERS ? tk('dash.others') : ctx.name(s.id), color: s.id === OTHERS ? OTHER_COLOR : ctx.color(s.id), y: r.x.length > 12 ? smooth(s.y).map((v) => Math.round(v * 10) / 10) : s.y })) }
  },
  render: (d, view, ctx) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} stacked={view !== 'line'} g={ctx.g} label={tk('dash.w.people-time')} />,
  table: (d) => ({ columns: [{ key: 'date', label: tk('dash.table.date') }, ...d.series.map((s) => ({ key: s.id, label: s.label, numeric: true }))], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 10), ...d.series.map((s) => s.y[i])]) })
})

export const peopleScatter = define<{ dots: Dot[]; rows: PersonRow[] }>({
  id: 'people-scatter',
  category: 'people',
  views: ['scatter'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const rows = byPerson(ctx.cs)
    return {
      rows,
      dots: rows.map((r) => ({
        id: r.id,
        label: ctx.name(r.id),
        x: r.commits,
        y: r.add + r.del,
        size: r.activeDays,
        color: ctx.color(r.id),
        rows: [
          { color: ctx.color(r.id), key: 'dot', label: tk('dash.kpi.commits'), value: int(r.commits) },
          { color: ctx.color(r.id), key: 'dot', label: tk('dash.metric.lines'), value: compact(r.add + r.del) },
          { color: ctx.color(r.id), key: 'dot', label: tk('dash.kpi.activeDays'), value: int(r.activeDays) }
        ]
      }))
    }
  },
  render: (d) => <Scatter dots={d.dots} xLabel={tk('dash.kpi.commits')} yLabel={tk('dash.metric.lines')} label={tk('dash.w.people-scatter')} />,
  table: (d, ctx) => ({ columns: [{ key: 'p', label: tk('dash.table.person') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }, { key: 'l', label: tk('dash.metric.lines'), numeric: true }, { key: 'd', label: tk('dash.kpi.activeDays'), numeric: true }], rows: d.rows.map((r) => [ctx.name(r.id), r.commits, r.add + r.del, r.activeDays]) })
})

export const peopleRadar = define<{ rows: PersonRow[] }>({
  id: 'people-radar',
  category: 'people',
  views: ['radar'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ rows: byPerson(ctx.cs).slice(0, 4) }),
  render: (d, _view, ctx) => {
    const axes = [tk('dash.kpi.commits'), tk('dash.metric.lines'), tk('dash.metric.files'), tk('dash.kpi.activeDays'), tk('dash.kpi.additions')]
    const get = (r: PersonRow) => [r.commits, r.add + r.del, r.files, r.activeDays, r.add]
    const max = axes.map((_, i) => Math.max(1, ...d.rows.map((r) => get(r)[i])))
    return (
      <Radar
        axes={axes}
        label={tk('dash.w.people-radar')}
        series={d.rows.map((r) => ({ id: r.id, label: ctx.name(r.id), color: ctx.color(r.id), values: get(r).map((v, i) => v / max[i]), display: get(r).map((v) => compact(v)) }))}
      />
    )
  },
  table: (d, ctx) => ({ columns: [{ key: 'p', label: tk('dash.table.person') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }, { key: 'l', label: tk('dash.metric.lines'), numeric: true }, { key: 'f', label: tk('dash.metric.files'), numeric: true }, { key: 'd', label: tk('dash.kpi.activeDays'), numeric: true }], rows: d.rows.map((r) => [ctx.name(r.id), r.commits, r.add + r.del, r.files, r.activeDays]) })
})

export const newcomersWidget = define<{ x: number[]; added: number[]; returning: number[] }>({
  id: 'newcomers',
  category: 'people',
  views: ['columns', 'area'],
  cols: 4,
  rows: 2,
  data: (ctx) => newcomers(ctx.ds, ctx.cs, ctx.range.from, ctx.range.to),
  render: (d, view) => {
    const series: Series[] = [
      { id: 'returning', label: tk('dash.returning'), color: 'var(--dash-s1)', y: d.returning },
      { id: 'added', label: tk('dash.newcomers'), color: 'var(--dash-s2)', y: d.added }
    ]
    if (view === 'area') return <TimeChart x={d.x} series={series} mode="area" stacked g="month" label={tk('dash.w.newcomers')} />
    return <TimeChart x={d.x} series={series} mode="bar" stacked g="month" label={tk('dash.w.newcomers')} />
  },
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.date') }, { key: 'n', label: tk('dash.newcomers'), numeric: true }, { key: 'r', label: tk('dash.returning'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 7), d.added[i], d.returning[i]]) })
})

interface BusData {
  commits: number
  lines: number
  people: number
  top: { name: string; share: number } | null
}

const busTone = (n: number): Tone => (n <= 1 ? 'critical' : n === 2 ? 'serious' : n === 3 ? 'warning' : 'good')

export const busFactorWidget = define<BusData>({
  id: 'bus-factor',
  category: 'people',
  views: ['gauge', 'meter'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const rows = byPerson(ctx.cs)
    const commits = busFactor(rows.map((r) => r.commits))
    const lines = busFactor(rows.map((r) => r.add + r.del))
    const total = rows.reduce((s, r) => s + r.commits, 0)
    return { commits, lines, people: rows.length, top: rows[0] ? { name: ctx.name(rows[0].id), share: total ? rows[0].commits / total : 0 } : null }
  },
  render: (d, view) => {
    const tone = busTone(Math.min(d.commits, d.lines || d.commits))
    const status = tk(`dash.status.${tone}`)
    if (view === 'meter')
      return (
        <div className="meters">
          <div>
            <div className="meter-title">{tk('dash.bus.byCommits')}</div>
            <Meter value={Math.min(1, d.commits / 5)} tone={busTone(d.commits)} label={tk('dash.bus.byCommits')} caption={tk('dash.bus.people', { count: d.commits })} />
          </div>
          <div>
            <div className="meter-title">{tk('dash.bus.byLines')}</div>
            <Meter value={Math.min(1, d.lines / 5)} tone={busTone(d.lines)} label={tk('dash.bus.byLines')} caption={tk('dash.bus.people', { count: d.lines })} />
          </div>
          {d.top && <p className="muted small">{tk('dash.bus.top', { name: d.top.name, share: `${Math.round(d.top.share * 100)}%` })}</p>}
        </div>
      )
    return <Gauge value={Math.min(1, d.commits / 5)} text={String(d.commits)} tone={tone} caption={tk('dash.bus.caption')} status={status} label={tk('dash.w.bus-factor')} />
  },
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: [[tk('dash.bus.byCommits'), d.commits], [tk('dash.bus.byLines'), d.lines], [tk('dash.kpi.people'), d.people]] })
})

export const ownership = define<{ people: string[]; folders: string[]; matrix: number[][] }>({
  id: 'ownership',
  category: 'people',
  views: ['heatmap', 'punch'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const folders = new Map<string, number>()
    for (const c of ctx.cs) for (const [p] of c.files) folders.set(topFolder(ctx.ds.paths[p]), (folders.get(topFolder(ctx.ds.paths[p])) ?? 0) + 1)
    const top = [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => f)
    const people = ctx.people.slice(0, 8).map((p) => p.id)
    const matrix = people.map(() => top.map(() => 0))
    for (const c of ctx.cs) {
      const pi = people.indexOf(c.person)
      if (pi < 0) continue
      for (const [p] of c.files) {
        const fi = top.indexOf(topFolder(ctx.ds.paths[p]))
        if (fi >= 0) matrix[pi][fi]++
      }
    }
    return { people, folders: top, matrix }
  },
  render: (d, view, ctx) => <Heatmap matrix={d.matrix} rows={d.people.map((p) => ctx.name(p))} cols={d.folders} colTicks={d.folders.map((_, i) => i)} rowLabelWidth={112} kind={view === 'punch' ? 'punch' : 'heat'} label={tk('dash.w.ownership')} valueLabel={tk('dash.metric.files')} low={tk('dash.less')} high={tk('dash.more')} />,
  table: (d, ctx) => ({ columns: [{ key: 'p', label: tk('dash.table.person') }, ...d.folders.map((f) => ({ key: f, label: f, numeric: true }))], rows: d.people.map((p, i) => [ctx.name(p), ...d.matrix[i]]) })
})

export const peopleTable = define<{ rows: PersonRow[] }>({
  id: 'people-table',
  category: 'people',
  views: ['table'],
  cols: 12,
  rows: 2,
  data: (ctx) => ({ rows: byPerson(ctx.cs) }),
  render: () => null,
  table: (d, ctx) => ({
    columns: [
      { key: 'p', label: tk('dash.table.person') },
      { key: 'c', label: tk('dash.kpi.commits'), numeric: true },
      { key: 'a', label: tk('dash.kpi.additions'), numeric: true },
      { key: 'd', label: tk('dash.kpi.deletions'), numeric: true },
      { key: 'f', label: tk('dash.metric.files'), numeric: true },
      { key: 'days', label: tk('dash.kpi.activeDays'), numeric: true },
      { key: 'first', label: tk('dash.table.first') },
      { key: 'last', label: tk('dash.table.last') }
    ],
    rows: d.rows.map((r) => [ctx.name(r.id), r.commits, r.add, r.del, r.files, r.activeDays, shortDate(r.first), shortDate(r.last)])
  })
})
