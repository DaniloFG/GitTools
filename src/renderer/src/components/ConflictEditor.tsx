import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConflictDetails } from '../../../shared/types'
import { buildResult, parseConflicts, resolveChunk, type ChunkResolution, type MergeChunk } from '../../../shared/conflicts'
import { useApp } from '../context'
import { BULK_RESOLUTIONS, bulkHelp, bulkLabel, useResolveAll } from '../bulkConflicts'
import { errorMessage } from '../format'
import { git } from '../git'
import { t, textDirection } from '../i18n'
import { useLayout } from '../layout'
import {
  arrowBetween,
  DEFAULT_ORDER,
  nextConflict,
  parseMergeLayout,
  sourcesByPosition,
  swapPanes,
  withMode,
  type MergeLayout,
  type MergeMode,
  type MergePane,
  type MergeSource
} from '../mergeLayout'
import { Modal } from './Modal'
import { Split } from './Split'
import { LoaderPane } from './Loader'

type Conflict = Extract<MergeChunk, { kind: 'conflict' }>
const CONTEXT = 3
/** Altura de uma linha de código (px) — igual nos três painéis, para eles ficarem alinhados. */
const LINE = 18
const PAD = 6
const PANE_MIME = 'application/x-gittools-merge-pane'

/** Setas do lado esquerdo do texto ("← Usar a atual"); as demais ficam depois ("Usar a que entra →"). */
const LEADING_ARROWS = new Set(['←', '↖', '↙'])
const withArrow = (label: string, arrow: string) => (LEADING_ARROWS.has(arrow) ? `${arrow} ${label}` : `${label} ${arrow}`)

/**
 * Editor de conflitos com três painéis — versão atual (HEAD), resultado e versão que entra — em duas visões:
 * clássica (as duas versões em cima e o resultado embaixo) ou em colunas. Os painéis
 * podem ser arrastados para trocar de lugar; as setas e os atalhos seguem a posição deles na tela.
 * Os painéis rolam juntos, e cada bloco em conflito ocupa a mesma altura nos três.
 */
