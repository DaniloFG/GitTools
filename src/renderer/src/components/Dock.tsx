import { Fragment, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AppContext } from '../context'
import {
  activateView,
  groupsOf,
  hideIn,
  inScreen,
  logicalSide,
  moveView,
  resizePair,
  screenOf,
  setSizes,
  shownTree,
  zoneAt,
  type DockNode,
  type DockState,
  type DropTarget,
  type ScreenId,
  type ShownGroup,
  type ShownNode,
  type ShownSplit,
  type Side,
  type ViewId
} from '../dock'
import { t } from '../i18n'
import { startResize } from '../resize'
import { slotRef } from '../slots'

export interface ViewMeta {
  label: string
  /** Número mostrado ao lado do nome (ex.: alterações pendentes). */
  badge?: number
  /** Dica mostrada ao parar o mouse sobre a aba. */
  help?: string
}

/** Faixa junto às bordas da janela onde soltar um painel o encaixa naquele lado. */
const EDGE = 28
const THRESHOLD = 5
/** Menor tamanho a que arrastar uma divisória leva um painel. */
const MIN_WIDTH = 140
const MIN_HEIGHT = 80
/** Em janelas muito pequenas os painéis encolhem até este tamanho, todos juntos, em vez de sair da tela. */
const SQUEEZE_WIDTH = 48
const SQUEEZE_HEIGHT = 40
const KEY_STEP = 16

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** O que está sob o ponteiro durante o arrasto de uma aba. */
interface Hit {
  target: DropTarget
  rect: Rect
  /** Traço fino entre duas abas (inserção) em vez da área inteira. */
  line?: boolean
  label?: string
}

const SIDE_LABEL: Record<Side, Parameters<typeof t>[0]> = {
  left: 'workbench.side.left',
  right: 'workbench.side.right',
  top: 'workbench.side.top',
  bottom: 'workbench.side.bottom'
}

/** Metade do retângulo do lado `side` (a parte que o painel solto passaria a ocupar). */
function halfOf(rect: Rect, side: Side): Rect {
  const w = rect.width / 2
  const h = rect.height / 2
  if (side === 'left') return { left: rect.left, top: rect.top, width: w, height: rect.height }
  if (side === 'right') return { left: rect.left + w, top: rect.top, width: w, height: rect.height }
  if (side === 'top') return { left: rect.left, top: rect.top, width: rect.width, height: h }
  return { left: rect.left, top: rect.top + h, width: rect.width, height: h }
}

interface DockProps {
  state: DockState
  onChange(next: DockState): void
  /** Tela aberta: só aparecem os painéis dela e os fixados nela. */
  screen: ScreenId
  meta: Record<ViewId, ViewMeta>
  /** Painéis que existem agora (ex.: Conflitos só quando há conflitos; Staged só na visão de listas separadas). */
  available(view: ViewId): boolean
}

/**
 * A janela em painéis livres, como num editor moderno: cada painel é uma aba num grupo, e os grupos ficam
 * lado a lado ou um sobre o outro. Arraste uma aba para o meio de outro painel (vira aba dele), para junto
 * de uma borda dele (divide o painel nesse lado) ou para a borda da janela — qualquer painel em qualquer
 * lugar. O conteúdo de cada painel é levado até o lugar dele por `PaneSlot` (ver slots.tsx).
 */
