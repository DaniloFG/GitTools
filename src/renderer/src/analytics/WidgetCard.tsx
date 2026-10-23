import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { startReorder } from '../reorder'
import { tk } from './widgets/helpers'
import { DataTable, toCsv } from './charts/DataTable'
import { WIDGET_BY_ID, moveBefore, removeWidget, resizeCols, updateWidget } from './widgets'
import type { Ctx, ViewId, WidgetInstance } from './widgets/types'
import { t } from '../i18n'

/** Linha de altura de um cartão (px): `rows` linhas, cada uma com cabeçalho do cartão incluído. */
export const ROW_HEIGHT = 188

const VIEW_GLYPH: Record<ViewId, string> = {
  tiles: '▦',
  area: '◢',
  line: '〰',
  bar: '▤',
  step: '⎍',
  stream: '≋',
  stacked: '▥',
  grouped: '▯',
  list: '☰',
  lollipop: '⚬',
  columns: '▥',
  donut: '◔',
  waffle: '▦',
  treemap: '▚',
  heatmap: '▩',
  punch: '⬤',
  calendar: '▦',
  radar: '⬡',
  scatter: '∴',
  funnel: '▽',
  gauge: '◠',
  meter: '▬',
  timeline: '⊷',
  table: '⊞'
}

interface Props {
  inst: WidgetInstance
  ctx: Ctx
  list: WidgetInstance[]
  onChange(next: WidgetInstance[]): void
  /** Colunas efetivas na largura atual da janela. */
  span: number
  /** Janela estreita: os indicadores quebram em mais linhas e ganham altura. */
  narrow?: boolean
}

/** Cartão de um widget: título, formas de ver, opções, tabela, menu e o gráfico. */
export function WidgetCard({ inst, ctx, list, onChange, span, narrow }: Props) {
  const { showMenu, toast } = useApp()
  const def = WIDGET_BY_ID.get(inst.widget)!
  const [asTable, setAsTable] = useState(false)
  const options = useMemo(() => {
    const out: Record<string, string> = {}
    for (const o of def.options ?? []) out[o.key] = inst.options?.[o.key] ?? o.values[0].id
    return out
  }, [def, inst.options])
  const optionsKey = JSON.stringify(options)
  // O cálculo só roda de novo quando os dados, o filtro ou as opções mudam.
  const model = useMemo(() => def.data(ctx, options), [def, ctx, optionsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const needsCommits = def.category !== 'repo' && def.category !== 'tool'
  const empty = (needsCommits && ctx.cs.length === 0) || def.empty?.(model) === true
  const forceTable = def.views.length === 1 && def.views[0] === 'table'
  const showTable = asTable || forceTable
  const rows = inst.rows ?? def.rows
  const heightRows = rows + (narrow && def.views.includes('tiles') && !showTable ? 1 : 0)
  const cols = inst.cols ?? def.cols

  const copy = async () => {
    const csv = toCsv(def.table(model, ctx, options))
    try {
      await navigator.clipboard.writeText(csv)
      toast('success', t('dash.card.copied'))
    } catch {
      const area = document.createElement('textarea')
      area.value = csv
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      toast('success', t('dash.card.copied'))
    }
  }

  const patch = (change: Partial<WidgetInstance>) => onChange(updateWidget(list, inst.uid, change))
  const index = list.findIndex((w) => w.uid === inst.uid)

  const menu = (e: React.MouseEvent) =>
    showMenu(e, [
      { label: t('dash.card.copy'), onClick: () => void copy() },
      { label: asTable ? t('dash.card.chart') : t('dash.card.table'), onClick: () => setAsTable(!asTable), disabled: forceTable },
      'separator',
      { label: t('dash.card.wider'), onClick: () => patch({ cols: resizeCols(cols, 1) }), disabled: cols === 12 },
      { label: t('dash.card.narrower'), onClick: () => patch({ cols: resizeCols(cols, -1) }), disabled: cols === 3 },
      { label: t('dash.card.taller'), onClick: () => patch({ rows: Math.min(3, rows + 1) as 1 | 2 | 3 }), disabled: rows === 3 },
      { label: t('dash.card.shorter'), onClick: () => patch({ rows: Math.max(1, rows - 1) as 1 | 2 | 3 }), disabled: rows === 1 },
      'separator',
      { label: t('dash.card.moveBack'), onClick: () => onChange(moveBefore(list, inst.uid, list[index - 1]?.uid ?? inst.uid)), disabled: index <= 0 },
      { label: t('dash.card.moveForward'), onClick: () => onChange(moveBefore(list, inst.uid, list[index + 1]?.uid ?? inst.uid)), disabled: index >= list.length - 1 },
      'separator',
      { label: t('dash.card.remove'), onClick: () => onChange(removeWidget(list, inst.uid)), danger: true }
    ])

  return (
    <section
      className={`dash-card ${showTable ? 'as-table' : ''}`}
      style={{ gridColumn: `span ${span}`, height: heightRows * ROW_HEIGHT + (heightRows - 1) * 14 }}
      data-reorder="dash"
      data-reorder-id={inst.uid}
      data-widget={inst.widget}
    >
      <header className="dash-card-head">
        <h3
          className="dash-card-title"
          title={`${tk(`dash.wd.${def.id}`)}\n\n${t('dash.card.dragHint')}`}
          onPointerDown={(e) => startReorder(e, 'dash', inst.uid, (id, target) => onChange(moveBefore(list, id, target)))}
        >
          {tk(`dash.w.${def.id}`)}
        </h3>
        <div className="dash-card-tools">
          {def.options?.map((o) => (
            <select key={o.key} className="dash-select" aria-label={t(o.label)} title={t(o.label)} value={options[o.key]} onChange={(e) => patch({ options: { ...inst.options, [o.key]: e.target.value } })}>
              {o.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {t(v.label)}
                </option>
              ))}
            </select>
          ))}
          {def.views.length > 1 && (
            <div className="dash-views" role="group" aria-label={t('dash.card.chartType')}>
              {def.views.map((v) => (
                <button key={v} className={!showTable && inst.view === v ? 'active' : ''} aria-pressed={!showTable && inst.view === v} title={tk(`dash.views.${v}`)} aria-label={tk(`dash.views.${v}`)} onClick={() => (setAsTable(false), patch({ view: v }))}>
                  {VIEW_GLYPH[v]}
                </button>
              ))}
              <button className={asTable ? 'active' : ''} aria-pressed={asTable} title={t('dash.card.table')} aria-label={t('dash.card.table')} onClick={() => setAsTable(!asTable)}>
                {VIEW_GLYPH.table}
              </button>
            </div>
          )}
          <button className="dash-icon-btn" onClick={menu} title={t('dash.card.menu')} aria-label={t('dash.card.menu')} aria-haspopup="menu">
            ⋯
          </button>
        </div>
      </header>
      <div className="dash-card-body">
        {empty ? <p className="dash-empty">{t('dash.noData')}</p> : showTable ? <DataTable data={def.table(model, ctx, options)} /> : def.render(model, inst.view, ctx, options)}
      </div>
    </section>
  )
}
