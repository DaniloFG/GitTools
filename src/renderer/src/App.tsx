import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Settings } from '../../shared/settings'
import type { OpenRepositories, RepoInfo } from '../../shared/types'
import type { RecentRepo } from '../../shared/api'
import { applyDateFormat, applySettings, bootSettings, resolveLocale, useLocaleCatalog } from './appearance'
import { insideVsCode } from './vscodeBridge'
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
  type CompareRequest,
  type RepoData,
  type RepoDataValue,
  type StudioRequest,
  type ToastAction,
  type ToastKind,
  type View,
  type WorkspaceApi
} from './context'
import { ChangesView } from './components/ChangesView'
import { CommitPanes, type FileFocus, type WipFocus } from './components/CommitDetails'
import { CommitList } from './components/CommitList'
import { ContextMenu, type MenuItem, type MenuState } from './components/ContextMenu'
// Só tipos: a tela de diálogos é carregada sob demanda (ver lazyScreens.ts).
import type { ConfirmRequest, DialogScope, DialogState } from './components/Dialogs'
import { CherryPickStudio, CloneDialog, CompareView, ConflictsScreen, Dashboards, DialogHost, RebaseEditor, SettingsCenter, ShortcutsHelp } from './lazyScreens'
import { FilesPanes } from './components/FilesView'
import { GitLogView } from './components/GitLogView'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ConflictFlowProvider, type ConflictFocus } from './components/ConflictFlow'
import { OperationBanner } from './components/OperationBanner'
import { SidebarPanes } from './components/Sidebar'
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
import { gitCalls, gitFor, gitInBackground, markChanged, OWN_CHANGE_WINDOW_MS, readCache, setActiveRoot } from './git'
import { draftPaths } from './editorDrafts'
import { getLocale, t, type MessageKey } from './i18n'
import { resetLayout as clearLayout, useLayout } from './layout'
import { clearCurrentLayout } from './savedLayouts'
import { historySignature, mergeData } from './stable'
import { shouldOpenOnStartup } from './conflictScreenPolicy'
import { createSingleFlight, SKIPPED } from './singleFlight'
import { dropSession, getSession, isOwnEcho, peekSession, planFor, sessionState, trimSessions, type Wants } from './repoSession'
import { canLoadMoreLog, checkedRefs, logLimitFor, nextLogPage, scopeKey, scopeLogOptions, scopeOfRefs, type HistoryScope } from './historyScope'
import { REPO_VIEWS, viewAvailable, type ViewId } from './dock'
import { forgetScreen, openScreen, readScreen, setScreenRoot } from './dockStore'
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
/** Painel do histórico que lista as alterações não commitadas (WipRow, montado só no slot `history`). */
const WIP_LIST_VIEWS: ViewId[] = ['history']
/**
 * Painel do blame. A assinatura que decide a releitura dele (`blameSignature`, em blameRows.ts) usa as contagens do
 * status: sem elas, editar um arquivo não mudaria a assinatura e o blame deixaria de ser relido. Por isso ele conta.
 */
const BLAME_VIEWS: ViewId[] = ['files.blame']

/** Texto do trabalho em aberto ("3 alterações não commitadas, uma operação em andamento"). */
function describeWork(work: UnsavedReason[]): string {
  return work
    .map((r) => (r.kind === 'changes' ? t('repoTabs.close.changes', { count: r.count }) : r.kind === 'operation' ? t('repoTabs.close.operation') : t('repoTabs.close.drafts', { count: r.count })))
    .join(', ')
}

/**
 * Repositórios para os quais a tela Conflitos já foi avaliada na partida nesta sessão. Fica fora do componente
 * porque cada aba é remontada a cada troca (`key` do RepoView): sem isso, voltar à aba reabriria a tela que o
 * usuário fechou. Sai do conjunto quando o repositório é fechado (ver `commit`).
 */
const conflictsStartupSeen = new Set<string>()

/** Mesma lista (mesmos repositórios, na mesma ordem e com o mesmo ativo)? */
function sameOpened(a: OpenRepositories, b: OpenRepositories): boolean {
  return a.active === b.active && a.repos.length === b.repos.length && a.repos.every((r, i) => r.root === b.repos[i].root)
}

/**
 * Última decisão de `isEcho`. Os dois ouvintes perguntam sobre o MESMO aviso, um após o outro, de forma síncrona;
 * a primeira resposta "eco" consome o carimbo, então a segunda pergunta precisa receber a mesma resposta.
 * Limpa no microtask seguinte, quando os dois ouvintes já terminaram: o aviso seguinte é decidido do zero.
 */
let lastEcho: { root: string; echo: boolean } | null = null

