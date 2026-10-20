import { useEffect, useState } from 'react'
import type { ChangedFile, CommitInfo, Comparison, DiffSource, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { currentBranch, useApp, type CompareRequest } from '../context'
import { errorMessage, relativeDate, shortSha, statusLabel } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { DiffView } from './DiffView'

interface Props {
  request: CompareRequest
  onRequest(request: CompareRequest): void
}

/** Compara duas branches, tags ou commits quaisquer. */
export function CompareView({ request, onRequest }: Props) {
  const { data, run, toast, selectCommit, openFileView } = useApp()
  const actions = useActions()
  const head = currentBranch(data)
  const defaultTo = data.branches.find((b) => !b.remote && b.name !== head)?.name ?? ''
  const [from, setFrom] = useState(request.from ?? head ?? 'HEAD')
  const [to, setTo] = useState(request.to ?? defaultTo)
  const [sinceBase, setSinceBase] = useState(true)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

  const refs = [
    'HEAD',
    ...data.branches.map((b) => b.name),
    ...data.tags.map((t) => t.name)
  ]

  // Uma nova solicitação (vinda de um menu) substitui os campos.
  useEffect(() => {
    if (request.from) setFrom(request.from)
    if (request.to) setTo(request.to)
  }, [request])

  const doCompare = async (a = from, b = to) => {
    if (!a.trim() || !b.trim()) return
    setLoading(true)
    setActive(null)
    try {
      const result = await git.compare(a.trim(), b.trim(), sinceBase)
      setComparison(result)
      setActive(result.files[0] ?? null)
    } catch (e) {
      setComparison(null)
      toast('error', errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const a = request.from ?? from
    const b = request.to ?? to
    if (a && b) void doCompare(a, b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, sinceBase])

  const base = comparison ? (sinceBase && comparison.mergeBase ? comparison.mergeBase : comparison.from) : null
  const source: DiffSource | null = comparison && base ? { kind: 'range', from: base, to: comparison.to } : null

  useEffect(() => {
    setDiff(null)
    setSelection(new Set())
    if (!source || !active) return
    let cancelled = false
    git.diff({ ...source, path: active.path }).then(
      (files) => !cancelled && setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, comparison])

  const swap = () => {
    setFrom(to)
    setTo(from)
    onRequest({ from: to, to: from })
  }

  const applyLines = async () => {
    if (!head || !diff || !source || !comparison) return
    const done = await actions.applyLines(
      head,
      source,
      diff.path,
      [...selection],
      t('compare.linesContext', { path: diff.path, from: comparison.from, to: comparison.to }),
      t('messages.linesFromRef', { path: diff.path, ref: comparison.to })
    )
    if (done) setSelection(new Set())
  }

  const copyVersion = async (file: ChangedFile) => {
    if (!head || !comparison) return
    await run(t('busy.copyingVersion'), () =>
      git.cherryPickFiles(head, [comparison.to], file.oldPath ? [file.path, file.oldPath] : [file.path], 'version')
    )
  }

  return (
    <div className="compare">
      <div className="compare-bar">
        <datalist id="compare-refs">
          {refs.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <label className="field inline">
          <span>{t('compare.from')}</span>
          <input list="compare-refs" value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCompare()} placeholder={t('compare.refPlaceholder')} />
        </label>
        <button className="icon-button" onClick={swap} title={t('compare.swap')}>
          ⇄
        </button>
        <label className="field inline">
          <span>{t('compare.to')}</span>
          <input list="compare-refs" value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doCompare()} placeholder={t('compare.refPlaceholder')} />
        </label>
        <label className="checkbox" title={t('compare.sinceBaseHelp')}>
          <input type="checkbox" checked={sinceBase} onChange={(e) => setSinceBase(e.target.checked)} />
          {t('compare.sinceBase')}
        </label>
        <button className="primary" onClick={() => onRequest({ from, to })} disabled={loading}>
          {loading ? <span className="spinner" /> : t('compare.compare')}
        </button>
      </div>

      {!comparison ? (
        <p className="empty">{t('compare.empty')}</p>
      ) : (
        <div className="split">
          <div className="compare-side">
            <CommitGroup
              title={t('compare.onlyIn', { ref: comparison.to })}
              commits={comparison.onlyTo}
              onOpen={selectCommit}
              action={
                head && comparison.onlyTo.length > 0 && head !== comparison.to
                  ? { label: `🍒 ${t('compare.takeTo', { target: head })}`, run: () => actions.cherryPickCommits(head, [...comparison.onlyTo].reverse().map((c) => c.sha)) }
                  : undefined
              }
            />
            <CommitGroup title={t('compare.onlyIn', { ref: comparison.from })} commits={comparison.onlyFrom} onOpen={selectCommit} />
            <div className="group-header">
              <strong>{t('compare.differentFiles')}</strong> <span className="count">{comparison.files.length}</span>
            </div>
            {comparison.files.length === 0 ? (
              <p className="empty small">{t('compare.identical')}</p>
            ) : (
              <ul className="file-list">
                {comparison.files.map((f) => (
                  <li key={f.path} className={`file-item ${active?.path === f.path ? 'active' : ''}`} onClick={() => setActive(f)}>
                    <span className={`status status-${f.status}`} title={statusLabel(f.status)}>
                      {f.status}
                    </span>
                    <span className="file-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <section className="details">
            {!active ? (
              <p className="empty">{t('compare.selectFile')}</p>
            ) : !diff ? (
              <p className="empty">
                <span className="spinner" />
              </p>
            ) : (
              <div className="diff-panel">
                <div className="selection-bar">
                  <span className="muted">
                    {shortSha(base!)} → {comparison.to}
                  </span>
                  {head && (
                    <>
                      <button className="primary" disabled={!selection.size} onClick={applyLines}>
                        {t('common.applyLinesInto', { count: selection.size, target: head })}
                      </button>
                      <button onClick={() => copyVersion(active)} title={t('compare.copyVersionHelp', { target: head, ref: comparison.to })}>
                        {t('compare.copyVersion', { ref: comparison.to })}
                      </button>
                    </>
                  )}
                  <button onClick={() => openFileView(active.path)}>{t('common.blameHistory')}</button>
                </div>
                <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function CommitGroup({
  title,
  commits,
  onOpen,
  action
}: {
  title: string
  commits: CommitInfo[]
  onOpen(sha: string): void
  action?: { label: string; run(): void }
}) {
  const [open, setOpen] = useState(commits.length <= 15)
  return (
    <div className="compare-group">
      <div className="group-header">
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <strong>{title}</strong> <span className="count">{commits.length}</span>
        <span className="toolbar-spacer" />
        {action && <button onClick={action.run}>{action.label}</button>}
      </div>
      {open &&
        (commits.length === 0 ? (
          <p className="empty small">{t('compare.noCommits')}</p>
        ) : (
          <ul className="compare-commits">
            {commits.map((c) => (
              <li key={c.sha} onClick={() => onOpen(c.sha)} title={t('compare.openInHistory')}>
                <code>{shortSha(c.sha)}</code>
                <span className="commit-subject">{c.subject}</span>
                <small className="muted">
                  {c.author} · {relativeDate(c.date)}
                </small>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}
