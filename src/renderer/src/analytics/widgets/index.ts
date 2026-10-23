// Registro dos widgets, os dashboards prontos e as preferências do usuário (pura: sem React, testável à parte).

import type { PeriodId } from '../model'
import { PERIODS } from '../model'
import * as code from './code'
import * as people from './people'
import * as quality from './quality'
import * as repo from './repo'
import * as summary from './summary'
import * as time from './time'
import * as tool from './tool'
import type { ViewId, WidgetCategory, WidgetDef, WidgetInstance } from './types'

export const WIDGETS: WidgetDef[] = [
  summary.kpiWidget,
  summary.commitsOverTime,
  summary.cumulativeCommits,
  summary.churnOverTime,
  summary.codeGrowth,
  people.topPeople,
  people.peopleOverTime,
  people.peopleScatter,
  people.peopleRadar,
  people.newcomersWidget,
  people.busFactorWidget,
  people.ownership,
  people.peopleTable,
  code.hotFiles,
  code.folders,
  code.fileTypes,
  code.commitSize,
  code.filesPerCommit,
  code.coupling,
  code.hotspots,
  time.calendar,
  time.weekdayHourWidget,
  time.byWeekday,
  time.byHour,
  time.monthly,
  summary.velocity,
  time.streakTiles,
  time.releasesWidget,
  quality.commitKinds,
  quality.conventional,
  quality.auditFunnel,
  quality.auditFlagsWidget,
  quality.schedule,
  quality.flow,
  quality.largeCommits,
  quality.auditTable,
  repo.repoSummary,
  repo.branchAge,
  repo.branchHealth,
  repo.aheadBehind,
  code.repoComposition,
  tool.commandHealth,
  tool.commandCount,
  tool.commandDuration,
  tool.commandTimeline,
  tool.slowestCommands
]

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]))

/** Os widgets estão registrados com a categoria certa (velocity vive em summary.tsx mas é de "tempo"). */
export const widgetsOf = (category: WidgetCategory) => WIDGETS.filter((w) => w.category === category)

export type DashboardId = 'overview' | 'people' | 'code' | 'cadence' | 'governance' | 'repository' | 'tool'

export const DASHBOARDS: DashboardId[] = ['overview', 'people', 'code', 'cadence', 'governance', 'repository', 'tool']

type Spec = [widget: string, view?: ViewId, cols?: WidgetInstance['cols'], rows?: WidgetInstance['rows'], options?: Record<string, string>]

const PRESETS: Record<DashboardId, Spec[]> = {
  overview: [
    ['kpis'],
    ['commits-over-time', 'area'],
    ['top-people', 'donut'],
    ['calendar', 'calendar', 8],
    ['hot-files', 'list', 4],
    ['weekday-hour', 'heatmap', 4],
    ['folders', 'treemap', 4],
    ['commit-kinds', 'waffle', 4]
  ],
  people: [
    ['top-people', 'list', 4],
    ['people-time', 'stream', 8],
    ['people-scatter', 'scatter', 4],
    ['people-radar', 'radar', 4],
    ['bus-factor', 'gauge', 4],
    ['newcomers', 'columns', 4],
    ['ownership', 'heatmap', 8],
    ['people-table', 'table', 12, 3]
  ],
  code: [
    ['hot-files', 'list', 4],
    ['folders', 'treemap', 8],
    ['churn', 'bar', 6],
    ['growth', 'area', 6],
    ['commit-size', 'columns', 4],
    ['files-per-commit', 'columns', 4],
    ['file-types', 'donut', 4],
    ['hotspots', 'scatter', 6],
    ['coupling', 'list', 6]
  ],
  cadence: [
    ['calendar', 'calendar', 12, 2],
    ['weekday-hour', 'punch', 6],
    ['by-weekday', 'columns', 3],
    ['by-hour', 'radar', 3],
    ['velocity', 'line', 6],
    ['monthly', 'columns', 6],
    ['streaks', 'tiles', 6, 1],
    ['releases', 'timeline', 6, 1]
  ],
  governance: [
    ['conventional', 'gauge', 4],
    ['schedule', 'donut', 4],
    ['flow', 'waffle', 4],
    ['audit-funnel', 'funnel', 6],
    ['audit-flags', 'list', 6],
    ['commit-kinds', 'donut', 4],
    ['large-commits', 'lollipop', 8],
    ['audit-table', 'table', 12, 3]
  ],
  repository: [
    ['repo-summary', 'tiles', 12, 1],
    ['branch-age', 'columns', 4],
    ['branch-health', 'gauge', 4],
    ['ahead-behind', 'grouped', 4],
    ['repo-composition', 'treemap', 8],
    ['releases', 'columns', 4]
  ],
  tool: [
    ['cmd-health', 'gauge', 4],
    ['cmd-count', 'donut', 4],
    ['cmd-duration', 'lollipop', 4],
    ['cmd-timeline', 'area', 8],
    ['cmd-slowest', 'list', 4]
  ]
}

