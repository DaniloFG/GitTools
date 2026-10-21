import { useRef, type ReactNode } from 'react'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { t } from '../i18n'

const MIN_HEIGHT = 48

const parseHeight = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= MIN_HEIGHT ? value : undefined)

/** Área com rolagem cuja altura o usuário ajusta pela alça de baixo (duplo clique volta ao padrão). */
export function ResizableBox({ id, className = '', children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useLayout(`box.${id}`, parseHeight)

  const resize = (e: React.PointerEvent) => {
    const start = ref.current?.getBoundingClientRect().height ?? height ?? MIN_HEIGHT
    startResize(e, 'row-resize', (_event, _dx, dy) => setHeight(Math.round(Math.max(MIN_HEIGHT, start + dy))))
  }

  return (
    <div className="resizable-box">
      <div ref={ref} className={`resizable-box-content ${className}`} style={height ? { height, maxHeight: 'none' } : undefined}>
        {children}
      </div>
      <div className="resizable-box-handle" title={t('layout.resize')} onPointerDown={resize} onDoubleClick={() => setHeight(undefined)} />
    </div>
  )
}
