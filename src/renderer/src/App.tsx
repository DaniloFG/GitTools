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
import { CommitPanes, type FileFocus, type WipFocus } from './components/CommitDetails'
import { CommitList } from './components/CommitList'
import { CompareView } from './components/CompareView'
import { ConflictEditor } from './components/ConflictEditor'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
import { DialogHost, type DialogState } from './components/Dialogs'
import { FilesPanes } from './components/FilesView'
import { GitLogView } from './components/GitLogView'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { OperationBanner } from './components/OperationBanner'
import { RebaseEditor } from './components/RebaseEditor'
import { SettingsCenter } from './components/settings/SettingsCenter'
import { ShortcutsHelp } from './components/settings/ShortcutsHelp'
import { SidebarPanes } from './components/Sidebar'
import { PanelsButtons, ScreenTabs } from './components/Screens'
import { Dashboards } from './components/Dashboards'
import { Loader, useDelayedLoading, useLastDefined } from './components/Loader'
import { Toasts } from './components/Toasts'
import { addToast, type Toast } from './feedback'
import { useUnhandledErrors } from './useUnhandledErrors'
import { Toolbar } from './components/Toolbar'
import { Welcome } from './components/Welcome'
import { Dock, type ViewMeta } from './components/Dock'
import { errorMessage, shortSha } from './format'
import { git } from './git'
import { getLocale, setLocale, t } from './i18n'
import { resetLayout as clearLayout, useLayout } from './layout'
import { historySignature, mergeData, type LogCache } from './stable'
import { checkedRefs, scopeKey, scopeLogOptions, scopeOfRefs, type HistoryScope } from './historyScope'
import { REPO_VIEWS, viewAvailable, type ViewId } from './dock'
import { openScreen, useDock, useScreen } from './dockStore'
import { parseChangesMode, type ChangesMode } from './changesMode'
import { PaneSlot, WhenShown } from './slots'

export type { HistoryScope }

function isOperationResult(value: unknown): value is { ok: boolean; message: string; conflicts: string[] } {
  return typeof value === 'object' && value !== null && 'ok' in value && 'conflicts' in value
}

/** Painéis de cada grupo de telas: o estado de cada grupo só é montado enquanto algum deles está na tela. */
const COMMIT_VIEWS: ViewId[] = ['commit.message', 'commit.files', 'commit.diff']
const CHANGES_VIEWS: ViewId[] = ['changes.conflicts', 'changes.unstaged', 'changes.staged', 'changes.files', 'changes.commit', 'changes.diff']
const FILES_VIEWS: ViewId[] = ['files.list', 'files.history', 'files.diff', 'files.editor', 'files.blame']
const COMPARE_VIEWS: ViewId[] = ['compare.setup', 'compare.files', 'compare.diff']

