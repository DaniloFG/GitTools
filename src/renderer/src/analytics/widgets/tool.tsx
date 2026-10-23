import { BarList, Columns } from '../charts/Bars'
import { Gauge, Meter, StatTile, type Tone } from '../charts/Figures'
import { Donut, type Slice } from '../charts/Part'
import { TimeChart } from '../charts/TimeChart'
import { OTHER_COLOR, foldTop, seriesColor } from '../charts/core'
import { duration, int, percent } from '../charts/format'
import { commandName, commandRows, percentile, type CommandRow } from '../metrics'
import { tk } from './helpers'
import { define } from './summary'

export const commandCount = define<{ rows: CommandRow[] }>({
  id: 'cmd-count',
  category: 'tool',
  views: ['list', 'donut', 'columns'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ rows: commandRows(ctx.commands) }),
  render: (d, view) => {
    const label = tk('dash.w.cmd-count')
    if (view === 'donut') {
      const base = d.rows.map((r, i) => ({ id: r.command, label: `git ${r.command}`, value: r.runs, color: seriesColor(i) }))
      const slices: Slice[] = foldTop(base, 5, (rest) => ({ id: '__others__', label: tk('dash.others'), value: rest.reduce((s, r) => s + r.value, 0), color: OTHER_COLOR }))
      return <Donut slices={slices} centerLabel={tk('dash.tool.runs')} label={label} />
    }
    if (view === 'columns') return <Columns categories={d.rows.slice(0, 10).map((r) => r.command)} series={[{ id: 'n', label: tk('dash.tool.runs'), color: 'var(--dash-s1)', y: d.rows.slice(0, 10).map((r) => r.runs) }]} label={label} />
    return <BarList rows={d.rows.map((r) => ({ id: r.command, label: `git ${r.command}`, value: r.runs, hint: r.readOnly ? tk('dash.tool.read') : tk('dash.tool.write') }))} label={label} share />
  },
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 'c', label: tk('dash.table.command') }, { key: 'n', label: tk('dash.tool.runs'), numeric: true }, { key: 'f', label: tk('dash.tool.failed'), numeric: true }, { key: 'a', label: tk('dash.tool.avg'), numeric: true }, { key: 'm', label: tk('dash.tool.max'), numeric: true }], rows: d.rows.map((r) => [r.command, r.runs, r.failed, Math.round(r.avgMs), Math.round(r.maxMs)]) })
})

export const commandDuration = define<{ rows: CommandRow[] }>({
  id: 'cmd-duration',
  category: 'tool',
  views: ['lollipop', 'list', 'columns'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ rows: commandRows(ctx.commands).sort((a, b) => b.avgMs - a.avgMs) }),
  render: (d, view) => {
    const label = tk('dash.w.cmd-duration')
    if (view === 'columns') return <Columns categories={d.rows.slice(0, 10).map((r) => r.command)} series={[{ id: 'n', label: tk('dash.tool.avg'), color: 'var(--dash-s4)', y: d.rows.slice(0, 10).map((r) => Math.round(r.avgMs)) }]} format={duration} label={label} />
    return <BarList rows={d.rows.map((r) => ({ id: r.command, label: `git ${r.command}`, value: r.avgMs, hint: `max ${duration(r.maxMs)}` }))} format={duration} variant={view === 'list' ? 'bar' : 'lollipop'} color="var(--dash-s4)" label={label} />
  },
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 'c', label: tk('dash.table.command') }, { key: 'a', label: tk('dash.tool.avg'), numeric: true }, { key: 'm', label: tk('dash.tool.max'), numeric: true }], rows: d.rows.map((r) => [r.command, Math.round(r.avgMs), Math.round(r.maxMs)]) })
})

const successTone = (r: number): Tone => (r >= 0.98 ? 'good' : r >= 0.92 ? 'warning' : r >= 0.8 ? 'serious' : 'critical')

