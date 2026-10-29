import { useEffect, useRef, useState } from 'react'
import type { ToastKind } from '../context'
import { dismissDelay, type Toast } from '../feedback'
import { t } from '../i18n'

export type { Toast } from '../feedback'

const ICON: Record<ToastKind, string> = { success: '✓', error: '✕', warning: '!', info: 'i' }

/**
 * Cada aviso some sozinho no tempo de `dismissDelay` (erros ficam até o usuário fechar). Quando a mesma
 * mensagem se repete, o contador muda e o tempo recomeça.
 */
function useDismissTimers(toasts: Toast[], onDismiss: (id: number) => void) {
  const timers = useRef(new Map<number, { count: number; timer: ReturnType<typeof setTimeout> }>())

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id))
    for (const [id, entry] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(entry.timer)
        timers.current.delete(id)
      }
    }
    for (const toast of toasts) {
      const delay = dismissDelay(toast.kind)
      const entry = timers.current.get(toast.id)
      if (delay === null) {
        if (entry) clearTimeout(entry.timer)
        timers.current.delete(toast.id)
        continue
      }
      if (entry?.count === toast.count) continue
      if (entry) clearTimeout(entry.timer)
      timers.current.set(toast.id, { count: toast.count, timer: setTimeout(() => onDismiss(toast.id), delay) })
    }
  }, [toasts, onDismiss])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const entry of map.values()) clearTimeout(entry.timer)
      map.clear()
    }
  }, [])
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  useDismissTimers(toasts, onDismiss)
  return (
    <div className="toasts">
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} onDismiss={() => onDismiss(item.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(): void }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(toast.text)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    setTimeout(() => setCopied(null), 1800)
  }

  // Clicar no aviso fecha; mas quem seleciona um trecho do texto para copiar não quer que ele feche.
  const dismissOnClick = () => {
    if (window.getSelection()?.toString()) return
    onDismiss()
  }

  return (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={dismissOnClick}>
      <span className="toast-icon" aria-hidden>
        {ICON[toast.kind]}
      </span>
      <span className="toast-body pre-line">
        {toast.text}
        {toast.count > 1 && <span className="toast-count">×{toast.count}</span>}
      </span>
      <span className="toast-actions">
        {toast.action && (
          <button
            className="toast-action primary"
            onClick={(e) => {
              e.stopPropagation()
              toast.action?.run()
              onDismiss()
            }}
          >
            {toast.action.label}
          </button>
        )}
        {toast.kind === 'error' && (
          <button className="toast-action" onClick={copy} title={t('feedback.toast.copyHelp')}>
            {copied === 'ok' ? t('feedback.toast.copied') : copied === 'fail' ? t('feedback.toast.copyFailed') : t('feedback.toast.copy')}
          </button>
        )}
        <button
          className="toast-close"
          aria-label={t('feedback.toast.close')}
          title={t('feedback.toast.close')}
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          ×
        </button>
      </span>
    </div>
  )
}
