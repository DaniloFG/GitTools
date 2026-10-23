import { BarList, Columns } from '../charts/Bars'
import { Funnel, Gauge, Meter, type Tone } from '../charts/Figures'
import { Donut, Waffle, type Slice } from '../charts/Part'
import { OTHER_COLOR, seriesColor, foldTop } from '../charts/core'
import { compact, int, percent, shortDate } from '../charts/format'
import { AUDIT_FLAGS, auditFlags, auditSummary, churn, flaggedCommits, kindCounts, kindOf, type AuditFlag, type AuditSummary, type CommitKind } from '../metrics'
import { tk } from './helpers'
import { define } from './summary'

const kindLabel = (kind: CommitKind) => tk(`dash.kind.${kind === 'other' ? 'misc' : kind}`)

const kindSlices = (rows: { kind: CommitKind; count: number }[]): Slice[] => {
  const base = rows.map((r) => ({ value: r.count, kind: r.kind }))
  const folded = foldTop(base, 5, (rest) => ({ value: rest.reduce((s, r) => s + r.value, 0), kind: 'other' as CommitKind }))
  return folded.map((r, i) => ({ id: r.kind + i, label: kindLabel(r.kind), value: r.value, color: i < 5 ? seriesColor(i) : OTHER_COLOR }))
}

