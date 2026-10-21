import { useEffect, useRef, type ReactNode } from 'react'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { t } from '../i18n'

interface Props {
  title: ReactNode
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  size?: 'small' | 'medium' | 'large' | 'settings'
  /** Nome sob o qual o tamanho escolhido pelo usuário fica guardado (padrão: o tamanho). */
  id?: string
}

/** Tamanho escolhido pelo usuário; sem largura/altura, vale o tamanho padrão do diálogo. */
interface ModalLayout {
  width?: number
  height?: number
  maximized?: boolean
  /** Deslocamento a partir do centro da tela, quando o usuário arrastou o diálogo. */
  x?: number
  y?: number
}

const MIN_WIDTH = 320
const MIN_HEIGHT = 160
const MARGIN = 16

/** Alças nas bordas e cantos: direção horizontal e vertical em que cada uma aumenta o diálogo. */
const HANDLES: { name: string; x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string }[] = [
  { name: 'n', x: 0, y: -1, cursor: 'ns-resize' },
  { name: 's', x: 0, y: 1, cursor: 'ns-resize' },
  { name: 'w', x: -1, y: 0, cursor: 'ew-resize' },
  { name: 'e', x: 1, y: 0, cursor: 'ew-resize' },
  { name: 'nw', x: -1, y: -1, cursor: 'nwse-resize' },
  { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { name: 'ne', x: 1, y: -1, cursor: 'nesw-resize' },
  { name: 'sw', x: -1, y: 1, cursor: 'nesw-resize' }
]

function parseModalLayout(value: unknown): ModalLayout {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const size = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
  const offset = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return { width: size(raw.width), height: size(raw.height), maximized: raw.maximized === true, x: offset(raw.x), y: offset(raw.y) }
}

export function Modal({ title, onClose, children, footer, size = 'small', id }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useLayout(`modal.${id ?? size}`, parseModalLayout)
  const { width, height, maximized } = layout
  const x = maximized ? 0 : (layout.x ?? 0)
  const y = maximized ? 0 : (layout.y ?? 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleMaximized = () => setLayout((prev) => ({ ...prev, maximized: !prev.maximized }))

  const resize = (e: React.PointerEvent, handle: (typeof HANDLES)[number]) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // O diálogo fica centralizado: cresce para os dois lados, então a borda acompanha o mouse em dobro.
    startResize(e, handle.cursor, (_event, dx, dy) => {
      setLayout((prev) => ({
        ...prev,
        width: handle.x ? Math.round(Math.min(Math.max(rect.width + 2 * handle.x * dx, MIN_WIDTH), window.innerWidth - MARGIN)) : prev.width,
        height: handle.y ? Math.round(Math.min(Math.max(rect.height + 2 * handle.y * dy, MIN_HEIGHT), window.innerHeight - MARGIN)) : prev.height
      }))
    })
  }

  /** Arrasta o diálogo pelo cabeçalho; a posição fica guardada (o cabeçalho nunca sai da tela). */
  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (maximized || !el || (e.target as HTMLElement).closest('button')) return
    const rect = el.getBoundingClientRect()
    const x0 = x
    const y0 = y
    startResize(e, 'move', (_event, dx, dy) => {
      const keep = 48
      const nx = Math.min(Math.max(x0 + dx, x0 - rect.left - rect.width + keep), x0 + window.innerWidth - rect.left - keep)
      const ny = Math.min(Math.max(y0 + dy, y0 - rect.top), y0 + window.innerHeight - rect.top - keep)
      setLayout((prev) => ({ ...prev, x: Math.round(nx), y: Math.round(ny) }))
    })
  }

  const custom = !maximized && (width || height)
  const style: React.CSSProperties | undefined = maximized ? undefined : { width, height, ...(x || y ? { transform: `translate(${x}px, ${y}px)` } : {}) }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal modal-${size} ${maximized ? 'modal-maximized' : ''} ${custom ? 'modal-custom' : ''}`}
        style={style}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header" title={maximized ? undefined : t('layout.moveWindow')} onPointerDown={move} onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && toggleMaximized()}>
          <h2>{title}</h2>
          <div className="modal-header-actions">
            {(x !== 0 || y !== 0) && (
              <button className="icon-button" onClick={() => setLayout((prev) => ({ ...prev, x: undefined, y: undefined }))} title={t('layout.centerWindow')} aria-label={t('layout.centerWindow')}>
                ⌖
              </button>
            )}
            <button
              className="icon-button"
              onClick={toggleMaximized}
              title={maximized ? t('layout.restoreWindow') : t('layout.maximize')}
              aria-label={maximized ? t('layout.restoreWindow') : t('layout.maximize')}
            >
              {maximized ? '❐' : '□'}
            </button>
            <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
        {!maximized &&
          HANDLES.map((handle) => (
            <div
              key={handle.name}
              className={`modal-resize modal-resize-${handle.name}`}
              onPointerDown={(e) => resize(e, handle)}
              onDoubleClick={() => setLayout((prev) => ({ x: prev.x, y: prev.y }))}
              title={t('layout.resize')}
            />
          ))}
      </div>
    </div>
  )
}