/**
 * O aviso do observador para `root` é eco de uma alteração feita por esta interface, e os dados já foram lidos
 * depois dela (ver `isOwnEcho`). O ouvinte do app e o da aba usam esta mesma função: nenhum invalida antes.
 */
function isEcho(root: string): boolean {
  if (lastEcho?.root === root) return lastEcho.echo
  const session = peekSession(root)
  const echo = isOwnEcho({
    ownChange: readCache.hasRecentChange(root, OWN_CHANGE_WINDOW_MS),
    generation: readCache.generation(root),
    lastLoaded: session?.loaded?.generation ?? null,
    loadingGeneration: session?.loadingGeneration ?? null,
    again: session?.again ?? false
  })
  // Eco de uma alteração já lida: o carimbo sai, para que um commit do terminal logo depois não passe por eco.
  if (echo) readCache.consumeChange(root)
  lastEcho = { root, echo }
  queueMicrotask(() => {
    lastEcho = null
  })
  return echo
}

/**
 * Nível do app: as abas dos repositórios abertos, configurações, avisos e os diálogos do próprio app.
 * Cada aba é um `RepoView` com `key` do repositório: ao trocar de aba, ele é remontado do zero, e nenhum estado
 * (seleção, diff, filtros, rascunhos, caches) passa de um repositório para o outro.
 */
