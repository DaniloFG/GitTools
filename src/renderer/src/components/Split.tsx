import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AppContext } from '../context'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import {
  clampSize,
  crossingAt,
  dockSplit,
  parseSplitState,
  rotateSplit,
  sideAt,
  stateFromPosition,
  swapSplit,
  type CollapsedPane,
  type DockSide,
  type SplitDirection,
  type SplitState
} from '../panes'
import { t } from '../i18n'

const KEY_STEP = 16
const KEY_STEP_LARGE = 80

interface Props {
  /** Nome sob o qual o tamanho escolhido fica guardado. */
  id: string
  direction?: SplitDirection
  /** Tamanho padrão do primeiro painel: fração do espaço (0–1) ou pixels quando `fixed`. */
  initial: number
  /** Guarda o primeiro painel em pixels (barras laterais) em vez de fração do espaço. */
  fixed?: boolean
  /** Tamanho mínimo de cada painel, em pixels. */
  min?: [number, number]
  /** Quais painéis podem ser recolhidos pela divisória. */
  collapsible?: [boolean, boolean]
  /**
   * Permite ao usuário trocar os painéis de lugar e girar a divisória (lado a lado ↔ em cima e embaixo).
   * Desligado só onde o próprio componente cuida do arranjo (ex.: editor de conflitos).
   */
  arrangeable?: boolean
  /** Nome de cada painel, mostrado na alça de arrasto. */
  labels?: [string, string]
  className?: string
  children: [ReactNode, ReactNode]
}

/** Arrasto de uma divisória em andamento. */
interface DragSession {
  move(event: PointerEvent): void
  end(): void
}

/** Cada divisória na tela sabe começar o próprio arrasto (para mover várias juntas num cruzamento). */
const dividers = new WeakMap<HTMLElement, () => DragSession>()

