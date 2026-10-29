import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffWindowRequest } from '../../../shared/api'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import type { FileDiff } from '../../../shared/types'
import { applySettings, resolveLocale } from '../appearance'
import { AppContext, type AppContextValue, type ToastKind } from '../context'
import { addToast, type Toast } from '../feedback'
import { errorMessage } from '../format'
import { git } from '../git'
import { getLocale, setLocale, t } from '../i18n'
import { closeVsCodePanel } from '../vscodeBridge'
import { DIFF_NAV_ACTIONS, emitDiffNav } from '../diffNav'
import { comboFromEvent, resolveBindings } from '../shortcuts'
import { useUnhandledErrors } from '../useUnhandledErrors'
import { Toasts } from './Toasts'
import { DiffView, useFullFile } from './DiffView'

/** Fecha a janela de diff (no VS Code, o painel). */
const closeWindow = () => {
  if (!closeVsCodePanel()) window.close()
}

/** Lê o pedido que a janela principal passou na URL desta janela. */
export function diffWindowRequest(search: string): DiffWindowRequest | null {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'diff') return null
  try {
    const request = JSON.parse(params.get('request') ?? '') as DiffWindowRequest
    return request && typeof request.path === 'string' && request.source ? request : null
  } catch {
    return null
  }
}

/**
 * Janela própria (do sistema) com o diff de um arquivo: pode ir para outro monitor e ficar aberta ao
 * lado da janela principal. Recarrega o diff quando volta a ter o foco.
 */
export function DiffWindowApp({ request }: { request: DiffWindowRequest }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [systemLocales, setSystemLocales] = useState<readonly string[]>(navigator.languages)
  const [diff, setDiff] = useState<FileDiff | null | { error: string }>(null)
  // Avisos desta janela (ela não compartilha as notificações da janela principal).
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current
    setToasts((list) => addToast(list, { kind, text }, Date.now(), id))
  }, [])
  useUnhandledErrors(toast)
  const [fullFile] = useFullFile()
  const { source, path } = request
  const title = request.title ?? path

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const locale = resolveLocale(settings, systemLocales)
  if (getLocale() !== locale) setLocale(locale)

  useEffect(() => {
    window.gittools.getSettings().then(setSettings, () => undefined)
    window.gittools.appInfo().then((info) => setSystemLocales(info.systemLocales), () => undefined)
  }, [])

  useEffect(() => applySettings(settings, locale, `${title} — GitTools`), [settings, locale, title])

  const load = useCallback(() => {
    git.diff({ ...source, path, fullFile }).then(
      (files) => setDiff(files.find((f) => f.path === path || f.oldPath === path) ?? files[0] ?? { error: t('diff.noContent') }),
      (e) => setDiff({ error: errorMessage(e) })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source), path, fullFile])

  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeWindow()
      // F7/Shift+F7 (ou as teclas escolhidas nas configurações) pulam de alteração em alteração.
      const bindings = resolveBindings(settingsRef.current.shortcuts)
      const combo = comboFromEvent(e)
      const action = Object.keys(DIFF_NAV_ACTIONS).find((id) => bindings[id] === combo)
      if (action && emitDiffNav(...DIFF_NAV_ACTIONS[action])) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // O diff só lê as preferências (modo cima/baixo ou lado a lado) do contexto do aplicativo.
  const context = { settings } as AppContextValue

  return (
    <AppContext.Provider value={context}>
      <div className="diff-window-app">
        <header className="toolbar">
          <span className="logo-mark">⑂</span>
          <strong className="diff-window-title" title={title}>
            {title}
          </strong>
          <span className="toolbar-spacer" />
          <button onClick={() => window.gittools.openInEditor(path).catch((e) => toast('error', errorMessage(e)))}>{t('common.openInEditor')}</button>
          <button onClick={() => closeWindow()}>{t('common.close')}</button>
        </header>
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((item) => item.id !== id))} />
        <div className="diff-window">
          {diff === null ? (
            <p className="empty">
              <span className="spinner" />
            </p>
          ) : 'error' in diff ? (
            <p className="empty">{diff.error}</p>
          ) : (
            <DiffView file={diff} />
          )}
        </div>
      </div>
    </AppContext.Provider>
  )
}
