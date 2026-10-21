import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { RepoInfo } from '../../shared/types'
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
import { CommitDetailsPanel } from './components/CommitDetails'
import { CommitList } from './components/CommitList'
import { CompareView } from './components/CompareView'
import { ConflictEditor } from './components/ConflictEditor'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
import { DialogHost, type DialogState } from './components/Dialogs'
import { FilesView } from './components/FilesView'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { OperationBanner } from './components/OperationBanner'
import { RebaseEditor } from './components/RebaseEditor'
import { SettingsCenter } from './components/settings/SettingsCenter'
import { ShortcutsHelp } from './components/settings/ShortcutsHelp'
import { Sidebar } from './components/Sidebar'
import { Split } from './components/Split'
import { Toasts, type Toast } from './components/Toasts'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'
import { errorMessage } from './format'
import { git } from './git'
import { getLocale, matchLocale, setLocale, textDirection, t, type LocaleId, type MessageKey } from './i18n'

export type HistoryScope = { kind: 'all' } | { kind: 'head' } | { kind: 'ref'; ref: string }

function isOperationResult(value: unknown): value is { ok: boolean; message: string; conflicts: string[] } {
  return typeof value === 'object' && value !== null && 'ok' in value && 'conflicts' in value
}

function resolveLocale(settings: Settings, systemLocales: readonly string[]): LocaleId {
  return settings.language === 'system' ? matchLocale(systemLocales) : settings.language
}

/** Aplica tema, escala, idioma e direção do texto (o árabe é escrito da direita para a esquerda). */
function applySettings(settings: Settings, locale: LocaleId) {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.lang = locale
  root.dir = textDirection()
  document.title = 'GitTools'
  window.gittools.setZoom(settings.zoom)
}

const TABS: { id: View; label: MessageKey }[] = [
  { id: 'history', label: 'tabs.history' },
  { id: 'changes', label: 'tabs.changes' },
  { id: 'files', label: 'tabs.files' },
  { id: 'compare', label: 'tabs.compare' }
]

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [data, setData] = useState<RepoData | null>(null)
  const [view, setView] = useState<View>('history')
  const [scope, setScope] = useState<HistoryScope>({ kind: 'all' })
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [studio, setStudio] = useState<StudioRequest | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [compare, setCompare] = useState<CompareRequest>({})
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  /** Configurações em edição, aplicadas na hora para pré-visualização. */
  const [preview, setPreview] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)
  const [systemLocales, setSystemLocales] = useState<readonly string[]>(navigator.languages)
  const [helpOpen, setHelpOpen] = useState(false)
  const toastId = useRef(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

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

  const refresh = useCallback(async () => {
    try {
      const s = scopeRef.current
      const [status, branches, tags, stashes, operation] = await Promise.all([
        git.status(),
        git.branches(),
        git.tags(),
        git.stashes(),
        git.operationState()
      ])
      const log = await git.log(s.kind === 'all' ? { all: true } : s.kind === 'head' ? {} : { ref: s.ref }).catch(() => [])
      setData({ status, branches, tags, stashes, log, operation })
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }, [toast])

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
    [refresh, toast]
  )

  const openRepository = useCallback(
    async (path?: string, create = false) => {
      try {
        const info = create ? await window.gittools.initRepository() : await window.gittools.openRepository(path)
        if (!info) return
        setData(null)
        setSelected([])
        setScope({ kind: 'all' })
        setFilePath(null)
        setCompare({})
        setView('history')
        setRepo(info)
      } catch (error) {
        toast('error', errorMessage(error))
      }
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
      settings,
      openSettings: (section) => setSettingsOpen(section ?? 'general'),
      openShortcuts: () => setHelpOpen(true)
    }
    // locale: força novos textos nos componentes quando o idioma muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, data, busy, refresh, run, toast, settings, locale])

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
    </>
  )

  if (!repo || !context) {
    return (
      <>
        <Welcome loading={!!repo} onOpen={openRepository} onSettings={() => setSettingsOpen('general')} />
        {settingsDialogs}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
      </>
    )
  }

  const changeCount = data!.status.staged.length + data!.status.unstaged.length + data!.status.conflicted.length
  const modalOpen = !!(studio || conflict || rebaseFrom || dialog || settingsOpen || helpOpen)

  return (
    <AppContext.Provider value={context}>
      <KeyboardShortcuts disabled={modalOpen} onOpenRepository={() => openRepository()} />
      <div className="app">
        <Toolbar onOpenRepository={openRepository} />
        <OperationBanner onShowChanges={() => setView('changes')} />
        <Split id="workspace" className="workspace" fixed initial={260} min={[160, 360]} collapsible={[true, false]}>
          <Sidebar
            scope={scope}
            onScope={(s) => {
              setScope(s)
              setView('history')
            }}
          />
          <main className="main">
            <nav className="tabs">
              {TABS.map((tab) => (
                <button key={tab.id} className={view === tab.id ? 'active' : ''} onClick={() => setView(tab.id)}>
                  {t(tab.label)}
                  {tab.id === 'changes' && changeCount > 0 && <span className="badge">{changeCount}</span>}
                </button>
              ))}
            </nav>
            {view === 'history' && (
              <Split id="history" initial={0.55} min={[280, 280]}>
                <CommitList scope={scope} onScope={setScope} selected={selected} onSelect={setSelected} />
                <CommitDetailsPanel selected={selected} />
              </Split>
            )}
            {view === 'changes' && <ChangesView />}
            {view === 'files' && <FilesView path={filePath} onPath={setFilePath} />}
            {view === 'compare' && <CompareView request={compare} onRequest={setCompare} />}
          </main>
        </Split>
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