/** Nenhum painel atingido (valor fixo, para o contexto não mudar a cada desenho quando não há operação). */
const NO_VIEWS: readonly ViewId[] = []

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [data, setData] = useState<RepoData | null>(null)
  const [dock, setDock] = useDock()
  const [screen] = useScreen()
  const [changesMode] = useLayout<ChangesMode>('pref.changesMode', parseChangesMode)
  const [scope, setScope] = useState<HistoryScope>({ kind: 'all' })
  const [selected, setSelected] = useState<string[]>([])
  const [fileFocus, setFileFocus] = useState<FileFocus | null>(null)
  const [wipFocus, setWipFocus] = useState<WipFocus | null>(null)
  /** Operação em andamento: o rótulo e os painéis que ela atinge (ver `run`). */
  const [operation, setOperation] = useState<{ label: string; scope: readonly ViewId[] } | null>(null)
  const busy = operation?.label ?? null
  const busyScope = operation?.scope ?? NO_VIEWS
  /** O indicador compacto fica na tela um pouco depois de a operação acabar: mantém o rótulo dela nesse tempo. */
  const busyVisible = useDelayedLoading(busy !== null)
  const busyLabel = useLastDefined(busy)
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
  /** A tela de Dashboards está aberta (no lugar dos painéis, que continuam montados por trás). */
  const [dashboardsOpen, setDashboards] = useState(false)
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

  /** Mostra um aviso; a mesma mensagem repetida logo em seguida vira um contador "×N" (ver `addToast`). */
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current
    setToasts((list) => addToast(list, { kind, text }, Date.now(), id))
  }, [])

  useUnhandledErrors(toast)

  // A Central de Configurações pede um aviso de exemplo para ver onde as notificações aparecem.
  useEffect(() => {
    const onSample = (e: Event) => {
      const { kind, text } = (e as CustomEvent<{ kind: ToastKind; text: string }>).detail
      toast(kind, text)
    }
    window.addEventListener('gittools:toast', onSample)
    return () => window.removeEventListener('gittools:toast', onSample)
  }, [toast])

  /** Quais painéis existem agora (ex.: Conflitos só com conflitos; Staged só na visão de listas separadas). */
  const conflicts = data?.status.conflicted.length ?? 0
  const available = useCallback((view: ViewId) => viewAvailable(view, { changesMode, conflicts }), [changesMode, conflicts])
  const availableRef = useRef(available)
  availableRef.current = available

  /**
   * Troca para um menu do topo: traz os painéis dele. Os de outras telas não entram junto (só os fixados ali).
   * Quem quer ir a outra tela chama isto, em vez de trazer painéis alheios.
   */
  const setView = useCallback((view: View) => {
    setDashboards(false)
    openScreen(view, (v) => availableRef.current(v))
  }, [])

  const askConfirm = useCallback((request: Parameters<AppContextValue['confirm']>[0]) => new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', ...request, resolve })), [])

  /** Restaurar o layout apaga o arranjo que o usuário montou: pergunta antes. */
  const resetLayout = useCallback(async () => {
    const ok = await askConfirm({
      title: t('layout.resetConfirm.title'),
      message: t('layout.resetConfirm.message'),
      confirmLabel: t('layout.resetConfirm.confirm'),
      danger: true
    })
    if (!ok) return
    clearLayout()
    toast('success', t('workbench.layoutRestored'))
  }, [toast, askConfirm])

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
      // Uma branch marcada que foi excluída ou renomeada sai do filtro (o novo escopo dispara outra leitura).
      const names = new Set(branches.map((b) => b.name))
      const marked = checkedRefs(s)
      if (marked.some((name) => !names.has(name))) {
        setScope(scopeOfRefs(marked.filter((name) => names.has(name))))
        return
      }
      const key = historySignature(scopeKey(s), status, branches, tags)
      let log = logCache.current?.key === key ? logCache.current.log : null
      if (!log) {
        log = await git.log(scopeLogOptions(s)).catch((e) => {
          toast('error', errorMessage(e))
          return null
        })
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

  /**
   * Executa uma operação com progresso (indicador no topo e overlay nos painéis do `scope`), mostra o resultado e
   * atualiza a tela no fim. O padrão do `scope` são os painéis que mostram dados do repositório.
   */
  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, scope: readonly ViewId[] = REPO_VIEWS): Promise<T | undefined> => {
      setOperation({ label, scope })
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
        setOperation(null)
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
      busyScope,
      refresh,
      run,
      toast,
      confirm: askConfirm,
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
        setWipFocus(null)
        setView('history')
        setSelected([sha])
      },
      showCommit: (sha) => {
        // Mostrar um commit é ir ao Histórico (os painéis do commit vêm com a tela).
        setWipFocus(null)
        setView('history')
        setSelected([sha])
      },
      dashboardsOpen,
      setDashboards,
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
  }, [repo, data, busy, busyScope, refresh, run, toast, settings, locale, setView, dashboardsOpen, openDiffWindow, resetLayout, askConfirm])

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

  /** Abre o diff de um arquivo no painel do diff do commit, trazendo os painéis do commit se estiverem escondidos. */
  const openFileInDetails = (sha: string, path: string) => {
    setWipFocus(null)
    setSelected([sha])
    setFileFocus((prev) => ({ sha, path, n: (prev?.n ?? 0) + 1 }))
    setView('history')
  }

  /** Abre o diff de um arquivo não commitado no painel do diff, trazendo os painéis do commit se estiverem escondidos. */
  const openWipFileInDetails = (path: string) => {
    setSelected([])
    setWipFocus((prev) => ({ path, n: (prev?.n ?? 0) + 1 }))
    setView('history')
  }

  /** Nome, número e dica de cada painel (as abas). */
  const meta: Record<ViewId, ViewMeta> = {
    branches: { label: t('workbench.views.branches') },
    tags: { label: t('sidebar.tags') },
    stashes: { label: t('sidebar.stashes') },
    history: { label: t('tabs.history'), help: t('history.log.tab') },
    'commit.message': { label: t('workbench.views.commitMessage') },
    'commit.files': { label: t('workbench.views.commitFiles') },
    'commit.diff': { label: t('workbench.views.commitDiff') },
    'changes.conflicts': { label: t('changes.sections.conflicts'), badge: conflicts },
    'changes.unstaged': { label: t('changes.sections.unstaged'), badge: changeCount },
    'changes.staged': { label: t('changes.sections.staged') },
    'changes.files': { label: t('changes.sections.files'), badge: changeCount },
    'changes.commit': { label: t('changes.sections.commit') },
    'changes.diff': { label: t('workbench.views.changesDiff') },
    'files.list': { label: t('tabs.files') },
    'files.history': { label: t('workbench.views.filesHistory') },
    'files.diff': { label: t('workbench.views.filesDiff') },
    'files.editor': { label: t('files.editor') },
    'files.blame': { label: t('files.blame') },
    'compare.setup': { label: t('tabs.compare') },
    'compare.files': { label: t('workbench.views.compareFiles') },
    'compare.diff': { label: t('workbench.views.compareDiff') },
    gitlog: { label: t('gitlog.title') }
  }

  return (
    <AppContext.Provider value={context}>
      <KeyboardShortcuts disabled={modalOpen} onOpenRepository={() => openRepository()} />
      <div className="app">
        <Toolbar onOpenRepository={openRepository} onClone={() => setCloneOpen(true)} />
        <div className="screen-bar">
          <ScreenTabs state={dock} meta={meta} screen={screen} onScreen={setView} available={available} changeCount={changeCount} dashboards={dashboardsOpen} onDashboards={() => setDashboards(true)} />
          <div className="toolbar-spacer" />
          <PanelsButtons state={dock} onChange={setDock} screen={screen} meta={meta} available={available} />
        </div>
        <OperationBanner onShowChanges={() => setView('changes')} />
        <div className={dashboardsOpen ? 'dock-hidden' : 'dock-wrap'}>
          <Dock state={dock} onChange={setDock} screen={screen} meta={meta} available={available} />
        </div>
        {dashboardsOpen && <Dashboards />}
      </div>
      {/* Cada tela é desenhada aqui e levada, por portais, ao painel onde o usuário a deixou. */}
      <SidebarPanes
        scope={scope}
        onScope={(s, options) => {
          setScope(s)
          if (options?.reveal !== false) setView('history')
        }}
      />
      <PaneSlot id="history">
        <CommitList
          scope={scope}
          onScope={setScope}
          selected={selected}
          onSelect={(shas) => {
            setWipFocus(null)
            setSelected(shas)
          }}
          onOpenFile={openFileInDetails}
          onOpenFileWindow={(sha, path) => openDiffWindow({ source: { kind: 'commit', sha }, path, title: `${path} · ${shortSha(sha)}` })}
          onOpenWipFile={openWipFileInDetails}
        />
      </PaneSlot>
      <WhenShown views={COMMIT_VIEWS}>
        <CommitPanes selected={selected} focus={fileFocus} wip={wipFocus} />
      </WhenShown>
      <WhenShown views={CHANGES_VIEWS}>
        <ChangesView />
      </WhenShown>
      <WhenShown views={FILES_VIEWS}>
        <FilesPanes path={filePath} onPath={setFilePath} />
      </WhenShown>
      <WhenShown views={COMPARE_VIEWS}>
        <CompareView request={compare} onRequest={setCompare} />
      </WhenShown>
      <PaneSlot id="gitlog">
        <GitLogView />
      </PaneSlot>
      {studio && <CherryPickStudio request={studio} onClose={() => setStudio(null)} />}
      {conflict && <ConflictEditor path={conflict} onClose={() => setConflict(null)} />}
      {rebaseFrom && <RebaseEditor fromSha={rebaseFrom} onClose={() => setRebaseFrom(null)} />}
      {settingsDialogs}
      {dialog && <DialogHost dialog={dialog} onDone={() => setDialog(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {busyVisible && (
        <div className="busy" role="status" aria-live="polite">
          <Loader size="sm" label={`${busyLabel}…`} />
        </div>
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </AppContext.Provider>
  )
}
