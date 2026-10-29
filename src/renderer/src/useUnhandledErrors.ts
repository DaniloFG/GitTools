import { useEffect } from 'react'
import type { ToastKind } from './context'
import { cleanErrorText, isIgnorableError } from './feedback'
import { errorMessage } from './format'
import { t } from './i18n'

/**
 * Erros que nenhum código tratou (exceções fora dos cliques, promessas rejeitadas sem `catch`) viram um
 * aviso de erro com o texto completo, em vez de sumirem no console. `toast` deve ser estável.
 */
export function useUnhandledErrors(toast: (kind: ToastKind, text: string) => void) {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.error ? errorMessage(e.error) : cleanErrorText(e.message)
      if (!isIgnorableError(message)) toast('error', t('feedback.unexpected', { message: message || t('feedback.unknown') }))
    }
    const onRejection = (e: PromiseRejectionEvent) => toast('error', t('feedback.unexpected', { message: errorMessage(e.reason) }))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [toast])
}