export function App() {
  const [settings, setSettings] = useState<Settings>(bootSettings)
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
  // O idioma precisa estar ativo antes de os componentes renderizarem seus textos (troca só com o catálogo carregado).
  const locale = useLocaleCatalog(resolveLocale(effective, systemLocales))
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

  // Abrir configurações e atalhos só troca estado com setters estáveis. Sem isto, a função mudaria a cada aviso
  // (o App redesenha ao mudar `toasts`) e arrastaria junto o valor de ações de cada repositório (ver RepoView).
  const openSettings = useCallback((section?: string) => setSettingsOpen(section ?? 'general'), [])
  const openShortcuts = useCallback(() => setHelpOpen(true), [])

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
      conflictsStartupSeen.delete(root)
      // A tela da aba também é esquecida: reabri-la começa no Histórico (ver dockStore.ts).
      forgetScreen(root)
      readCache.drop(root)
    }
    openedRef.current = next
    setOpened(next)
    setSummaries((prev) => {
      const kept = Object.entries(prev).filter(([root]) => roots.has(root))
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept)
    })
  }, [])

  /** Guarda o resumo de um repositório; se for igual ao que já está, a lista de abas nem redesenha. */
  const applySummary = useCallback((root: string, next: RepoSummary) => {
    setSummaries((prev) => (JSON.stringify(prev[root]) === JSON.stringify(next) ? prev : { ...prev, [root]: next }))
  }, [])

  /** Atualiza o resumo de um repositório (branch, alterações, conflito, operação) sem trocar para ele. */
  const refreshSummary = useCallback(
    async (root: string) => {
      // A aba ativa não é lida aqui: a tela dela já leu status e operação, e envia o resumo (ver RepoView).
      if (root === openedRef.current.active) return
      try {
        const background = gitInBackground(root)
        const [status, operation] = await Promise.all([background.status(), background.operationState()])
        applySummary(root, summarize(status, operation.kind))
      } catch {
        // Repositório que sumiu da pasta ou da sessão: a aba fica sem indicadores.
      }
    },
    [applySummary]
  )

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
          // Eco de uma alteração desta interface: os dados já foram lidos depois dela. Nada a invalidar.
          if (isEcho(root)) return
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

  /**
   * Clique no alerta de conflito da aba ativa. O estado da tela Conflitos é do RepoView (some com a aba), então o
   * pedido vai como um contador: o RepoView abre a tela quando o número muda. Outra aba só é ativada (ver RepoTabs).
   */
  const [conflictsRequest, setConflictsRequest] = useState(0)
  const openConflictsFromTab = useCallback(() => setConflictsRequest((n) => n + 1), [])

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

  // Um Suspense por tela sob demanda: se uma delas suspende pela primeira vez enquanto outra já está aberta, um
  // Suspense compartilhado esconderia a já aberta até o pedaço novo chegar. Separados, cada um só segura a sua.
  const settingsDialogs = (
    <>
      {settingsOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
      {helpOpen && (
        <Suspense fallback={null}>
          <ShortcutsHelp settings={settings} onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
      {cloneOpen && (
        <Suspense fallback={null}>
          <CloneDialog
            onClose={() => setCloneOpen(false)}
            onCloned={() => {
              setCloneOpen(false)
              void transition(true, () => window.gittools.openRepositories())
            }}
          />
        </Suspense>
      )}
    </>
  )

  const activeRepo = opened.repos.find((r) => r.root === opened.active) ?? null
  const appModalOpen = !!(settingsOpen || helpOpen || cloneOpen || dialog)

  if (!activeRepo) {
    // Sem repositório na tela, nenhuma chamada git deve ir para o último que saiu.
    setActiveRoot(null)
    setScreenRoot('')
    return (
      <>
        <Welcome
          loading={!loaded}
          onOpen={(path, create) => void openRepo(path, create)}
          onClone={() => setCloneOpen(true)}
          onSettings={() => setSettingsOpen('general')}
        />
        {settingsDialogs}
        <Suspense fallback={null}>
          {dialog && <DialogHost dialog={dialog.state} scope={dialog.scope} onDone={() => setDialog(null)} />}
        </Suspense>
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
          onConflicts={openConflictsFromTab}
        />
        <RepoView
          key={activeRepo.root}
          repo={activeRepo}
          several={opened.repos.length > 1}
          workspace={workspace}
          settings={settings}
          onSummary={applySummary}
          notify={toast}
          appModalOpen={appModalOpen}
          openSettings={openSettings}
          openShortcuts={openShortcuts}
          onSaveSettings={saveSettings}
          conflictsRequest={conflictsRequest}
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
      <Suspense fallback={null}>
        {dialog && <DialogHost dialog={dialog.state} scope={dialog.scope} onDone={() => setDialog(null)} />}
      </Suspense>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </>
  )
}

/**
 * Monta as quatro fatias (dados, operação, ações, configurações) e o valor combinado de `AppContext`, que quem ainda
 * lê o contexto direto usa. A ordem dos provedores não muda nada: cada um só é lido pelos seus hooks.
 */
function AppProviders({
  repoData,
  busy,
  actions,
  settings,
  app,
  onSaveSettings,
  conflictFocus,
  children
}: {
  repoData: RepoDataValue
  busy: BusyValue
  actions: AppActions
  settings: AppSettingsValue
  app: AppContextValue
  onSaveSettings(next: Settings): Promise<void>
  conflictFocus: ConflictFocus | null
  children: ReactNode
}) {
  return (
    <RepoDataContext.Provider value={repoData}>
      <BusyContext.Provider value={busy}>
        <AppActionsContext.Provider value={actions}>
          <AppSettingsContext.Provider value={settings}>
            <AppContext.Provider value={app}>
              {/* Estado do fluxo de conflitos (continuar sozinho, decisões lembradas): fica aqui para rodar com a tela fechada. */}
              <ConflictFlowProvider onSaveSettings={onSaveSettings} focus={conflictFocus}>
                {children}
              </ConflictFlowProvider>
            </AppContext.Provider>
          </AppSettingsContext.Provider>
        </AppActionsContext.Provider>
      </BusyContext.Provider>
    </RepoDataContext.Provider>
  )
}

/**
 * Limite `memo` para os filhos diretos do RepoView. O RepoView guarda a seleção, o foco e a operação em andamento,
 * e redesenha a cada clique na lista, seta ou operação; sem este limite a barra de ferramentas, o Dock, a barra
 * lateral e todas as telas redesenhavam junto, mesmo sem nada novo para elas (o contexto estreito não evita isso,
 * porque o redesenho vem do pai, por propriedade). Com `memo`, cada um só redesenha quando as próprias propriedades
 * mudam ou quando a fatia de contexto que lê muda. As propriedades passadas a eles precisam ser estáveis
 * (`useCallback`, `useMemo` ou setters do `useState`).
 *
 * `locale` entra nas propriedades de todos de propósito: quem chama `t()` sem ler contexto (ex.: as dicas de
 * `CommitPanes`, os textos de `FilesPanes`) também se renova quando o idioma troca. O componente ignora o valor;
 * ele só serve para a comparação do `memo` ver a troca.
 */
function paneMemo<P extends object>(component: (props: P) => ReactNode) {
  return memo(component as (props: P & { locale: string }) => ReactNode)
}

const KeyboardShortcutsPane = paneMemo(KeyboardShortcuts)
const ToolbarPane = paneMemo(Toolbar)
const OperationBannerPane = paneMemo(OperationBanner)
const DockPane = paneMemo(Dock)
const DashboardsPane = memo(Dashboards)
const ConflictsScreenPane = memo(ConflictsScreen)
const SidebarPanesPane = paneMemo(SidebarPanes)
const CommitListPane = paneMemo(CommitList)
const CommitPanesPane = paneMemo(CommitPanes)
const ChangesViewPane = paneMemo(ChangesView)
const FilesPanesPane = paneMemo(FilesPanes)
const CompareViewPane = memo(CompareView)
const GitLogViewPane = paneMemo(GitLogView)

interface RepoViewProps {
  repo: RepoInfo
  /** Há mais de um repositório aberto: os avisos citam o nome deste. */
  several: boolean
  workspace: WorkspaceApi
  settings: Settings
  /** Entrega o resumo de um repositório (calculado dos dados que a própria tela já leu, sem outra leitura do git). */
  onSummary(root: string, summary: RepoSummary): void
  /** Avisa no nível do app (o prefixo do repositório já foi acrescentado, quando cabe). */
  notify(kind: ToastKind, text: string, action?: ToastAction): void
  /** Configurações, ajuda ou clonagem abertas no nível do app: os atalhos desta aba ficam quietos. */
  appModalOpen: boolean
  openSettings(section?: string): void
  openShortcuts(): void
  /** Grava as configurações (usada pelo "Continuar automaticamente" da tela Conflitos). */
  onSaveSettings(next: Settings): Promise<void>
  /** Contador de pedidos para abrir a tela Conflitos vindos do alerta da aba (ver `openConflictsFromTab`). */
  conflictsRequest: number
}

/**
 * A tela de um repositório (uma aba). Todo o estado daqui é deste repositório, e a aba é remontada a cada troca.
 */
function RepoView({ repo, several, workspace, settings, onSummary, notify, appModalOpen, openSettings, openShortcuts, onSaveSettings, conflictsRequest }: RepoViewProps) {
  // As chamadas do proxy `git` passam a ir para este repositório (ver git.ts).
  setActiveRoot(repo.root)
  // A tela aberta (menu do topo) é de cada aba: a aba ativa é a raiz deste repositório (ver dockStore.ts).
  setScreenRoot(repo.root)
  /** Sessão do repositório: sobrevive à troca de aba e devolve os dados e a tela como estavam (ver repoSession.ts). */
  const session = getSession(repo.root)
  /** Chamadas presas a este repositório: uma leitura em andamento nunca termina no repositório de outra aba. */
  const gitOn = useMemo(() => gitFor(repo.root), [repo.root])
  const [data, setData] = useState<RepoData | null>(() => session.data)
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
  /** Arquivo que a tela Conflitos deve selecionar ao abrir (ver `openConflict`); o editor de conflitos é um painel dela. */
  const [conflictFocus, setConflictFocus] = useState<ConflictFocus | null>(null)
  const [compare, setCompare] = useState<CompareRequest>(() => session.ui.compare)
  const [filePath, setFilePath] = useState<string | null>(() => session.ui.filePath)
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null)
  /** A tela de Dashboards está aberta (no lugar dos painéis, que continuam montados por trás). */
  const [dashboardsOpen, setDashboardsOpen] = useState(false)
  /**
   * A tela Conflitos está aberta (também no lugar dos painéis). Começa fechada a cada troca de repositório (o RepoView
   * é remontado), então o repositório novo sem conflito nunca a herda aberta; com conflito, vale a regra da partida.
   */
  const [conflictsOpen, setConflictsOpen] = useState(false)
  // Uma tela que ocupa o lugar dos painéis por vez: abrir uma fecha a outra.
  const setDashboards = useCallback((open: boolean) => {
    setDashboardsOpen(open)
    if (open) setConflictsOpen(false)
  }, [])
  const setConflictsScreen = useCallback((open: boolean) => {
    setConflictsOpen(open)
    if (open) setDashboardsOpen(false)
  }, [])
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // O que o usuário estava vendo volta igual ao retornar a esta aba.
  useEffect(() => {
    Object.assign(session.ui, { scope, selected, fileFocus, wipFocus, compare, filePath })
  }, [session, scope, selected, fileFocus, wipFocus, compare, filePath])

  // Ao abrir o histórico sem commit escolhido, mostra o mais recente: os painéis do commit já têm o que exibir.
  // Só uma vez por aba: se o usuário tirar a seleção depois, ela fica como ele deixou.
  const seededHistory = useRef(false)
  useEffect(() => {
    if (seededHistory.current || !data || data.log.length === 0) return
    seededHistory.current = true
    if (selected.length === 0 && !wipFocus) setSelected([data.log[0].sha])
  }, [data, selected, wipFocus])

  // Poucas sessões guardam dados ao mesmo tempo; as mais antigas voltam a ser lidas ao serem abertas.
  useEffect(() => {
    trimSessions(repo.root)
  }, [repo.root])

  /**
   * Só o que está na tela é carregado. O histórico serve ao painel Histórico e às cores das branches; os stashes,
   * ao painel Stashes e aos dashboards. Status, branches, tags e operação sempre vêm (as abas e as demais telas
   * dependem deles), mas as contagens de linhas do status (+/−) só quando uma tela que as mostra está na tela.
   * Quando um painel aparece, a leitura que faltava é feita na hora (ver `ensureFresh`).
   */
  const logShown = useAnyShown(LOG_VIEWS)
  const stashesShown = useAnyShown(STASH_VIEWS) || dashboardsOpen
  // Todos os `useAnyShown` são chamados sempre (regra dos hooks): as condições entram só depois.
  const changesShown = useAnyShown(CHANGES_VIEWS)
  const commitShown = useAnyShown(COMMIT_VIEWS)
  const wipListShown = useAnyShown(WIP_LIST_VIEWS)
  const blameShown = useAnyShown(BLAME_VIEWS)
  const [wipListOpen] = useLayout<boolean>('history.wipOpen', (v) => v === true)
  // Painéis do commit só mostram as alterações (WipPanes) quando o foco está nelas, sem commit selecionado.
  const statsShown = changesShown || (commitShown && wipFocus !== null && selected.length === 0) || (wipListShown && wipListOpen) || blameShown
  const wants = useMemo<Wants>(() => ({ log: logShown, stashes: stashesShown, stats: statsShown }), [logShown, stashesShown, statsShown])
  const wantsRef = useRef(wants)
  wantsRef.current = wants

  /**
   * Avisos desta aba: citam o repositório quando há mais de um aberto. Nome, contagem e `notify` vão por ref, para
   * `toast` ser estável (ele entra nas dependências de quase todas as ações; ver `actions` abaixo).
   */
  const toastSource = useRef({ notify, name: repo.name, several })
  toastSource.current = { notify, name: repo.name, several }
  const toast = useCallback((kind: ToastKind, text: string, action?: ToastAction) => {
    const source = toastSource.current
    source.notify(kind, prefixToast(text, source.name, source.several), action)
  }, [])

  /**
   * Configurações lidas no momento da chamada (ver `openInEditor`). Por ref, a ação não muda quando elas mudam.
   * Vale para `settings` salvas, não para a pré-visualização, como antes.
   */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  /** Quais painéis existem agora (ex.: Conflitos só com conflitos; Staged só na visão de listas separadas). */
  const conflicts = data?.status.conflicted.length ?? 0
  const available = useCallback((view: ViewId) => viewAvailable(view, { changesMode, conflicts }), [changesMode, conflicts])
  const availableRef = useRef(available)
  availableRef.current = available

  // Partida: com conflito já na primeira leitura do repositório, a tela Conflitos abre uma vez por repositório e
  // sessão. O repositório entra no conjunto na primeira leitura de qualquer jeito: conflito que surge depois (um
  // merge feito agora) não abre a tela sozinho, e fechar a tela não a faz voltar ao reler o status.
  const dataReady = data !== null
  useEffect(() => {
    if (!dataReady) return
    const alreadyOpenedFor = conflictsStartupSeen.has(repo.root)
    conflictsStartupSeen.add(repo.root)
    // A opção vem de `settingsRef` (configuração salva, ver acima): a leitura é só desta partida, não reage a mudanças.
    if (shouldOpenOnStartup({ hasConflicts: conflicts > 0, setting: settingsRef.current.conflictStartup, alreadyOpenedFor })) setConflictsScreen(true)
    // `conflicts` só vale na primeira leitura: não é dependência de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, repo.root, setConflictsScreen])

  // Pedido do alerta da aba: abre a tela quando o contador muda (o valor inicial, de antes desta aba, não conta).
  const seenRequest = useRef(conflictsRequest)
  useEffect(() => {
    if (seenRequest.current === conflictsRequest) return
    seenRequest.current = conflictsRequest
    setConflictsScreen(true)
  }, [conflictsRequest, setConflictsScreen])

  /**
   * Troca para um menu do topo: traz os painéis dele. Os de outras telas não entram junto (só os fixados ali).
   * Quem quer ir a outra tela chama isto, em vez de trazer painéis alheios.
   */
  const setView = useCallback((view: View) => {
    setDashboardsOpen(false)
    setConflictsOpen(false)
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
    clearCurrentLayout()
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
      const needs: Wants = { log: wantsRef.current.log || prev === null, stashes: wantsRef.current.stashes, stats: wantsRef.current.stats }
      // Geração anotada antes de ler: se algo mudar durante a leitura, o resultado já nasce como "stale".
      const generation = readCache.generation(repo.root)
      session.loadingGeneration = generation
      const [status, refs, operation, stashes] = await Promise.all([
        // Sem contagens, o status é um processo só e não lê arquivo algum (ver `status` no núcleo).
        gitOn.status(needs.stats),
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
        // O limite entra na chave: uma página nova (ou o escopo trocado) não reaproveita a lista menor.
        const limit = logLimitFor(session.logLimit, scopeKey(s))
        const key = `${historySignature(scopeKey(s), status, branches, tags)}\n${limit}`
        const cached = session.logCache?.key === key ? session.logCache.log : null
        if (cached) log = cached
        else {
          const fetched = await gitOn.log({ ...scopeLogOptions(s), limit }).catch((e) => {
            toast('error', errorMessage(e))
            return null
          })
          if (fetched) session.logCache = { key, log: fetched }
          log = fetched ?? session.logCache?.log ?? []
        }
      }
      session.data = mergeData(session.data, { status, branches, tags, stashes, log, operation })
      session.loaded = { generation, scopeKey: scopeKey(s), log: needs.log, stashes: needs.stashes, stats: needs.stats }
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
          // Uma página do histórico em leitura termina antes: a leitura completa lê o limite já atualizado.
          if (session.pagingLog) await session.pagingLog
          await load()
        } while (session.again)
      } finally {
        session.inflight = null
        session.loadingGeneration = null
      }
    })()
    session.inflight = round
    return round
  }, [session, load])

  /**
   * Lê só a página seguinte do histórico (um processo git) e a junta à lista atual. Não passa por `load`: status,
   * refs e operação não são relidos, porque a página não depende deles. Chamada quando o rodapé da lista aparece.
   */
  const loadMoreLog = useCallback(async () => {
    // Não se mistura com uma leitura completa: espera ela terminar (e não começa outra enquanto esta página roda).
    while (session.inflight) await session.inflight
    if (session.pagingLog) return
    const s = scopeRef.current
    const prev = session.data
    const limit = logLimitFor(session.logLimit, scopeKey(s))
    // Só continua a partir de um histórico que corresponde ao status atual (a última leitura trouxe o log).
    if (!prev || !session.loaded?.log || !canLoadMoreLog(prev.log.length, limit)) return
    const page = nextLogPage(prev.log.length)
    const reading = (async () => {
      try {
        const fetched = await gitOn.log({ ...scopeLogOptions(s), ...page })
        // Mudou enquanto lia (leitura completa, troca de escopo, repositório descartado): a página já não se aplica.
        if (session.data?.log !== prev.log || scopeKey(scopeRef.current) !== scopeKey(s)) return
        const log = [...prev.log, ...fetched]
        // O limite pedido (não o tamanho da página): se a página veio curta, `canLoadMoreLog` já dá falso.
        const loadedLimit = page.skip + page.limit
        session.logLimit = { scopeKey: scopeKey(s), limit: loadedLimit }
        session.logCache = { key: `${historySignature(scopeKey(s), prev.status, prev.branches, prev.tags)}\n${loadedLimit}`, log }
        session.data = mergeData(session.data, { ...prev, log })
        setData(session.data)
      } catch (e) {
        toast('error', errorMessage(e))
      } finally {
        session.pagingLog = null
      }
    })()
    session.pagingLog = reading
    await reading
  }, [session, gitOn, toast])

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

  // O resumo da aba (indicador) sai dos dados que esta tela já leu: não há leitura extra do git para ele.
  const repoStatus = data?.status
  const repoOperation = data?.operation
  useEffect(() => {
    if (repoStatus && repoOperation) onSummary(repo.root, summarize(repoStatus, repoOperation.kind))
  }, [repoStatus, repoOperation, onSummary, repo.root])

  // Ao abrir a aba, ao mudar o filtro de branches ou quando um painel novo aparece: lê só o que falta.
  useEffect(() => {
    void ensureFresh()
  }, [repo.root, scope, wants, ensureFresh])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.gittools.onRepositoryChanged((root) => {
      // Mudança em outro repositório não mexe nos dados desta aba (o indicador dela fica no nível do app).
      if (root !== undefined && root !== repo.root) return
      // Eco de uma alteração desta interface: os dados já foram lidos depois dela (o ouvinte do app decide igual).
      if (root !== undefined && isEcho(root)) return
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
   * Uma por vez: enquanto outra não termina (inclusive a atualização do fim), a chamada é ignorada sem toast nem
   * atualização, para que um clique duplo não execute a operação duas vezes. Com `options.queue`, a chamada espera
   * as anteriores terminarem, em ordem, e só então executa (para ações que não podem se perder, como stage em
   * sequência). Ver `singleFlight.ts`.
   * O indicador de operação (`busy`) só cai depois da atualização do fim, junto com o bloqueio: os botões ficam
   * desligados enquanto a operação e a atualização estiverem em curso.
   * Não chame `run` de dentro do callback de outro `run`: sem `queue`, a chamada interna é ignorada em silêncio;
   * com `queue`, trava.
   */
  // Inicialização preguiçosa: o bloqueio é criado uma vez, e não a cada renderização do RepoView.
  const [flight] = useState(createSingleFlight)
  const run = useCallback(
    async <T,>(
      label: string,
      fn: () => Promise<T>,
      scope: readonly ViewId[] = REPO_VIEWS,
      options?: { queue?: boolean }
    ): Promise<T | undefined> => {
      const outcome = await flight.run(async (): Promise<T | undefined> => {
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
          // Atualiza primeiro e só então tira o indicador: `busy` cai junto com o bloqueio.
          try {
            await refresh()
          } finally {
            setOperation(null)
          }
        }
      }, options)
      return outcome === SKIPPED ? undefined : outcome
    },
    [flight, refresh, toast, setView]
  )

  const openDiffWindow = useCallback(
    (request: Parameters<AppContextValue['openDiffWindow']>[0]) => {
      // A janela de diff guarda o repositório: ela não deve usar o ativo quando a aba mudar.
      window.gittools.openDiffWindow({ ...request, root: repo.root }).catch((error) => toast('error', errorMessage(error)))
    },
    [toast, repo.root]
  )

  // Os textos trocam com o idioma: `getLocale()` entra nas dependências das ações de propósito (ver abaixo).
  const locale = getLocale()

  /** Dados do repositório. Sem `data` (ainda carregando), a tela mostra o carregamento e nenhum provedor é montado. */
  const repoDataValue = useMemo<RepoDataValue | null>(() => (data ? { repo, workspace, data } : null), [repo, workspace, data])
  /** Operação em andamento: fica numa fatia própria porque muda duas vezes em cada operação. */
  const busyValue = useMemo<BusyValue>(() => ({ busy, busyScope }), [busy, busyScope])
  /** Configurações e as telas Dashboards e Conflitos. */
  const settingsValue = useMemo<AppSettingsValue>(() => ({ settings, dashboardsOpen, conflictsOpen }), [settings, dashboardsOpen, conflictsOpen])

  /**
   * Ações. O valor só muda quando o idioma ou o repositório ativo muda: cada função abaixo precisa ser estável.
   * Os setters do `useState` já são; `refresh`, `run`, `toast`, `setView`, `openDiffWindow`, `resetLayout` e
   * `askConfirm` só mudam com o repositório; `openSettings` e `openShortcuts` vêm estáveis do App. O que muda com
   * frequência (`settings`) é lido por ref, no momento da chamada.
   * `locale` entra de propósito: os textos de `t()` dentro das ações se renovam quando o idioma troca.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo<AppActions>(
    () => ({
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
      setDashboards,
      setConflictsScreen,
      setView,
      openDiffWindow,
      resetLayout,
      // O editor de conflitos já não é um diálogo: abrir um arquivo é abrir a tela Conflitos com ele selecionado.
      openConflict: (path) => {
        setConflictFocus({ path })
        setConflictsScreen(true)
      },
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
        // Lê a configuração no clique (ref): assim a ação não precisa mudar quando as configurações mudam.
        // No VS Code os arquivos abrem no próprio editor dele: não há editor a escolher.
        if (!settingsRef.current.editor && !insideVsCode()) {
          toast('info', t('editor.chooseFirst'))
          openSettings('editor')
          return
        }
        window.gittools.openInEditor(path, repo.root).catch((error) => toast('error', errorMessage(error)))
      },
      openSettings,
      openShortcuts
    }),
    [locale, repo.root, refresh, run, toast, setView, setDashboards, setConflictsScreen, openDiffWindow, resetLayout, askConfirm, openSettings, openShortcuts]
  )

  /** Valor combinado (o de `useApp`): só para quem ainda lê `AppContext` direto. Redesenha com qualquer fatia. */
  const context = useMemo<AppContextValue | null>(
    () => (repoDataValue && { ...repoDataValue, ...busyValue, ...actions, ...settingsValue }),
    [repoDataValue, busyValue, actions, settingsValue]
  )

  const changeCount = data ? data.status.staged.length + data.status.unstaged.length + data.status.conflicted.length : 0
  /** Nome, número e dica de cada painel (as abas). */
  const meta = useMemo<Record<ViewId, ViewMeta>>(
    () => ({
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
    }),
    // locale: os textos de t() trocam com o idioma; badges mudam com as contagens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, conflicts, changeCount]
  )

  // Manipuladores passados aos filhos memorizados (ver `paneMemo`): estáveis, para o `memo` deles valer. Ficam antes
  // do retorno antecipado abaixo por causa da regra dos hooks.
  const openRepoDialog = useCallback(() => void workspace.openRepo(), [workspace])
  const openRepository = useCallback((path?: string, create?: boolean) => void workspace.openRepo(path, create), [workspace])
  const openDashboards = useCallback(() => setDashboards(true), [setDashboards])
  const changeScope = useCallback(
    (s: HistoryScope, options?: { reveal?: boolean }) => {
      setScope(s)
      // Na tela de branches a lista só filtra o histórico: não troca de tela.
      if (options?.reveal !== false && readScreen() !== 'branches') setView('history')
    },
    [setView]
  )
  const selectCommits = useCallback((shas: string[]) => {
    setWipFocus(null)
    setSelected(shas)
  }, [])

  /** Abre o diff de um arquivo no painel do diff do commit, trazendo os painéis do commit se estiverem escondidos. */
  const openFileInDetails = useCallback(
    (sha: string, path: string) => {
      setWipFocus(null)
      setSelected([sha])
      setFileFocus((prev) => ({ sha, path, n: (prev?.n ?? 0) + 1 }))
      setView('history')
    },
    [setView]
  )

  /** Abre o diff de um arquivo não commitado no painel do diff, trazendo os painéis do commit se estiverem escondidos. */
  const openWipFileInDetails = useCallback(
    (path: string) => {
      setSelected([])
      setWipFocus((prev) => ({ path, n: (prev?.n ?? 0) + 1 }))
      setView('history')
    },
    [setView]
  )

  const openFileWindow = useCallback(
    (sha: string, path: string) => openDiffWindow({ source: { kind: 'commit', sha }, path, title: `${path} · ${shortSha(sha)}` }),
    [openDiffWindow]
  )

  if (!repoDataValue || !context) {
    return (
      <div className="repo-loading">
        <Loader size="sm" label={t('welcome.loading')} />
      </div>
    )
  }

  const modalOpen = !!(studio || rebaseFrom || dialog || appModalOpen)

  return (
    <AppProviders repoData={repoDataValue} busy={busyValue} actions={actions} settings={settingsValue} app={context} onSaveSettings={onSaveSettings} conflictFocus={conflictFocus}>
      <KeyboardShortcutsPane locale={locale} disabled={modalOpen} onOpenRepository={openRepoDialog} />
      <ToolbarPane
        locale={locale}
        onOpenRepository={openRepository}
        onClone={workspace.openClone}
        onScreen={setView}
        meta={meta}
        available={available}
        changeCount={changeCount}
        dashboards={dashboardsOpen}
        onDashboards={openDashboards}
      />
      <OperationBannerPane locale={locale} />
      <div className={dashboardsOpen || conflictsOpen ? 'dock-hidden' : 'dock-wrap'}>
        <DockPane locale={locale} meta={meta} available={available} />
      </div>
      {dashboardsOpen && (
        <Suspense fallback={null}>
          <DashboardsPane locale={locale} />
        </Suspense>
      )}
      {conflictsOpen && (
        <Suspense fallback={null}>
          <ConflictsScreenPane locale={locale} />
        </Suspense>
      )}
      {/* Cada tela é desenhada aqui e levada, por portais, ao painel onde o usuário a deixou. */}
      <SidebarPanesPane locale={locale} scope={scope} onScope={changeScope} />
      <PaneSlot id="history">
        <CommitListPane
          locale={locale}
          scope={scope}
          onScope={setScope}
          canLoadMore={data !== null && canLoadMoreLog(data.log.length, logLimitFor(session.logLimit, scopeKey(scope)))}
          onLoadMore={loadMoreLog}
          selected={selected}
          onSelect={selectCommits}
          onOpenFile={openFileInDetails}
          onOpenFileWindow={openFileWindow}
          onOpenWipFile={openWipFileInDetails}
        />
      </PaneSlot>
      <WhenShown views={COMMIT_VIEWS}>
        <CommitPanesPane locale={locale} selected={selected} focus={fileFocus} wip={wipFocus} />
      </WhenShown>
      <WhenShown views={CHANGES_VIEWS}>
        <ChangesViewPane locale={locale} />
      </WhenShown>
      <WhenShown views={FILES_VIEWS}>
        <FilesPanesPane locale={locale} path={filePath} onPath={setFilePath} />
      </WhenShown>
      <WhenShown views={COMPARE_VIEWS}>
        <Suspense fallback={null}>
          <CompareViewPane locale={locale} request={compare} onRequest={setCompare} />
        </Suspense>
      </WhenShown>
      <PaneSlot id="gitlog">
        <GitLogViewPane locale={locale} />
      </PaneSlot>
      {studio && (
        <Suspense fallback={null}>
          <CherryPickStudio request={studio} onClose={() => setStudio(null)} />
        </Suspense>
      )}
      {rebaseFrom && (
        <Suspense fallback={null}>
          <RebaseEditor fromSha={rebaseFrom} onClose={() => setRebaseFrom(null)} />
        </Suspense>
      )}
      {dialog && (
        <Suspense fallback={null}>
          <DialogHost dialog={dialog} onDone={() => setDialog(null)} />
        </Suspense>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {busyVisible && (
        <div className="busy" role="status" aria-live="polite">
          <Loader size="sm" label={`${busyLabel}…`} />
        </div>
      )}
    </AppProviders>
  )
}