export const commitKinds = define<{ rows: { kind: CommitKind; count: number }[]; conventional: number; total: number }>({
  id: 'commit-kinds',
  category: 'quality',
  views: ['donut', 'list', 'waffle', 'columns'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const real = ctx.cs.filter((c) => !c.merge)
    return { rows: kindCounts(ctx.cs).sort((a, b) => b.count - a.count), conventional: real.filter((c) => kindOf(c).conventional).length, total: real.length }
  },
  render: (d, view) => {
    const label = tk('dash.w.commit-kinds')
    if (view === 'list') return <BarList rows={d.rows.map((r, i) => ({ id: r.kind, label: kindLabel(r.kind), value: r.count, color: i < 7 ? seriesColor(i) : OTHER_COLOR }))} label={label} share />
    if (view === 'waffle') return <Waffle slices={kindSlices(d.rows)} label={label} />
    if (view === 'columns') return <Columns categories={d.rows.slice(0, 8).map((r) => kindLabel(r.kind))} series={[{ id: 'n', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', y: d.rows.slice(0, 8).map((r) => r.count) }]} label={label} />
    return <Donut slices={kindSlices(d.rows)} centerLabel={tk('dash.kpi.commits')} label={label} />
  },
  table: (d) => ({ columns: [{ key: 'k', label: tk('dash.table.type') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: d.rows.map((r) => [kindLabel(r.kind), r.count]) })
})

const ratioTone = (r: number, good: number, warn: number, serious: number): Tone => (r >= good ? 'good' : r >= warn ? 'warning' : r >= serious ? 'serious' : 'critical')

export const conventional = define<{ ratio: number; count: number; total: number }>({
  id: 'conventional',
  category: 'quality',
  views: ['gauge', 'meter'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    const real = ctx.cs.filter((c) => !c.merge)
    const count = real.filter((c) => kindOf(c).conventional).length
    return { ratio: real.length ? count / real.length : 0, count, total: real.length }
  },
  render: (d, view) => {
    const tone = ratioTone(d.ratio, 0.8, 0.6, 0.4)
    if (view === 'meter')
      return (
        <div className="meters">
          <Meter value={d.ratio} tone={tone} label={tk('dash.w.conventional')} caption={`${int(d.count)} / ${int(d.total)}`} />
          <p className="muted small">{tk('dash.conventional.help')}</p>
        </div>
      )
    return <Gauge value={d.ratio} tone={tone} caption={tk('dash.conventional.caption')} status={tk(`dash.status.${tone}`)} label={tk('dash.w.conventional')} target={0.8} />
  },
  table: (d) => ({ columns: [{ key: 'm', label: tk('dash.table.metric') }, { key: 'v', label: tk('dash.table.value'), numeric: true }], rows: [[tk('dash.conventional.caption'), percent(d.ratio, 1)], [tk('dash.table.total'), d.total], [tk('dash.table.compliant'), d.count]] })
})

export const auditFunnel = define<{ steps: { id: string; label: string; value: number }[] }>({
  id: 'audit-funnel',
  category: 'quality',
  views: ['funnel', 'list'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const real = ctx.cs.filter((c) => !c.merge)
    const withBody = real.filter((c) => c.bodyLength > 0)
    const clear = withBody.filter((c) => !auditFlags(c).includes('weakSubject'))
    const conv = clear.filter((c) => kindOf(c).conventional)
    const clean = conv.filter((c) => !auditFlags(c).some((f) => f === 'large' || f === 'otherCommitter' || f === 'revert'))
    return {
      steps: [
        { id: 'all', label: tk('dash.funnel.all'), value: real.length },
        { id: 'body', label: tk('dash.funnel.body'), value: withBody.length },
        { id: 'clear', label: tk('dash.funnel.clear'), value: clear.length },
        { id: 'conv', label: tk('dash.funnel.conventional'), value: conv.length },
        { id: 'clean', label: tk('dash.funnel.clean'), value: clean.length }
      ]
    }
  },
  render: (d, view) => (view === 'list' ? <BarList rows={d.steps.map((s) => ({ id: s.id, label: s.label, value: s.value }))} label={tk('dash.w.audit-funnel')} share /> : <Funnel steps={d.steps} label={tk('dash.w.audit-funnel')} />),
  table: (d) => ({ columns: [{ key: 's', label: tk('dash.table.step') }, { key: 'v', label: tk('dash.kpi.commits'), numeric: true }], rows: d.steps.map((s) => [s.label, s.value]) })
})

export const auditFlagsWidget = define<AuditSummary>({
  id: 'audit-flags',
  category: 'quality',
  views: ['list', 'lollipop', 'columns'],
  cols: 6,
  rows: 2,
  data: (ctx) => auditSummary(ctx.cs),
  render: (d, view) => {
    const rows = AUDIT_FLAGS.map((f) => ({ id: f, label: tk(`dash.flag.${f}`), value: d.counts[f], hint: tk(`dash.flagHelp.${f}`) })).sort((a, b) => b.value - a.value)
    if (view === 'columns') return <Columns categories={rows.map((r) => r.label)} series={[{ id: 'n', label: tk('dash.kpi.commits'), color: 'var(--dash-s2)', y: rows.map((r) => r.value) }]} label={tk('dash.w.audit-flags')} />
    return <BarList rows={rows} variant={view === 'lollipop' ? 'lollipop' : 'bar'} color="var(--dash-s2)" label={tk('dash.w.audit-flags')} share />
  },
  table: (d) => ({ columns: [{ key: 'f', label: tk('dash.table.flag') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: AUDIT_FLAGS.map((f) => [tk(`dash.flag.${f}`), d.counts[f]]) })
})

export const schedule = define<{ inside: number; off: number; weekend: number; total: number }>({
  id: 'schedule',
  category: 'quality',
  views: ['donut', 'gauge', 'waffle'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    let off = 0
    let weekend = 0
    let inside = 0
    for (const c of ctx.cs) {
      const f = auditFlags(c)
      if (f.includes('weekend')) weekend++
      else if (f.includes('offHours')) off++
      else inside++
    }
    return { inside, off, weekend, total: ctx.cs.length }
  },
  render: (d, view) => {
    const slices: Slice[] = [
      { id: 'in', label: tk('dash.schedule.inside'), value: d.inside, color: 'var(--dash-s1)' },
      { id: 'off', label: tk('dash.schedule.off'), value: d.off, color: 'var(--dash-s4)' },
      { id: 'we', label: tk('dash.schedule.weekend'), value: d.weekend, color: 'var(--dash-s2)' }
    ]
    if (view === 'gauge') {
      const share = d.total ? (d.off + d.weekend) / d.total : 0
      const tone = ratioTone(1 - share, 0.85, 0.7, 0.5)
      return <Gauge value={share} tone={tone} caption={tk('dash.schedule.caption')} status={tk(`dash.status.${tone}`)} label={tk('dash.w.schedule')} />
    }
    return view === 'waffle' ? <Waffle slices={slices} label={tk('dash.w.schedule')} /> : <Donut slices={slices} centerLabel={tk('dash.kpi.commits')} label={tk('dash.w.schedule')} />
  },
  table: (d) => ({ columns: [{ key: 'k', label: tk('dash.table.type') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: [[tk('dash.schedule.inside'), d.inside], [tk('dash.schedule.off'), d.off], [tk('dash.schedule.weekend'), d.weekend]] })
})

export const flow = define<{ direct: number; merges: number; reverts: number }>({
  id: 'flow',
  category: 'quality',
  views: ['donut', 'waffle', 'list'],
  cols: 4,
  rows: 2,
  data: (ctx) => {
    let merges = 0
    let reverts = 0
    for (const c of ctx.cs) {
      if (c.merge) merges++
      else if (kindOf(c).kind === 'revert') reverts++
    }
    return { merges, reverts, direct: ctx.cs.length - merges - reverts }
  },
  render: (d, view) => {
    const slices: Slice[] = [
      { id: 'direct', label: tk('dash.flow.direct'), value: d.direct, color: 'var(--dash-s1)' },
      { id: 'merge', label: tk('dash.flow.merges'), value: d.merges, color: 'var(--dash-s7)' },
      { id: 'revert', label: tk('dash.flow.reverts'), value: d.reverts, color: 'var(--dash-s8)' }
    ]
    if (view === 'list') return <BarList rows={slices.map((s) => ({ id: s.id, label: s.label, value: s.value, color: s.color }))} label={tk('dash.w.flow')} share />
    return view === 'waffle' ? <Waffle slices={slices} label={tk('dash.w.flow')} /> : <Donut slices={slices} centerLabel={tk('dash.kpi.commits')} label={tk('dash.w.flow')} />
  },
  table: (d) => ({ columns: [{ key: 'k', label: tk('dash.table.type') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: [[tk('dash.flow.direct'), d.direct], [tk('dash.flow.merges'), d.merges], [tk('dash.flow.reverts'), d.reverts]] })
})

export const auditTable = define<{ rows: { sha: string; time: number; author: string; subject: string; flags: AuditFlag[] }[] }>({
  id: 'audit-table',
  category: 'quality',
  views: ['table'],
  cols: 12,
  rows: 3,
  data: (ctx) => ({ rows: flaggedCommits(ctx.cs, 80).map((r) => ({ sha: r.commit.sha, time: r.commit.time, author: ctx.name(r.commit.person), subject: r.commit.subject, flags: r.flags })) }),
  render: () => null,
  empty: (d) => d.rows.length === 0,
  table: (d) => ({
    columns: [
      { key: 'sha', label: 'SHA' },
      { key: 'date', label: tk('dash.table.date') },
      { key: 'author', label: tk('dash.table.person') },
      { key: 'subject', label: tk('dash.table.subject') },
      { key: 'flags', label: tk('dash.table.flag') }
    ],
    rows: d.rows.map((r) => [r.sha.slice(0, 7), shortDate(r.time), r.author, r.subject, r.flags.map((f) => tk(`dash.flag.${f}`)).join(', ')])
  })
})

export const largeCommits = define<{ rows: { sha: string; subject: string; lines: number; files: number; author: string }[] }>({
  id: 'large-commits',
  category: 'quality',
  views: ['list', 'lollipop'],
  cols: 6,
  rows: 2,
  data: (ctx) => ({ rows: [...ctx.cs].filter((c) => !c.merge).sort((a, b) => churn(b) - churn(a)).slice(0, 25).map((c) => ({ sha: c.sha, subject: c.subject, lines: churn(c), files: c.nfiles, author: ctx.name(c.person) })) }),
  render: (d, view) => <BarList rows={d.rows.map((r) => ({ id: r.sha, label: `${r.sha.slice(0, 7)} ${r.subject}`, value: r.lines, hint: `${r.author} · ${r.files}` }))} variant={view === 'lollipop' ? 'lollipop' : 'bar'} color="var(--dash-s8)" format={compact} label={tk('dash.w.large-commits')} />,
  table: (d) => ({ columns: [{ key: 'sha', label: 'SHA' }, { key: 'subject', label: tk('dash.table.subject') }, { key: 'author', label: tk('dash.table.person') }, { key: 'lines', label: tk('dash.metric.lines'), numeric: true }, { key: 'files', label: tk('dash.metric.files'), numeric: true }], rows: d.rows.map((r) => [r.sha.slice(0, 7), r.subject, r.author, r.lines, r.files]) })
})