export const commandHealth = define<{ total: number; failed: number; ratio: number; p90: number; avg: number }>({
  id: 'cmd-health',
  category: 'tool',
  views: ['gauge', 'meter', 'tiles'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const done = ctx.commands.filter((c) => c.durationMs !== undefined)
    const failed = done.filter((c) => c.failed).length
    const times = done.map((c) => c.durationMs ?? 0)
    return { total: done.length, failed, ratio: done.length ? 1 - failed / done.length : 1, p90: percentile(times, 90), avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0 }
  },
  render: (d, view) => {
    const tone = successTone(d.ratio)
    if (view === 'tiles')
      return (
        <div className="tiles compact">
          <StatTile label={tk('dash.tool.runs')} value={int(d.total)} />
          <StatTile label={tk('dash.tool.failed')} value={int(d.failed)} />
          <StatTile label={tk('dash.tool.avg')} value={duration(d.avg)} />
          <StatTile label="p90" value={duration(d.p90)} />
        </div>
      )
    if (view === 'meter') return <div className="meters"><Meter value={d.ratio} tone={tone} label={tk('dash.w.cmd-health')} caption={`${int(d.total - d.failed)} / ${int(d.total)}`} /></div>
    return <Gauge value={d.ratio} tone={tone} caption={tk('dash.tool.success')} status={tk(`dash.status.${tone}`)} label={tk('dash.w.cmd-health')} />
  },
  empty: (d) => d.total === 0,
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: [[tk('dash.tool.runs'), d.total], [tk('dash.tool.failed'), d.failed], [tk('dash.tool.success'), percent(d.ratio, 1)], [tk('dash.tool.avg'), Math.round(d.avg)], ['p90', Math.round(d.p90)]] })
})

export const commandTimeline = define<{ x: number[]; series: { id: string; label: string; color: string; y: number[] }[] }>({
  id: 'cmd-timeline',
  category: 'tool',
  views: ['area', 'bar', 'line', 'step'],
  cols: 8,
  rows: 2,
  data: (ctx) => {
    const done = ctx.commands.filter((c) => c.durationMs !== undefined)
    if (!done.length) return { x: [], series: [] }
    const lo = Math.min(...done.map((c) => c.startedAt))
    const hi = Math.max(...done.map((c) => c.startedAt))
    // Intervalos de 5 s, 1 min ou 5 min, conforme a duração da sessão.
    const minute = hi - lo <= 300_000 ? 5_000 : hi - lo <= 7_200_000 ? 60_000 : 300_000
    const from = Math.floor(lo / minute) * minute
    const to = Math.floor(hi / minute) * minute
    const x: number[] = []
    for (let t = from; t <= to; t += minute) x.push(t)
    const reads = x.map(() => 0)
    const writes = x.map(() => 0)
    for (const c of done) {
      const i = Math.floor((c.startedAt - from) / minute)
      const name = commandName(c.args)
      if (['status', 'log', 'show', 'diff', 'rev-parse', 'for-each-ref', 'ls-files', 'ls-tree', 'blame', 'rev-list', 'merge-base', 'cat-file', 'version', '--version'].includes(name)) reads[i]++
      else writes[i]++
    }
    return { x, series: [{ id: 'read', label: tk('dash.tool.read'), color: 'var(--dash-s1)', y: reads }, { id: 'write', label: tk('dash.tool.write'), color: 'var(--dash-s2)', y: writes }] }
  },
  render: (d, view) => <TimeChart x={d.x} series={d.series} mode={view as 'area'} stacked g="day" axisLabel={(ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} titleLabel={(ms) => new Date(ms).toLocaleTimeString()} label={tk('dash.w.cmd-timeline')} />,
  empty: (d) => d.x.length === 0,
  table: (d) => ({ columns: [{ key: 't', label: tk('dash.table.time') }, ...d.series.map((s) => ({ key: s.id, label: s.label, numeric: true }))], rows: d.x.map((t, i) => [new Date(t).toLocaleTimeString(), ...d.series.map((s) => s.y[i])]) })
})

export const slowestCommands = define<{ rows: { args: string; ms: number; failed: boolean; at: number }[] }>({
  id: 'cmd-slowest',
  category: 'tool',
  views: ['list', 'lollipop'],
  cols: 6,
  rows: 2,
  data: (ctx) => ({ rows: ctx.commands.filter((c) => c.durationMs !== undefined).sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 20).map((c) => ({ args: c.args.filter((a) => !a.startsWith('--format')).join(' '), ms: c.durationMs ?? 0, failed: !!c.failed, at: c.startedAt })) }),
  render: (d, view) => <BarList rows={d.rows.map((r, i) => ({ id: String(i), label: `git ${r.args}`, value: r.ms, hint: new Date(r.at).toLocaleTimeString() }))} format={duration} variant={view === 'lollipop' ? 'lollipop' : 'bar'} color="var(--dash-s5)" label={tk('dash.w.cmd-slowest')} />,
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 'c', label: tk('dash.table.command') }, { key: 'ms', label: tk('dash.tool.avg'), numeric: true }, { key: 'f', label: tk('dash.tool.failed') }], rows: d.rows.map((r) => [`git ${r.args}`, Math.round(r.ms), r.failed ? '✕' : '']) })
})
