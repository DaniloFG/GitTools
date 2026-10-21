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
  return { width: size(raw.width), height: size(raw.height), maximized: raw.maximized === true }
}

export function Modal({ title, onClose, children, footer, size = 'small', id }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useLayout(`modal.${id ?? size}`, parseModalLayout)
  const { width, height, maximized } = layout

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

  const custom = !maximized && (width || height)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal modal-${size} ${maximized ? 'modal-maximized' : ''} ${custom ? 'modal-custom' : ''}`}
        style={maximized ? undefined : { width, height }}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header" onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && toggleMaximized()}>
          <h2>{title}</h2>
          <div className="modal-header-actions">
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
              onDoubleClick={() => setLayout(undefined)}
              title={t('layout.resize')}
            />
          ))}
      </div>
    </div>
  )
}
