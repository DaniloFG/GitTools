import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConflictDetails } from '../../../shared/types'
import { buildResult, parseConflicts, resolveChunk, type ChunkResolution, type MergeChunk } from '../../../shared/conflicts'
import { useApp } from '../context'
import { errorMessage } from '../format'
import { git } from '../git'
import { t, textDirection } from '../i18n'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { parseColumns, resizeColumns } from '../panes'
import { Modal } from './Modal'

type Conflict = Extract<MergeChunk, { kind: 'conflict' }>
const CONTEXT = 3
const COLUMNS = [1, 1, 1]
const MIN_COLUMN = 0.25
const parseMergeColumns = (value: unknown) => parseColumns(value, COLUMNS.length) ?? COLUMNS

/** Setas apontando para a coluna da versão atual / da que entra (invertidas em idiomas RTL). */
const arrows = () => (textDirection() === 'rtl' ? { ours: '→', theirs: '←' } : { ours: '←', theirs: '→' })

/**
 * Editor de conflitos em três colunas: versão atual (HEAD) × resultado × versão que entra.
 * Cada bloco em conflito é resolvido com um clique (ou editando o resultado à mão).
 */
export function ConflictEditor({ path, onClose }: { path: string; onClose(): void }) {
  const { run, toast } = useApp()
  const [details, setDetails] = useState<ConflictDetails | null>(null)
  const [resolutions, setResolutions] = useState<(ChunkResolution | undefined)[]>([])
  const [showFinal, setShowFinal] = useState(false)
  const [columns, setColumns] = useLayout('conflict.columns', parseMergeColumns)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    git.conflictDetails(path).then(setDetails, (e) => {
      toast('error', errorMessage(e))
      onClose()
    })
  }, [path, toast, onClose])

  const parsed = useMemo(() => (details?.working != null ? parseConflicts(details.working) : null), [details])
  const conflicts = parsed?.chunks.filter((c): c is Conflict => c.kind === 'conflict') ?? []
  const resolvedCount = conflicts.filter((_, i) => resolutions[i]).length
  const result = parsed ? buildResult(parsed, resolutions) : ''

  const setAt = (index: number, resolution: ChunkResolution | undefined) => {
    const next = [...resolutions]
    next[index] = resolution
    setResolutions(next)
  }

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
        <p className="empty">
          <span className="spinner" /> {t('conflict.loading')}
        </p>
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
          <button className="choice" onClick={() => window.gittools.openFile(path)}>
            <strong>{t('common.openInEditor')}</strong>
            <span>{t('conflict.editorHelp')}</span>
          </button>
        </div>
      </Modal>
    )
  }

  /** Arrasta a borda entre a coluna `index` e a seguinte. */
  const resizeColumn = (e: React.PointerEvent, index: number) => {
    const grid = gridRef.current
    if (!grid) return
    const start = columns
    const width = grid.clientWidth
    const rtl = getComputedStyle(grid).direction === 'rtl'
    const sum = start.reduce((a, b) => a + b, 0)
    startResize(e, 'col-resize', (_event, dx) => setColumns(resizeColumns(start, index, ((rtl ? -dx : dx) / width) * sum, MIN_COLUMN)))
  }
  const columnHandle = (index: number) => (
    <span
      className="column-resize merge-column-resize"
      title={t('layout.resize')}
      onPointerDown={(e) => resizeColumn(e, index)}
      onDoubleClick={() => setColumns(undefined)}
    />
  )

  let conflictIndex = -1
  return (
    <Modal
      title={t('conflict.title', { path })}
      onClose={onClose}
      size="large"
      id="conflict"
      footer={
        <>
          <span className="footer-summary">
            {conflicts.length === 0
              ? t('conflict.noMarkers')
              : t('conflict.progress', { resolved: resolvedCount, count: conflicts.length })}
          </span>
          <button onClick={() => window.gittools.openFile(path)}>{t('common.openInEditor')}</button>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={resolvedCount < conflicts.length} onClick={save}>
            {t('conflict.save')}
          </button>
        </>
      }
    >
      <div className="merge-toolbar">
        <span className="muted">{t('conflict.resolveAll')}</span>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours' })))}>
          {arrows().ours} {t('conflict.useOurs')}
        </button>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'theirs' })))}>
          {t('conflict.useTheirs')} {arrows().theirs}
        </button>
        <button onClick={() => setResolutions(conflicts.map(() => ({ kind: 'ours-theirs' })))}>{t('conflict.keepBoth')}</button>
        <button className="link" onClick={() => setResolutions([])}>
          {t('conflict.undoChoices')}
        </button>
        <span className="toolbar-spacer" />
        <label className="checkbox">
          <input type="checkbox" checked={showFinal} onChange={(e) => setShowFinal(e.target.checked)} />
          {t('conflict.showFinal')}
        </label>
      </div>

      {showFinal ? (
        <pre className="merge-final">{result}</pre>
      ) : (
        <div className="merge-grid" ref={gridRef} style={{ gridTemplateColumns: columns.map((c) => `minmax(0, ${c}fr)`).join(' ') }}>
          <div className="merge-head ours">
            {t('conflict.oursColumn', { label: conflicts[0]?.oursLabel ?? 'HEAD' })}
            {columnHandle(0)}
          </div>
          <div className="merge-head result">
            {t('conflict.resultColumn')}
            {columnHandle(1)}
          </div>
          <div className="merge-head theirs">{t('conflict.theirsColumn', { label: conflicts[0]?.theirsLabel ?? '' })}</div>
          {parsed.chunks.map((chunk, c) => {
            if (chunk.kind === 'common') {
              return <CommonChunk key={c} lines={chunk.lines} first={c === 0} last={c === parsed.chunks.length - 1} />
            }
            const index = ++conflictIndex
            return (
              <ConflictBlock
                key={c}
                index={index}
                total={conflicts.length}
                chunk={chunk}
                resolution={resolutions[index]}
                onResolve={(r) => setAt(index, r)}
              />
            )
          })}
        </div>
      )}
    </Modal>
  )
}

