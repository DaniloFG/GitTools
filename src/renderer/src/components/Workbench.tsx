import { useContext, useState, type ReactNode } from 'react'
import { AppContext } from '../context'
import { t } from '../i18n'
import { useLayout } from '../layout'
import { activeView, AREA_IDS, moveView, parseWorkbench, type AreaId, type ViewId, type WorkbenchState } from '../workbench'
import { Split } from './Split'

export interface ViewDef {
  label: string
  /** Número mostrado ao lado do nome (ex.: alterações pendentes). */
  badge?: number
  /** Dica mostrada ao parar o mouse sobre a aba. */
  help?: string
  render(): ReactNode
}

/** Arranjo das áreas, guardado no layout (o botão "restaurar layout" volta ao padrão). */
export function useWorkbench() {
  return useLayout<WorkbenchState>('workbench', parseWorkbench)
}

/** Onde a aba arrastada seria solta. */
interface DropTarget {
  area: AreaId
  /** Posição entre as abas; ausente = no fim. */
  index?: number
  /** Retângulo destacado na tela (posição fixa). */
  rect: { left: number; top: number; width: number; height: number }
  /** Destaque fino entre duas abas (inserção) em vez da área inteira. */
  line?: boolean
}

/** Faixa junto à borda da janela que encaixa a aba na área daquele lado. */
const EDGE = 56
const THRESHOLD = 5

const AREA_LABELS: Record<AreaId, Parameters<typeof t>[0]> = {
  left: 'workbench.area.left',
  center: 'workbench.area.center',
  right: 'workbench.area.right',
  bottom: 'workbench.area.bottom'
}

/**
 * Janela em áreas (esquerda, centro, direita e embaixo), como no VS Code: cada área tem abas; arraste
 * uma aba para outra área, para a borda da janela ou entre outras abas para mudar o arranjo.
 */
