import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import type { OpenRepositories, RepoInfo } from '../../shared/types'
import type { RecentRepo } from '../../shared/api'
import { applyDateFormat, applySettings, resolveLocale } from './appearance'
import { insideVsCode } from './vscodeBridge'
import {
  AppContext,
  type AppContextValue,
  type CompareRequest,
  type RepoData,
  type StudioRequest,
  type ToastAction,
  type ToastKind,
  type View,
  type WorkspaceApi
} from './context'
import { CherryPickStudio } from './components/CherryPickStudio'
import { ChangesView } from './components/ChangesView'
import { CloneDialog } from './components/CloneDialog'
import { CommitPanes, type FileFocus, type WipFocus } from './components/CommitDetails'
import { CommitList } from './components/CommitList'
import { CompareView } from './components/CompareView'
import { ConflictEditor } from './components/ConflictEditor'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
import { DialogHost, type ConfirmRequest, type DialogScope, type DialogState } from './components/Dialogs'
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
import { RepoTabs } from './components/RepoTabs'
import { Dock, type ViewMeta } from './components/Dock'
import { installCopy } from './copy'
import { errorMessage, shortSha } from './format'
import { gitCalls, gitFor, gitInBackground, markChanged, readCache, setActiveRoot } from './git'
import { draftPaths } from './editorDrafts'
import { getLocale, setLocale, t, type MessageKey } from './i18n'
import { resetLayout as clearLayout, useLayout } from './layout'
import { historySignature, mergeData } from './stable'
import { dropSession, getSession, peekSession, planFor, sessionState, trimSessions, type Wants } from './repoSession'
import { checkedRefs, scopeKey, scopeLogOptions, scopeOfRefs, type HistoryScope } from './historyScope'
import { REPO_VIEWS, viewAvailable, type ViewId } from './dock'
import { openScreen, useDock, useScreen } from './dockStore'
import { parseChangesMode, type ChangesMode } from './changesMode'
import { PaneSlot, WhenShown, useAnyShown } from './slots'
import {
  cycleIndex,
  normalizeRoot,
  prefixToast,
  repoColor,
  sameRoot,
  summarize,
  SWITCH_FORCE_HINT_MS,
  SWITCH_WAIT_MS,
  unsavedWork,
  type RepoSummary,
  type UnsavedReason
} from './workspace'

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

/** Painéis que usam o histórico de commits (o de branches usa as cores do grafo). */
const LOG_VIEWS: ViewId[] = ['history', 'branches']
/** Painéis que listam os stashes. */
const STASH_VIEWS: ViewId[] = ['stashes']

/** Texto do trabalho em aberto ("3 alterações não commitadas, uma operação em andamento"). */
function describeWork(work: UnsavedReason[]): string {
  return work
    .map((r) => (r.kind === 'changes' ? t('repoTabs.close.changes', { count: r.count }) : r.kind === 'operation' ? t('repoTabs.close.operation') : t('repoTabs.close.drafts', { count: r.count })))
    .join(', ')
}

/** Mesma lista (mesmos repositórios, na mesma ordem e com o mesmo ativo)? */
function sameOpened(a: OpenRepositories, b: OpenRepositories): boolean {
  return a.active === b.active && a.repos.length === b.repos.length && a.repos.every((r, i) => r.root === b.repos[i].root)
}

/**
 * Nível do app: as abas dos repositórios abertos, configurações, avisos e os diálogos do próprio app.
 * Cada aba é um `RepoView` com `key` do repositório: ao trocar de aba, ele é remontado do zero, e nenhum estado
 * (seleção, diff, filtros, rascunhos, caches) passa de um repositório para o outro.
 */