export function Dock({ state, onChange: change, screen, meta, available }: DockProps) {
  const app = useContext(AppContext)
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ view: ViewId; hit: Hit | null } | null>(null)
  /** Grupo que ocupa a janela toda (null = todos à vista). Não é guardado: o arranjo continua o mesmo. */
  const [maximized, setMaximized] = useState<string | null>(null)
  const latest = useRef(state)
  latest.current = state
  /** Só grava quando o arranjo mudou de fato (clicar na aba que já está à frente não muda nada). */
  const onChange = (next: DockState) => {
    if (next !== latest.current) change(next)
  }

  const isShown = (view: ViewId) => available(view) && inScreen(state, view, screen)
  const tree = shownTree(state, isShown)

  const maximizedGroup = maximized && tree ? findShownGroup(tree, maximized) : null
  // O painel ampliado volta ao tamanho de antes quando ele some ou quando outro painel passa à frente (ex.: um atalho de tela).
  const othersFront = tree && maximized ? frontViews(tree, maximized).join() : ''
  const seenOthers = useRef<string | null>(null)
  useEffect(() => {
    if (!maximized) seenOthers.current = null
    else if (!maximizedGroup) setMaximized(null)
    else if (seenOthers.current === null) seenOthers.current = othersFront
    else if (seenOthers.current !== othersFront) setMaximized(null)
  }, [maximized, maximizedGroup, othersFront])

  // Quando uma aba passa à frente de fora (ex.: ao trazer uma tela), garante que ela apareça na barra de abas.
  const fronts = tree ? frontViews(tree).join() : ''
  useEffect(() => {
    for (const tab of rootRef.current?.querySelectorAll<HTMLElement>('.dock-tab.active') ?? []) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [fronts])

  /** Calcula o destino sob o ponteiro: entre abas, junto de uma borda da janela ou dentro de um painel. */
  const hitAt = (x: number, y: number): Hit | null => {
    const root = rootRef.current
    if (!root) return null
    const box = root.getBoundingClientRect()
    const rtl = getComputedStyle(root).direction === 'rtl'

    for (const bar of root.querySelectorAll<HTMLElement>('[data-group-tabs]')) {
      const r = bar.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const group = bar.dataset.groupTabs!
      const tabs = [...bar.querySelectorAll<HTMLElement>('[data-view]')]
      let at = tabs.findIndex((tab) => {
        const tr = tab.getBoundingClientRect()
        const middle = tr.left + tr.width / 2
        return rtl ? x > middle : x < middle
      })
      if (at < 0) at = tabs.length
      // O índice é o da lista guardada do grupo, que também tem as abas escondidas.
      const views = groupsOf(latest.current.root).find((g) => g.id === group)?.views ?? []
      const index = tabs[at] ? views.indexOf(tabs[at].dataset.view as ViewId) : views.length
      const ref = tabs[at] ?? tabs[tabs.length - 1]
      const tr = ref?.getBoundingClientRect()
      const lineX = !tr ? r.left + 4 : tabs[at] ? (rtl ? tr.right : tr.left) : rtl ? tr.left : tr.right
      return { target: { kind: 'tabs', group, index }, rect: { left: lineX - 2, top: r.top + 3, width: 4, height: r.height - 6 }, line: true }
    }

    const strip = (side: Side): Hit => {
      const width = box.width * 0.25
      const height = box.height * 0.3
      const rect: Rect =
        side === 'left'
          ? { left: box.left, top: box.top, width, height: box.height }
          : side === 'right'
            ? { left: box.right - width, top: box.top, width, height: box.height }
            : { left: box.left, top: box.bottom - height, width: box.width, height }
      return { target: { kind: 'edge', side: logicalSide(side, rtl) }, rect, label: t(SIDE_LABEL[side]) }
    }
    if (x < box.left + EDGE) return strip('left')
    if (x > box.right - EDGE) return strip('right')
    if (y > box.bottom - EDGE) return strip('bottom')

    for (const body of root.querySelectorAll<HTMLElement>('[data-group]')) {
      const r = body.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const group = body.dataset.group!
      const rect: Rect = { left: r.left, top: r.top, width: r.width, height: r.height }
      const zone = zoneAt(x, y, rect)
      if (zone === 'center') return { target: { kind: 'tabs', group }, rect, label: t('workbench.dropTabs') }
      return { target: { kind: 'split', group, side: logicalSide(zone, rtl) }, rect: halfOf(rect, zone), label: t(SIDE_LABEL[zone]) }
    }
    return null
  }

  const startTabDrag = (e: ReactPointerEvent, view: ViewId) => {
    if (e.button !== 0) return
    const x0 = e.clientX
    const y0 = e.clientY
    let active = false
    let hit: Hit | null = null
    const move = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - x0, event.clientY - y0) < THRESHOLD) return
        active = true
        document.body.classList.add('docking')
      }
      hit = hitAt(event.clientX, event.clientY)
      setDrag({ view, hit })
    }
    const end = (drop: boolean) => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      if (!active) return
      document.body.classList.remove('docking')
      setDrag(null)
      if (drop && hit) onChange(moveView(latest.current, view, hit.target))
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
    // Esc cancela o arrasto sem mover nada.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !active) return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /** Menu da aba: as mesmas mudanças do arrastar, para quem não arrasta. */
  const tabMenu = (e: React.MouseEvent, view: ViewId, groupId: string, lonely: boolean) => {
    const sides: Side[] = ['left', 'right', 'top', 'bottom']
    app?.showMenu(e, [
      {
        label: t('workbench.splitMenu'),
        disabled: lonely,
        submenu: sides.map((side) => ({ label: t(SIDE_LABEL[side]), onClick: () => onChange(moveView(latest.current, view, { kind: 'split', group: groupId, side })) }))
      },
      {
        label: t('workbench.edgeMenu'),
        submenu: sides.map((side) => ({ label: t(SIDE_LABEL[side]), onClick: () => onChange(moveView(latest.current, view, { kind: 'edge', side })) }))
      },
      'separator',
      { label: maximized === groupId ? t('workbench.restoreSize') : t('workbench.maximize'), onClick: () => setMaximized(maximized === groupId ? null : groupId) },
      // Num painel de outra tela (fixado aqui), "ocultar" é deixar de fixá-lo nesta tela.
      { label: t('workbench.hide'), onClick: () => onChange(hideIn(latest.current, view, screen)) },
      { label: t('workbench.resetLayout'), onClick: () => void app.resetLayout() }
    ])
  }

  const renderGroup = (node: ShownGroup) => (
    <section className="dock-group">
      <div className="dock-tabbar">
        <nav className="dock-tabs" data-group-tabs={node.id} title={t('workbench.tabsHelp')} role="tablist">
          {node.views.map((view) => (
            <button
              key={view}
              data-view={view}
              role="tab"
              aria-selected={view === node.active}
              className={`dock-tab ${view === node.active ? 'active' : ''} ${drag?.view === view ? 'dragging' : ''} ${screenOf(view) !== screen ? 'foreign' : ''}`}
              onPointerDown={(e) => startTabDrag(e, view)}
              onClick={() => onChange(activateView(latest.current, view))}
              onDoubleClick={() => setMaximized(maximized === node.id ? null : node.id)}
              onContextMenu={(e) => tabMenu(e, view, node.id, node.views.length === 1)}
              title={meta[view].help}
            >
              {meta[view].label}
              {!!meta[view].badge && <span className="badge">{meta[view].badge}</span>}
            </button>
          ))}
        </nav>
        <button
          className="dock-maximize"
          onClick={() => setMaximized(maximized === node.id ? null : node.id)}
          title={maximized === node.id ? t('workbench.restoreSize') : t('workbench.maximize')}
          aria-label={maximized === node.id ? t('workbench.restoreSize') : t('workbench.maximize')}
          aria-pressed={maximized === node.id}
        >
          {maximized === node.id ? '⤡' : '⤢'}
        </button>
      </div>
      <div className="dock-body" data-group={node.id}>
        <div key={node.active} className="dock-slot" data-slot={node.active} ref={slotRef(node.active)} />
      </div>
    </section>
  )

  /** Arrastar a divisória entre dois filhos: os dois dividem entre si o espaço que já tinham. */
  const startDividerDrag = (e: ReactPointerEvent<HTMLDivElement>, node: ShownSplit, i: number) => {
    const divider = e.currentTarget
    const prev = divider.previousElementSibling as HTMLElement | null
    const next = divider.nextElementSibling as HTMLElement | null
    if (!prev || !next) return
    const row = node.dir === 'row'
    const size = (el: HTMLElement) => (row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)
    const [sa, sb] = [size(prev), size(next)]
    const rtl = row && getComputedStyle(divider).direction === 'rtl'
    const start = latest.current
    startResize(e, row ? 'col-resize' : 'row-resize', (_event, dx, dy) => {
      onChange(withPair(start, node, i, row ? (rtl ? -dx : dx) : dy, sa, sb))
    })
  }

  const dividerKeys = (e: KeyboardEvent<HTMLDivElement>, node: ShownSplit, i: number) => {
    const row = node.dir === 'row'
    const keys = row ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const divider = e.currentTarget
    if (!keys.includes(e.key) && e.key !== 'Enter') return
    e.preventDefault()
    const prev = divider.previousElementSibling as HTMLElement
    const next = divider.nextElementSibling as HTMLElement
    const size = (el: HTMLElement) => (row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height)
    const rtl = row && getComputedStyle(divider).direction === 'rtl'
    if (e.key === 'Enter') return onChange(withPair(latest.current, node, i, (size(next) - size(prev)) / 2, size(prev), size(next)))
    let delta = (e.key === keys[1] ? 1 : -1) * (e.shiftKey ? KEY_STEP * 5 : KEY_STEP)
    if (rtl) delta = -delta
    onChange(withPair(latest.current, node, i, delta, size(prev), size(next)))
  }

  const renderNode = (node: ShownNode): React.ReactNode => {
    if (node.kind === 'group') return renderGroup(node)
    const row = node.dir === 'row'
    return (
      <div className={`dock-split dock-${node.dir}`}>
        {node.children.map((child, i) => {
          const style: CSSProperties = { flex: `${child.weight} 1 0px`, [row ? 'minWidth' : 'minHeight']: row ? SQUEEZE_WIDTH : SQUEEZE_HEIGHT }
          return (
            <Fragment key={child.node.id}>
              {i > 0 && (
                <div
                  className="dock-divider"
                  role="separator"
                  aria-orientation={row ? 'vertical' : 'horizontal'}
                  tabIndex={0}
                  title={t('layout.resize')}
                  onPointerDown={(e) => startDividerDrag(e, node, i)}
                  onKeyDown={(e) => dividerKeys(e, node, i)}
                  onDoubleClick={(e) => {
                    const el = e.currentTarget
                    const prev = el.previousElementSibling as HTMLElement
                    const next = el.nextElementSibling as HTMLElement
                    const size = (x: HTMLElement) => (row ? x.getBoundingClientRect().width : x.getBoundingClientRect().height)
                    onChange(withPair(latest.current, node, i, (size(next) - size(prev)) / 2, size(prev), size(next)))
                  }}
                />
              )}
              <div className="dock-cell" style={style}>
                {renderNode(child.node)}
              </div>
            </Fragment>
          )
        })}
      </div>
    )
  }

  return (
    <div className="dock" ref={rootRef}>
      {tree ? (
        renderNode(maximizedGroup ?? tree)
      ) : (
        <div className="dock-empty">
          <p className="empty">{t('workbench.allHidden')}</p>
          <button onClick={() => void app?.resetLayout()}>{t('workbench.resetLayout')}</button>
        </div>
      )}
      {drag?.hit && (
        <div
          className={`dock-indicator ${drag.hit.line ? 'line' : ''}`}
          style={{ left: drag.hit.rect.left, top: drag.hit.rect.top, width: drag.hit.rect.width, height: drag.hit.rect.height }}
          aria-hidden
        >
          {!drag.hit.line && drag.hit.label && <span>{drag.hit.label}</span>}
        </div>
      )}
    </div>
  )
}

