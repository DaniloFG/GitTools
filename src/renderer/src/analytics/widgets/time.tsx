import { BarList, Columns } from '../charts/Bars'
import { Radar, StatTile, Timeline } from '../charts/Figures'
import { CalendarHeat, Heatmap } from '../charts/Grid'
import { TimeChart, type Series } from '../charts/TimeChart'
import { compact, decimal, int, shortDate, weekdayNames } from '../charts/format'
import { overTime, perDay, releases, streaks, weekdayHour } from '../metrics'
import { tk } from './helpers'
import { define } from './summary'

export const calendar = define<{ perDay: Map<number, number>; total: number }>({
  id: 'calendar',
  category: 'time',
  views: ['calendar'],
  cols: 12,
  rows: 2,
  data: (ctx) => {
    const p = perDay(ctx.cs)
    return { perDay: p, total: [...p.values()].reduce((a, b) => a + b, 0) }
  },
  render: (d, _view, ctx) => <CalendarHeat perDay={d.perDay} from={ctx.range.from} to={ctx.range.to} label={tk('dash.w.calendar')} valueLabel={tk('dash.kpi.commits')} low={tk('dash.less')} high={tk('dash.more')} />,
  table: (d) => ({ columns: [{ key: 'd', label: tk('dash.table.date') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }], rows: [...d.perDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => [new Date(t).toISOString().slice(0, 10), c]) })
})

export const weekdayHourWidget = define<{ matrix: number[][] }>({
  id: 'weekday-hour',
  category: 'time',
  views: ['heatmap', 'punch'],
  cols: 6,
  rows: 2,
  data: (ctx) => ({ matrix: weekdayHour(ctx.cs) }),
  render: (d, view) => {
    const cols = Array.from({ length: 24 }, (_, i) => `${i}h`)
    return <Heatmap matrix={d.matrix} rows={weekdayNames()} cols={cols} colTicks={[0, 3, 6, 9, 12, 15, 18, 21]} kind={view === 'punch' ? 'punch' : 'heat'} label={tk('dash.w.weekday-hour')} valueLabel={tk('dash.kpi.commits')} low={tk('dash.less')} high={tk('dash.more')} />
  },
  table: (d) => ({ columns: [{ key: 'd', label: tk('dash.table.weekday') }, ...Array.from({ length: 24 }, (_, i) => ({ key: `h${i}`, label: `${i}h`, numeric: true }))], rows: d.matrix.map((r, i) => [weekdayNames()[i], ...r]) })
})

