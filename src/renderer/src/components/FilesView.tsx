import { useEffect, useMemo, useRef, useState } from 'react'
import type { BlameResult, FileDiff, FileHistoryEntry, LineKey } from '../../../shared/types'
import { currentBranch, useApp } from '../context'
import { useActions } from '../actions'
import { errorMessage, fullDate, relativeDate, shortSha } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { DiffView } from './DiffView'
import { Split } from './Split'

const MAX_LISTED = 500
const UNCOMMITTED = /^0+$/
const GUTTER_DEFAULT = 260
const GUTTER_MIN = 120
const GUTTER_MAX = 640
const parseGutter = (value: unknown) => (typeof value === 'number' && value >= GUTTER_MIN && value <= GUTTER_MAX ? value : GUTTER_DEFAULT)

/** Explorador de arquivos com blame por linha e histórico de cada arquivo. */
export function FilesView({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const { data, toast, openInEditor } = useApp()
  const [files, setFiles] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<'blame' | 'history'>('blame')
  const [blameRev, setBlameRev] = useState<string | undefined>(undefined)

  useEffect(() => {
    git.listFiles().then(setFiles, (e) => toast('error', errorMessage(e)))
  }, [data.status.headSha, toast])

  useEffect(() => setBlameRev(undefined), [path])

  const filtered = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter((f) => terms.every((t) => f.toLowerCase().includes(t)))
  }, [files, filter])

  return (
    <Split id="files" initial={0.34} min={[200, 320]}>
      <div className="files-list">
        <input className="files-filter" placeholder={t('files.filter', { count: files.length })} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <ul className="file-list">
          {filtered.slice(0, MAX_LISTED).map((f) => (
            <li key={f} className={`file-item ${f === path ? 'active' : ''}`} onClick={() => onPath(f)} title={f}>
              <span className="file-path">{f}</span>
            </li>
          ))}
        </ul>
        {filtered.length > MAX_LISTED && <p className="muted small">{t('files.truncated', { shown: MAX_LISTED, count: filtered.length })}</p>}
      </div>
      <section className="details file-details">
        {!path ? (
          <p className="empty">{t('files.empty')}</p>
        ) : (
          <>
            <div className="file-header">
              <code className="diff-path">{path}</code>
              <span className="toolbar-spacer" />
              <button onClick={() => openInEditor(path)}>{t('common.openInEditor')}</button>
            </div>
            <nav className="tabs">
              <button className={tab === 'blame' ? 'active' : ''} onClick={() => setTab('blame')}>
                {blameRev ? t('files.blameAt', { sha: shortSha(blameRev) }) : t('files.blame')}
              </button>
              <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
                {t('files.history')}
              </button>
            </nav>
            {tab === 'blame' ? (
              <div className="file-details-body">
                <BlameView path={path} rev={blameRev} onClearRev={() => setBlameRev(undefined)} />
              </div>
            ) : (
              <FileHistory
                path={path}
                onBlameAt={(sha) => {
                  setBlameRev(sha)
                  setTab('blame')
                }}
              />
            )}
          </>
        )}
      </section>
    </Split>
  )
}