export function instance(widget: string, uid: string, view?: ViewId, cols?: WidgetInstance['cols'], rows?: WidgetInstance['rows'], options?: Record<string, string>): WidgetInstance {
  const def = WIDGET_BY_ID.get(widget)!
  return { uid, widget, view: view && def.views.includes(view) ? view : def.views[0], ...(options ? { options } : {}), ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) }
}

export function presetWidgets(id: DashboardId): WidgetInstance[] {
  return PRESETS[id].map(([w, v, c, r, o], i) => instance(w, `${w}-${i + 1}`, v, c, r, o))
}

// --------------------------------------------------------------------------------------------- preferências

export interface CustomDashboard {
  id: string
  name: string
  widgets: WidgetInstance[]
}

export interface DashPrefs {
  /** Dashboard aberto: um dos prontos ou o id de um personalizado. */
  active: string
  period: PeriodId
  scope: 'all' | 'head'
  includeMerges: boolean
  excludeBots: boolean
  /** Dashboards prontos que o usuário mudou (os que não aparecem aqui usam o arranjo padrão). */
  overrides: Partial<Record<DashboardId, WidgetInstance[]>>
  custom: CustomDashboard[]
}

export const DEFAULT_PREFS: DashPrefs = { active: 'overview', period: '12m', scope: 'all', includeMerges: true, excludeBots: false, overrides: {}, custom: [] }

const COLS = [3, 4, 6, 8, 12]
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseInstances(value: unknown): WidgetInstance[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: WidgetInstance[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.widget !== 'string' || typeof raw.uid !== 'string') continue
    const def = WIDGET_BY_ID.get(raw.widget)
    if (!def || seen.has(raw.uid)) continue
    seen.add(raw.uid)
    const options: Record<string, string> = {}
    if (isRecord(raw.options)) {
      const given = raw.options
      for (const o of def.options ?? []) if (typeof given[o.key] === 'string' && o.values.some((v) => v.id === given[o.key])) options[o.key] = given[o.key] as string
    }
    out.push({
      uid: raw.uid,
      widget: def.id,
      view: def.views.includes(raw.view as ViewId) ? (raw.view as ViewId) : def.views[0],
      ...(Object.keys(options).length ? { options } : {}),
      ...(COLS.includes(raw.cols as number) ? { cols: raw.cols as WidgetInstance['cols'] } : {}),
      ...([1, 2, 3].includes(raw.rows as number) ? { rows: raw.rows as WidgetInstance['rows'] } : {})
    })
  }
  return out
}

