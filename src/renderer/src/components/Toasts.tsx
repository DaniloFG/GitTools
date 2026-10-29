import { useCallback, useRef, useState } from 'react'
import type { ToastKind } from '../context'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const ICON: Record<ToastKind, string> = { success: '✓', error: '✕', warning: '!', info: 'i' }

/** Lista de avisos de uma janela que não é a principal (ela some sozinha depois de um tempo). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current
    setToasts((list) => [...list, { id, kind, text }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 5000)
  }, [])
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  return { toasts, toast, dismiss }
}

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
