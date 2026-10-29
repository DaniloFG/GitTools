import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Analytics, GitCommandEntry } from '../../../shared/types'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { t, formatRelative } from '../i18n'
import { useLayout } from '../layout'
import { seriesColor, useSize } from '../analytics/charts/core'
import { compact, int, shortDate } from '../analytics/charts/format'
import { auditFlags } from '../analytics/metrics'
import { DAY, DEFAULT_FILTERS, PERIODS, applyFilters, buildDataset, endOfDay, periodRange, startOfDay, type Filters, type PeriodId } from '../analytics/model'
import { autoGranularity } from '../analytics/metrics'
import { WidgetCard } from '../analytics/WidgetCard'
import { DASHBOARDS, WIDGETS, WIDGET_BY_ID, addCustom, addWidget, parsePrefs, removeCustom, renameCustom, resetDashboard, widgetsFor, withWidgets, type DashPrefs } from '../analytics/widgets'
import { tk } from '../analytics/widgets/helpers'
import { CATEGORIES, type Ctx, type WidgetCategory, type WidgetInstance } from '../analytics/widgets/types'
import { Modal } from './Modal'
import { Loader, LoaderPane, LoadingOverlay } from './Loader'
import '../analytics/dashboard.css'

const PERIOD_LABEL: Record<PeriodId, string> = { '7d': 'dash.filters.p7d', '30d': 'dash.filters.p30d', '90d': 'dash.filters.p90d', '6m': 'dash.filters.p6m', '12m': 'dash.filters.p12m', all: 'dash.filters.pall', custom: 'dash.filters.custom' }

