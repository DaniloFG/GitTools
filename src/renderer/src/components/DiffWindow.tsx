import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffWindowRequest } from '../../../shared/api'
import type { Settings } from '../../../shared/settings'
import type { FileDiff } from '../../../shared/types'
import { applyDateFormat, applySettings, bootSettings, resolveLocale, useLocaleCatalog } from '../appearance'
import {
  AppActionsContext,
  AppContext,
  AppSettingsContext,
  BusyContext,
  RepoDataContext,
  type AppActions,
  type AppContextValue,
  type AppSettingsValue,
  type BusyValue,
  type ToastKind
} from '../context'
import { addToast, type Toast } from '../feedback'
import { errorMessage } from '../format'
import { getActiveRoot, git, markChanged, setActiveRoot } from '../git'
import { t } from '../i18n'
import { closeVsCodePanel } from '../vscodeBridge'
import { DIFF_NAV_ACTIONS, emitDiffNav } from '../diffNav'
import { comboFromEvent, resolveBindings } from '../shortcuts'
import { installCopy } from '../copy'
import { useUnhandledErrors } from '../useUnhandledErrors'
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu'
import { Toasts } from './Toasts'
import { DiffView, useFullFile } from './DiffView'
import { useDiffUncapped } from '../diffLimit'
import { LoaderPane } from './Loader'

/** Fecha a janela de diff (no VS Code, o painel). */
const closeWindow = () => {
  if (!closeVsCodePanel()) window.close()
}

/**
 * Janela própria (do sistema) com o diff de um arquivo: pode ir para outro monitor e ficar aberta ao
 * lado da janela principal. Recarrega o diff quando volta a ter o foco.
 */
export function DiffWindowApp({ request }: { request: DiffWindowRequest }) {
  // Começa com as configurações lidas antes do primeiro desenho (`bootLocale` em main.tsx), como a janela principal:
  // assim o idioma salvo é o do primeiro quadro e nenhum catálogo a mais é baixado.
  const [settings, setSettings] = useState<Settings>(bootSettings)
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
  const uncapped = useDiffUncapped(path)
  const title = request.title ?? path
  // Esta janela é de um repositório só (o da requisição): as chamadas git dela vão para ele, não para o ativo.
  setActiveRoot(request.root ?? null)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Mesmo mecanismo da janela principal: o idioma só vira o atual com o catálogo carregado; até lá fica o anterior
  // e a janela redesenha quando ele chega. Sem `setLocale` solto no desenho, que não redesenharia ao carregar.
  const locale = useLocaleCatalog(resolveLocale(settings, systemLocales))
  applyDateFormat(settings, systemLocales)

  useEffect(() => {
    window.gittools.getSettings().then(setSettings, () => undefined)
    window.gittools.appInfo().then((info) => setSystemLocales(info.systemLocales), () => undefined)
  }, [])

  useEffect(() => applySettings(settings, locale, `${title} — GitTools`), [settings, locale, title])

  const load = useCallback(() => {
    git.diff({ ...source, path, fullFile, uncapped }).then(
      (files) => setDiff(files.find((f) => f.path === path || f.oldPath === path) ?? files[0] ?? { error: t('diff.noContent') }),
      (e) => setDiff({ error: errorMessage(e) })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source), path, fullFile, uncapped])

  useEffect(() => {
    load()
    // Ao voltar para a janela o arquivo pode ter mudado por fora: o que estava guardado deste repositório não vale mais.
    const onFocus = () => {
      const root = getActiveRoot()
      if (root) markChanged(root)
      // As configurações também: a janela principal troca o idioma e não avisa esta janela, então ela relê ao voltar
      // o foco. Com o idioma novo, `useLocaleCatalog` redesenha os textos desta janela.
      // Mantém a referência quando nada mudou: um objeto novo redesenharia todos os consumidores do contexto de
      // configurações. JSON.stringify basta aqui porque as configurações são um objeto pequeno (a regra contra
      // JSON.stringify é para dados grandes do repositório).
      window.gittools.getSettings().then(
        (next) => setSettings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
        () => undefined
      )
      load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
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

  const [menu, setMenu] = useState<MenuState | null>(null)
  useEffect(() => installCopy({ show: setMenu, notify: toast }), [toast])

  // O diff lê as preferências (modo cima/baixo ou lado a lado) e mostra menus e avisos por este contexto.
  // Os componentes leem as fatias (`AppSettingsContext`, `AppActionsContext`...), então esta janela fornece as quatro,
  // cada uma memorizada, além do valor combinado para quem ainda lê `AppContext`. Os valores são parciais: esta
  // janela não tem dados de repositório (fatia nula) nem as outras ações, como antes da divisão.
  // As ações mudam com o idioma (como na janela principal), para os textos de quem só lê ações se renovarem.
  const actions = useMemo(
    () =>
      ({
        toast,
        showMenu: (event: React.MouseEvent, items: MenuItem[]) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({ x: event.clientX, y: event.clientY, items })
        }
      }) as unknown as AppActions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, locale]
  )
  const settingsValue = useMemo<AppSettingsValue>(() => ({ settings, dashboardsOpen: false, conflictsOpen: false }), [settings])
  const busyValue = useMemo<BusyValue>(() => ({ busy: null, busyScope: [] }), [])
  const context = useMemo(
    () => ({ ...busyValue, ...actions, ...settingsValue }) as AppContextValue,
    [busyValue, actions, settingsValue]
  )

  // Sem repositório nesta janela: a fatia de dados é nula, e quem a lê direto trata a ausência (como `DialogHost`).
  return (
    <RepoDataContext.Provider value={null}>
      <BusyContext.Provider value={busyValue}>
        <AppActionsContext.Provider value={actions}>
          <AppSettingsContext.Provider value={settingsValue}>
            <AppContext.Provider value={context}>
              <div className="diff-window-app">
                <header className="toolbar">
                  <span className="logo-mark">⑂</span>
                  <strong className="diff-window-title" title={title}>
                    {title}
                  </strong>
                  <span className="toolbar-spacer" />
                  <button onClick={() => window.gittools.openInEditor(path, request.root).catch((e) => toast('error', errorMessage(e)))}>{t('common.openInEditor')}</button>
                  <button onClick={() => closeWindow()}>{t('common.close')}</button>
                </header>
                <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((item) => item.id !== id))} />
                <div className="diff-window">
                  {diff === null ? (
                    <LoaderPane label={t('loader.diff')} />
                  ) : 'error' in diff ? (
                    <p className="empty">{diff.error}</p>
                  ) : (
                    <DiffView file={diff} initialLayout={request.layout} />
                  )}
                </div>
                {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
              </div>
            </AppContext.Provider>
          </AppSettingsContext.Provider>
        </AppActionsContext.Provider>
      </BusyContext.Provider>
    </RepoDataContext.Provider>
  )
}
