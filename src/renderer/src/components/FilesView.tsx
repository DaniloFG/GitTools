import { useEffect, useMemo, useRef, useState } from 'react'
import type { BlameResult, FileDiff, FileHistoryEntry, LineKey } from '../../../shared/types'
import { currentBranch, useApp } from '../context'
import { useActions } from '../actions'
import { errorMessage, fullDate, relativeDate, shortSha } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { useLayout } from '../layout'
import { startResize } from '../resize'
import { DiffView, useFullFile } from './DiffView'
import { revealView } from '../dockStore'
import { PaneSlot, useAnyShown } from '../slots'
import { LineStats } from './LineStats'
import { FileEditor } from './FileEditor'
import { draftPaths, useDraftsVersion } from '../editorDrafts'
import { FileEntries, FileViewToggle } from './FileList'
import { Loader, LoaderPane } from './Loader'

const MAX_LISTED = 500
const UNCOMMITTED = /^0+$/
const GUTTER_DEFAULT = 260
const GUTTER_MIN = 120
const GUTTER_MAX = 640
const parseGutter = (value: unknown) => (typeof value === 'number' && value >= GUTTER_MIN && value <= GUTTER_MAX ? value : GUTTER_DEFAULT)

/**
 * Explorador de arquivos com editor, blame por linha e histórico de cada arquivo. São painéis independentes:
 * a lista de arquivos (`files.list`), o editor (`files.editor`), o blame (`files.blame`), as versões do arquivo
 * (`files.history`) e o diff da versão escolhida (`files.diff`) — cada um pode ficar em qualquer lugar da janela.
 */