export function Workbench({ state, onChange, views }: { state: WorkbenchState; onChange(next: WorkbenchState): void; views: Record<ViewId, ViewDef> }) {
  const app = useContext(AppContext)
  const [drag, setDrag] = useState<{ view: ViewId; target: DropTarget | null } | null>(null)

  /** Calcula o destino sob o ponteiro: entre abas, numa borda da janela ou numa área. */
  const targetAt = (x: number, y: number, workbench: DOMRect): DropTarget | null => {
    for (const bar of document.querySelectorAll<HTMLElement>('[data-area-tabs]')) {
      const r = bar.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const area = bar.dataset.areaTabs as AreaId
      const tabs = [...bar.querySelectorAll<HTMLElement>('[data-view]')]
      const rtl = getComputedStyle(bar).direction === 'rtl'
      let index = tabs.findIndex((tab) => {
        const tr = tab.getBoundingClientRect()
        const middle = tr.left + tr.width / 2
        return rtl ? x > middle : x < middle
      })
      if (index < 0) index = tabs.length
      const ref = tabs[index] ?? tabs[tabs.length - 1]
      const tr = ref?.getBoundingClientRect()
      const lineX = !tr ? r.left + 4 : tabs[index] ? (rtl ? tr.right : tr.left) : rtl ? tr.left : tr.right
      return { area, index, rect: { left: lineX - 2, top: r.top + 3, width: 4, height: r.height - 6 }, line: true }
    }
    const w = workbench
    // Em idiomas da direita para a esquerda a área "esquerda" (início) fica do lado direito da tela.
    const rtl = document.documentElement.dir === 'rtl'
    const start = { left: w.left, top: w.top, width: w.width * 0.22, height: w.height }
    const end = { left: w.right - w.width * 0.22, top: w.top, width: w.width * 0.22, height: w.height }
    if (x < w.left + EDGE) return rtl ? { area: 'right', rect: start } : { area: 'left', rect: start }
    if (x > w.right - EDGE) return rtl ? { area: 'left', rect: end } : { area: 'right', rect: end }
    if (y > w.bottom - EDGE) return { area: 'bottom', rect: { left: w.left, top: w.bottom - w.height * 0.3, width: w.width, height: w.height * 0.3 } }
    for (const el of document.querySelectorAll<HTMLElement>('[data-area]')) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { area: el.dataset.area as AreaId, rect: { left: r.left, top: r.top, width: r.width, height: r.height } }
      }
    }
    return null
  }

  const startTabDrag = (e: React.PointerEvent, view: ViewId) => {
    if (e.button !== 0) return
    const workbench = (e.currentTarget as HTMLElement).closest('.workbench')
    if (!workbench) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let target: DropTarget | null = null
    const move = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - x0, event.clientY - y0) < THRESHOLD) return
        active = true
        document.body.classList.add('docking')
      }
      target = targetAt(event.clientX, event.clientY, workbench.getBoundingClientRect())
      setDrag({ view, target })
    }
    const end = (drop: boolean) => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (!active) return
      document.body.classList.remove('docking')
      setDrag(null)
      if (drop && target) onChange(moveView(state, view, target.area, target.index))
      // O clique que vem depois de soltar não deve trocar de aba.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    }
    const onUp = end(true)
    const onCancel = end(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const tabMenu = (e: React.MouseEvent, view: ViewId, area: AreaId) =>
    app?.showMenu(e, [
      ...AREA_IDS.filter((a) => a !== area).map((a) => ({
        label: t('workbench.moveTo', { area: t(AREA_LABELS[a]) }),
        onClick: () => onChange(moveView(state, view, a))
      })),
      'separator',
      { label: t('workbench.resetLayout'), onClick: () => app.resetLayout() }
    ])

  const area = (id: AreaId) => {
    const list = state[id].views
    const current = activeView(state, id)
    return (
      <section className={`area area-${id}`} data-area={id}>
        <nav className="area-tabs" data-area-tabs={id} title={t('workbench.tabsHelp')}>
          {list.map((view) => (
            <button
              key={view}
              data-view={view}
              className={`area-tab ${view === current ? 'active' : ''} ${drag?.view === view ? 'dragging' : ''}`}
              onPointerDown={(e) => startTabDrag(e, view)}
              onClick={() => onChange({ ...state, [id]: { ...state[id], active: view } })}
              onContextMenu={(e) => tabMenu(e, view, id)}
              title={views[view].help}
            >
              {views[view].label}
              {!!views[view].badge && <span className="badge">{views[view].badge}</span>}
            </button>
          ))}
        </nav>
        <div className="area-body">{current ? views[current].render() : <p className="empty area-empty">{t('workbench.emptyArea')}</p>}</div>
      </section>
    )
  }

  const has = (id: AreaId) => state[id].views.length > 0
  const center = area('center')
  const middle = has('bottom') ? (
    <Split id="wb-bottom" direction="column" initial={0.74} min={[160, 80]} collapsible={[false, true]} arrangeable={false}>
      {center}
      {area('bottom')}
    </Split>
  ) : (
    center
  )
  const inner = has('right') ? (
    <Split id="wb-right" initial={0.62} min={[320, 200]} collapsible={[false, true]} arrangeable={false}>
      {middle}
      {area('right')}
    </Split>
  ) : (
    middle
  )

  return (
    <div className="workbench">
      {has('left') ? (
        <Split id="wb-left" className="workspace" fixed initial={260} min={[160, 360]} collapsible={[true, false]} arrangeable={false}>
          {area('left')}
          {inner}
        </Split>
      ) : (
        <div className="workspace">{inner}</div>
      )}
      {drag && (
        <>
          <div className="dock-edges" aria-hidden>
            {(['left', 'right', 'bottom'] as const).map((side) => (
              <span key={side} className={`dock-edge dock-edge-${side} ${drag.target?.area === side && !drag.target.line ? 'active' : ''}`}>
                <span>{t(AREA_LABELS[side])}</span>
              </span>
            ))}
          </div>
          {drag.target && (
            <div
              className={`dock-indicator ${drag.target.line ? 'line' : ''}`}
              style={{ left: drag.target.rect.left, top: drag.target.rect.top, width: drag.target.rect.width, height: drag.target.rect.height }}
            >
              {!drag.target.line && <span>{t('workbench.dropInto', { area: t(AREA_LABELS[drag.target.area]) })}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
