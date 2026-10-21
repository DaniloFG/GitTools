import type { ToastKind } from '../context'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const ICON: Record<ToastKind, string> = { success: '✓', error: '✕', warning: '!', info: 'i' }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-icon">{ICON[t.kind]}</span>
          <span className="pre-line">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
