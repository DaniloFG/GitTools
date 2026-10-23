import { BarList, Columns } from '../charts/Bars'
import { Gauge, Meter, StatTile, type Tone } from '../charts/Figures'
import { bytes, decimal, int, shortDate } from '../charts/format'
import { DAY } from '../model'
import { tk } from './helpers'
import { define } from './summary'
import type { Ctx } from './types'

const AGE_EDGES = [0, 8, 31, 91, 181]

const ageDays = (ctx: Ctx, ms: number) => Math.max(0, Math.floor((ctx.now - ms) / DAY))

const localBranches = (ctx: Ctx) => ctx.branches.filter((b) => !b.remote)

export const branchAge = define<{ bins: { label: string; count: number }[]; rows: { name: string; age: number; current: boolean }[] }>({
  id: 'branch-age',
  category: 'repo',
  views: ['columns', 'list'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const all = ctx.branches
    const rows = all.map((b) => ({ name: b.name, age: ageDays(ctx, b.date), current: b.current })).sort((a, b) => b.age - a.age)
    const bins = AGE_EDGES.map((min, i) => ({ label: AGE_EDGES[i + 1] === undefined ? tk('dash.age.over', { days: min }) : tk('dash.age.range', { from: min, to: AGE_EDGES[i + 1] - 1 }), count: 0 }))
    for (const r of rows) {
      let i = AGE_EDGES.length - 1
      while (i > 0 && r.age < AGE_EDGES[i]) i--
      bins[i].count++
    }
    return { bins, rows }
  },
  render: (d, view) =>
    view === 'list' ? (
      <BarList rows={d.rows.slice(0, 30).map((r) => ({ id: r.name, label: r.name, value: r.age }))} format={(n) => tk('dash.days', { count: n })} color="var(--dash-s4)" label={tk('dash.w.branch-age')} />
    ) : (
      <Columns categories={d.bins.map((b) => b.label)} series={[{ id: 'n', label: tk('dash.metric.branches'), color: 'var(--dash-s4)', y: d.bins.map((b) => b.count) }]} label={tk('dash.w.branch-age')} />
    ),
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 'b', label: tk('dash.table.branch') }, { key: 'a', label: tk('dash.table.ageDays'), numeric: true }], rows: d.rows.map((r) => [r.name, r.age]) })
})

export const aheadBehind = define<{ rows: { name: string; ahead: number; behind: number }[] }>({
  id: 'ahead-behind',
  category: 'repo',
  views: ['grouped', 'list'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ rows: localBranches(ctx).filter((b) => b.ahead + b.behind > 0).sort((a, b) => b.ahead + b.behind - (a.ahead + a.behind)).map((b) => ({ name: b.name, ahead: b.ahead, behind: b.behind })) }),
  render: (d, view) =>
    view === 'list' ? (
      <BarList rows={d.rows.map((r) => ({ id: r.name, label: r.name, value: r.ahead + r.behind, hint: `↑${r.ahead} ↓${r.behind}` }))} label={tk('dash.w.ahead-behind')} />
    ) : (
      <Columns
        categories={d.rows.slice(0, 8).map((r) => r.name)}
        series={[
          { id: 'ahead', label: tk('dash.ahead'), color: 'var(--dash-s1)', y: d.rows.slice(0, 8).map((r) => r.ahead) },
          { id: 'behind', label: tk('dash.behind'), color: 'var(--dash-s2)', y: d.rows.slice(0, 8).map((r) => r.behind) }
        ]}
        label={tk('dash.w.ahead-behind')}
      />
    ),
  empty: (d) => d.rows.length === 0,
  table: (d) => ({ columns: [{ key: 'b', label: tk('dash.table.branch') }, { key: 'a', label: tk('dash.ahead'), numeric: true }, { key: 'd', label: tk('dash.behind'), numeric: true }], rows: d.rows.map((r) => [r.name, r.ahead, r.behind]) })
})

const healthTone = (r: number): Tone => (r >= 0.7 ? 'good' : r >= 0.5 ? 'warning' : r >= 0.3 ? 'serious' : 'critical')

export const branchHealth = define<{ fresh: number; stale: number; ratio: number }>({
  id: 'branch-health',
  category: 'repo',
  views: ['gauge', 'meter'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const list = localBranches(ctx)
    const fresh = list.filter((b) => ageDays(ctx, b.date) <= 30).length
    return { fresh, stale: list.length - fresh, ratio: list.length ? fresh / list.length : 1 }
  },
  render: (d, view) => {
    const tone = healthTone(d.ratio)
    if (view === 'meter')
      return (
        <div className="meters">
          <Meter value={d.ratio} tone={tone} label={tk('dash.w.branch-health')} caption={`${int(d.fresh)} / ${int(d.fresh + d.stale)}`} />
          <p className="muted small">{tk('dash.branchHealth.help', { stale: d.stale })}</p>
        </div>
      )
    return <Gauge value={d.ratio} tone={tone} caption={tk('dash.branchHealth.caption')} status={tk(`dash.status.${tone}`)} label={tk('dash.w.branch-health')} />
  },
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: [[tk('dash.branchHealth.fresh'), d.fresh], [tk('dash.branchHealth.stale'), d.stale]] })
})

export const repoSummary = define<{ tiles: { id: string; value: string }[] }>({
  id: 'repo-summary',
  category: 'repo',
  views: ['tiles'],
  cols: 12,
  rows: 1,
  data: (ctx) => {
    const size = ctx.ds.tree.reduce((s, f) => s + f.size, 0)
    const ageDaysTotal = ctx.ds.first ? Math.max(1, Math.round((ctx.now - ctx.ds.first) / DAY)) : 0
    return {
      tiles: [
        { id: 'branches', value: int(localBranches(ctx).length) },
        { id: 'remoteBranches', value: int(ctx.branches.filter((b) => b.remote).length) },
        { id: 'tags', value: int(ctx.tags.length) },
        { id: 'stashes', value: int(ctx.stashes.length) },
        { id: 'trackedFiles', value: int(ctx.ds.tree.length) },
        { id: 'size', value: bytes(size) },
        { id: 'age', value: ageDaysTotal ? (ageDaysTotal > 400 ? tk('dash.years', { count: decimal(ageDaysTotal / 365, 1) }) : tk('dash.days', { count: ageDaysTotal })) : '—' },
        { id: 'since', value: ctx.ds.first ? shortDate(ctx.ds.first) : '—' }
      ]
    }
  },
  render: (d) => (
    <div className="tiles">
      {d.tiles.map((x) => (
        <StatTile key={x.id} label={tk(`dash.repo.${x.id}`)} value={x.value} />
      ))}
    </div>
  ),
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: d.tiles.map((x) => [tk(`dash.repo.${x.id}`), x.value]) })
})

