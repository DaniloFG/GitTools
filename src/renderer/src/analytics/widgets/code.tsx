import { BarList, Columns, type BarRow } from '../charts/Bars'
import { Donut, Waffle, type Slice } from '../charts/Part'
import { Scatter, type Dot } from '../charts/Scatter'
import { Treemap } from '../charts/Treemap'
import { OTHER_COLOR, foldTop, seriesColor } from '../charts/core'
import { bytes, compact, int, shortDate } from '../charts/format'
import { byFile, churn, coChange, extensionOf, folderTree, histogram, FILES_EDGES, SIZE_EDGES, type FileRow, type TreeNode } from '../metrics'
import { tk } from './helpers'
import { define } from './summary'
import type { Ctx } from './types'

const FILE_METRICS = (['changes', 'lines', 'people'] as const).map((id) => ({ id, label: `dash.metric.${id}` as never }))
const FOLDER_METRICS = (['lines', 'commits'] as const).map((id) => ({ id, label: `dash.metric.${id}` as never }))

const fileValue = (f: FileRow, metric: string) => (metric === 'lines' ? f.add + f.del : metric === 'people' ? f.people : f.commits)

export const hotFiles = define<{ rows: BarRow[]; files: FileRow[]; metric: string }>({
  id: 'hot-files',
  category: 'code',
  views: ['list', 'lollipop'],
  cols: 6,
  rows: 2,
  options: [{ key: 'metric', label: 'dash.option.metric', values: FILE_METRICS }],
  data: (ctx, opt) => {
    const metric = opt.metric ?? 'changes'
    const files = byFile(ctx.cs, ctx.ds.paths)
    const rows = files
      .map((f) => ({ id: f.path, label: f.path, value: fileValue(f, metric), hint: `${f.commits} · ${f.people}` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 30)
    return { rows, files, metric }
  },
  render: (d, view) => <BarList rows={d.rows} variant={view === 'lollipop' ? 'lollipop' : 'bar'} color="var(--dash-s2)" label={tk('dash.w.hot-files')} />,
  table: (d) => ({
    columns: [
      { key: 'f', label: tk('dash.table.file') },
      { key: 'c', label: tk('dash.metric.changes'), numeric: true },
      { key: 'a', label: tk('dash.kpi.additions'), numeric: true },
      { key: 'd', label: tk('dash.kpi.deletions'), numeric: true },
      { key: 'p', label: tk('dash.metric.people'), numeric: true },
      { key: 'last', label: tk('dash.table.last') }
    ],
    rows: d.files.slice(0, 300).map((f) => [f.path, f.commits, f.add, f.del, f.people, shortDate(f.last)])
  })
})

interface FolderData {
  tree: TreeNode
  rows: BarRow[]
}

function folderData(ctx: Ctx, metric: string): FolderData {
  const files = byFile(ctx.cs, ctx.ds.paths)
  const tree = folderTree(files.map((f) => ({ path: f.path, value: metric === 'commits' ? f.commits : f.add + f.del })))
  const rows = (tree.children ?? []).map((c, i) => ({ id: c.path || c.name, label: c.name, value: c.value, color: seriesColor(i) })).slice(0, 30)
  return { tree, rows }
}

const slicesOf = (rows: BarRow[]): Slice[] =>
  foldTop(rows, 5, (rest) => ({ id: '__others__', label: tk('dash.others'), value: rest.reduce((s, r) => s + r.value, 0), color: OTHER_COLOR })).map((r, i) => ({ id: r.id, label: r.label, value: r.value, color: r.id === '__others__' ? OTHER_COLOR : (r.color ?? seriesColor(i)) }))

export const folders = define<FolderData & { metric: string }>({
  id: 'folders',
  category: 'code',
  views: ['treemap', 'list', 'donut'],
  cols: 8,
  rows: 2,
  options: [{ key: 'metric', label: 'dash.option.metric', values: FOLDER_METRICS }],
  data: (ctx, opt) => ({ ...folderData(ctx, opt.metric ?? 'lines'), metric: opt.metric ?? 'lines' }),
  render: (d, view) => {
    const label = tk('dash.w.folders')
    if (view === 'donut') return <Donut slices={slicesOf(d.rows)} centerLabel={tk(`dash.metric.${d.metric}`)} label={label} />
    if (view === 'list') return <BarList rows={d.rows} label={label} share />
    return <Treemap root={d.tree} label={label} valueLabel={tk(`dash.metric.${d.metric}`)} />
  },
  table: (d) => ({ columns: [{ key: 'f', label: tk('dash.table.folder') }, { key: 'v', label: tk(`dash.metric.${d.metric}`), numeric: true }], rows: d.rows.map((r) => [r.label, r.value]) })
})

export const fileTypes = define<{ rows: BarRow[]; metric: string }>({
  id: 'file-types',
  category: 'code',
  views: ['donut', 'waffle', 'list', 'columns'],
  cols: 4,
  rows: 2,
  options: [{ key: 'metric', label: 'dash.option.metric', values: FOLDER_METRICS }],
  data: (ctx, opt) => {
    const metric = opt.metric ?? 'lines'
    const by = new Map<string, number>()
    for (const f of byFile(ctx.cs, ctx.ds.paths)) by.set(extensionOf(f.path), (by.get(extensionOf(f.path)) ?? 0) + (metric === 'commits' ? f.commits : f.add + f.del))
    const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([ext, value], i) => ({ id: ext, label: ext.startsWith('.') || ext.startsWith('(') ? ext : `.${ext}`, value, color: seriesColor(i) }))
    return { rows, metric }
  },
  render: (d, view) => {
    const label = tk('dash.w.file-types')
    if (view === 'waffle') return <Waffle slices={slicesOf(d.rows)} label={label} />
    if (view === 'list') return <BarList rows={d.rows.slice(0, 30)} label={label} share />
    if (view === 'columns') return <Columns categories={d.rows.slice(0, 10).map((r) => r.label)} series={[{ id: 'v', label: tk(`dash.metric.${d.metric}`), color: 'var(--dash-s1)', y: d.rows.slice(0, 10).map((r) => r.value) }]} label={label} />
    return <Donut slices={slicesOf(d.rows)} centerLabel={tk(`dash.metric.${d.metric}`)} label={label} />
  },
  table: (d) => ({ columns: [{ key: 'e', label: tk('dash.table.type') }, { key: 'v', label: tk(`dash.metric.${d.metric}`), numeric: true }], rows: d.rows.map((r) => [r.label, r.value]) })
})

export const commitSize = define<{ bins: { label: string; count: number }[] }>({
  id: 'commit-size',
  category: 'code',
  views: ['columns', 'list'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ bins: histogram(ctx.cs.filter((c) => !c.merge).map(churn), SIZE_EDGES, (a, b) => (b === null ? `${compact(a)}+` : `${a}–${b}`)) }),
  render: (d, view) =>
    view === 'list' ? (
      <BarList rows={d.bins.map((b) => ({ id: b.label, label: b.label, value: b.count }))} label={tk('dash.w.commit-size')} share />
    ) : (
      <Columns categories={d.bins.map((b) => b.label)} series={[{ id: 'n', label: tk('dash.kpi.commits'), color: 'var(--dash-s1)', y: d.bins.map((b) => b.count) }]} label={tk('dash.w.commit-size')} />
    ),
  table: (d) => ({ columns: [{ key: 'r', label: tk('dash.metric.lines') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: d.bins.map((b) => [b.label, b.count]) })
})

export const filesPerCommit = define<{ bins: { label: string; count: number }[] }>({
  id: 'files-per-commit',
  category: 'code',
  views: ['columns', 'list'],
  cols: 4,
  rows: 2,
  data: (ctx) => ({ bins: histogram(ctx.cs.filter((c) => !c.merge && c.nfiles > 0).map((c) => c.nfiles), FILES_EDGES, (a, b) => (b === null ? `${a}+` : a === b ? String(a) : `${a}–${b}`)) }),
  render: (d, view) =>
    view === 'list' ? (
      <BarList rows={d.bins.map((b) => ({ id: b.label, label: b.label, value: b.count }))} label={tk('dash.w.files-per-commit')} share />
    ) : (
      <Columns categories={d.bins.map((b) => b.label)} series={[{ id: 'n', label: tk('dash.kpi.commits'), color: 'var(--dash-s3)', y: d.bins.map((b) => b.count) }]} label={tk('dash.w.files-per-commit')} />
    ),
  table: (d) => ({ columns: [{ key: 'r', label: tk('dash.metric.files') }, { key: 'n', label: tk('dash.kpi.commits'), numeric: true }], rows: d.bins.map((b) => [b.label, b.count]) })
})

export const coupling = define<{ pairs: { a: string; b: string; count: number }[] }>({
  id: 'coupling',
  category: 'code',
  views: ['list', 'lollipop'],
  cols: 6,
  rows: 2,
  data: (ctx) => ({ pairs: coChange(ctx.cs, ctx.ds.paths, 20) }),
  render: (d, view) => <BarList rows={d.pairs.map((p) => ({ id: `${p.a}|${p.b}`, label: `${p.a.split('/').pop()} ↔ ${p.b.split('/').pop()}`, value: p.count, hint: `${p.a} ↔ ${p.b}` }))} variant={view === 'lollipop' ? 'lollipop' : 'bar'} color="var(--dash-s5)" label={tk('dash.w.coupling')} />,
  empty: (d) => d.pairs.length === 0,
  table: (d) => ({ columns: [{ key: 'a', label: tk('dash.table.file') }, { key: 'b', label: tk('dash.table.fileB') }, { key: 'n', label: tk('dash.table.together'), numeric: true }], rows: d.pairs.map((p) => [p.a, p.b, p.count]) })
})

export const hotspots = define<{ dots: Dot[]; files: FileRow[] }>({
  id: 'hotspots',
  category: 'code',
  views: ['scatter'],
  cols: 6,
  rows: 2,
  data: (ctx) => {
    const files = byFile(ctx.cs, ctx.ds.paths).slice(0, 120)
    return {
      files,
      dots: files.map((f) => ({
        id: f.path,
        label: f.path.split('/').pop() ?? f.path,
        x: f.commits,
        y: f.people,
        size: f.add + f.del,
        color: 'var(--dash-s2)',
        rows: [
          { color: 'var(--dash-s1)', key: 'dot', label: tk('dash.metric.changes'), value: int(f.commits) },
          { color: 'var(--dash-s1)', key: 'dot', label: tk('dash.metric.people'), value: int(f.people) },
          { color: 'var(--dash-s1)', key: 'dot', label: tk('dash.metric.lines'), value: compact(f.add + f.del) }
        ]
      }))
    }
  },
  render: (d) => <Scatter dots={d.dots} xLabel={tk('dash.metric.changes')} yLabel={tk('dash.metric.people')} label={tk('dash.w.hotspots')} />,
  table: (d) => ({ columns: [{ key: 'f', label: tk('dash.table.file') }, { key: 'c', label: tk('dash.metric.changes'), numeric: true }, { key: 'p', label: tk('dash.metric.people'), numeric: true }, { key: 'l', label: tk('dash.metric.lines'), numeric: true }], rows: d.files.map((f) => [f.path, f.commits, f.people, f.add + f.del]) })
})

/** Composição do repositório hoje (arquivos do HEAD, por tamanho em bytes). */
export const repoComposition = define<{ tree: TreeNode; byExt: BarRow[]; total: number; files: number }>({
  id: 'repo-composition',
  category: 'repo',
  views: ['treemap', 'donut', 'list'],
  cols: 8,
  rows: 2,
  data: (ctx) => {
    const tree = folderTree(ctx.ds.tree.map((f) => ({ path: f.path, value: f.size })))
    const by = new Map<string, number>()
    for (const f of ctx.ds.tree) by.set(extensionOf(f.path), (by.get(extensionOf(f.path)) ?? 0) + f.size)
    const byExt = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([ext, value], i) => ({ id: ext, label: ext.startsWith('.') || ext.startsWith('(') ? ext : `.${ext}`, value, color: seriesColor(i) }))
    return { tree, byExt, total: ctx.ds.tree.reduce((s, f) => s + f.size, 0), files: ctx.ds.tree.length }
  },
  render: (d, view) => {
    const label = tk('dash.w.repo-composition')
    if (view === 'donut') return <Donut slices={slicesOf(d.byExt)} centerLabel={tk('dash.size')} format={bytes} label={label} />
    if (view === 'list') return <BarList rows={d.byExt.slice(0, 30)} format={bytes} label={label} share />
    return <Treemap root={d.tree} format={bytes} label={label} valueLabel={tk('dash.size')} />
  },
  empty: (d) => d.files === 0,
  table: (d) => ({ columns: [{ key: 'e', label: tk('dash.table.type') }, { key: 'b', label: tk('dash.size'), numeric: true }], rows: d.byExt.map((r) => [r.label, r.value]) })
})
