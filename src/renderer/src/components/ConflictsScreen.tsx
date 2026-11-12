import { memo, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useAppActions, useAppSettings, useBusy, useRepoData } from '../context'
import { t, type MessageKey } from '../i18n'
import { BULK_RESOLUTIONS, bulkHelp, bulkLabel } from '../bulkConflicts'
import { buildConflictRows, effectiveTab, keepSelection, nextPending, type ConflictKind, type ConflictTab } from '../conflictRows'
import { filterConflictRows, type ConflictFilter, type ConflictSituation } from '../conflictFilter'
import { shouldCloseAfterResolve } from '../conflictScreenPolicy'
import { ConflictEditor } from '../lazyScreens'
import { REUSE_NAMES, useConflictFlow, type ConflictFocus } from './ConflictFlow'
import { LoaderPane } from './Loader'
import { OPERATION_LABEL } from './OperationBanner'
import { VirtualList, type VirtualListHandle } from './VirtualList'

/** Altura fixa de cada linha da lista (px): a janela é calculada dos dados, sem medir o DOM. */
const ROW = 30

/**
 * Pedidos de `openConflict` que a tela já aplicou, pela identidade do objeto. Fora do componente porque a tela é
 * desmontada ao fechar: sem isso, reabri-la pelo banner repetiria o último pedido e selecionaria um arquivo antigo.
 */
const appliedFocus = new WeakSet<ConflictFocus>()

const KIND_LABEL: Record<ConflictKind, MessageKey> = {
  bothModified: 'conflictsScreen.kinds.bothModified',
  bothAdded: 'conflictsScreen.kinds.bothAdded',
  bothDeleted: 'conflictsScreen.kinds.bothDeleted',
  addedByUs: 'conflictsScreen.kinds.addedByUs',
  addedByThem: 'conflictsScreen.kinds.addedByThem',
  deletedByUs: 'conflictsScreen.kinds.deletedByUs',
  deletedByThem: 'conflictsScreen.kinds.deletedByThem'
}
const KINDS = Object.keys(KIND_LABEL) as ConflictKind[]

const SITUATION_LABEL: Record<ConflictSituation, MessageKey> = {
  all: 'conflictsScreen.situationAll',
  pending: 'conflictsScreen.situationPending',
  decided: 'conflictsScreen.situationDecided'
}
const SITUATIONS = Object.keys(SITUATION_LABEL) as ConflictSituation[]

interface RowProps {
  path: string
  kindLabel: string
  /** Lado lembrado de uma parada anterior ("Nosso"/"Deles"); null = sem decisão. */
  sideLabel: string | null
  sideHelp: string | undefined
  /** É o arquivo aberto no painel do editor. */
  selected: boolean
  onSelect(path: string): void
}

/**
 * Uma linha da lista. Só recebe texto pronto e um manipulador estável (o caminho vai por argumento), e não lê
 * contexto: o `memo` evita redesenhar as linhas visíveis quando só o filtro ou o rodapé mudam.
 */
const ConflictRowView = memo(function ConflictRowView({ path, kindLabel, sideLabel, sideHelp, selected, onSelect }: RowProps) {
  return (
    <button type="button" className={selected ? 'conflicts-row selected' : 'conflicts-row'} title={path} aria-current={selected || undefined} onClick={() => onSelect(path)}>
      <span className="conflicts-row-path">{path}</span>
      <span className="conflicts-row-kind">{kindLabel}</span>
      {sideLabel && (
        <span className="conflicts-row-badge" title={sideHelp}>
          {sideLabel}
        </span>
      )}
    </button>
  )
})

/**
 * Tela Conflitos: ocupa o lugar dos painéis (como os Dashboards). Lista em janela com filtros e busca, resumo
 * da operação e, no rodapé, continuar, pular, abortar, o lote e as decisões lembradas. Selecionar um arquivo abre o
 * editor lado a lado num painel à direita (em janela estreita, a lista e o editor viram abas). O estado do fluxo vem
 * de `ConflictFlowProvider`.
 * `locale` entra só para o `memo` ver a troca de idioma (ver `paneMemo` em App.tsx).
 */