export function FilesPanes({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const [blameRev, setBlameRev] = useState<string | undefined>(undefined)
  useEffect(() => setBlameRev(undefined), [path])

  return (
    <>
      <PaneSlot id="files.list">
        <FilesList path={path} onPath={onPath} />
      </PaneSlot>
      <PaneSlot id="files.editor">
        {path ? <FileEditor key={path} path={path} /> : <p className="empty">{t('files.empty')}</p>}
      </PaneSlot>
      <PaneSlot id="files.blame">
        <section className="details file-details">
          {!path ? (
            <p className="empty">{t('files.empty')}</p>
          ) : (
            <>
              <FileHeader path={path} title={blameRev ? t('files.blameAt', { sha: shortSha(blameRev) }) : t('files.blame')} />
              <div className="file-details-body">
                <BlameView path={path} rev={blameRev} onClearRev={() => setBlameRev(undefined)} />
              </div>
            </>
          )}
        </section>
      </PaneSlot>
      <FileHistoryPanes
        path={path}
        onBlameAt={(sha) => {
          setBlameRev(sha)
          revealView('files.blame')
        }}
      />
    </>
  )
}

function FileHeader({ path, title }: { path: string; title: string }) {
  const { openInEditor } = useApp()
  return (
    <div className="file-header">
      <strong>{title}</strong>
      <code className="diff-path">{path}</code>
      <span className="toolbar-spacer" />
      <button onClick={() => openInEditor(path)}>{t('common.openInEditor')}</button>
    </div>
  )
}

function FilesList({ path, onPath }: { path: string | null; onPath(path: string): void }) {
  const { data, toast, repo } = useApp()
  const [files, setFiles] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  // Arquivos com alterações ainda não salvas no editor.
  useDraftsVersion()
  const unsaved = new Set(draftPaths(repo.root))

  useEffect(() => {
    git.listFiles().then(setFiles, (e) => toast('error', errorMessage(e)))
  }, [data.status.headSha, toast])

  const filtered = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return files.filter((f) => terms.every((t) => f.toLowerCase().includes(t)))
  }, [files, filter])
  const shown = useMemo(() => filtered.slice(0, MAX_LISTED), [filtered])

  return (
    <div className="files-list">
      <div className="files-list-header">
        <input className="files-filter" placeholder={t('files.filter', { count: files.length })} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <FileViewToggle />
      </div>
      <ul className="file-list">
        <FileEntries
          items={shown}
          pathOf={(f) => f}
          render={(f, { label, style }) => (
            <li
              key={f}
              className={`file-item ${f === path ? 'active' : ''}`}
              style={style}
              onClick={() => {
                onPath(f)
                revealView('files.editor')
              }}
              title={f}
            >
              {label}
              {unsaved.has(f) && (
                <span className="file-unsaved" title={t('editor.unsavedHelp')} aria-label={t('editor.unsaved')}>
                  ●
                </span>
              )}
            </li>
          )}
        />
      </ul>
      {filtered.length > MAX_LISTED && <p className="muted small">{t('files.truncated', { shown: MAX_LISTED, count: filtered.length })}</p>}
    </div>
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
  if (!blame) return <LoaderPane label={t('loader.blame')} />

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

function FileHistoryPanes({ path, onBlameAt }: { path: string | null; onBlameAt(sha: string): void }) {
  // As versões só são lidas enquanto algum dos dois painéis está na tela.
  const shown = useAnyShown(['files.history', 'files.diff'])
  return shown && path ? <FileHistoryLoaded key={path} path={path} onBlameAt={onBlameAt} /> : <HistoryMessage>{path ? <Loader size="sm" label={t('loader.fileHistory')} /> : t('files.empty')}</HistoryMessage>
}

/** Mensagem nos dois painéis do histórico do arquivo (nada escolhido, carregando, sem commits). */
function HistoryMessage({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaneSlot id="files.history">
        <p className="empty">{children}</p>
      </PaneSlot>
      <PaneSlot id="files.diff">
        <p className="empty">{children}</p>
      </PaneSlot>
    </>
  )
}

function FileHistoryLoaded({ path, onBlameAt }: { path: string; onBlameAt(sha: string): void }) {
  const { data, run, confirm, toast, selectCommit, openDiffWindow } = useApp()
  const actions = useActions()
  const head = currentBranch(data)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [active, setActive] = useState<FileHistoryEntry | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  const [fullFile] = useFullFile()

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
    git.diff({ kind: 'commit', sha: active.sha, path: active.path, fullFile }).then(
      (files) => setDiff(files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [active, toast, fullFile])

  if (!entries) return <HistoryMessage><Loader size="sm" label={t('loader.fileHistory')} /></HistoryMessage>
  if (entries.length === 0) return <HistoryMessage>{t('files.noCommits')}</HistoryMessage>

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
      { kind: 'commit', sha: active.sha, fullFile },
      diff.path,
      [...selection],
      t('details.linesContext', { path: diff.path, sha: shortSha(active.sha), subject: active.subject }),
      `${active.subject}\n\n${t('messages.linesFrom', { path: diff.path, sha: active.sha })}`
    )
    if (done) setSelection(new Set())
  }

  return (
    <>
      <PaneSlot id="files.history">
        <section className="details file-details">
          <FileHeader path={path} title={t('files.history')} />
          <ul className="compare-commits history-list">
            {entries.map((e) => (
              <li
                key={e.sha}
                className={active?.sha === e.sha ? 'active' : ''}
                onClick={() => {
                  setActive(e)
                  revealView('files.diff')
                }}
              >
                <code>{shortSha(e.sha)}</code>
                <span className="commit-subject">{e.subject}</span>
                {e.path !== path && <span className="tag" title={t('files.nameAtCommit')}>{e.path}</span>}
                <LineStats stats={e} />
                <small className="muted">
                  {e.author} · {relativeDate(e.date)}
                </small>
              </li>
            ))}
          </ul>
        </section>
      </PaneSlot>
      <PaneSlot id="files.diff">
        {active ? (
          <div className="diff-panel file-history-diff">
            <div className="selection-bar">
              <button
                onClick={() => openDiffWindow({ source: { kind: 'commit', sha: active.sha }, path: active.path, title: `${active.path} · ${shortSha(active.sha)}` })}
                title={t('diffExtra.openWindowHelp')}
              >
                ⧉ {t('diffExtra.openWindow')}
              </button>
              <button onClick={() => selectCommit(active.sha)}>{t('files.viewCommit')}</button>
              <button onClick={() => onBlameAt(active.sha)}>{t('files.blameThisVersion')}</button>
              <button onClick={() => restore(active)}>{t('files.restoreThisVersion')}</button>
              {head && (
                <button className="primary" disabled={!selection.size} title={selection.size ? undefined : t('feedback.blocked.noSelection')} onClick={applyLines}>
                  {t('common.applyLinesInto', { count: selection.size, target: head })}
                </button>
              )}
            </div>
            {diff ? <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} /> : <LoaderPane label={t('loader.diff')} />}
          </div>
        ) : (
          <p className="empty">{t('files.noCommits')}</p>
        )}
      </PaneSlot>
    </>
  )
}