/** Comandos git que o GitTools executou (os do início da sessão e os que chegam ao vivo). */
function useCommands(): GitCommandEntry[] {
  const [list, setList] = useState<GitCommandEntry[]>([])
  useEffect(() => {
    const byId = new Map<number, GitCommandEntry>()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      setList([...byId.values()])
    }
    void window.gittools.gitLog().then((entries) => {
      for (const e of entries) byId.set(e.id, e)
      flush()
    })
    const off = window.gittools.onGitCommand((entry) => {
      byId.set(entry.id, entry)
      // O log chega em rajadas: junta as atualizações em uma só por segundo.
      if (!timer) timer = setTimeout(flush, 1000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return list
}

/** Lê o histórico para os dashboards; recarrega quando o repositório muda de verdade (outro commit, branch ou tag). */
function useAnalytics(scope: 'all' | 'head') {
  const { repo, data } = useApp()
  const [state, setState] = useState<{ analytics: Analytics | null; loading: boolean; error: string | null }>({ analytics: null, loading: true, error: null })
  const signature = `${data.status.headSha}|${data.branches.map((b) => b.sha).join(',')}|${data.tags.length}`
  const [tick, setTick] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    setState((s) => ({ ...s, loading: true, error: null }))
    git.analytics({ scope }).then(
      (analytics) => id === request.current && setState({ analytics, loading: false, error: null }),
      (e) => id === request.current && setState((s) => ({ ...s, loading: false, error: errorMessage(e) }))
    )
  }, [repo.root, scope, signature, tick])
  return { ...state, reload: () => setTick((n) => n + 1) }
}

export function Dashboards() {
  const { repo, data, prompt, confirm, toast, showMenu } = useApp()
  const [prefs, setPrefs] = useLayout<DashPrefs>('pref.dashboards', parsePrefs)
  const commands = useCommands()
  const { analytics, loading, error, reload } = useAnalytics(prefs.scope)
  const [people, setPeople] = useState<string[]>([])
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [gallery, setGallery] = useState(false)
  const [boxRef, size] = useSize<HTMLDivElement>()

  const ds = useMemo(() => (analytics ? buildDataset(analytics) : null), [analytics])
  // Outro repositório: os filtros de pessoas e datas não valem mais.
  useEffect(() => {
    setPeople([])
    setCustom(null)
  }, [repo.root])

  const period: PeriodId = custom ? 'custom' : prefs.period
  const filters: Filters = useMemo(() => {
    if (!ds) return DEFAULT_FILTERS
    const range = custom ? { from: custom.from ? startOfDay(new Date(`${custom.from}T00:00:00`).getTime()) : null, to: custom.to ? endOfDay(new Date(`${custom.to}T00:00:00`).getTime()) : null } : periodRange(prefs.period, ds)
    return { ...range, people, includeMerges: prefs.includeMerges, excludeBots: prefs.excludeBots }
  }, [ds, custom, prefs.period, prefs.includeMerges, prefs.excludeBots, people])

  const ctx: Ctx | null = useMemo(() => {
    if (!ds) return null
    const cs = applyFilters(ds, filters)
    const from = filters.from ?? ds.first
    const to = filters.to ?? ds.last
    const span = Math.max(DAY, to - from)
    const prev = filters.from !== null && filters.to !== null ? applyFilters(ds, { ...filters, from: filters.from - span - 1, to: filters.from - 1 }) : []
    const counts = new Map<string, number>()
    for (const c of cs) counts.set(c.person, (counts.get(c.person) ?? 0) + 1)
    const present = ds.people.filter((p) => counts.has(p.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    return {
      ds,
      cs,
      prev,
      range: { from, to: Math.max(to, from + DAY) },
      g: autoGranularity(from, to),
      people: present,
      name: (id: string) => ds.person.get(id)?.name ?? id,
      color: (id: string) => seriesColor(ds.person.get(id)?.slot ?? 8),
      branches: data.branches,
      tags: data.tags,
      stashes: data.stashes,
      commands,
      head: data.status.branch,
      now: analytics?.generatedAt ?? Date.now()
    }
  }, [ds, filters, data.branches, data.tags, data.stashes, data.status.branch, commands, analytics])

  const widgets = widgetsFor(prefs, prefs.active)
  const setWidgets = useCallback((next: WidgetInstance[]) => setPrefs((p) => withWidgets(p, p.active, next)), [setPrefs])
  const filtersActive = people.length > 0 || !!custom || !prefs.includeMerges || prefs.excludeBots || prefs.scope !== 'all' || prefs.period !== '12m'

  const clearFilters = () => {
    setPeople([])
    setCustom(null)
    setPrefs((p) => ({ ...p, period: '12m', scope: 'all', includeMerges: true, excludeBots: false }))
  }

  const newDashboard = async () => {
    const name = await prompt({ title: t('dash.newDashboard'), label: t('dash.dashboardName'), placeholder: t('dash.dashboardNamePlaceholder'), confirmLabel: t('dash.create') })
    if (name) setPrefs((p) => addCustom(p, name).prefs)
  }

  const tabMenu = (e: React.MouseEvent, id: string) => {
    const c = prefs.custom.find((x) => x.id === id)
    if (!c) return
    e.preventDefault()
    showMenu(e, [
      {
        label: t('dash.rename'),
        onClick: async () => {
          const name = await prompt({ title: t('dash.rename'), label: t('dash.dashboardName'), initial: c.name, confirmLabel: t('common.ok') })
          if (name) setPrefs((p) => renameCustom(p, id, name))
        }
      },
      {
        label: t('dash.delete'),
        danger: true,
        onClick: async () => {
          if (await confirm({ title: t('dash.delete'), message: t('dash.deleteConfirm', { name: c.name }), confirmLabel: t('common.discard'), danger: true })) setPrefs((p) => removeCustom(p, id))
        }
      }
    ])
  }

  const reset = async () => {
    const ok = await confirm({ title: t('dash.resetTitle'), message: t('dash.resetMessage'), confirmLabel: t('dash.resetConfirm') })
    if (ok) setPrefs((p) => resetDashboard(p, p.active))
  }

  const exportCsv = async () => {
    if (!ctx) return
    const esc = (v: string | number | boolean) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const header = ['sha', 'date', 'author', 'email', 'committer', 'subject', 'files', 'additions', 'deletions', 'merge', 'flags']
    const lines = ctx.cs.map((c) => [c.sha, new Date(c.time).toISOString(), c.author, c.email, c.committer, c.subject, c.nfiles, c.add, c.del, c.merge, auditFlags(c).join(' ')].map(esc).join(','))
    try {
      await navigator.clipboard.writeText([header.join(','), ...lines].join('\n'))
      toast('success', t('dash.exported'))
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  const tabs = [...DASHBOARDS.map((id) => ({ id: id as string, label: tk(`dash.dashboards.${id}`), help: tk(`dash.dashboardsHelp.${id}`) })), ...prefs.custom.map((c) => ({ id: c.id, label: c.name, help: c.name }))]

  const narrow = size.w > 0 && size.w < 700
  const medium = size.w >= 700 && size.w < 1050
  const spanOf = (cols: number) => (narrow ? 12 : medium ? (cols <= 4 ? 6 : 12) : cols)

  return (
    <div className="dashboards dash" ref={boxRef}>
      <header className="dash-head">
        <div className="dash-tabs" role="tablist" aria-label={t('dash.title')}>
          {tabs.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={prefs.active === tab.id} className={`dash-tab ${prefs.active === tab.id ? 'active' : ''}`} title={tab.help} onClick={() => setPrefs((p) => ({ ...p, active: tab.id }))} onContextMenu={(e) => tabMenu(e, tab.id)}>
              {tab.label}
            </button>
          ))}
          <button className="dash-tab add" onClick={() => void newDashboard()} title={t('dash.newDashboard')} aria-label={t('dash.newDashboard')}>
            ＋
          </button>
        </div>
        <div className="dash-actions">
          {analytics && (
            <span className="dash-updated muted small" title={new Date(analytics.generatedAt).toLocaleString()}>
              {loading ? <Loader size="sm" label={t('dash.loading')} /> : t('dash.updated', { time: formatRelative(analytics.generatedAt) })}
            </span>
          )}
          <button className="icon-button" onClick={reload} title={t('dash.refresh')} aria-label={t('dash.refresh')}>
            ⟳
          </button>
          <button onClick={() => void exportCsv()} disabled={!ctx || ctx.cs.length === 0} title={t('dash.exportCsv')}>
            ⇩ CSV
          </button>
          <button onClick={() => void reset()} title={t('dash.reset')} disabled={prefs.custom.some((c) => c.id === prefs.active) ? widgets.length === 0 : !prefs.overrides[prefs.active as keyof DashPrefs['overrides']]}>
            ↺
          </button>
          <button className="primary" onClick={() => setGallery(true)}>
            ＋ {t('dash.add.button')}
          </button>
        </div>
      </header>

      <div className="dash-filters" role="toolbar" aria-label={t('dash.filters.period')}>
        <div className="segmented" role="group" aria-label={t('dash.filters.period')}>
          {PERIODS.map((p) => (
            <button key={p} className={period === p ? 'active' : ''} aria-pressed={period === p} onClick={() => (setCustom(null), setPrefs((x) => ({ ...x, period: p })))}>
              {t(PERIOD_LABEL[p] as never)}
            </button>
          ))}
        </div>
        <label className="dash-date">
          <span>{t('dash.filters.from')}</span>
          <input type="date" value={custom?.from ?? (filters.from ? isoDay(filters.from) : '')} max={custom?.to || undefined} onChange={(e) => setCustom({ from: e.target.value, to: custom?.to ?? (filters.to ? isoDay(filters.to) : '') })} />
        </label>
        <label className="dash-date">
          <span>{t('dash.filters.to')}</span>
          <input type="date" value={custom?.to ?? (filters.to ? isoDay(filters.to) : '')} min={custom?.from || undefined} onChange={(e) => setCustom({ from: custom?.from ?? (filters.from ? isoDay(filters.from) : ''), to: e.target.value })} />
        </label>
        <PeoplePicker ds={ds} selected={people} onChange={setPeople} />
        <div className="segmented" role="group" aria-label={t('dash.filters.scope')} title={t('dash.filters.scope')}>
          <button className={prefs.scope === 'all' ? 'active' : ''} aria-pressed={prefs.scope === 'all'} onClick={() => setPrefs((p) => ({ ...p, scope: 'all' }))}>
            {t('dash.filters.scopeAll')}
          </button>
          <button className={prefs.scope === 'head' ? 'active' : ''} aria-pressed={prefs.scope === 'head'} onClick={() => setPrefs((p) => ({ ...p, scope: 'head' }))}>
            {t('dash.filters.scopeHead')}
          </button>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.includeMerges} onChange={(e) => setPrefs((p) => ({ ...p, includeMerges: e.target.checked }))} /> {t('dash.filters.merges')}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.excludeBots} onChange={(e) => setPrefs((p) => ({ ...p, excludeBots: e.target.checked }))} /> {t('dash.filters.bots')}
        </label>
        {filtersActive && (
          <button className="link" onClick={clearFilters}>
            {t('dash.filters.clear')}
          </button>
        )}
        <span className="toolbar-spacer" />
        {ctx && (
          <span className="dash-summary muted small">
            {t('history.count', { count: ctx.cs.length })} · {t('dash.peopleCount', { count: ctx.people.length })}
            {ctx.cs.length > 0 && ` · ${shortDate(ctx.range.from)} → ${shortDate(ctx.range.to)}`}
          </span>
        )}
      </div>

      {analytics?.truncated && <p className="dash-banner">{t('dash.truncated', { count: int(analytics.commits.length) })}</p>}
      {error && <p className="dash-banner error">{t('dash.error', { error })}</p>}

      <LoadingOverlay active={loading && !!ctx} label={t('dash.loading')} className="loading-fill">
        <div className="dash-scroll">
          {!ctx ? (
            loading ? <LoaderPane label={t('dash.loading')} /> : <p className="dash-loading" />
          ) : ds && ds.commits.length === 0 ? (
            <p className="dash-loading">{t('dash.emptyRepo')}</p>
          ) : (
            <>
              {ctx.cs.length === 0 && (
                <p className="dash-banner">
                  {t('dash.emptyFilters')}{' '}
                  <button className="link" onClick={clearFilters}>
                    {t('dash.filters.clear')}
                  </button>
                </p>
              )}
              {widgets.length === 0 ? (
                <div className="dash-loading">
                  <p>{t('dash.add.empty')}</p>
                  <button className="primary" onClick={() => setGallery(true)}>
                    ＋ {t('dash.add.button')}
                  </button>
                </div>
              ) : (
                <div className="dash-grid">
                  {widgets.map((inst) => (
                    <WidgetCard key={inst.uid} inst={inst} ctx={ctx} list={widgets} onChange={setWidgets} span={spanOf(inst.cols ?? WIDGET_BY_ID.get(inst.widget)!.cols)} narrow={narrow || medium} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </LoadingOverlay>

      {gallery && (
        <Gallery
          onClose={() => setGallery(false)}
          onAdd={(id) => {
            setWidgets(addWidget(widgets, id))
            toast('success', t('dash.add.added'))
          }}
        />
      )}
    </div>
  )
}

const isoDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Escolha de pessoas: lista com busca e caixas de seleção. */
function PeoplePicker({ ds, selected, onChange }: { ds: ReturnType<typeof buildDataset> | null; selected: string[]; onChange(next: string[]): void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  const list = (ds?.people ?? []).filter((p) => !query || `${p.name} ${p.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80)
  return (
    <div className="dash-people" ref={ref}>
      <button className={selected.length ? 'active' : ''} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        {selected.length ? t('dash.filters.peopleSelected', { count: selected.length }) : t('dash.filters.allPeople')} ▾
      </button>
      {open && (
        <div className="dash-popover" role="listbox" aria-multiselectable>
          <input autoFocus placeholder={t('dash.filters.searchPerson')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul>
            {list.map((p) => (
              <li key={p.id}>
                <label className="checkbox">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => onChange(selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id])} />
                  <i className="dot" style={{ background: seriesColor(p.slot) }} aria-hidden />
                  <span className="dash-person">{p.name}</span>
                  <span className="muted small">{compact(p.commits)}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <button className="link" onClick={() => onChange([])}>
              {t('dash.filters.clearPeople')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Galeria para escolher qualquer um dos gráficos e adicioná-lo ao dashboard. */
function Gallery({ onClose, onAdd }: { onClose(): void; onAdd(widget: string): void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<WidgetCategory | 'all'>('all')
  const q = query.trim().toLowerCase()
  const items = WIDGETS.filter((w) => (category === 'all' || w.category === category) && (!q || `${tk(`dash.w.${w.id}`)} ${tk(`dash.wd.${w.id}`)}`.toLowerCase().includes(q)))
  return (
    <Modal title={t('dash.add.title')} onClose={onClose} size="large" id="dash.gallery">
      <div className="dash-gallery">
        <div className="dash-gallery-bar">
          <input autoFocus placeholder={t('dash.add.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="segmented wrap" role="group">
            <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>
              {t('dash.add.all')}
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
                {tk(`dash.categories.${c}`)}
              </button>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="muted">{t('dash.add.none')}</p>
        ) : (
          <ul className="dash-gallery-list">
            {items.map((w) => (
              <li key={w.id}>
                <button className="dash-gallery-item" onClick={() => onAdd(w.id)}>
                  <span className="dash-gallery-cat">{tk(`dash.categories.${w.category}`)}</span>
                  <strong>{tk(`dash.w.${w.id}`)}</strong>
                  <span className="muted small">{tk(`dash.wd.${w.id}`)}</span>
                  <span className="dash-gallery-views">{w.views.map((v) => tk(`dash.views.${v}`)).join(' · ')}</span>
                  <span className="dash-gallery-add">＋ {t('dash.add.button')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
