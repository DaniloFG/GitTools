import { useEffect, useState } from 'react'
import type { ChangedFile, CommitInfo, Comparison, DiffSource, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { currentBranch, useApp, type CompareRequest } from '../context'
import { errorMessage, relativeDate, shortSha, statusLabel } from '../format'
import { t } from '../i18n'
import { git } from '../git'
import { CommitDetailsPanel } from './CommitDetails'
import { DiffView, useFullFile } from './DiffView'
import { revealPane, Split } from './Split'
import { stepIndex } from '../diffNav'
import { FileEntries, FileViewToggle } from './FileList'
import { LineStats } from './LineStats'

interface Props {
  request: CompareRequest
  onRequest(request: CompareRequest): void
}

/** Compara duas branches, tags ou commits quaisquer. */
export function CompareView({ request, onRequest }: Props) {
  const { data, run, toast, selectCommit, openFileView, showMenu, openDiffWindow } = useApp()
  const actions = useActions()
  const head = currentBranch(data)
  const defaultTo = data.branches.find((b) => !b.remote && b.name !== head)?.name ?? ''
  const [from, setFrom] = useState(request.from ?? head ?? 'HEAD')
  const [to, setTo] = useState(request.to ?? defaultTo)
  const [sinceBase, setSinceBase] = useState(true)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<ChangedFile | null>(null)
  /** Commit aberto no painel ao lado (clicado nas listas "Só em…"); a tela continua na comparação. */
  const [commit, setCommit] = useState<string | null>(null)
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
    setCommit(null)
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
  const [fullFile] = useFullFile()
  const source: DiffSource | null = comparison && base ? { kind: 'range', from: base, to: comparison.to, fullFile } : null

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
  }, [active, comparison, fullFile])

  const openCommit = (sha: string) => setCommit(sha)
  const commitMenu = (e: React.MouseEvent, sha: string) =>
    showMenu(e, [
      { label: t('compare.showCommit'), onClick: () => setCommit(sha) },
      { label: t('compare.openInHistory'), onClick: () => selectCommit(sha) },
      'separator',
      { label: t('history.menu.copySha'), onClick: () => navigator.clipboard.writeText(sha) }
    ])

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
        <Split id="compare" initial={0.4} min={[240, 280]}>
          <div className="compare-side">
            <CommitGroup
              title={t('compare.onlyIn', { ref: comparison.to })}
              commits={comparison.onlyTo}
              active={commit}
              onOpen={openCommit}
              onMenu={commitMenu}
              action={
                head && comparison.onlyTo.length > 0 && head !== comparison.to
                  ? { label: `🍒 ${t('compare.takeTo', { target: head })}`, run: () => actions.cherryPickCommits(head, [...comparison.onlyTo].reverse().map((c) => c.sha)) }
                  : undefined
              }
            />
            <CommitGroup
              title={t('compare.onlyIn', { ref: comparison.from })}
              commits={comparison.onlyFrom}
              active={commit}
              onOpen={openCommit}
              onMenu={commitMenu}
            />
            <div className="group-header">
              <strong>{t('compare.differentFiles')}</strong> <span className="count">{comparison.files.length}</span>
              <span className="toolbar-spacer" />
              <FileViewToggle compact />
            </div>
            {comparison.files.length === 0 ? (
              <p className="empty small">{t('compare.identical')}</p>
            ) : (
              <ul className="file-list">
                <FileEntries
                  items={comparison.files}
                  pathOf={(f) => f.path}
                  oldPathOf={(f) => f.oldPath}
                  statusOf={(f) => f.status}
                  render={(f, { label, style }) => (
                  <li
                    key={f.path}
                    style={style}
                    className={`file-item ${!commit && active?.path === f.path ? 'active' : ''}`}
                    onClick={() => {
                      setCommit(null)
                      setActive(f)
                      revealPane('compare', 'second')
                    }}
                  >
                    <span className={`status status-${f.status}`} title={statusLabel(f.status)}>
                      {f.status}
                    </span>
                    {label}
                    <LineStats stats={f} />
                  </li>
                  )}
                />
              </ul>
            )}
          </div>
          {commit ? (
            <CommitDetailsPanel selected={[commit]} />
          ) : (
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
                  <button
                    onClick={() => source && openDiffWindow({ source, path: active.path, title: `${active.path} · ${shortSha(base!)} → ${comparison.to}` })}
                    title={t('diffExtra.openWindowHelp')}
                  >
                    ⧉ {t('diffExtra.openWindow')}
                  </button>
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
                <DiffView
                  file={diff}
                  selection={head ? selection : undefined}
                  onSelectionChange={setSelection}
                  fileNav={{
                    index: Math.max(0, comparison.files.findIndex((f) => f.path === active?.path)),
                    count: comparison.files.length,
                    go: (delta) => {
                      const next = comparison.files[stepIndex(comparison.files.findIndex((f) => f.path === active?.path), delta, comparison.files.length)]
                      if (next) setActive(next)
                    }
                  }}
                />
              </div>
            )}
          </section>
          )}
        </Split>
      )}
    </div>
  )
}

function CommitGroup({
  title,
  commits,
  active,
  onOpen,
  onMenu,
  action
}: {
  title: string
  commits: CommitInfo[]
  active: string | null
  onOpen(sha: string): void
  onMenu(e: React.MouseEvent, sha: string): void
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
              <li
                key={c.sha}
                className={active === c.sha ? 'active' : ''}
                onClick={() => onOpen(c.sha)}
                onContextMenu={(e) => onMenu(e, c.sha)}
                title={t('compare.showCommitHelp')}
              >
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