function CommonChunk({ lines, first, last }: { lines: string[]; first: boolean; last: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const head = first ? [] : lines.slice(0, CONTEXT)
  const tail = last ? [] : lines.slice(-CONTEXT)
  const hidden = lines.length - head.length - tail.length
  if (expanded || hidden <= 2) return <pre className="merge-common">{lines.join('\n')}</pre>
  return (
    <>
      {head.length > 0 && <pre className="merge-common">{head.join('\n')}</pre>}
      <button className="merge-fold" onClick={() => setExpanded(true)}>
        ⋯ {t('conflict.hiddenLines', { count: hidden })}
      </button>
      {tail.length > 0 && <pre className="merge-common">{tail.join('\n')}</pre>}
    </>
  )
}

interface BlockProps {
  index: number
  total: number
  chunk: Conflict
  resolution: ChunkResolution | undefined
  onResolve(resolution: ChunkResolution | undefined): void
}

function ConflictBlock({ index, total, chunk, resolution, onResolve }: BlockProps) {
  const lines = resolveChunk(chunk, resolution)
  const is = (kind: ChunkResolution['kind']) => resolution?.kind === kind
  return (
    <>
      <div className="merge-block-bar">
        <strong>
          {t('conflict.blockOf', { index: index + 1, total })}
        </strong>
        <button className={is('ours') ? 'active' : ''} onClick={() => onResolve({ kind: 'ours' })}>
          {arrows().ours} {t('conflict.useOurs')}
        </button>
        <button className={is('ours-theirs') ? 'active' : ''} onClick={() => onResolve({ kind: 'ours-theirs' })}>
          {t('conflict.bothOursFirst')}
        </button>
        <button className={is('theirs-ours') ? 'active' : ''} onClick={() => onResolve({ kind: 'theirs-ours' })}>
          {t('conflict.bothTheirsFirst')}
        </button>
        <button className={is('theirs') ? 'active' : ''} onClick={() => onResolve({ kind: 'theirs' })}>
          {t('conflict.useTheirs')} {arrows().theirs}
        </button>
        {chunk.base && (
          <button className={is('base') ? 'active' : ''} onClick={() => onResolve({ kind: 'base' })} title={t('conflict.baseHelp')}>
            {t('conflict.base')}
          </button>
        )}
        <button className={is('custom') && resolution?.kind === 'custom' && resolution.text === '' ? 'active' : ''} onClick={() => onResolve({ kind: 'custom', text: '' })}>
          {t('conflict.neither')}
        </button>
        {resolution && (
          <button className="link" onClick={() => onResolve(undefined)}>
            {t('conflict.clear')}
          </button>
        )}
      </div>
      <pre className={`merge-side ours ${is('ours') || is('ours-theirs') || is('theirs-ours') ? 'chosen' : ''}`}>{chunk.ours.join('\n') || ' '}</pre>
      <textarea
        className={`merge-result ${resolution ? 'resolved' : 'pending'}`}
        value={lines ? lines.join('\n') : ''}
        placeholder={t('conflict.resultPlaceholder')}
        rows={Math.max(3, chunk.ours.length, chunk.theirs.length, lines?.length ?? 0)}
        spellCheck={false}
        onChange={(e) => onResolve({ kind: 'custom', text: e.target.value })}
      />
      <pre className={`merge-side theirs ${is('theirs') || is('ours-theirs') || is('theirs-ours') ? 'chosen' : ''}`}>{chunk.theirs.join('\n') || ' '}</pre>
    </>
  )
}