export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  /** Configurações em edição, aplicadas na hora para pré-visualização. */
  const [preview, setPreview] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [systemLocales, setSystemLocales] = useState<readonly string[]>(navigator.languages)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const [dialog, setDialog] = useState<{ state: DialogState; scope: DialogScope | null } | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** Repositórios abertos e o ativo, como o processo principal os tem. */
  const [opened, setOpened] = useState<OpenRepositories>({ repos: [], active: null })
  const openedRef = useRef(opened)
  const [loaded, setLoaded] = useState(false)
  const [summaries, setSummaries] = useState<Record<string, RepoSummary>>({})
  const summariesRef = useRef(summaries)
  summariesRef.current = summaries
  /** Troca de aba esperando as operações do repositório que sai ("aguardando a operação em …"). */
  const [waiting, setWaiting] = useState<{ repo: string; canForce: boolean } | null>(null)
  /** Commits sendo aplicados em outro repositório (rótulo do indicador). */
  const [crossBusy, setCrossBusy] = useState<string | null>(null)
  /** Trocas de repositório e aberturas/fechamentos rodam em fila, uma de cada vez. */
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const transitioning = useRef(false)
  /** Resolve quando o usuário escolhe "Trocar mesmo assim" na espera. */
  const forceWait = useRef<(() => void) | null>(null)

  const effective = preview ?? settings
  const locale = resolveLocale(effective, systemLocales)
  // O idioma precisa estar ativo antes de os componentes renderizarem seus textos.
  if (getLocale() !== locale) setLocale(locale)
  applyDateFormat(effective, systemLocales)

  useEffect(() => {
    applySettings(effective, locale)
  }, [effective, locale])

  /** Mostra um aviso; a mesma mensagem repetida logo em seguida vira um contador "×N" (ver `addToast`). */
  const toast = useCallback((kind: ToastKind, text: string, action?: ToastAction) => {
    const id = ++toastId.current
    setToasts((list) => addToast(list, { kind, text, action }, Date.now(), id))
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

  // Copiar em toda a tela: Ctrl+C copia a linha focada, e o botão direito onde não há menu próprio oferece copiar.
  useEffect(() => installCopy({ show: setMenu, notify: toast }), [toast])

  const askConfirm = useCallback(
    (request: ConfirmRequest, scope: DialogScope | null = null) =>
      new Promise<boolean>((resolve) => setDialog({ state: { kind: 'confirm', ...request, resolve }, scope })),
    []
  )

  const commit = useCallback((next: OpenRepositories) => {
    const roots = new Set(next.repos.map((r) => r.root))
    // Repositório fechado: esquece a sessão (dados e tela) e as leituras guardadas dele.
    for (const { root } of openedRef.current.repos) {
      if (roots.has(root)) continue
      dropSession(root)
      readCache.drop(root)
    }
    openedRef.current = next
    setOpened(next)
    setSummaries((prev) => {
      const kept = Object.entries(prev).filter(([root]) => roots.has(root))
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept)
    })
  }, [])

  /** Atualiza o resumo de um repositório (branch, alterações, conflito, operação) sem trocar para ele. */
  const refreshSummary = useCallback(async (root: string) => {
    try {
      const background = gitInBackground(root)
      const [status, operation] = await Promise.all([background.status(), background.operationState()])
      const next = summarize(status, operation.kind)
      setSummaries((prev) => (JSON.stringify(prev[root]) === JSON.stringify(next) ? prev : { ...prev, [root]: next }))
    } catch {
      // Repositório que sumiu da pasta ou da sessão: a aba fica sem indicadores.
    }
  }, [])

  const refreshAll = useCallback(
    (roots?: string[]) => Promise.all((roots ?? openedRef.current.repos.map((r) => r.root)).map((root) => refreshSummary(root))),
    [refreshSummary]
  )

  /**
   * Muda a lista aberta ou o ativo. Se o ativo vai mudar, segura as chamadas novas do repositório que sai e espera
   * as em andamento terminarem (com botão para trocar mesmo assim): assim, nenhuma operação de vários passos
   * continua no outro repositório. Cada chamada já saiu com o root em que foi pedida, então não há mistura.
   */
  const transition = useCallback(
    (changesActive: boolean, change: () => Promise<OpenRepositories | null>): Promise<void> => {
      const job = chain.current.then(async () => {
        // Só o repositório que sai (se a ativa muda) precisa ter as chamadas esperadas.
        const leaving = changesActive ? openedRef.current.active : null
        transitioning.current = true
        let hint: ReturnType<typeof setTimeout> | undefined
        try {
          if (leaving !== null) {
            gitCalls.close(leaving)
            const name = openedRef.current.repos.find((r) => r.root === leaving)?.name ?? ''
            const forced = new Promise<void>((resolve) => (forceWait.current = resolve))
            setWaiting({ repo: name, canForce: false })
            hint = setTimeout(() => setWaiting((w) => (w ? { ...w, canForce: true } : w)), SWITCH_FORCE_HINT_MS)
            const drained = await gitCalls.idle(leaving, { timeoutMs: SWITCH_WAIT_MS, forced })
            if (!drained) toast('warning', t('repoTabs.wait.forced', { repo: name }))
          }
          const next = await change()
          if (next) {
            commit(next)
            // Os indicadores das abas atualizam em segundo plano: não seguram a troca.
            void refreshAll(next.repos.map((r) => r.root))
          }
        } catch (error) {
          toast('error', errorMessage(error))
        } finally {
          if (hint !== undefined) clearTimeout(hint)
          forceWait.current = null
          if (leaving !== null) gitCalls.open(leaving)
          setWaiting(null)
          transitioning.current = false
        }
      })
      chain.current = job.catch(() => undefined)
      return job
    },
    [commit, refreshAll, toast]
  )

  const activate = useCallback(
    (root: string) => {
      if (root === openedRef.current.active) return
      void transition(true, async () => {
        await window.gittools.switchRepository(root)
        return window.gittools.openRepositories()
      })
    },
    [transition]
  )

  /** Abre (ou só ativa, se já está aberto) um repositório numa aba; sem caminho, pergunta a pasta. */
  const openRepo = useCallback(
    async (path?: string, create = false) => {
      let info: RepoInfo | null
      try {
        info = create ? await window.gittools.initRepository() : await window.gittools.openRepository(path)
      } catch (error) {
        toast('error', errorMessage(error))
        return
      }
      if (!info || info.root === openedRef.current.active) return
      await transition(true, () => window.gittools.openRepositories())
    },
    [toast, transition]
  )

  const closeRepo = useCallback(
    async (root: string) => {
      const repo = openedRef.current.repos.find((r) => r.root === root)
      if (!repo) return
      const work = unsavedWork(summariesRef.current[root], draftPaths(root).length)
      if (work.length > 0) {
        const ok = await askConfirm(
          {
            title: t('repoTabs.close.title', { repo: repo.name }),
            message: t('repoTabs.close.message', { details: describeWork(work) }),
            confirmLabel: t('repoTabs.close.confirm')
          },
          { repo, several: openedRef.current.repos.length > 1 }
        )
        if (!ok) return
      }
      await transition(root === openedRef.current.active, () => window.gittools.closeRepository(root))
    },
    [askConfirm, transition]
  )

  const closeOthers = useCallback(
    async (keep: string) => {
      const others = openedRef.current.repos.filter((r) => r.root !== keep)
      const withWork = others.filter((r) => unsavedWork(summariesRef.current[r.root], draftPaths(r.root).length).length > 0)
      if (withWork.length > 0) {
        const ok = await askConfirm({
          title: t('repoTabs.closeOthersDialog.title'),
          message: t('repoTabs.closeOthersDialog.message', { details: t('repoTabs.closeOthersDialog.hasWork', { names: withWork.map((r) => r.name).join(', ') }) }),
          confirmLabel: t('repoTabs.close.confirm')
        })
        if (!ok) return
      }
      // Quem fica precisa ser o ativo antes de os outros saírem (o processo principal ativa o vizinho ao fechar o ativo).
      if (openedRef.current.active !== keep) {
        await transition(true, async () => {
          await window.gittools.switchRepository(keep)
          return window.gittools.openRepositories()
        })
      }
      for (const repo of others) await transition(false, () => window.gittools.closeRepository(repo.root))
    },
    [askConfirm, transition]
  )

  /**
   * O ponteiro parou sobre a aba de outro repositório: lê o básico dele em segundo plano (poucas leituras por vez),
   * e a troca de aba acha tudo no cache. Repositório já em dia não é lido.
   */
  const warm = useCallback((root: string) => {
    if (root === openedRef.current.active || transitioning.current) return
    const session = peekSession(root)
    if (session?.data && session.loaded && session.loaded.generation === readCache.generation(root)) return
    const background = gitInBackground(root)
    void Promise.all([background.status(true), background.refs(), background.operationState()]).catch(() => undefined)
  }, [])

  const cycle = useCallback(
    (delta: 1 | -1) => {
      const { repos, active } = openedRef.current
      const next = cycleIndex(repos.length, repos.findIndex((r) => r.root === active), delta)
      if (next >= 0 && repos[next].root !== active) activate(repos[next].root)
    },
    [activate]
  )

  /**
   * Aplica commits do repositório `sourceRoot` na branch atual de `targetRoot`. Só depois de confirmar, com origem e
   * destino escritos. Antes, mostra o motivo se o destino não aceita (sujo, sem branch, operação em andamento).
   */
  const applyAcross = useCallback(
    async (sourceRoot: string, targetRoot: string, shas: string[]) => {
      const { repos } = openedRef.current
      const source = repos.find((r) => sameRoot(r.root, sourceRoot))
      const target = repos.find((r) => sameRoot(r.root, targetRoot))
      if (!source || !target || shas.length === 0) return
      if (source.root === target.root) return toast('warning', t('multiRepo.sameRepository'))
      const s = summariesRef.current[target.root]
      const blocked: MessageKey | null = !s
        ? null
        : s.detached
          ? 'multiRepo.targetDetached'
          : s.changes > 0
            ? 'multiRepo.targetDirty'
            : s.operation !== 'none'
              ? 'multiRepo.targetBusy'
              : null
      if (blocked) return toast('warning', t(blocked, { root: target.name }))

      const branch = !s ? '…' : s.detached ? (s.headSha?.slice(0, 7) ?? t('repoTabs.noBranch')) : (s.branch ?? t('repoTabs.noBranch'))
      const ok = await askConfirm(
        {
          title: t('repoTabs.cross.title', { target: target.name }),
          message: [
            t('repoTabs.cross.origin', { repo: source.name, commits: t('history.count', { count: shas.length }) }),
            t('repoTabs.cross.destination', { repo: target.name, branch }),
            '',
            t('repoTabs.cross.note')
          ].join('\n'),
          confirmLabel: t('repoTabs.cross.confirm')
        },
        { repo: target, several: true }
      )
      if (!ok) return

      setCrossBusy(t('busy.cherryPick'))
      const goTo: ToastAction = { label: t('repoTabs.cross.goTo', { repo: target.name }), run: () => activate(target.root) }
      try {
        const result = await window.gittools.cherryPickAcross(source.root, target.root, shas)
        if (result.ok) toast('success', prefixToast(result.message || t('repoTabs.cross.done', { target: target.name }), target.name, true), goTo)
        else toast('warning', prefixToast(t('repoTabs.cross.conflict', { target: target.name }), target.name, true), goTo)
      } catch (error) {
        toast('error', prefixToast(errorMessage(error), target.name, true))
      } finally {
        setCrossBusy(null)
        // O cherry-pick entre repositórios não passa pelo proxy do git: avisa o cache de que o destino mudou.
        markChanged(source.root, target.root)
        void refreshAll([source.root, target.root])
      }
    },
    [activate, askConfirm, refreshAll, toast]
  )

  const workspace = useMemo<WorkspaceApi>(
    () => ({
      repos: opened.repos,
      summaries,
      activate,
      close: (root) => void closeRepo(root),
      closeOthers: (root) => void closeOthers(root),
      cycle,
      openRepo: (path, create) => void openRepo(path, create),
      openClone: () => setCloneOpen(true),
      applyAcross: (sourceRoot, targetRoot, shas) => void applyAcross(sourceRoot, targetRoot, shas)
    }),
    [opened.repos, summaries, activate, closeRepo, closeOthers, cycle, openRepo, applyAcross]
  )

  // Carga inicial: os repositórios reabertos da última sessão (e o ativo, que pode ter vindo da linha de comando).
  useEffect(() => {
    window.gittools.getSettings().then(setSettings, () => undefined)
    window.gittools.appInfo().then((info) => setSystemLocales(info.systemLocales), () => undefined)
    window.gittools
      .openRepositories()
      .then((state) => {
        commit(state)
        void refreshAll(state.repos.map((r) => r.root))
      }, () => undefined)
      .finally(() => setLoaded(true))
  }, [commit, refreshAll])

  // Mudanças nos repositórios: o de outra aba só atualiza o indicador dela. Ao ganhar o foco, confere a lista
  // (ela pode ter mudado por fora, como um repositório aberto pelo VS Code).
  useEffect(
    () =>
      window.gittools.onRepositoryChanged((root) => {
        if (root !== undefined) {
          // Mudou por fora (ou por outra aba): o que estava guardado deste repositório deixa de valer.
          readCache.invalidate(root)
          if (openedRef.current.repos.some((r) => r.root === root)) void refreshSummary(root)
          return
        }
        // A janela voltou a ter foco: qualquer repositório pode ter mudado na pasta de trabalho.
        readCache.invalidateAll()
        void refreshAll()
        if (transitioning.current) return
        void window.gittools.openRepositories().then((next) => {
          if (!transitioning.current && !sameOpened(next, openedRef.current)) void transition(next.active !== openedRef.current.active, async () => next)
        }, () => undefined)
      }),
    [refreshSummary, refreshAll, transition]
  )

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next)
    await window.gittools.saveSettings(next)
  }, [])

  const tabMenu = (event: React.MouseEvent, root: string) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t('repoTabs.closeThis'), onClick: () => void closeRepo(root) },
        { label: t('repoTabs.closeOthers'), onClick: () => void closeOthers(root), disabled: opened.repos.length < 2 }
      ]
    })
  }

  /** "+" da barra: abrir, criar, clonar e os recentes (os já abertos aparecem marcados). */
  const addMenu = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const { clientX: x, clientY: y } = event
    const recents: RecentRepo[] = await window.gittools.recentRepositories().catch(() => [])
    const openRoots = new Set(opened.repos.map((r) => normalizeRoot(r.root)))
    const recentItem = (r: RecentRepo): MenuItem => ({
      label: `${r.favorite ? '★ ' : ''}${r.name}${openRoots.has(normalizeRoot(r.path)) ? ` · ${t('repoTabs.openBadge')}` : ''}`,
      hint: r.path,
      onClick: () => void openRepo(r.path)
    })
    const items: MenuItem[] = [
      { label: t('toolbar.openRepository'), onClick: () => void openRepo() },
      { label: t('toolbar.createRepository'), onClick: () => void openRepo(undefined, true) },
      { label: t('clone.menu'), onClick: () => setCloneOpen(true) },
      ...(recents.length > 0 ? (['separator' as const, ...recents.slice(0, 10).map(recentItem)] as MenuItem[]) : [])
    ]
    setMenu({ x, y, items })
  }

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
          onCloned={() => {
            setCloneOpen(false)
            void transition(true, () => window.gittools.openRepositories())
          }}
        />
      )}
    </>
  )

  const activeRepo = opened.repos.find((r) => r.root === opened.active) ?? null
  const appModalOpen = !!(settingsOpen || helpOpen || cloneOpen || dialog)

  if (!activeRepo) {
    // Sem repositório na tela, nenhuma chamada git deve ir para o último que saiu.
    setActiveRoot(null)
    return (
      <>
        <Welcome
          loading={!loaded}
          onOpen={(path, create) => void openRepo(path, create)}
          onClone={() => setCloneOpen(true)}
          onSettings={() => setSettingsOpen('general')}
        />
        {settingsDialogs}
        {dialog && <DialogHost dialog={dialog.state} scope={dialog.scope} onDone={() => setDialog(null)} />}
        <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
      </>
    )
  }

  return (
    <>
      <div className="app workspace-app" style={{ '--repo': repoColor(activeRepo.root) } as CSSProperties}>
        <div className="repo-stripe" aria-hidden />
        <RepoTabs
          repos={opened.repos}
          active={activeRepo.root}
          summaries={summaries}
          onActivate={activate}
          onClose={(root) => void closeRepo(root)}
          onMenu={tabMenu}
          onAdd={(e) => void addMenu(e)}
          onDropCommits={(target, shas) => void applyAcross(activeRepo.root, target, shas)}
          onWarm={warm}
        />
        <RepoView
          key={activeRepo.root}
          repo={activeRepo}
          several={opened.repos.length > 1}
          workspace={workspace}
          settings={settings}
          notify={toast}
          appModalOpen={appModalOpen}
          openSettings={(section) => setSettingsOpen(section ?? 'general')}
          openShortcuts={() => setHelpOpen(true)}
        />
        {crossBusy && (
          <div className="busy" role="status" aria-live="polite">
            <Loader size="sm" label={`${crossBusy}…`} />
          </div>
        )}
      </div>
      {waiting && (
        <div className="repo-wait" role="status" aria-live="polite">
          <div className="repo-wait-card">
            <Loader size="sm" label={t('repoTabs.wait.title', { repo: waiting.repo })} />
            <p className="muted small">{t('repoTabs.wait.help')}</p>
            {waiting.canForce && (
              <button className="primary" onClick={() => forceWait.current?.()}>
                {t('repoTabs.wait.force')}
              </button>
            )}
          </div>
        </div>
      )}
      {settingsDialogs}
      {dialog && <DialogHost dialog={dialog.state} scope={dialog.scope} onDone={() => setDialog(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </>
  )
}

interface RepoViewProps {
  repo: RepoInfo
  /** Há mais de um repositório aberto: os avisos citam o nome deste. */
  several: boolean
  workspace: WorkspaceApi
  settings: Settings
  /** Avisa no nível do app (o prefixo do repositório já foi acrescentado, quando cabe). */
  notify(kind: ToastKind, text: string, action?: ToastAction): void
  /** Configurações, ajuda ou clonagem abertas no nível do app: os atalhos desta aba ficam quietos. */
  appModalOpen: boolean
  openSettings(section?: string): void
  openShortcuts(): void
}

/**
 * A tela de um repositório (uma aba). Todo o estado daqui é deste repositório, e a aba é remontada a cada troca.
 */
function RepoView({ repo, several, workspace, settings, notify, appModalOpen, openSettings, openShortcuts }: RepoViewProps) {
  // As chamadas do proxy `git` passam a ir para este repositório (ver git.ts).
  setActiveRoot(repo.root)
  /** Sessão do repositório: sobrevive à troca de aba e devolve os dados e a tela como estavam (ver repoSession.ts). */
  const session = getSession(repo.root)
  /** Chamadas presas a este repositório: uma leitura em andamento nunca termina no repositório de outra aba. */
  const gitOn = useMemo(() => gitFor(repo.root), [repo.root])
  const [data, setData] = useState<RepoData | null>(() => session.data)
  const [dock, setDock] = useDock()
  const [screen] = useScreen()
  const [changesMode] = useLayout<ChangesMode>('pref.changesMode', parseChangesMode)
  const [scope, setScope] = useState<HistoryScope>(() => session.ui.scope)
  const [selected, setSelected] = useState<string[]>(() => session.ui.selected)
  const [fileFocus, setFileFocus] = useState<FileFocus | null>(() => session.ui.fileFocus)
  const [wipFocus, setWipFocus] = useState<WipFocus | null>(() => session.ui.wipFocus)
  /** Operação em andamento: o rótulo e os painéis que ela atinge (ver `run`). */
  const [operation, setOperation] = useState<{ label: string; scope: readonly ViewId[] } | null>(null)
  const busy = operation?.label ?? null
  const busyScope = operation?.scope ?? NO_VIEWS
  /** O indicador compacto fica na tela um pouco depois de a operação acabar: mantém o rótulo dela nesse tempo. */
  const busyVisible = useDelayedLoading(busy !== null)
  const busyLabel = useLastDefined(busy)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [studio, setStudio] = useState<StudioRequest | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [compare, setCompare] = useState<CompareRequest>(() => session.ui.compare)
  const [filePath, setFilePath] = useState<string | null>(() => session.ui.filePath)
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null)
  /** A tela de Dashboards está aberta (no lugar dos painéis, que continuam montados por trás). */
  const [dashboardsOpen, setDashboards] = useState(false)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // O que o usuário estava vendo volta igual ao retornar a esta aba.
  useEffect(() => {
    Object.assign(session.ui, { scope, selected, fileFocus, wipFocus, compare, filePath })
  }, [session, scope, selected, fileFocus, wipFocus, compare, filePath])

  // Poucas sessões guardam dados ao mesmo tempo; as mais antigas voltam a ser lidas ao serem abertas.
  useEffect(() => {
    trimSessions(repo.root)
  }, [repo.root])

  /**
   * Só o que está na tela é carregado. O histórico serve ao painel Histórico e às cores das branches; os stashes,
   * ao painel Stashes e aos dashboards. Status, branches, tags e operação sempre vêm (as abas e as demais telas
   * dependem deles). Quando um painel aparece, a leitura que faltava é feita na hora (ver `ensureFresh`).
   */
  const logShown = useAnyShown(LOG_VIEWS)
  const stashesShown = useAnyShown(STASH_VIEWS) || dashboardsOpen
  const wants = useMemo<Wants>(() => ({ log: logShown, stashes: stashesShown }), [logShown, stashesShown])
  const wantsRef = useRef(wants)
  wantsRef.current = wants

  /** Avisos desta aba: citam o repositório quando há mais de um aberto. */
  const toast = useCallback(
    (kind: ToastKind, text: string, action?: ToastAction) => notify(kind, prefixToast(text, repo.name, several), action),
    [notify, repo.name, several]
  )

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
   * Baixa o estado do repositório (passando pelo cache de leituras: o que não mudou desde a última vez não chama o
   * git). O histórico só é baixado de novo se algo mudou de lugar (ver `historySignature`) e só se estiver na tela.
   */
  const load = useCallback(async () => {
    try {
      const s = scopeRef.current
      const prev = session.data
      // Primeira leitura: traz o histórico mesmo que o painel ainda não tenha aparecido (os painéis se encaixam depois do primeiro desenho).
      const needs: Wants = { log: wantsRef.current.log || prev === null, stashes: wantsRef.current.stashes }
      // Geração anotada antes de ler: se algo mudar durante a leitura, o resultado já nasce como "stale".
      const generation = readCache.generation(repo.root)
      const [status, refs, operation, stashes] = await Promise.all([
        gitOn.status(true),
        gitOn.refs(),
        gitOn.operationState(),
        needs.stashes ? gitOn.stashes() : Promise.resolve(prev?.stashes ?? [])
      ])
      const { branches, tags } = refs
      // Uma branch marcada que foi excluída ou renomeada sai do filtro (o novo escopo dispara outra leitura).
      const names = new Set(branches.map((b) => b.name))
      const marked = checkedRefs(s)
      if (marked.some((name) => !names.has(name))) {
        setScope(scopeOfRefs(marked.filter((name) => names.has(name))))
        return
      }
      let log = prev?.log ?? []
      if (needs.log) {
        const key = historySignature(scopeKey(s), status, branches, tags)
        const cached = session.logCache?.key === key ? session.logCache.log : null
        if (cached) log = cached
        else {
          const fetched = await gitOn.log(scopeLogOptions(s)).catch((e) => {
            toast('error', errorMessage(e))
            return null
          })
          if (fetched) session.logCache = { key, log: fetched }
          log = fetched ?? session.logCache?.log ?? []
        }
      }
      session.data = mergeData(session.data, { status, branches, tags, stashes, log, operation })
      session.loaded = { generation, scopeKey: scopeKey(s), log: needs.log, stashes: needs.stashes }
      setData(session.data)
    } catch (error) {
      toast('error', errorMessage(error))
    }
  }, [session, gitOn, repo.root, toast])

  /**
   * Só uma leitura roda por vez por repositório, mesmo que a aba suma e volte: pedidos que chegam no meio (foco da
   * janela, alteração na pasta .git, fim de uma operação) viram uma única nova rodada, em vez de várias em paralelo.
   */
  const runLoad = useCallback((): Promise<void> => {
    if (session.inflight) {
      session.again = true
      return session.inflight
    }
    const round = (async () => {
      try {
        do {
          session.again = false
          await load()
        } while (session.again)
      } finally {
        session.inflight = null
      }
    })()
    session.inflight = round
    return round
  }, [session, load])

  /** Leitura que decide sozinha se é preciso: dados em dia não chamam o git; dados velhos aparecem e são relidos por trás. */
  const ensureFresh = useCallback(async () => {
    // Poucas voltas: se o repositório não para de mudar, cada aviso dele já agenda a sua própria leitura.
    for (let turn = 0; turn < 3; turn++) {
      const state = sessionState({
        hasData: session.data !== null,
        loaded: session.loaded,
        loading: session.inflight !== null,
        generation: readCache.generation(repo.root),
        scopeKey: scopeKey(scopeRef.current),
        wants: wantsRef.current
      })
      const plan = planFor(state)
      if (plan === 'use-cached') {
        if (session.data) setData(session.data)
        return
      }
      if (plan === 'wait') await session.inflight
      else await runLoad()
    }
  }, [session, repo.root, runLoad])

  /** Atualização pedida (depois de uma operação, de um aviso do git…): invalida as leituras guardadas e lê de novo. */
  const refresh = useCallback((): Promise<void> => {
    readCache.invalidate(repo.root)
    return runLoad()
  }, [repo.root, runLoad])

  // Ao abrir a aba, ao mudar o filtro de branches ou quando um painel novo aparece: lê só o que falta.
  useEffect(() => {
    void ensureFresh()
  }, [repo.root, scope, wants, ensureFresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.gittools.onRepositoryChanged((root) => {
      // Mudança em outro repositório não mexe nos dados desta aba (o indicador dela fica no nível do app).
      if (root !== undefined && root !== repo.root) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 150)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [repo.root, refresh])

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

  const openDiffWindow = useCallback(
    (request: Parameters<AppContextValue['openDiffWindow']>[0]) => {
      // A janela de diff guarda o repositório: ela não deve usar o ativo quando a aba mudar.
      window.gittools.openDiffWindow({ ...request, root: repo.root }).catch((error) => toast('error', errorMessage(error)))
    },
    [toast, repo.root]
  )

  const context = useMemo<AppContextValue | null>(() => {
    if (!data) return null
    return {
      repo,
      workspace,
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
          openSettings('editor')
          return
        }
        window.gittools.openInEditor(path, repo.root).catch((error) => toast('error', errorMessage(error)))
      },
      settings,
      openSettings,
      openShortcuts
    }
    // locale: força novos textos nos componentes quando o idioma muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, workspace, data, busy, busyScope, refresh, run, toast, settings, setView, dashboardsOpen, openDiffWindow, resetLayout, askConfirm, openSettings, openShortcuts])

  if (!context) {
    return (
      <div className="repo-loading">
        <Loader size="sm" label={t('welcome.loading')} />
      </div>
    )
  }

  const changeCount = data!.status.staged.length + data!.status.unstaged.length + data!.status.conflicted.length
  const modalOpen = !!(studio || conflict || rebaseFrom || dialog || appModalOpen)

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
      <KeyboardShortcuts disabled={modalOpen} onOpenRepository={() => void workspace.openRepo()} />
      <Toolbar onOpenRepository={(path, create) => void workspace.openRepo(path, create)} onClone={workspace.openClone} />
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
      {dialog && <DialogHost dialog={dialog} onDone={() => setDialog(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {busyVisible && (
        <div className="busy" role="status" aria-live="polite">
          <Loader size="sm" label={`${busyLabel}…`} />
        </div>
      )}
    </AppContext.Provider>
  )
}