function findShownGroup(node: ShownNode, id: string): ShownGroup | null {
  if (node.kind === 'group') return node.id === id ? node : null
  for (const child of node.children) {
    const found = findShownGroup(child.node, id)
    if (found) return found
  }
  return null
}

/** Abas que estão à frente em cada grupo (para saber quando alguma mudou), menos as do grupo `except`. */
function frontViews(node: ShownNode, except?: string): ViewId[] {
  return node.kind === 'group' ? (node.id === except ? [] : [node.active]) : node.children.flatMap((c) => frontViews(c.node, except))
}

/** Novo arranjo depois de a divisória entre os filhos `i - 1` e `i` andar `delta` pixels. */
function withPair(state: DockState, node: ShownSplit, i: number, delta: number, sizeA: number, sizeB: number): DockState {
  const [a, b] = [node.children[i - 1], node.children[i]]
  const min = node.dir === 'row' ? MIN_WIDTH : MIN_HEIGHT
  const [wa, wb] = resizePair(a.weight, b.weight, sizeA, sizeB, delta, min, min)
  const current = findSplit(state.root, node.id)
  if (!current) return state
  const sizes = [...current.sizes]
  sizes[a.index] = wa
  sizes[b.index] = wb
  return setSizes(state, node.id, sizes)
}

function findSplit(node: DockNode, id: string): Extract<DockNode, { kind: 'split' }> | null {
  if (node.kind === 'group') return null
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findSplit(child, id)
    if (found) return found
  }
  return null
}

