import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAppActions, useBusy, useRepoData } from '../context'
import { t, type MessageKey } from '../i18n'
import { buildConflictRows, type ConflictKind } from '../conflictRows'
import { filterConflictRows, type ConflictFilter, type ConflictSituation } from '../conflictFilter'
import { REUSE_NAMES, useConflictFlow } from './ConflictFlow'
import { OPERATION_LABEL } from './OperationBanner'
import { VirtualList } from './VirtualList'

/** Altura fixa de cada linha da lista (px): a janela é calculada dos dados, sem medir o DOM. */
const ROW = 30

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
  onOpen(path: string): void
}

/**
 * Uma linha da lista. Só recebe texto pronto e um manipulador estável (o caminho vai por argumento), e não lê
 * contexto: o `memo` evita redesenhar as linhas visíveis quando só o filtro ou o rodapé mudam.
 */
const ConflictRowView = memo(function ConflictRowView({ path, kindLabel, sideLabel, sideHelp, onOpen }: RowProps) {
  return (
    <button type="button" className="conflicts-row" title={path} onClick={() => onOpen(path)}>
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
 * da operação e, no rodapé, continuar, pular, abortar e as decisões lembradas. Selecionar um arquivo abre o editor
 * lado a lado (modal, até o E9 embuti-lo). O estado do fluxo vem de `ConflictFlowProvider`.
 * `locale` entra só para o `memo` ver a troca de idioma (ver `paneMemo` em App.tsx).
 */
export function ConflictsScreen({ locale }: { locale: string }) {
  const { data } = useRepoData()
  const { openConflict, setConflictsScreen, setView } = useAppActions()
  // Operação em andamento: continuar, pular e abortar não disparam outra enquanto a primeira não termina.
  const { busy } = useBusy()
  const flow = useConflictFlow()
  const { decisions, plan, reuseIgnored, autoContinue } = flow
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
          onOpen={openConflict}
        />
      )
    },
    [shown, labels, openConflict]
  )

  // Esc fecha a tela: ouvinte no próprio elemento (nada na `window`). O editor de conflitos e os diálogos são
  // desenhados fora desta árvore, então o Esc deles não chega aqui; a conferência do `.modal-backdrop` cobre o foco
  // que ainda esteja nesta tela com um deles aberto. `defaultPrevented`: outro componente já tratou a tecla (a busca).
  const rootRef = useRef<HTMLElement>(null)
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-backdrop')) return
      setConflictsScreen(false)
    },
    [setConflictsScreen]
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

  const showChanges = useCallback(() => setView('changes'), [setView])
  const close = useCallback(() => setConflictsScreen(false), [setConflictsScreen])

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
      <div className="conflicts-body">
        {shown.length > 0 ? (
          <VirtualList className="conflicts-list" role="group" aria-label={t('conflictsScreen.listLabel')} count={shown.length} rowHeight={ROW} keyOf={keyOf} renderItem={renderItem} overscan={ROW * 8} />
        ) : (
          <p className="conflicts-empty muted">
            {empty ? (kind === 'none' ? t('conflictsScreen.empty') : t('operation.noConflicts')) : t('conflictBulk.noMatch')}
          </p>
        )}
        <aside className="conflicts-help">
          <strong>{t('conflictsScreen.help')}</strong>
          <p className="muted small">{t('conflictsScreen.helpDetail')}</p>
        </aside>
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