export function ConflictsScreen({ locale }: { locale: string }) {
  const { data } = useRepoData()
  const { setConflictsScreen, setView, showMenu, openInEditor } = useAppActions()
  // Operação em andamento: continuar, pular e abortar não disparam outra enquanto a primeira não termina.
  const { busy } = useBusy()
  const flow = useConflictFlow()
  const { decisions, plan, reuseIgnored, autoContinue, focus } = flow
  const { operation, status } = data
  const conflicted = status.conflicted
  const kind = operation.kind

  // Filtros e busca: estado local, então digitar só redesenha esta tela. A busca é adiada para a digitação não
  // esperar o filtro de uma lista grande.
  const [kindFilter, setKindFilter] = useState<ConflictKind | 'all'>('all')
  const [situation, setSituation] = useState<ConflictSituation>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const rows = useMemo(() => buildConflictRows(conflicted, decisions), [conflicted, decisions])
  const filter = useMemo<ConflictFilter>(() => ({ kind: kindFilter, situation, query: deferredQuery }), [kindFilter, situation, deferredQuery])
  const shown = useMemo(() => filterConflictRows(rows, filter), [rows, filter])
  const pending = useMemo(() => rows.reduce((n, row) => (row.resolved === null ? n + 1 : n), 0), [rows])

  // Arquivo aberto no painel do editor. O que vale é `selected`: o bruto pode apontar para um arquivo que já saiu do
  // conflito (resolvido), e então nada fica selecionado. O bruto não é zerado de propósito: um pedido de `openConflict`
  // feito antes de o status trazer o arquivo passa a valer quando ele chegar. O editor só é montado, e o arquivo só é
  // lido, para o selecionado.
  const [chosen, setChosen] = useState<string | null>(null)
  const [tab, setTab] = useState<ConflictTab>('list')
  const selected = useMemo(() => keepSelection(rows, chosen), [rows, chosen])
  const visibleTab = effectiveTab(selected, tab)
  const select = useCallback((path: string) => {
    setChosen(path)
    // Em janela estreita escolher uma linha leva ao editor; em janela larga a aba nem aparece.
    setTab('editor')
  }, [])
  const closeEditor = useCallback(() => setChosen(null), [])
  // Pedido de fora (`openConflict`): seleciona o arquivo uma vez por pedido.
  useEffect(() => {
    if (!focus || appliedFocus.has(focus)) return
    appliedFocus.add(focus)
    select(focus.path)
  }, [focus, select])

  // Textos das linhas, prontos uma vez por idioma: a linha só compara strings.
  const labels = useMemo(
    () => {
      const kinds = {} as Record<ConflictKind, string>
      for (const k of KINDS) kinds[k] = t(KIND_LABEL[k])
      const ours = t('conflictsScreen.sideOurs')
      const theirs = t('conflictsScreen.sideTheirs')
      return {
        kinds,
        ours,
        theirs,
        oursHelp: t('conflictsScreen.remembered', { side: ours }),
        theirsHelp: t('conflictsScreen.remembered', { side: theirs })
      }
    },
    // locale: os textos de t() trocam com o idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale]
  )

  const keyOf = useCallback((index: number) => shown[index].path, [shown])
  const renderItem = useCallback(
    (index: number) => {
      const row = shown[index]
      return (
        <ConflictRowView
          path={row.path}
          kindLabel={labels.kinds[row.kind]}
          sideLabel={row.resolved === null ? null : row.resolved === 'ours' ? labels.ours : labels.theirs}
          sideHelp={row.resolved === null ? undefined : row.resolved === 'ours' ? labels.oursHelp : labels.theirsHelp}
          selected={row.path === selected}
          onSelect={select}
        />
      )
    },
    [shown, labels, selected, select]
  )
  const listRef = useRef<VirtualListHandle>(null)

  // Teclas da tela: ouvinte no próprio elemento (nada na `window`). Os diálogos são desenhados fora desta árvore, então
  // o Esc deles não chega aqui; a conferência do `.modal-backdrop` cobre o foco que ainda esteja nesta tela com um
  // deles aberto. `defaultPrevented`: outro componente já tratou a tecla (a busca).
  // O editor agora está dentro da tela, então o Esc vindo de qualquer ponto dele é ignorado, assim como o Esc com um
  // menu de contexto aberto (o menu usa a tecla para fechar a si mesmo): fechar a tela descartaria o que foi digitado.
  // F8 vindo de um campo de texto (textarea, input, select) também é ignorado: trocar de arquivo perderia a edição.
  const rootRef = useRef<HTMLElement>(null)
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (e.key === 'F8' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
        // F8: próximo arquivo pendente, a partir do selecionado (sem pendente, nada acontece).
        const next = nextPending(rows, selected)
        if (next === null) return
        e.preventDefault()
        select(next)
        const at = shown.findIndex((row) => row.path === next)
        if (at !== -1) listRef.current?.scrollToIndex(at)
        return
      }
      if (e.key !== 'Escape') return
      if (target?.closest('.conflict-editor')) return
      if (document.querySelector('.modal-backdrop, .context-menu')) return
      setConflictsScreen(false)
    },
    [rows, shown, selected, select, setConflictsScreen]
  )
  // O foco vai para a tela ao abrir (senão o Esc nunca chegaria a ela), mas só se ainda não está dentro dela.
  useEffect(() => {
    const el = rootRef.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
  }, [])

  const reuseTotal = plan.ours.length + plan.theirs.length
  const reuseText = useMemo(() => {
    if (reuseTotal === 0) return ''
    const names = [...plan.ours, ...plan.theirs]
    const files = names.slice(0, REUSE_NAMES).join(', ') + (names.length > REUSE_NAMES ? ` +${names.length - REUSE_NAMES}` : '')
    return plan.ours.length > 0 && plan.theirs.length > 0
      ? t('operation.reuseBoth', { ours: plan.ours.length, theirs: plan.theirs.length, files })
      : plan.ours.length > 0
        ? t('operation.reuseOurs', { count: plan.ours.length, files })
        : t('operation.reuseTheirs', { count: plan.theirs.length, files })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, reuseTotal, locale])

  // Ações do arquivo selecionado, no cabeçalho do painel. Cada uma passa por `flow.resolve` (que também lembra o lado
  // escolhido); o arquivo resolvido sai de `status.conflicted` e a seleção se desfaz sozinha.
  const fileActions = useMemo(
    () =>
      selected === null ? null : (
        <div className="conflict-file-actions" role="group" aria-label={t('conflictsScreen.fileActions')}>
          <button disabled={busy !== null} title={t('operation.useOursHelp')} onClick={() => void flow.resolve(selected, 'ours')}>
            {t('conflict.useOurs')}
          </button>
          <button disabled={busy !== null} title={t('operation.useTheirsHelp')} onClick={() => void flow.resolve(selected, 'theirs')}>
            {t('conflict.useTheirs')}
          </button>
          <button disabled={busy !== null} title={t('operation.resolvedHelp')} onClick={() => void flow.resolve(selected, 'resolved')}>
            ✓ {t('operation.resolved')}
          </button>
          <button onClick={() => openInEditor(selected)}>{t('common.openInEditor')}</button>
        </div>
      ),
    // locale: os textos de t() trocam com o idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, busy, flow.resolve, openInEditor, locale]
  )

  // Lote no rodapé: "Resolver todos" age em todos os arquivos em conflito do repositório (com confirmação, em `useResolveAll`).
  const bulkMenu = useCallback(
    (e: MouseEvent) =>
      showMenu(
        e,
        BULK_RESOLUTIONS.map((resolution) => ({
          label: t(bulkLabel(resolution)),
          hint: t(bulkHelp(resolution)),
          onClick: () => void flow.resolveEvery(resolution)
        }))
      ),
    [showMenu, flow.resolveEvery] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const showChanges = useCallback(() => setView('changes'), [setView])
  const close = useCallback(() => setConflictsScreen(false), [setConflictsScreen])

  // Opção "fechar sozinha" (`conflictSummary`): a tela fecha quando a operação que ela acompanhava termina. Sem estado
  // novo: `sawOperation` é só uma marca de ref. Ela é consumida ao terminar, então mudar a opção depois não fecha a
  // tela por um fim de operação antigo.
  const { settings } = useAppSettings()
  const conflictSummary = settings.conflictSummary
  const sawOperation = useRef(false)
  useEffect(() => {
    if (kind !== 'none') {
      sawOperation.current = true
      return
    }
    const hadOperation = sawOperation.current
    sawOperation.current = false
    if (shouldCloseAfterResolve({ setting: conflictSummary, operationKind: kind, hadOperation })) setConflictsScreen(false)
  }, [kind, conflictSummary, setConflictsScreen])

  const heading =
    kind === 'none'
      ? t('conflictsScreen.title')
      : `${t('conflictsScreen.title')} · ${t(OPERATION_LABEL[kind])}${
          kind === 'rebase' && operation.step ? ` · ${t('conflictsScreen.step', { step: operation.step, total: operation.total ?? 0 })}` : ''
        }`

  const empty = rows.length === 0
  const canContinue = kind !== 'none' && kind !== 'merge'

  return (
    <section ref={rootRef} className="conflicts-screen" tabIndex={-1} aria-label={t('conflictsScreen.title')} onKeyDown={onKeyDown}>
      <header className="conflicts-head">
        <h2 className="conflicts-title">{heading}</h2>
        <span className="muted conflicts-counts">{t('conflictsScreen.counts', { pending, total: rows.length })}</span>
      </header>
      <div className="conflicts-bar">
        <select aria-label={t('conflictsScreen.filterKind')} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ConflictKind | 'all')}>
          <option value="all">{t('conflictsScreen.kindAll')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {labels.kinds[k]}
            </option>
          ))}
        </select>
        <select aria-label={t('conflictsScreen.filterSituation')} value={situation} onChange={(e) => setSituation(e.target.value as ConflictSituation)}>
          {SITUATIONS.map((s) => (
            <option key={s} value={s}>
              {t(SITUATION_LABEL[s])}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="conflict-filter"
          value={query}
          placeholder={t('conflictsScreen.searchPlaceholder')}
          aria-label={t('conflictsScreen.searchLabel')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc na busca com texto limpa a busca; a tela só fecha com a busca vazia.
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              setQuery('')
            }
          }}
        />
      </div>
      {/* Janela estreita: lista e editor viram abas (o CSS só mostra isto abaixo de 640px). */}
      <div className="conflicts-tabs" role="tablist" aria-label={t('conflictsScreen.tabsLabel')}>
        <button type="button" role="tab" aria-selected={visibleTab === 'list'} onClick={() => setTab('list')}>
          {t('conflictsScreen.tabList')}
        </button>
        <button type="button" role="tab" aria-selected={visibleTab === 'editor'} disabled={selected === null} onClick={() => setTab('editor')}>
          {t('conflictsScreen.tabEditor')}
        </button>
      </div>
      <div className="conflicts-body" data-tab={visibleTab}>
        {shown.length > 0 ? (
          <VirtualList ref={listRef} className="conflicts-list" role="group" aria-label={t('conflictsScreen.listLabel')} count={shown.length} rowHeight={ROW} keyOf={keyOf} renderItem={renderItem} overscan={ROW * 8} />
        ) : (
          <p className="conflicts-empty muted">
            {empty ? (kind === 'none' ? t('conflictsScreen.empty') : t('operation.noConflicts')) : t('conflictBulk.noMatch')}
          </p>
        )}
        <div className="conflicts-side">
          {selected !== null ? (
            // `key`: trocar de arquivo remonta o editor, e com ele as escolhas por bloco, que são de um arquivo só.
            <Suspense fallback={<LoaderPane label={t('conflict.loading')} />}>
              <ConflictEditor key={selected} path={selected} actions={fileActions} onClose={closeEditor} />
            </Suspense>
          ) : (
            <aside className="conflicts-help">
              <strong>{t('conflictsScreen.help')}</strong>
              <p className="muted small">{t('conflictsScreen.helpDetail')}</p>
            </aside>
          )}
        </div>
      </div>
      <footer className="conflicts-foot">
        {reuseTotal > 0 && !reuseIgnored && !empty && (
          <div className="conflict-tools">
            <span className="small">{reuseText}</span>
            <button className="primary" disabled={busy !== null} onClick={() => void flow.applyReuse()}>
              {t('operation.reuseApply')}
            </button>
            <button onClick={flow.ignoreReuse}>{t('operation.reuseIgnore')}</button>
          </div>
        )}
        <div className="conflicts-actions">
          {canContinue && (
            <>
              <button
                className="primary"
                disabled={conflicted.length > 0 || busy !== null}
                title={conflicted.length > 0 ? t('feedback.blocked.conflicts') : undefined}
                onClick={() => void flow.continueOperation()}
              >
                {t('operation.continue')}
              </button>
              <button disabled={busy !== null} onClick={() => void flow.skip()}>
                {t('operation.skip')}
              </button>
            </>
          )}
          {(kind === 'none' || kind === 'merge') && (
            <>
              {kind === 'merge' && <span className="muted small">{t('conflictsScreen.mergeFooter')}</span>}
              <button className={kind === 'merge' ? 'primary' : undefined} onClick={showChanges}>
                {t('operation.showChanges')}
              </button>
            </>
          )}
          {!empty && (
            <button disabled={busy !== null} title={t('conflictBulk.menuHelp')} onClick={bulkMenu}>
              {t('conflictBulk.menuLabel')} ▾
            </button>
          )}
          {/* Sem operação em andamento e sem conflito não há o que abortar. */}
          {(kind !== 'none' || !empty) && (
            <button className="danger" disabled={busy !== null} onClick={() => void flow.abort()}>
              {t('operation.abort')}
            </button>
          )}
          {canContinue && (
            <label className="conflicts-auto" title={t('settings.general.autoContinueHelp')}>
              <input type="checkbox" checked={autoContinue} onChange={(e) => flow.setAutoContinue(e.target.checked)} />
              <span>{t('settings.general.autoContinue')}</span>
            </label>
          )}
          <button className="conflicts-close" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </footer>
    </section>
  )
}
