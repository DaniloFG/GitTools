import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { RepoInfo } from '../../shared/types'
import { applySettings, resolveLocale } from './appearance'
import { insideVsCode } from './vscodeBridge'
import {
  AppContext,
  type AppContextValue,
  type CompareRequest,
  type RepoData,
  type StudioRequest,
  type ToastKind,
  type View
} from './context'
import { CherryPickStudio } from './components/CherryPickStudio'
import { ChangesView } from './components/ChangesView'
import { CloneDialog } from './components/CloneDialog'
import { CommitDetailsPanel, type FileFocus } from './components/CommitDetails'
import { CommitList } from './components/CommitList'
import { CompareView } from './components/CompareView'
import { ConflictEditor } from './components/ConflictEditor'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
import { DialogHost, type DialogState } from './components/Dialogs'
import { FilesView } from './components/FilesView'
import { GitLogView } from './components/GitLogView'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { OperationBanner } from './components/OperationBanner'
import { RebaseEditor } from './components/RebaseEditor'
import { SettingsCenter } from './components/settings/SettingsCenter'
import { ShortcutsHelp } from './components/settings/ShortcutsHelp'
import { Sidebar } from './components/Sidebar'
import { revealPane, Split } from './components/Split'
import { Toasts, type Toast } from './components/Toasts'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'
import { useWorkbench, Workbench, type ViewDef } from './components/Workbench'
import { errorMessage, shortSha } from './format'
import { git } from './git'
import { getLocale, setLocale, t } from './i18n'
import { resetLayout as clearLayout } from './layout'
import { historySignature, mergeData, type LogCache } from './stable'
import { activate, areaOf, type AreaId, type WorkbenchState } from './workbench'

export type HistoryScope = { kind: 'all' } | { kind: 'head' } | { kind: 'ref'; ref: string }

function isOperationResult(value: unknown): value is { ok: boolean; message: string; conflicts: string[] } {
  return typeof value === 'object' && value !== null && 'ok' in value && 'conflicts' in value
}

