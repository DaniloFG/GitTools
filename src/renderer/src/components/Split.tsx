import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { readLayout, useLayout, writeLayout } from '../layout'
import { startResize } from '../resize'
import { clampSize, parseSplitState, stateFromPosition, type CollapsedPane, type SplitState } from '../panes'
import { t } from '../i18n'

const KEY_STEP = 16
const KEY_STEP_LARGE = 80

interface Props {
  /** Nome sob o qual o tamanho escolhido fica guardado. */
  id: string
  direction?: 'row' | 'column'
  /** Tamanho padrão do primeiro painel: fração do espaço (0–1) ou pixels quando `fixed`. */
  initial: number
  /** Guarda o primeiro painel em pixels (barras laterais) em vez de fração do espaço. */
  fixed?: boolean
  /** Tamanho mínimo de cada painel, em pixels. */
  min?: [number, number]
  /** Quais painéis podem ser recolhidos pela divisória. */
  collapsible?: [boolean, boolean]
  className?: string
  children: [ReactNode, ReactNode]
}

const layoutKey = (id: string) => `split.${id}`

/** Mostra ou esconde um painel de fora da divisória (ex.: atalho para a barra lateral). */
export function togglePane(id: string, pane: CollapsedPane) {
  const state = parseSplitState(readLayout(layoutKey(id)))
  writeLayout(layoutKey(id), { ...state, collapsed: state.collapsed === pane ? undefined : pane })
}

/** Dois painéis separados por uma divisória que o usuário arrasta, recolhe ou restaura (duplo clique). */
export function Split({ id, direction = 'row', initial, fixed = false, min = [160, 160], collapsible = [true, true], className = '', children }: Props) {
  const row = direction === 'row'
  const ref = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useLayout<SplitState>(layoutKey(id), parseSplitState)
  const [total, setTotal] = useState(0)
  /** Espessura da divisória (configurável), descontada do espaço dos painéis. */
  const [dividerSize, setDividerSize] = useState(1)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
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
  const px = clampSize(fixed ? size : size * available, available, min[0], min[1])
  const limits = { available, min, collapsible, fixed }

  const firstStyle: CSSProperties =
    collapsed === 'first'
      ? { display: 'none' }
      : collapsed === 'second'
        ? { flex: '1 1 0' }
        : { flex: `0 0 ${total ? `${px}px` : fixed ? `${size}px` : `${size * 100}%`}` }
  const secondStyle: CSSProperties = collapsed === 'second' ? { display: 'none' } : { flex: '1 1 0' }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rtl = row && getComputedStyle(el).direction === 'rtl'
    const space = Math.max(0, (row ? rect.width : rect.height) - dividerSize)
    setDragging(true)
    startResize(
      e,
      row ? 'col-resize' : 'row-resize',
      (event) => {
        const pos = row ? (rtl ? rect.right - event.clientX : event.clientX - rect.left) : event.clientY - rect.top
        setState((prev) => stateFromPosition(pos, prev, { ...limits, available: space }))
      },
      () => setDragging(false)
    )
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const forward = row ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
    if (e.key === 'Enter') {
      e.preventDefault()
      return setState(undefined)
    }
    if (!forward.includes(e.key)) return
    e.preventDefault()
    const rtl = row && !!ref.current && getComputedStyle(ref.current).direction === 'rtl'
    let sign = e.key === forward[0] ? 1 : -1
    if (rtl) sign = -sign
    // Num painel recolhido, a seta para o lado oposto o mostra de novo.
    if ((collapsed === 'first' && sign > 0) || (collapsed === 'second' && sign < 0)) return setState((prev) => ({ ...prev, collapsed: undefined }))
    if (collapsed) return
    const step = (e.shiftKey ? KEY_STEP_LARGE : KEY_STEP) * sign
    setState((prev) => stateFromPosition(px + step, prev, limits))
  }

  const toStart = collapsed === 'second' || (!collapsed && collapsible[0])
  const toEnd = collapsed === 'first' || (!collapsed && collapsible[1])
  const buttonTitle = collapsed ? t('layout.showPanel') : t('layout.hidePanel')

  return (
    <div ref={ref} className={`split split-${direction} ${className}`}>
      <div className="split-pane" style={firstStyle}>
        {children[0]}
      </div>
      <div
        ref={dividerRef}
        className={`split-divider ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''}`}
        role="separator"
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={collapsed === 'first' ? 0 : collapsed === 'second' ? 100 : available ? Math.round((px / available) * 100) : 50}
        tabIndex={0}
        title={t('layout.resize')}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && setState(undefined)}
        onKeyDown={onKeyDown}
      >
        <div className="split-divider-buttons">
          {toStart && (
            <button
              tabIndex={-1}
              title={buttonTitle}
              onClick={() => setState((prev) => ({ ...prev, collapsed: prev.collapsed === 'second' ? undefined : 'first' }))}
            >
              {row ? '◂' : '▴'}
            </button>
          )}
          {toEnd && (
            <button
              tabIndex={-1}
              title={buttonTitle}
              onClick={() => setState((prev) => ({ ...prev, collapsed: prev.collapsed === 'first' ? undefined : 'second' }))}
            >
              {row ? '▸' : '▾'}
            </button>
          )}
        </div>
      </div>
      <div className="split-pane" style={secondStyle}>
        {children[1]}
      </div>
    </div>
  )
}
