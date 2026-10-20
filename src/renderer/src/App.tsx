import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/api'
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
import { SettingsDialog, ShortcutsHelp } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Toasts, type Toast } from './components/Toasts'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'
import { errorMessage } from './format'
import { git } from './git'

export type HistoryScope = { kind: 'all' } | { kind: 'head' } | { kind: 'ref'; ref: string }

function isOperationResult(value: unknown): value is { ok: boolean; message: string; conflicts: string[] } {
  return typeof value === 'object' && value !== null && 'ok' in value && 'conflicts' in value
}

function applySettings(settings: Settings) {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  window.gittools.setZoom(settings.zoom)
}

const TABS: { id: View; label: string }[] = [
  { id: 'history', label: 'Histórico' },
  { id: 'changes', label: 'Alterações' },
  { id: 'files', label: 'Arquivos' },
  { id: 'compare', label: 'Comparar' }
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const toastId = useRef(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    applySettings(settings)
  }, [settings])

  useEffect(() => {
    window.gittools.getSettings().then(setSettings, () => undefined)
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
      openSettings: () => setSettingsOpen(true),
      openShortcuts: () => setHelpOpen(true)
    }
  }, [repo, data, busy, refresh, run, toast, settings])

  const settingsDialogs = (
    <>
      {settingsOpen && <SettingsDialog settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <ShortcutsHelp settings={settings} onClose={() => setHelpOpen(false)} />}
    </>
  )

  if (!repo || !context) {
    return (
      <>
        <Welcome loading={!!repo} onOpen={openRepository} onSettings={() => setSettingsOpen(true)} />
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
        <div className="workspace">
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
                  {tab.label}
                  {tab.id === 'changes' && changeCount > 0 && <span className="badge">{changeCount}</span>}
                </button>
              ))}
            </nav>
            {view === 'history' && (
              <div className="split">
                <CommitList scope={scope} onScope={setScope} selected={selected} onSelect={setSelected} />
                <CommitDetailsPanel selected={selected} />
              </div>
            )}
            {view === 'changes' && <ChangesView />}
            {view === 'files' && <FilesView path={filePath} onPath={setFilePath} />}
            {view === 'compare' && <CompareView request={compare} onRequest={setCompare} />}
          </main>
        </div>
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