/** Divisórias perpendiculares a `el` que passam pelo ponto (x, y). */
function crossingDividers(el: HTMLElement, vertical: boolean, x: number, y: number): (() => DragSession)[] {
  const others = [...document.querySelectorAll<HTMLElement>('.split-divider')].flatMap((other) => {
    const begin = other !== el ? dividers.get(other) : undefined
    if (!begin || other.offsetParent === null) return []
    const rect = other.getBoundingClientRect()
    return [{ item: begin, vertical: other.getAttribute('aria-orientation') === 'vertical', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
  })
  return crossingAt(x, y, vertical, others)
}

const layoutKey = (id: string) => `split.${id}`

/**
 * Quantas divisórias arrumáveis envolvem um painel. As alças de painéis aninhados ficam deslocadas
 * para não caírem uma em cima da outra quando os painéis começam no mesmo ponto.
 */
const DepthContext = createContext(0)
const GRIP_OFFSET = 56

/** Só o arranjo (troca de lugar e direção), sem tamanho nem painel recolhido. */
const arrangementOf = ({ swapped, direction }: SplitState): SplitState => ({ swapped, direction })

/**
 * Dois painéis separados por uma divisória que o usuário arrasta, recolhe ou restaura (duplo clique).
 * Os painéis também podem trocar de lugar e ficar lado a lado ou um em cima do outro; tudo fica guardado.
 * Onde duas divisórias se cruzam, arrastar o cruzamento redimensiona as duas de uma vez.
 */
export function Split({
  id,
  direction: defaultDirection = 'row',
  initial,
  fixed = false,
  min = [160, 160],
  collapsible = [true, true],
  arrangeable = true,
  labels,
  className = '',
  children
}: Props) {
  const app = useContext(AppContext)
  const depth = useContext(DepthContext)
  /** Painel sendo arrastado e lado onde ele seria solto. */
  const [docking, setDocking] = useState<{ pane: CollapsedPane; side: DockSide | null } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useLayout<SplitState>(layoutKey(id), parseSplitState)
  /** Largura disponível: lado a lado sem espaço (ex.: a aba levada para uma área estreita) vira um em cima do outro. */
  const [width, setWidth] = useState(Infinity)
  const narrow = arrangeable && defaultDirection === 'row' && !state.direction && width < min[0] + min[1] + 40
  const direction = arrangeable ? (state.direction ?? (narrow ? 'column' : defaultDirection)) : defaultDirection
  const row = direction === 'row'
  const swapped = arrangeable && !!state.swapped
  const [total, setTotal] = useState(0)
  /** Espessura da divisória (configurável), descontada do espaço dos painéis. */
  const [dividerSize, setDividerSize] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [crossing, setCrossing] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      setWidth(el.clientWidth)
      setTotal(row ? el.clientWidth : el.clientHeight)
      const divider = dividerRef.current
      if (divider) setDividerSize(row ? divider.offsetWidth : divider.offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (dividerRef.current) observer.observe(dividerRef.current)
    return () => observer.disconnect()
  }, [row])

  const available = Math.max(0, total - dividerSize)
  const size = state.size ?? initial
  const collapsed = state.collapsed
  // `px` e `size` sempre se referem ao primeiro filho, esteja ele antes ou depois da divisória.
  const px = clampSize(fixed ? size : size * available, available, min[0], min[1])
  const limits = { available, min, collapsible, fixed }
  /** Qual painel (primeiro ou segundo filho) aparece antes da divisória na tela. */
  const before: CollapsedPane = swapped ? 'second' : 'first'
  const after: CollapsedPane = swapped ? 'first' : 'second'
  const canCollapse = (pane: CollapsedPane) => collapsible[pane === 'first' ? 0 : 1]

  const firstStyle: CSSProperties = {
    order: swapped ? 2 : 0,
    ...(collapsed === 'first'
      ? { display: 'none' }
      : collapsed === 'second'
        ? { flex: '1 1 0' }
        : { flex: `0 0 ${total ? `${px}px` : fixed ? `${size}px` : `${size * 100}%`}` })
  }
  const secondStyle: CSSProperties = { order: swapped ? 0 : 2, ...(collapsed === 'second' ? { display: 'none' } : { flex: '1 1 0' }) }

  /** Começa a arrastar esta divisória (também chamado pelas divisórias que a cruzam). */
  const begin = (): DragSession => {
    const el = ref.current!
    const rect = el.getBoundingClientRect()
    const rtl = row && getComputedStyle(el).direction === 'rtl'
    const space = Math.max(0, (row ? rect.width : rect.height) - dividerSize)
    setDragging(true)
    return {
      move: (event) => {
        const pos = row ? (rtl ? rect.right - event.clientX : event.clientX - rect.left) : event.clientY - rect.top
        // Com os painéis trocados, o primeiro filho fica depois da divisória.
        const first = swapped ? space - pos : pos
        setState((prev) => stateFromPosition(first, prev, { ...limits, available: space }))
      },
      end: () => setDragging(false)
    }
  }
  const beginRef = useRef(begin)
  beginRef.current = begin

  useLayoutEffect(() => {
    const el = dividerRef.current
    if (!el) return
    dividers.set(el, () => beginRef.current())
    return () => {
      dividers.delete(el)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !ref.current || !dividerRef.current) return
    const others = crossingDividers(dividerRef.current, row, e.clientX, e.clientY)
    const sessions = [begin(), ...others.map((start) => start())]
    startResize(
      e,
      others.length ? 'move' : row ? 'col-resize' : 'row-resize',
      (event) => sessions.forEach((s) => s.move(event)),
      () => sessions.forEach((s) => s.end())
    )
  }

  // Sobre um cruzamento de divisórias, o cursor mostra que dá para arrastar nas duas direções.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons || !dividerRef.current) return
    const next = !(e.target as HTMLElement).closest('button') && crossingDividers(dividerRef.current, row, e.clientX, e.clientY).length > 0
    if (next !== crossing) setCrossing(next)
  }

  /** Volta ao tamanho padrão, mantendo o lugar e a direção escolhidos. */
  const resetSize = () => setState((prev) => arrangementOf(prev))

  const onKeyDown = (e: React.KeyboardEvent) => {
    const forward = row ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
    if (e.key === 'Enter') {
      e.preventDefault()
      return resetSize()
    }
    if (!forward.includes(e.key)) return
    e.preventDefault()
    const rtl = row && !!ref.current && getComputedStyle(ref.current).direction === 'rtl'
    // Sentido em que a divisória anda na tela (+1 = direita/baixo).
    let sign = e.key === forward[0] ? 1 : -1
    if (rtl) sign = -sign
    // Num painel recolhido, a seta para o lado oposto o mostra de novo.
    if ((collapsed === before && sign > 0) || (collapsed === after && sign < 0)) return setState((prev) => ({ ...prev, collapsed: undefined }))
    if (collapsed) return
    const step = (e.shiftKey ? KEY_STEP_LARGE : KEY_STEP) * sign * (swapped ? -1 : 1)
    setState((prev) => stateFromPosition(px + step, prev, limits))
  }

  const toStart = collapsed === after || (!collapsed && canCollapse(before))
  const toEnd = collapsed === before || (!collapsed && canCollapse(after))
  const buttonTitle = collapsed ? t('layout.showPanel') : t('layout.hidePanel')
  const swap = () => setState((prev) => swapSplit(prev))
  const rotate = () => setState((prev) => rotateSplit(prev, defaultDirection))

  const onContextMenu = (e: React.MouseEvent) => {
    if (!app) return
    app.showMenu(e, [
      ...(arrangeable
        ? [
            { label: `${row ? '⇄' : '⇅'} ${t('layout.swapPanels')}`, onClick: swap },
            { label: `⟲ ${row ? t('layout.stackPanels') : t('layout.sideBySide')}`, onClick: rotate },
            'separator' as const
          ]
        : []),
      { label: t('layout.defaultSize'), onClick: resetSize },
      ...(arrangeable ? [{ label: t('layout.defaultArrangement'), onClick: () => setState(undefined) }] : [])
    ])
  }

  const percent = available ? Math.round(((swapped ? available - px : px) / available) * 100) : 50

  /**
   * Arrastar a alça de um painel: um destaque mostra em que lado ele vai ficar (esquerda, direita,
   * em cima ou embaixo do outro painel); ao soltar, o arranjo muda.
   */
  const startDock = (e: React.PointerEvent, pane: CollapsedPane) => {
    const el = ref.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const rtl = getComputedStyle(el).direction === 'rtl'
    const x0 = e.clientX
    const y0 = e.clientY
    let side: DockSide | null = null
    setDocking({ pane, side: null })
    document.body.classList.add('docking')
    const move = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - x0, event.clientY - y0) < 6) return
      side = sideAt(event.clientX, event.clientY, el.getBoundingClientRect())
      setDocking({ pane, side })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('docking')
      setDocking(null)
      if (side) {
        const chosen = side
        setState((prev) => dockSplit(prev, pane, chosen, defaultDirection, rtl))
      }
    }
    const cancel = () => {
      side = null
      end()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
  }

  const grip = (pane: CollapsedPane) =>
    arrangeable && collapsed !== pane ? (
      <button
        className="pane-grip"
        style={{ insetInlineStart: `calc(50% - 22px + ${depth * GRIP_OFFSET}px)` }}
        title={`${labels ? `${labels[pane === 'first' ? 0 : 1]} — ` : ''}${t('workbench.dragPanel')}`}
        aria-label={t('workbench.dragPanel')}
        onPointerDown={(e) => startDock(e, pane)}
        onContextMenu={onContextMenu}
      >
        ⠿
      </button>
    ) : null

  return (
    <div ref={ref} className={`split split-${direction} ${className}`}>
      <div className="split-pane" style={firstStyle}>
        {grip('first')}
        <DepthContext.Provider value={arrangeable ? depth + 1 : depth}>{children[0]}</DepthContext.Provider>
      </div>
      <div
        ref={dividerRef}
        className={`split-divider ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''} ${crossing ? 'crossing' : ''}`}
        style={{ order: 1 }}
        role="separator"
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={collapsed === before ? 0 : collapsed === after ? 100 : percent}
        tabIndex={0}
        title={t('layout.resize')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setCrossing(false)}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && resetSize()}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
      >
        <div className="split-divider-buttons">
          {toStart && (
            <button
              tabIndex={-1}
              title={buttonTitle}
              onClick={() => setState((prev) => ({ ...prev, collapsed: prev.collapsed === after ? undefined : before }))}
            >
              {row ? '◂' : '▴'}
            </button>
          )}
          {toEnd && (
            <button
              tabIndex={-1}
              title={buttonTitle}
              onClick={() => setState((prev) => ({ ...prev, collapsed: prev.collapsed === before ? undefined : after }))}
            >
              {row ? '▸' : '▾'}
            </button>
          )}
        </div>
      </div>
      <div className="split-pane" style={secondStyle}>
        {grip('second')}
        <DepthContext.Provider value={arrangeable ? depth + 1 : depth}>{children[1]}</DepthContext.Provider>
      </div>
      {docking?.side && (
        <div className={`dock-preview dock-${docking.side}`} aria-hidden>
          <span>{t(`workbench.side.${docking.side}`)}</span>
        </div>
      )}
    </div>
  )
}