export function parsePrefs(value: unknown): DashPrefs {
  const raw = isRecord(value) ? value : {}
  const overrides: DashPrefs['overrides'] = {}
  if (isRecord(raw.overrides)) for (const id of DASHBOARDS) if (Array.isArray(raw.overrides[id])) overrides[id] = parseInstances(raw.overrides[id])
  const custom: CustomDashboard[] = []
  if (Array.isArray(raw.custom)) {
    for (const c of raw.custom) {
      if (!isRecord(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim() || custom.some((x) => x.id === c.id)) continue
      custom.push({ id: c.id, name: c.name.trim().slice(0, 40), widgets: parseInstances(c.widgets) })
    }
  }
  const known = new Set<string>([...DASHBOARDS, ...custom.map((c) => c.id)])
  return {
    active: typeof raw.active === 'string' && known.has(raw.active) ? raw.active : DEFAULT_PREFS.active,
    period: PERIODS.includes(raw.period as PeriodId) ? (raw.period as PeriodId) : DEFAULT_PREFS.period,
    scope: raw.scope === 'head' ? 'head' : 'all',
    includeMerges: raw.includeMerges !== false,
    excludeBots: raw.excludeBots === true,
    overrides,
    custom
  }
}

/** Widgets do dashboard `id` agora (o arranjo do usuário, se houver; senão o padrão). */
export function widgetsFor(prefs: DashPrefs, id: string): WidgetInstance[] {
  const custom = prefs.custom.find((c) => c.id === id)
  if (custom) return custom.widgets
  return prefs.overrides[id as DashboardId] ?? presetWidgets(id as DashboardId)
}

/** Grava o novo arranjo de um dashboard (pronto ou personalizado). */
export function withWidgets(prefs: DashPrefs, id: string, widgets: WidgetInstance[]): DashPrefs {
  if (prefs.custom.some((c) => c.id === id)) return { ...prefs, custom: prefs.custom.map((c) => (c.id === id ? { ...c, widgets } : c)) }
  return { ...prefs, overrides: { ...prefs.overrides, [id]: widgets } }
}

export function resetDashboard(prefs: DashPrefs, id: string): DashPrefs {
  const { [id as DashboardId]: _removed, ...rest } = prefs.overrides
  void _removed
  return prefs.custom.some((c) => c.id === id) ? withWidgets(prefs, id, []) : { ...prefs, overrides: rest }
}

export function addWidget(list: WidgetInstance[], widget: string): WidgetInstance[] {
  let n = list.length + 1
  while (list.some((w) => w.uid === `${widget}-${n}`)) n++
  return [...list, instance(widget, `${widget}-${n}`)]
}

export const removeWidget = (list: WidgetInstance[], uid: string) => list.filter((w) => w.uid !== uid)

export const updateWidget = (list: WidgetInstance[], uid: string, patch: Partial<WidgetInstance>) => list.map((w) => (w.uid === uid ? { ...w, ...patch } : w))

/** Troca o widget de lugar com o vizinho (`delta` = -1 anda para antes, +1 para depois). */
export function moveWidget(list: WidgetInstance[], uid: string, delta: -1 | 1): WidgetInstance[] {
  const i = list.findIndex((w) => w.uid === uid)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Move o widget `uid` para a posição do widget `target` (arrastar e soltar). */
export function moveBefore(list: WidgetInstance[], uid: string, target: string): WidgetInstance[] {
  const from = list.findIndex((w) => w.uid === uid)
  const to = list.findIndex((w) => w.uid === target)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const WIDTHS: WidgetInstance['cols'][] = [3, 4, 6, 8, 12]

/** Próxima largura (mais larga ou mais estreita); nos extremos continua na mesma. */
export function resizeCols(current: NonNullable<WidgetInstance['cols']>, dir: -1 | 1): NonNullable<WidgetInstance['cols']> {
  const i = WIDTHS.indexOf(current)
  return WIDTHS[Math.max(0, Math.min(WIDTHS.length - 1, i + dir))]!
}

export function addCustom(prefs: DashPrefs, name: string): { prefs: DashPrefs; id: string } {
  let n = prefs.custom.length + 1
  while (prefs.custom.some((c) => c.id === `custom-${n}`)) n++
  const id = `custom-${n}`
  return { id, prefs: { ...prefs, active: id, custom: [...prefs.custom, { id, name: name.trim().slice(0, 40), widgets: [] }] } }
}

export function removeCustom(prefs: DashPrefs, id: string): DashPrefs {
  return { ...prefs, active: prefs.active === id ? 'overview' : prefs.active, custom: prefs.custom.filter((c) => c.id !== id) }
}

export function renameCustom(prefs: DashPrefs, id: string, name: string): DashPrefs {
  const clean = name.trim().slice(0, 40)
  return clean ? { ...prefs, custom: prefs.custom.map((c) => (c.id === id ? { ...c, name: clean } : c)) } : prefs
}