/** Divisória e painel de cada área lateral (para mostrar a área se estiver recolhida). */
const AREA_PANES: Partial<Record<AreaId, [string, 'first' | 'second']>> = {
  left: ['wb-left', 'first'],
  right: ['wb-right', 'second'],
  bottom: ['wb-bottom', 'second']
}

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [data, setData] = useState<RepoData | null>(null)
  const [workbench, setWorkbench] = useWorkbench()
  const [scope, setScope] = useState<HistoryScope>({ kind: 'all' })
  const [selected, setSelected] = useState<string[]>([])
  const [fileFocus, setFileFocus] = useState<FileFocus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [studio, setStudio] = useState<StudioRequest | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [compare, setCompare] = useState<CompareRequest>({})
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  /** Configurações em edição, aplicadas na hora para pré-visualização. */
  const [preview, setPreview] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)
  const [systemLocales, setSystemLocales] = useState<readonly string[]>(navigator.languages)
  const [helpOpen, setHelpOpen] = useState(false)
  const toastId = useRef(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const refreshing = useRef<Promise<void> | null>(null)
  const refreshAgain = useRef(false)
  const logCache = useRef<LogCache | null>(null)

  const effective = preview ?? settings
  const locale = resolveLocale(effective, systemLocales)
  // O idioma precisa estar ativo antes de os componentes renderizarem seus textos.
  if (getLocale() !== locale) setLocale(locale)

  useEffect(() => {
    applySettings(effective, locale)
  }, [effective, locale])

  useEffect(() => {
    window.gittools.getSettings().then(setSettings, () => undefined)
    window.gittools.appInfo().then((info) => setSystemLocales(info.systemLocales), () => undefined)
    window.gittools.currentRepository().then((info) => info && setRepo((prev) => prev ?? info))
  }, [])

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next)
    await window.gittools.saveSettings(next)
  }, [])

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current
    setToasts((list) => [...list, { id, kind, text }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 5000)
  }, [])

  // A Central de Configurações pede um aviso de exemplo para ver onde as notificações aparecem.
  useEffect(() => {
    const onSample = (e: Event) => {
      const { kind, text } = (e as CustomEvent<{ kind: ToastKind; text: string }>).detail
      toast(kind, text)
    }
    window.addEventListener('gittools:toast', onSample)
    return () => window.removeEventListener('gittools:toast', onSample)
  }, [toast])

  /** Mostra uma tela: ativa a aba dela e expande a área, se estiver recolhida. */
  const setView = useCallback(
    (view: View) => {
      setWorkbench((prev: WorkbenchState) => {
        const pane = AREA_PANES[areaOf(prev, view)]
        if (pane) revealPane(pane[0], pane[1])
        return activate(prev, view)
      })
    },
    [setWorkbench]
  )

  const resetLayout = useCallback(() => {
    clearLayout()
    toast('success', t('workbench.layoutRestored'))
  }, [toast])

  /**
   * Baixa o estado do repositório. Só um refresh roda por vez: pedidos que chegam no meio (foco da janela,
   * alteração na pasta .git, fim de uma operação) viram uma única nova rodada, em vez de várias em paralelo.
   * O histórico só é baixado de novo se algo mudou de lugar (ver `historySignature`).
   */
  const load = useCallback(async () => {
    try {
      const s = scopeRef.current
      const [status, branches, tags, stashes, operation] = await Promise.all([
        git.status(true),
        git.branches(),
        git.tags(),
        git.stashes(),
        git.operationState()
      ])
      const key = historySignature(s.kind === 'ref' ? `ref:${s.ref}` : s.kind, status, branches, tags)
      let log = logCache.current?.key === key ? logCache.current.log : null
      if (!log) {
        log = await git.log(s.kind === 'all' ? { all: true } : s.kind === 'head' ? {} : { ref: s.ref }).catch(() => null)
        if (log) logCache.current = { key, log }
        else log = logCache.current?.log ?? []
      }
      const next = { status, branches, tags, stashes, log, operation }
      setData((prev) => mergeData(prev, next))
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }, [toast])

  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) {
      refreshAgain.current = true
      return refreshing.current
    }
    const round = (async () => {
      try {
        do {
          refreshAgain.current = false
          await load()
        } while (refreshAgain.current)
      } finally {
        refreshing.current = null
      }
    })()
    refreshing.current = round
    return round
  }, [load])

  useEffect(() => {
    if (repo) void refresh()
  }, [repo, scope, refresh])

  useEffect(() => {
    if (!repo) return
    let timer: ReturnType<typeof setTimeout> | null = null
    return window.gittools.onRepositoryChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 150)
    })
  }, [repo, refresh])

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(label)
      try {
        const result = await fn()
        if (isOperationResult(result)) {
          if (result.ok) toast('success', result.message)
          else {
            toast('warning', result.message)
            setView('changes')
          }
        } else if (typeof result === 'string' && result) toast('info', result)
        return result
      } catch (error) {
        toast('error', errorMessage(error))
        return undefined
      } finally {
        setBusy(null)
        await refresh()
      }
    },
    [refresh, toast, setView]
  )

  /** Passa a mostrar outro repositório (aberto, criado ou clonado). */
  const showRepository = useCallback(
    (info: RepoInfo) => {
      setData(null)
      logCache.current = null
      setSelected([])
      setScope({ kind: 'all' })
      setFilePath(null)
      setCompare({})
      setView('history')
      setRepo(info)
    },
    [setView]
  )

  const openRepository = useCallback(
    async (path?: string, create = false) => {
      try {
        const info = create ? await window.gittools.initRepository() : await window.gittools.openRepository(path)
        if (info) showRepository(info)
      } catch (error) {
        toast('error', errorMessage(error))
      }
    },
    [toast, showRepository]
  )

  const openDiffWindow = useCallback(
    (request: Parameters<AppContextValue['openDiffWindow']>[0]) => {
      window.gittools.openDiffWindow(request).catch((error) => toast('error', errorMessage(error)))
    },
    [toast]
  )

  const context = useMemo<AppContextValue | null>(() => {
    if (!repo || !data) return null
    return {
      repo,
      data,
      busy,
      refresh,
      run,
      toast,
      confirm: (r) => new Promise((resolve) => setDialog({ kind: 'confirm', ...r, resolve })),
      prompt: (r) => new Promise((resolve) => setDialog({ kind: 'prompt', ...r, resolve })),
      choose: (r) => new Promise((resolve) => setDialog({ kind: 'choice', ...r, resolve })),
      askPush: (r) => new Promise((resolve) => setDialog({ kind: 'push', ...r, resolve })),
      showMenu: (event: React.MouseEvent, items: MenuItem[]) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY, items })
      },
      openStudio: (request) => setStudio(request),
      selectCommit: (sha) => {
        setView('history')
        setSelected([sha])
      },
      setView,
      openDiffWindow,
      resetLayout,
      openConflict: (path) => setConflict(path),
      openCompare: (request) => {
        setCompare(request)
        setView('compare')
      },
      openFileView: (path) => {
        setFilePath(path)
        setView('files')
      },
      openRebase: (sha) => setRebaseFrom(sha),
      openInEditor: (path = '.') => {
        // No VS Code os arquivos abrem no próprio editor dele: não há editor a escolher.
        if (!settings.editor && !insideVsCode()) {
          toast('info', t('editor.chooseFirst'))
          setSettingsOpen('editor')
          return
        }
        window.gittools.openInEditor(path).catch((error) => toast('error', errorMessage(error)))
      },
      settings,
      openSettings: (section) => setSettingsOpen(section ?? 'general'),
      openShortcuts: () => setHelpOpen(true)
    }
    // locale: força novos textos nos componentes quando o idioma muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, data, busy, refresh, run, toast, settings, locale, setView, openDiffWindow, resetLayout])

  const settingsDialogs = (
    <>
      {settingsOpen && (
        <SettingsCenter
          settings={settings}
          initialSection={settingsOpen}
          onPreview={setPreview}
          onSave={saveSettings}
          onClose={() => {
            setPreview(null)
            setSettingsOpen(null)
          }}
          onShowShortcuts={() => setHelpOpen(true)}
        />
      )}
      {helpOpen && <ShortcutsHelp settings={settings} onClose={() => setHelpOpen(false)} />}
      {cloneOpen && (
        <CloneDialog
          onClose={() => setCloneOpen(false)}
          onCloned={(info) => {
            setCloneOpen(false)
            showRepository(info)
          }}
        />
      )}
    </>
  )

  if (!repo || !context) {
    return (
      <>
        <Welcome loading={!!repo} onOpen={openRepository} onClone={() => setCloneOpen(true)} onSettings={() => setSettingsOpen('general')} />
        {settingsDialogs}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
      </>
    )
  }

  const changeCount = data!.status.staged.length + data!.status.unstaged.length + data!.status.conflicted.length
  const modalOpen = !!(studio || conflict || rebaseFrom || dialog || settingsOpen || helpOpen || cloneOpen)

  /** Abre o diff de um arquivo no painel de detalhes, mostrando os painéis se estiverem recolhidos. */
  const openFileInDetails = (sha: string, path: string) => {
    setSelected([sha])
    setFileFocus((prev) => ({ sha, path, n: (prev?.n ?? 0) + 1 }))
    revealPane('history', 'second')
    revealPane('commit-details', 'second')
    setView('history')
  }

  const views: Record<View, ViewDef> = {
    branches: {
      label: t('workbench.views.branches'),
      render: () => (
        <Sidebar
          scope={scope}
          onScope={(s) => {
            setScope(s)
            setView('history')
          }}
        />
      )
    },
    history: {
      label: t('tabs.history'),
      help: t('history.log.tab'),
      render: () => (
        <Split id="history" initial={0.55} min={[280, 280]} labels={[t('workbench.panes.commits'), t('workbench.panes.details')]}>
          <CommitList
            scope={scope}
            onScope={setScope}
            selected={selected}
            onSelect={setSelected}
            onOpenFile={openFileInDetails}
            onOpenFileWindow={(sha, path) => openDiffWindow({ source: { kind: 'commit', sha }, path, title: `${path} · ${shortSha(sha)}` })}
          />
          <CommitDetailsPanel selected={selected} focus={fileFocus} />
        </Split>
      )
    },
    changes: { label: t('tabs.changes'), badge: changeCount, render: () => <ChangesView /> },
    files: { label: t('tabs.files'), render: () => <FilesView path={filePath} onPath={setFilePath} /> },
    compare: { label: t('tabs.compare'), render: () => <CompareView request={compare} onRequest={setCompare} /> },
    gitlog: { label: t('gitlog.title'), render: () => <GitLogView /> }
  }

  return (
    <AppContext.Provider value={context}>
      <KeyboardShortcuts disabled={modalOpen} onOpenRepository={() => openRepository()} />
      <div className="app">
        <Toolbar onOpenRepository={openRepository} onClone={() => setCloneOpen(true)} />
        <OperationBanner onShowChanges={() => setView('changes')} />
        <Workbench state={workbench} onChange={setWorkbench} views={views} />
      </div>
      {studio && <CherryPickStudio request={studio} onClose={() => setStudio(null)} />}
      {conflict && <ConflictEditor path={conflict} onClose={() => setConflict(null)} />}
      {rebaseFrom && <RebaseEditor fromSha={rebaseFrom} onClose={() => setRebaseFrom(null)} />}
      {settingsDialogs}
      {dialog && <DialogHost dialog={dialog} onDone={() => setDialog(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {busy && (
        <div className="busy">
          <span className="spinner" /> {busy}…
        </div>
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </AppContext.Provider>
  )
}
