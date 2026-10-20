import { useEffect, useState } from 'react'
import type { ChangedFile, CommitDetails, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { DiffView } from './DiffView'

export function CommitDetailsPanel({ selected }: { selected: string[] }) {
  if (selected.length === 0) {
    return (
      <section className="details empty-details">
        <h3>{t('details.tips.title')}</h3>
        <ul className="tips">
          <li>{t('details.tips.dragCommit')}</li>
          <li>{t('details.tips.dragBranch')}</li>
          <li>{t('details.tips.clickCommit')}</li>
          <li>{t('details.tips.studio')}</li>
        </ul>
      </section>
    )
  }
  if (selected.length > 1) return <MultiSelection shas={selected} />
  return <SingleCommit key={selected[0]} sha={selected[0]} />
}

function MultiSelection({ shas }: { shas: string[] }) {
  const { openStudio } = useApp()
  const actions = useActions()
  return (
    <section className="details">
      <h3>{t('details.multiTitle', { count: shas.length })}</h3>
      <p className="muted">{t('details.multiHelp')}</p>
      <div className="button-column">
        {actions.head && (
          <button className="primary" onClick={() => actions.cherryPickCommits(actions.head!, shas)}>
            🍒 {t('details.cherryPickInto', { target: actions.head })}
          </button>
        )}
        <button onClick={() => openStudio({ target: actions.head ?? undefined, commits: shas, mode: 'files' })}>
          {t('details.chooseFilesOrLines')}
        </button>
      </div>
    </section>
  )
}

function SingleCommit({ sha }: { sha: string }) {
  const { toast, openFileView } = useApp()
  const actions = useActions()
  const head = actions.head
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())

  useEffect(() => {
    git.commitDetails(sha).then(
      (d) => {
        setDetails(d)
        setActive(d.files[0] ?? null)
      },
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, toast])

  useEffect(() => {
    setSelection(new Set())
    setDiff(null)
    if (!active) return
    git.diff({ kind: 'commit', sha, path: active.path }).then(
      (files) => setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, active, toast])

  if (!details) return <section className="details"><span className="spinner" /></section>

  const pathsOf = (files: ChangedFile[]) => files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
  const dragFiles = (file: ChangedFile) =>
    checked.has(file.path) ? details.files.filter((f) => checked.has(f.path)) : [file]

  const applyLines = async () => {
    if (!head || !diff) return
    const done = await actions.applyLines(
      head,
      { kind: 'commit', sha },
      diff.path,
      [...selection],
      t('details.linesContext', { path: diff.path, sha: shortSha(sha), subject: details.subject }),
      `${details.subject}\n\n${t('messages.linesFrom', { path: diff.path, sha: details.sha })}`
    )
    if (done) setSelection(new Set())
  }

  return (
    <section className="details">
      <div className="commit-header">
        <h3>{details.subject}</h3>
        {details.body && <p className="commit-body pre-line">{details.body}</p>}
        <div className="commit-meta">
          <span>
            {details.author} &lt;{details.email}&gt;
          </span>
          <span>{fullDate(details.date)}</span>
          <code title={t('common.clickToCopy')} onClick={() => navigator.clipboard.writeText(details.sha)}>
            {shortSha(details.sha)}
          </code>
          {details.parents.length > 1 && <span className="tag">merge</span>}
        </div>
        {head && (
          <div className="button-row">
            <button className="primary" onClick={() => actions.cherryPickCommits(head, [sha], details.subject)}>
              🍒 {t('details.cherryPickInto', { target: head })}
            </button>
            {checked.size > 0 && (
              <button onClick={() => actions.filesOntoBranch(sha, pathsOf(details.files.filter((f) => checked.has(f.path))), head)}>
                {t('details.takeChecked', { count: checked.size, target: head })}
              </button>
            )}
          </div>
        )}
      </div>

      <ul className="file-list">
        {details.files.map((file) => (
          <li
            key={file.path}
            className={`file-item ${active?.path === file.path ? 'active' : ''}`}
            onClick={() => setActive(file)}
            draggable
            onDragStart={(e) => {
              const files = dragFiles(file)
              startDrag(
                e,
                { type: 'commit-files', sha, paths: pathsOf(files) },
                files.length > 1 ? `📄 ${t('common.files', { count: files.length })}` : `📄 ${file.path}`
              )
            }}
            onDragEnd={endDrag}
            title={t('details.dragFile')}
          >
            <input
              type="checkbox"
              checked={checked.has(file.path)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = new Set(checked)
                if (e.target.checked) next.add(file.path)
                else next.delete(file.path)
                setChecked(next)
              }}
            />
            <span className={`status status-${file.status}`} title={statusLabel(file.status)}>
              {file.status}
            </span>
            <span className="file-path">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
          </li>
        ))}
      </ul>

      {diff && (
        <div className="diff-panel">
          {head && (
            <div className="selection-bar">
              <span className="muted">{t('details.selectLinesHelp')}</span>
              <button className="primary" disabled={!selection.size} onClick={applyLines}>
                {t('common.applyLinesInto', { count: selection.size, target: head })}
              </button>
              <button onClick={() => actions.filesOntoBranch(sha, pathsOf([active!]), head)}>{t('details.takeWholeFile')}</button>
              <button onClick={() => openFileView(diff.path)}>{t('common.blameHistory')}</button>
            </div>
          )}
          <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} />
        </div>
      )}
    </section>
  )
}