export function ConflictEditor({ path, onClose }: { path: string; onClose(): void }) {
  const { run, toast, showMenu, repo } = useApp()
  const resolveAll = useResolveAll()
  const [details, setDetails] = useState<ConflictDetails | null>(null)
  const [resolutions, setResolutions] = useState<(ChunkResolution | undefined)[]>([])
  const [showFinal, setShowFinal] = useState(false)
  const [layout, setLayout] = useLayout<MergeLayout>('conflict.layout', parseMergeLayout)
  const [current, setCurrent] = useState(0)
  /** Trechos iguais (índice do chunk) que o usuário abriu — valem para os três painéis. */
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set())
  const [dragging, setDragging] = useState<MergePane | null>(null)
  const [dropTarget, setDropTarget] = useState<MergePane | null>(null)
  const scrollers = useRef<Partial<Record<MergePane, HTMLDivElement | null>>>({})
  const syncing = useRef<MergePane | null>(null)
  const syncFrame = useRef(0)
  const rtl = textDirection() === 'rtl'

  useEffect(() => {
    git.conflictDetails(path).then(setDetails, (e) => {
      toast('error', errorMessage(e))
      onClose()
    })
  }, [path, toast, onClose])

  const parsed = useMemo(() => (details?.working != null ? parseConflicts(details.working) : null), [details])
  const conflicts = useMemo(() => parsed?.chunks.filter((c): c is Conflict => c.kind === 'conflict') ?? [], [parsed])
  const resolvedCount = conflicts.filter((_, i) => resolutions[i]).length
  const result = parsed ? buildResult(parsed, resolutions) : ''

  const setAt = useCallback(
    (index: number, resolution: ChunkResolution | undefined) =>
      setResolutions((prev) => {
        const next = [...prev]
        next[index] = resolution
        return next
      }),
    []
  )

  /** Rola os três painéis juntos até o conflito `index`. */
  const scrollToConflict = useCallback((index: number) => {
    const panes = Object.values(scrollers.current).filter((el): el is HTMLDivElement => !!el)
    const block = panes[0]?.querySelector<HTMLElement>(`[data-conflict="${index}"]`)
    if (!block) return
    const top = Math.max(0, block.offsetTop - 2 * LINE)
    syncing.current = 'result'
    for (const el of panes) el.scrollTop = top
    cancelAnimationFrame(syncFrame.current)
    syncFrame.current = requestAnimationFrame(() => (syncing.current = null))
  }, [])

  const goTo = useCallback(
    (index: number | null) => {
      if (index === null) return
      setCurrent(index)
      scrollToConflict(index)
    },
    [scrollToConflict]
  )

  // Depois de trocar a visão ou os painéis de lugar, volta para o conflito em que o usuário estava.
  // (A chave é um texto: o objeto do layout é recriado a cada leitura.)
  const arrangement = `${layout.mode}:${layout.order.join()}`
  useEffect(() => {
    if (!showFinal) requestAnimationFrame(() => scrollToConflict(current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement, showFinal, parsed])

  const isResolved = (i: number) => !!resolutions[i]
  const step = (dir: 1 | -1, onlyPending = false) => goTo(nextConflict(current, conflicts.length, dir, isResolved, onlyPending))
  /** Resolve o conflito atual e segue para o próximo pendente. */
  const takeCurrent = (resolution: ChunkResolution) => {
    if (!conflicts.length) return
    setAt(current, resolution)
    const pending = (i: number) => i !== current && !resolutions[i]
    const next = nextConflict(current, conflicts.length, 1, (i) => !pending(i), true)
    if (next !== null) goTo(next)
  }
  const [leftSource, rightSource] = sourcesByPosition(layout, rtl)

  // Atalhos dentro do editor: Alt+↓/↑ navegam entre conflitos; Alt+←/→ usam a versão do painel da esquerda/direita.
  const keyState = useRef({ step, takeCurrent, leftSource, rightSource })
  keyState.current = { step, takeCurrent, leftSource, rightSource }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const k = keyState.current
      if (e.key === 'ArrowDown') k.step(1, e.shiftKey)
      else if (e.key === 'ArrowUp') k.step(-1, e.shiftKey)
      else if (e.key === 'ArrowLeft') k.takeCurrent({ kind: k.leftSource })
      else if (e.key === 'ArrowRight') k.takeCurrent({ kind: k.rightSource })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = async () => {
    const done = await run(t('busy.savingResolution'), async () => {
      await git.saveConflictResolution(path, result)
      return true
    })
    if (done) onClose()
  }

  const resolveWhole = async (side: 'ours' | 'theirs') => {
    const done = await run(t('busy.resolving'), async () => {
      await git.resolveConflict(path, side)
      return true
    })
    if (done) onClose()
  }

  if (!details) {
    return (
      <Modal title={t('conflict.titleShort', { path })} onClose={onClose} size="medium">
        <LoaderPane label={t('conflict.loading')} />
      </Modal>
    )
  }

  // Conflitos sem marcadores no texto: binário, ou um lado removeu o arquivo.
  if (details.binary || !parsed || details.ours === null || details.theirs === null) {
    const reason = details.binary
      ? t('conflict.binary')
      : details.ours === null
        ? t('conflict.deletedByUs')
        : details.theirs === null
          ? t('conflict.deletedByThem')
          : t('conflict.unreadable')
    return (
      <Modal title={t('conflict.titleShort', { path })} onClose={onClose} size="medium">
        <p>{reason}</p>
        <div className="choice-list">
          <button className="choice" onClick={() => resolveWhole('ours')}>
            <strong>{details.ours === null ? t('conflict.deleteFile') : t('conflict.keepOurs')}</strong>
          </button>
          <button className="choice" onClick={() => resolveWhole('theirs')}>
            <strong>{details.theirs === null ? t('conflict.deleteFile') : t('conflict.keepTheirs')}</strong>
          </button>
          <button className="choice" onClick={() => window.gittools.openFile(path, repo.root)}>
            <strong>{t('common.openInEditor')}</strong>
            <span>{t('conflict.editorHelp')}</span>
          </button>
        </div>
      </Modal>
    )
  }

  const oursLabel = conflicts[0]?.oursLabel ?? 'HEAD'
  const theirsLabel = conflicts[0]?.theirsLabel ?? ''
  const paneTitle = (pane: MergePane) =>
    pane === 'ours' ? t('conflict.oursColumn', { label: oursLabel }) : pane === 'theirs' ? t('conflict.theirsColumn', { label: theirsLabel }) : t('conflict.resultColumn')
  const useLabel = (pane: MergeSource) => (pane === 'ours' ? t('conflict.useOurs') : t('conflict.useTheirs'))
  /** Seta do resultado para a versão (onde está o texto que será usado). */
  const towards = (pane: MergePane) => arrowBetween(layout, 'result', pane, rtl)
  /** Seta da versão para o resultado (para onde o texto vai). */
  const intoResult = (pane: MergePane) => arrowBetween(layout, pane, 'result', rtl)

  const onScroll = (pane: MergePane) => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current && syncing.current !== pane) return
    syncing.current = pane
    const top = e.currentTarget.scrollTop
    for (const [other, el] of Object.entries(scrollers.current)) if (other !== pane && el && el.scrollTop !== top) el.scrollTop = top
    cancelAnimationFrame(syncFrame.current)
    syncFrame.current = requestAnimationFrame(() => (syncing.current = null))
  }

  const swap = (a: MergePane, b: MergePane) => setLayout(swapPanes(layout, a, b))
  const setMode = (mode: MergeMode) => setLayout(withMode(layout, mode))

  const paneMenu = (e: React.MouseEvent, pane: MergePane) =>
    showMenu(
      e,
      layout.order
        .filter((p) => p !== pane)
        .map((other) => ({ label: t('conflict.layout.swapWith', { pane: paneTitle(other) }), onClick: () => swap(pane, other) }))
    )

  /** Altura (em linhas) do bloco `index` — a maior entre as versões e o resultado, igual nos três painéis. */
  const blockRows = (chunk: Conflict, index: number) =>
    Math.max(2, chunk.ours.length, chunk.theirs.length, resolveChunk(chunk, resolutions[index])?.length ?? 0)

  const renderPane = (pane: MergePane) => {
    let conflictIndex = -1
    const source = pane === 'result' ? null : (pane as MergeSource)
    return (
      <div
        className={`merge-pane merge-pane-${pane} ${dropTarget === pane ? 'drop-over' : ''} ${dragging === pane ? 'dragging' : ''}`}
        onDragOver={(e) => {
          if (!dragging || dragging === pane) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(pane)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((p) => (p === pane ? null : p))
        }}
        onDrop={(e) => {
          e.preventDefault()
          const from = e.dataTransfer.getData(PANE_MIME) as MergePane
          if (from && from !== pane) swap(from, pane)
          setDragging(null)
          setDropTarget(null)
        }}
      >
        <div
          className={`merge-pane-head ${pane}`}
          draggable
          title={t('conflict.layout.dragHelp')}
          onDragStart={(e) => {
            e.dataTransfer.setData(PANE_MIME, pane)
            e.dataTransfer.effectAllowed = 'move'
            setDragging(pane)
          }}
          onDragEnd={() => {
            setDragging(null)
            setDropTarget(null)
          }}
          onContextMenu={(e) => paneMenu(e, pane)}
        >
          <span className="merge-grip" aria-hidden>
            ⠿
          </span>
          <span className="merge-pane-title">{paneTitle(pane)}</span>
          {source && (
            <span className="merge-pane-arrow" title={t('conflict.layout.flowsTo', { pane: paneTitle('result') })}>
              {intoResult(pane)}
            </span>
          )}
          {dropTarget === pane && dragging && <span className="drop-hint">{t('conflict.layout.dropToSwap')}</span>}
        </div>
        <div className="merge-scroll" ref={(el) => void (scrollers.current[pane] = el)} onScroll={onScroll(pane)}>
          <div className="merge-content">
            {parsed.chunks.map((chunk, c) => {
              if (chunk.kind === 'common') {
                return (
                  <CommonChunk
                    key={c}
                    lines={chunk.lines}
                    first={c === 0}
                    last={c === parsed.chunks.length - 1}
                    expanded={unfolded.has(c)}
                    onExpand={() => setUnfolded((prev) => new Set(prev).add(c))}
                  />
                )
              }
              const index = ++conflictIndex
              const resolution = resolutions[index]
              const rows = blockRows(chunk, index)
              // +2: a borda de 1px (os blocos têm borda nos três painéis, para a altura bater).
              const height = rows * LINE + 2 * PAD + 2
              const resultLines = resolveChunk(chunk, resolution)
              const widest = Math.max(0, ...[...chunk.ours, ...chunk.theirs, ...(resultLines ?? [])].map((l) => l.length))
              const is = (kind: ChunkResolution['kind']) => resolution?.kind === kind
              const chosen = !!source && (is(source) || is('ours-theirs') || is('theirs-ours'))
              return (
                <div
                  key={c}
                  data-conflict={index}
                  className={`merge-block ${index === current ? 'current' : ''} ${resolution ? 'resolved' : 'pending'}`}
                  onMouseDown={() => setCurrent(index)}
                >
                  <div className="merge-block-bar">
                    <strong>{t('conflict.blockOf', { index: index + 1, total: conflicts.length })}</strong>
                    {source ? (
                      <button className={is(source) ? 'active' : ''} title={useLabel(source)} onClick={() => setAt(index, { kind: source })}>
                        {withArrow(t('conflict.takeThis'), intoResult(source))}
                      </button>
                    ) : (
                      <ResultActions
                        resolution={resolution}
                        hasBase={!!chunk.base}
                        oursLabel={withArrow(t('conflict.useOurs'), towards('ours'))}
                        theirsLabel={withArrow(t('conflict.useTheirs'), towards('theirs'))}
                        onResolve={(r) => setAt(index, r)}
                      />
                    )}
                  </div>
                  {source ? (
                    <pre className={`merge-side ${source} ${chosen ? 'chosen' : ''}`} style={{ height }}>
                      {(source === 'ours' ? chunk.ours : chunk.theirs).join('\n')}
                    </pre>
                  ) : (
                    <textarea
                      className={`merge-result ${resolution ? 'resolved' : 'pending'}`}
                      style={{ height, width: `max(100%, ${widest + 4}ch)` }}
                      value={resultLines?.join('\n') ?? ''}
                      placeholder={t('conflict.resultPlaceholder')}
                      spellCheck={false}
                      wrap="off"
                      onFocus={() => setCurrent(index)}
                      onChange={(e) => setAt(index, { kind: 'custom', text: e.target.value })}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const [p0, p1, p2] = layout.order
  const panes =
    layout.mode === 'columns' ? (
      <Split id="merge-columns" initial={1 / 3} min={[160, 320]} collapsible={[false, false]} arrangeable={false}>
        {renderPane(p0)}
        <Split id="merge-columns-right" initial={0.5} min={[160, 160]} collapsible={[false, false]} arrangeable={false}>
          {renderPane(p1)}
          {renderPane(p2)}
        </Split>
      </Split>
    ) : (
      <Split id="merge-classic" direction="column" initial={0.5} min={[120, 120]} collapsible={[false, false]} arrangeable={false}>
        <Split id="merge-classic-top" initial={0.5} min={[160, 160]} collapsible={[false, false]} arrangeable={false}>
          {renderPane(p0)}
          {renderPane(p1)}
        </Split>
        {renderPane(p2)}
      </Split>
    )

  const hasConflicts = conflicts.length > 0
  const navButton = (label: ReactNode, title: string, target: number | null, onClick: () => void) => (
    <button disabled={target === null} title={title} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <Modal
      title={t('conflict.title', { path })}
      onClose={onClose}
      size="large"
      id="conflict"
      footer={
        <>
          <span className="footer-summary">
            {conflicts.length === 0 ? t('conflict.noMarkers') : t('conflict.progress', { resolved: resolvedCount, count: conflicts.length })}
          </span>
          <button
            title={t('conflictBulk.menuHelp')}
            onClick={(e) =>
              showMenu(
                e,
                BULK_RESOLUTIONS.map((resolution) => ({
                  label: t(bulkLabel(resolution)),
                  hint: t(bulkHelp(resolution)),
                  onClick: async () => {
                    const result = await resolveAll(resolution)
                    // Se este arquivo saiu do conflito, a janela já não tem o que mostrar.
                    if (result && !result.failed.some((f) => f.path === path)) onClose()
                  }
                }))
              )
            }
          >
            {t('conflictBulk.menuLabel')} ▾
          </button>
          <button onClick={() => window.gittools.openFile(path, repo.root)}>{t('common.openInEditor')}</button>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={resolvedCount < conflicts.length} onClick={save}>
            {t('conflict.save')}
          </button>
        </>
      }
    >
      <div className="merge-editor">
        <div className="merge-toolbar">
          {navButton(`▲ ${t('conflict.nav.prev')}`, t('conflict.nav.prevHelp'), nextConflict(current, conflicts.length, -1), () => step(-1))}
          {navButton(`▼ ${t('conflict.nav.next')}`, t('conflict.nav.nextHelp'), nextConflict(current, conflicts.length, 1), () => step(1))}
          {navButton(
            `⏭ ${t('conflict.nav.nextPending')}`,
            t('conflict.nav.nextPendingHelp'),
            nextConflict(current, conflicts.length, 1, isResolved, true),
            () => step(1, true)
          )}
          {hasConflicts && <span className="merge-current">{t('conflict.blockOf', { index: current + 1, total: conflicts.length })}</span>}
          <span className="toolbar-separator" />
          <button disabled={!hasConflicts} title={t('conflict.nav.takeLeftHelp')} onClick={() => takeCurrent({ kind: leftSource })}>
            {withArrow(useLabel(leftSource), towards(leftSource))}
          </button>
          <button disabled={!hasConflicts} title={t('conflict.nav.takeRightHelp')} onClick={() => takeCurrent({ kind: rightSource })}>
            {withArrow(useLabel(rightSource), towards(rightSource))}
          </button>
          <button disabled={!hasConflicts} onClick={() => takeCurrent({ kind: leftSource === 'ours' ? 'ours-theirs' : 'theirs-ours' })}>
            {leftSource === 'ours' ? t('conflict.bothOursFirst') : t('conflict.bothTheirsFirst')}
          </button>
          <span className="toolbar-spacer" />
          <span className="muted small">{t('conflict.layout.title')}</span>
          <div className="segmented" role="group" aria-label={t('conflict.layout.title')}>
            <button className={layout.mode === 'classic' ? 'active' : ''} title={t('conflict.layout.classicHelp')} onClick={() => setMode('classic')}>
              ⬒ {t('conflict.layout.classic')}
            </button>
            <button className={layout.mode === 'columns' ? 'active' : ''} title={t('conflict.layout.columnsHelp')} onClick={() => setMode('columns')}>
              ▥ {t('conflict.layout.columns')}
            </button>
          </div>
          <button title={t('conflict.layout.swapSidesHelp')} onClick={() => swap('ours', 'theirs')}>
            ⇄ {t('conflict.layout.swapSides')}
          </button>
          <button
            className="link"
            disabled={layout.order.join() === DEFAULT_ORDER[layout.mode].join()}
            onClick={() => setLayout({ mode: layout.mode, order: DEFAULT_ORDER[layout.mode] })}
          >
            {t('conflict.layout.reset')}
          </button>
        </div>
        <div className="merge-toolbar secondary">
          <span className="muted">{t('conflict.resolveAll')}</span>
          <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours' })))}>{withArrow(t('conflict.useOurs'), towards('ours'))}</button>
          <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'theirs' })))}>{withArrow(t('conflict.useTheirs'), towards('theirs'))}</button>
          <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours-theirs' })))}>{t('conflict.keepBoth')}</button>
          <button className="link" onClick={() => setResolutions([])}>
            {t('conflict.undoChoices')}
          </button>
          <span className="toolbar-spacer" />
          <span className="muted small merge-keys">{t('conflict.nav.keys')}</span>
          <label className="checkbox">
            <input type="checkbox" checked={showFinal} onChange={(e) => setShowFinal(e.target.checked)} />
            {t('conflict.showFinal')}
          </label>
        </div>
        {showFinal ? <pre className="merge-final">{result}</pre> : <div className={`merge-panes merge-${layout.mode}`}>{panes}</div>}
      </div>
    </Modal>
  )
}

/**
 * Botões do bloco no painel do resultado: as duas versões ficam à vista e as demais opções (ambas,
 * original, nenhuma) num menu, para a barra caber mesmo numa coluna estreita.
 */
function ResultActions({
  resolution,
  hasBase,
  oursLabel,
  theirsLabel,
  onResolve
}: {
  resolution: ChunkResolution | undefined
  hasBase: boolean
  oursLabel: string
  theirsLabel: string
  onResolve(resolution: ChunkResolution | undefined): void
}) {
  const { showMenu } = useApp()
  const is = (kind: ChunkResolution['kind']) => resolution?.kind === kind
  const neither = resolution?.kind === 'custom' && resolution.text === ''
  const more: { label: string; resolution: ChunkResolution; active: boolean; hint?: string }[] = [
    { label: t('conflict.bothOursFirst'), resolution: { kind: 'ours-theirs' }, active: is('ours-theirs') },
    { label: t('conflict.bothTheirsFirst'), resolution: { kind: 'theirs-ours' }, active: is('theirs-ours') },
    ...(hasBase ? [{ label: t('conflict.base'), resolution: { kind: 'base' } as ChunkResolution, active: is('base'), hint: t('conflict.baseHelp') }] : []),
    { label: t('conflict.neither'), resolution: { kind: 'custom', text: '' }, active: neither }
  ]
  const chosen = more.find((m) => m.active)
  return (
    <>
      <button className={is('ours') ? 'active' : ''} title={oursLabel} onClick={() => onResolve({ kind: 'ours' })}>
        {oursLabel}
      </button>
      <button className={is('theirs') ? 'active' : ''} title={theirsLabel} onClick={() => onResolve({ kind: 'theirs' })}>
        {theirsLabel}
      </button>
      <button
        className={chosen ? 'active' : ''}
        title={chosen ? chosen.label : t('conflict.more')}
        onClick={(e) =>
          showMenu(e, [
            ...more.map((m) => ({ label: `${m.active ? '✓ ' : ''}${m.label}`, hint: m.hint, onClick: () => onResolve(m.resolution) })),
            ...(resolution ? ['separator' as const, { label: t('conflict.clear'), onClick: () => onResolve(undefined) }] : [])
          ])
        }
      >
        {chosen ? chosen.label : t('conflict.more')} ▾
      </button>
      {resolution?.kind === 'custom' && !neither && <span className="tag">{t('conflict.edited')}</span>}
    </>
  )
}

/** Trecho igual nas duas versões; os do meio ficam recolhidos (o estado vale para os três painéis). */
function CommonChunk({ lines, first, last, expanded, onExpand }: { lines: string[]; first: boolean; last: boolean; expanded: boolean; onExpand(): void }) {
  const head = first ? [] : lines.slice(0, CONTEXT)
  const tail = last ? [] : lines.slice(-CONTEXT)
  const hidden = lines.length - head.length - tail.length
  if (expanded || hidden <= 2) return <pre className="merge-common">{lines.join('\n')}</pre>
  return (
    <>
      {head.length > 0 && <pre className="merge-common">{head.join('\n')}</pre>}
      <button className="merge-fold" onClick={onExpand}>
        ⋯ {t('conflict.hiddenLines', { count: hidden })}
      </button>
      {tail.length > 0 && <pre className="merge-common">{tail.join('\n')}</pre>}
    </>
  )
}
