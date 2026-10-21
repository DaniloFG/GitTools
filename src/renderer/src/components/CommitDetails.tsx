import { useEffect, useState } from 'react'
import type { ChangedFile, CommitDetails, FileDiff, LineKey } from '../../../shared/types'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { DiffView, useFullFile } from './DiffView'
import { revealPane, Split } from './Split'
import { stepIndex } from '../diffNav'
import { FileEntries, FileViewToggle } from './FileList'
import { LineStats } from './LineStats'

/** Arquivo a abrir no diff (ex.: clicado nos arquivos expandidos do histórico). `n` muda a cada pedido. */
export interface FileFocus {
  sha: string
  path: string
  n: number
}

export function CommitDetailsPanel({ selected, focus }: { selected: string[]; focus?: FileFocus | null }) {
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
  return <SingleCommit key={selected[0]} sha={selected[0]} focus={focus?.sha === selected[0] ? focus : null} />
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

function SingleCommit({ sha, focus }: { sha: string; focus: FileFocus | null }) {
  const { toast, openFileView, openDiffWindow, openInEditor, showMenu } = useApp()
  const actions = useActions()
  const head = actions.head
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [selection, setSelection] = useState<Set<LineKey>>(new Set())
  const [fullFile] = useFullFile()

  useEffect(() => {
    git.commitDetails(sha).then(
      (d) => {
        setDetails(d)
        setActive(d.files[0] ?? null)
      },
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, toast])

  /** Mostra o diff do arquivo no painel de baixo (expandindo-o, se estiver recolhido). */
  const showDiff = (file: ChangedFile) => {
    setActive(file)
    revealPane('commit-details', 'second')
  }

  const openWindow = (file: ChangedFile) =>
    openDiffWindow({ source: { kind: 'commit', sha }, path: file.path, title: `${file.path} · ${shortSha(sha)}` })

  const fileMenu = (e: React.MouseEvent, file: ChangedFile) =>
    showMenu(e, [
      { label: t('history.files.openDiff'), onClick: () => showDiff(file) },
      { label: `⧉ ${t('diffExtra.openWindow')}`, onClick: () => openWindow(file) },
      ...(head ? [{ label: t('history.files.take', { target: head }), onClick: () => actions.filesOntoBranch(sha, pathsOf([file]), head) }] : []),
      { label: t('common.blameHistory'), onClick: () => openFileView(file.path) },
      { label: t('common.openInEditor'), onClick: () => openInEditor(file.path) },
      'separator',
      { label: t('history.files.copyPath'), onClick: () => navigator.clipboard.writeText(file.path) }
    ])

  // Abre o arquivo pedido de fora (lista de arquivos expandida no histórico).
  useEffect(() => {
    if (!details || !focus) return
    const file = details.files.find((f) => f.path === focus.path)
    if (file) {
      setActive(file)
      document.querySelector(`.file-list [data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [details, focus])

  useEffect(() => {
    setSelection(new Set())
    setDiff(null)
    if (!active) return
    git.diff({ kind: 'commit', sha, path: active.path, fullFile }).then(
      (files) => setDiff(files.find((f) => f.path === active.path) ?? files[0] ?? null),
      (e) => toast('error', errorMessage(e))
    )
  }, [sha, active, toast, fullFile])

  if (!details) return <section className="details"><span className="spinner" /></section>

  const fileNav = {
    index: Math.max(0, details.files.findIndex((f) => f.path === active?.path)),
    count: details.files.length,
    go: (delta: 1 | -1) => {
      const file = details.files[stepIndex(details.files.findIndex((f) => f.path === active?.path), delta, details.files.length)]
      if (!file) return
      showDiff(file)
      document.querySelector(`.file-list [data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }
  const pathsOf = (files: ChangedFile[]) => files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
  const dragFiles = (file: ChangedFile) =>
    checked.has(file.path) ? details.files.filter((f) => checked.has(f.path)) : [file]

  const applyLines = async () => {
    if (!head || !diff) return
    const done = await actions.applyLines(
      head,
      { kind: 'commit', sha, fullFile },
      diff.path,
      [...selection],
      t('details.linesContext', { path: diff.path, sha: shortSha(sha), subject: details.subject }),
      `${details.subject}\n\n${t('messages.linesFrom', { path: diff.path, sha: details.sha })}`
    )
    if (done) setSelection(new Set())
  }

  return (
    // Em cima, a mensagem e os arquivos; embaixo, o diff — a divisória entre eles pode ser arrastada.
    <Split id="commit-details" direction="column" initial={0.4} min={[80, 120]}>
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

        <div className="group-header">
          <strong>{t('common.fileList')}</strong> <span className="count">{details.files.length}</span>
          <span className="toolbar-spacer" />
          <FileViewToggle />
        </div>
        <ul className="file-list">
          <FileEntries
            items={details.files}
            pathOf={(f) => f.path}
            oldPathOf={(f) => f.oldPath}
            render={(file, { label, style }) => (
            <li
              key={file.path}
              style={style}
              data-path={file.path}
              className={`file-item ${active?.path === file.path ? 'active' : ''}`}
              onClick={() => showDiff(file)}
              onDoubleClick={() => openWindow(file)}
              onContextMenu={(e) => fileMenu(e, file)}
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
              {label}
              <LineStats stats={file} />
            </li>
            )}
          />
        </ul>
      </section>
      <section className="details">
        {diff ? (
          <div className="diff-panel">
            {!head && (
              <div className="selection-bar">
                <button onClick={() => openWindow(active!)} title={t('diffExtra.openWindowHelp')}>
                  ⧉ {t('diffExtra.openWindow')}
                </button>
              </div>
            )}
            {head && (
              <div className="selection-bar">
                <span className="muted">{t('details.selectLinesHelp')}</span>
                <button onClick={() => openWindow(active!)} title={t('diffExtra.openWindowHelp')}>
                  ⧉ {t('diffExtra.openWindow')}
                </button>
                <button className="primary" disabled={!selection.size} onClick={applyLines}>
                  {t('common.applyLinesInto', { count: selection.size, target: head })}
                </button>
                <button onClick={() => actions.filesOntoBranch(sha, pathsOf([active!]), head)}>{t('details.takeWholeFile')}</button>
                <button onClick={() => openFileView(diff.path)}>{t('common.blameHistory')}</button>
              </div>
            )}
            <DiffView file={diff} selection={head ? selection : undefined} onSelectionChange={setSelection} fileNav={fileNav} />
          </div>
        ) : (
          active && (
            <p className="empty">
              <span className="spinner" />
            </p>
          )
        )}
      </section>
    </Split>
  )
}