export const byWeekday = define<{ y: number[] }>({
  id: 'by-weekday',
  category: 'time',
  views: ['columns', 'list', 'lollipop'],
  cols: 3,
  rows: 2,
  data: (ctx) => ({ y: weekdayHour(ctx.cs).map((r) => r.reduce((a, b) => a + b, 0)) }),
  render: (d, view) => {
    const names = weekdayNames()
    const peak = d.y.indexOf(Math.max(...d.y))
    if (view === 'columns') return <Columns categories={names} series={[{ id: 'c', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', y: d.y }]} highlight={peak} label={tk('dash.w.by-weekday')} />
    return <BarList rows={d.y.map((v, i) => ({ id: String(i), label: names[i], value: v }))} variant={view === 'lollipop' ? 'lollipop' : 'bar'} label={tk('dash.w.by-weekday')} share />
  },
  table: (d) => ({ columns: [{ key: 'd', label: tk('dash.table.weekday') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }], rows: d.y.map((v, i) => [weekdayNames()[i], v]) })
})

export const byHour = define<{ y: number[] }>({
  id: 'by-hour',
  category: 'time',
  views: ['columns', 'radar'],
  cols: 3,
  rows: 2,
  data: (ctx) => {
    const m = weekdayHour(ctx.cs)
    return { y: Array.from({ length: 24 }, (_, h) => m.reduce((s, r) => s + r[h], 0)) }
  },
  render: (d, view) => {
    const cats = Array.from({ length: 24 }, (_, i) => `${i}h`)
    if (view === 'radar') {
      const max = Math.max(1, ...d.y)
      return <Radar axes={cats.map((c, i) => (i % 3 === 0 ? c : ''))} label={tk('dash.w.by-hour')} series={[{ id: 'h', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', values: d.y.map((v) => v / max), display: d.y.map((v) => compact(v)) }]} />
    }
    return <Columns categories={cats.map((c, i) => (i % 3 === 0 ? c : ''))} series={[{ id: 'c', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', y: d.y }]} highlight={d.y.indexOf(Math.max(...d.y))} label={tk('dash.w.by-hour')} />
  },
  table: (d) => ({ columns: [{ key: 'h', label: tk('dash.table.hour') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }], rows: d.y.map((v, i) => [`${i}h`, v]) })
})

export const monthly = define<{ x: number[]; series: Series[] }>({
  id: 'monthly',
  category: 'time',
  views: ['columns', 'area', 'line'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const s = overTime(ctx.cs, 'month', ctx.range.from, ctx.range.to)
    return { x: s.x, series: [{ id: 'c', label: tk('dash.kpi.commits'), color: 'var(--dash-s4)', y: s.y }] }
  },
  render: (d, view) => <TimeChart x={d.x} series={d.series} mode={view === 'columns' ? 'bar' : (view as 'area')} g="month" label={tk('dash.w.monthly')} peak />,
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.month') }, { key: 'c', label: tk('dash.kpi.commits'), numeric: true }], rows: d.x.map((t, i) => [new Date(t).toISOString().slice(0, 7), d.series[0].y[i]]) })
})

export const streakTiles = define<ReturnType<typeof streaks> & { perDay: number }>({
  id: 'streaks',
  category: 'time',
  views: ['tiles'],
  cols: 6,
  rows: 1,
  data: (ctx) => {
    const s = streaks(ctx.cs)
    return { ...s, perDay: s.activeDays ? ctx.cs.length / s.activeDays : 0 }
  },
  render: (d) => (
    <div className="tiles compact">
      <StatTile label={tk('dash.kpi.activeDays')} value={int(d.activeDays)} />
      <StatTile label={tk('dash.streak.longest')} value={tk('dash.days', { count: d.longestStreak })} />
      <StatTile label={tk('dash.streak.gap')} value={tk('dash.days', { count: d.longestGap })} />
      <StatTile label={tk('dash.kpi.perActiveDay')} value={decimal(d.perDay, 1)} />
    </div>
  ),
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: [[tk('dash.kpi.activeDays'), d.activeDays], [tk('dash.streak.longest'), d.longestStreak], [tk('dash.streak.gap'), d.longestGap]] })
})

interface ReleaseData {
  rows: { tag: string; time: number; sinceLast: number | null }[]
}

export const releasesWidget = define<ReleaseData>({
  id: 'releases',
  category: 'time',
  views: ['timeline', 'columns', 'list'],
  cols: 6,
  rows: 2,
  data: (ctx) => ({ rows: releases(ctx.cs) }),
  render: (d, view, ctx) => {
    const label = tk('dash.w.releases')
    if (view === 'columns') {
      const rows = d.rows.filter((r) => r.sinceLast !== null)
      return <Columns categories={rows.map((r) => r.tag)} series={[{ id: 'd', label: tk('dash.releases.interval'), color: 'var(--dash-s3)', y: rows.map((r) => r.sinceLast ?? 0) }]} label={label} />
    }
    if (view === 'list') return <BarList rows={[...d.rows].reverse().filter((r) => r.sinceLast !== null).map((r) => ({ id: r.tag, label: r.tag, value: r.sinceLast ?? 0, hint: shortDate(r.time) }))} format={(n) => tk('dash.days', { count: n })} color="var(--dash-s3)" label={label} />
    return <Timeline items={d.rows.map((r) => ({ id: r.tag, label: r.tag, time: r.time, rows: [{ color: 'var(--dash-s1)', key: 'dot', label: shortDate(r.time), value: r.sinceLast === null ? '—' : tk('dash.days', { count: r.sinceLast }) }] }))} from={ctx.range.from} to={ctx.range.to} formatDate={shortDate} label={label} />
  },
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 't', label: 'Tag' }, { key: 'd', label: tk('dash.table.date') }, { key: 'i', label: tk('dash.releases.interval'), numeric: true }], rows: d.rows.map((r) => [r.tag, new Date(r.time).toISOString().slice(0, 10), r.sinceLast ?? '']) })
})