function BlameView({ path, rev, onClearRev }: { path: string; rev?: string; onClearRev(): void }) {
  const { selectCommit, data } = useApp()
  const [blame, setBlame] = useState<BlameResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gutter, setGutter] = useLayout('blame.gutter', parseGutter)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setBlame(null)
    setError(null)
  }, [path, rev])

  // Recarrega também quando o repositório muda (sem apagar a tela enquanto carrega).
  useEffect(() => {
    let cancelled = false
    git.blame(path, rev).then(
      (b) => !cancelled && setBlame(b),
      (e) => !cancelled && setError(errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [path, rev, data.status])

  const range = useMemo(() => {
    const dates = Object.values(blame?.commits ?? {})
      .filter((c) => !UNCOMMITTED.test(c.sha))
      .map((c) => c.date)
    return { min: Math.min(...dates), max: Math.max(...dates) }
  }, [blame])

  if (error) return <p className="empty">{error}</p>
  if (!blame) return <p className="empty"><span className="spinner" /></p>

  const resizeGutter = (e: React.PointerEvent) => {
    const start = gutter
    const rtl = !!wrapRef.current && getComputedStyle(wrapRef.current).direction === 'rtl'
    startResize(e, 'col-resize', (_event, dx) => setGutter(Math.round(Math.min(Math.max(start + (rtl ? -dx : dx), GUTTER_MIN), GUTTER_MAX))))
  }

  const heat = (date: number) => (range.max > range.min ? (date - range.min) / (range.max - range.min) : 1)

  return (
    <>
      {rev && (
        <p className="muted small">
          {t('files.showingAt', { sha: shortSha(rev) })}{' '}
          <button className="link" onClick={onClearRev}>
            {t('files.showCurrent')}
          </button>
        </p>
      )}
      <div className="blame-wrap" ref={wrapRef} style={{ '--blame-gutter': `${gutter}px` } as React.CSSProperties}>
        <div className="column-resize blame-resize" title={t('layout.resize')} onPointerDown={resizeGutter} onDoubleClick={() => setGutter(undefined)} />
        <table className="blame-table">
          <tbody>
            {blame.lines.map((line, i) => {
              const commit = blame.commits[line.sha]
              const first = i === 0 || blame.lines[i - 1].sha !== line.sha
              // A segunda linha de cada bloco mostra o resumo do commit.
              const second = !first && (i === 1 || blame.lines[i - 2].sha !== line.sha)
              const uncommitted = UNCOMMITTED.test(line.sha)
              const h = uncommitted ? 1 : heat(commit.date)
              return (
                <tr key={line.line} className={first ? 'blame-first' : ''}>
                  <td
                    className="blame-gutter"
                    style={{ borderInlineStartColor: `color-mix(in srgb, var(--accent) ${Math.round(15 + h * 85)}%, transparent)` }}
                    title={uncommitted ? t('files.uncommittedHelp') : `${commit.summary}\n${commit.author} · ${fullDate(commit.date)}\n${commit.sha}\n\n${t('files.clickToOpen')}`}
                    onClick={() => !uncommitted && selectCommit(line.sha)}
                  >
                    {first &&
                      (uncommitted ? (
                        <span className="muted">{t('files.uncommitted')}</span>
                      ) : (
                        <div className="blame-info">
                          <code>{shortSha(line.sha)}</code> <span className="blame-author">{commit.author}</span>{' '}
                          <span className="muted">{relativeDate(commit.date)}</span>
                        </div>
                      ))}
                    {second && !uncommitted && <div className="blame-summary">{commit.summary}</div>}
                  </td>
                  <td className="ln">{line.line}</td>
                  <td className="code">{line.content || ' '}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FileHistory({ path, onBlameAt }: { path: string; onBlameAt(sha: string): void }) {
  const { data, run, confirm, toast, selectCommit } = useApp()
  const actions = useActions()
  const head = currentBranch(data)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [active, setActive] = useState<FileHistoryEntry | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

  useEffect(() => {
    setEntries(null)
    git.fileHistory(path).then(
      (list) => {
        setEntries(list)
        setActive(list[0] ?? null)
      },
      (e) => toast('error', errorMessage(e))
    )
  }, [path, toast])

  useEffect(() => {
    setDiff(null)
    setSelection(new Set())
    if (!active) return
    git.diff({ kind: 'commit', sha: active.sha, path: active.path }).then(
      (files) => setDiff(files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [active, toast])

  if (!entries) return <p className="empty"><span className="spinner" /></p>
  if (entries.length === 0) return <p className="empty">{t('files.noCommits')}</p>

  const restore = async (entry: FileHistoryEntry) => {
    const ok = await confirm({
      title: t('files.restoreTitle'),
      message: t('files.restoreMessage', { path: entry.path, sha: shortSha(entry.sha), subject: entry.subject }),
      confirmLabel: t('files.restore')
    })
    if (ok) await run(t('busy.restoring'), () => git.restoreFile(entry.sha, entry.path))
  }

  const applyLines = async () => {
    if (!head || !active || !diff) return
    const done = await actions.applyLines(
      head,
      { kind: 'commit', sha: active.sha },
      diff.path,
      [...selection],
      t('details.linesContext', { path: diff.path, sha: shortSha(active.sha), subject: active.subject }),
      `${active.subject}\n\n${t('messages.linesFrom', { path: diff.path, sha: active.sha })}`
    )
    if (done) setSelection(new Set())
  }

  return (
    <Split id="file-history" className="file-history" direction="column" fixed initial={220} min={[60, 120]}>
      <ul className="compare-commits history-list">
        {entries.map((e) => (
          <li key={e.sha} className={active?.sha === e.sha ? 'active' : ''} onClick={() => setActive(e)}>
            <code>{shortSha(e.sha)}</code>
            <span className="commit-subject">{e.subject}</span>
            {e.path !== path && <span className="tag" title={t('files.nameAtCommit')}>{e.path}</span>}
            <small className="muted">
              {e.author} · {relativeDate(e.date)}
            </small>
          </li>
        ))}
      </ul>
      {active ? (
        <div className="diff-panel file-history-diff">
          <div className="selection-bar">
            <button onClick={() => selectCommit(active.sha)}>{t('files.viewCommit')}</button>
            <button onClick={() => onBlameAt(active.sha)}>{t('files.blameThisVersion')}</button>
            <button onClick={() => restore(active)}>{t('files.restoreThisVersion')}</button>
            {head && (
              <button className="primary" disabled={!selection.size} onClick={applyLines}>
                {t('common.applyLinesInto', { count: selection.size, target: head })}
              </button>
            )}
          </div>
          {diff ? <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} /> : <p className="empty"><span className="spinner" /></p>}
        </div>
      ) : (
        <div />
      )}
    </Split>
  )
}
