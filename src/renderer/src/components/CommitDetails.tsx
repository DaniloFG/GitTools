import { useEffect, useState } from 'react'
import type { ChangedFile, CommitDetails, FileDiff, LineKey } from '../../../shared/types'
import { buildEntries, sumStats, type ChangeEntry } from '../changeEntries'
import { useActions } from '../actions'
import { useApp } from '../context'
import { copyText } from '../copy'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { DiffView, useFullFile } from './DiffView'
import { revealView } from '../dockStore'
import { PaneSlot } from '../slots'
import { stepIndex } from '../diffNav'
import { FileEntries, FileViewToggle } from './FileList'
import { LineStats } from './LineStats'

/** Arquivo a abrir no diff (ex.: clicado nos arquivos expandidos do histórico). `n` muda a cada pedido. */
export interface FileFocus {
  sha: string
  path: string
  n: number
}

/** Arquivo não commitado a mostrar no painel (clicado na linha de alterações do histórico). */
export interface WipFocus {
  path: string
  n: number
}

/**
 * Descrição, arquivos e diff do commit escolhido. São três painéis independentes (`commit.message`,
 * `commit.files` e `commit.diff`): cada um pode ficar em qualquer lugar da janela, junto de qualquer outro.
 */
export function CommitPanes({ selected, focus, wip }: { selected: string[]; focus?: FileFocus | null; wip?: WipFocus | null }) {
  if (selected.length === 0 && wip) return <WipPanes focus={wip} />
  if (selected.length === 0) {
    return (
      <>
        <PaneSlot id="commit.message">
          <section className="details empty-details">
            <h3>{t('details.tips.title')}</h3>
            <ul className="tips">
              <li>{t('details.tips.dragCommit')}</li>
              <li>{t('details.tips.dragBranch')}</li>
              <li>{t('details.tips.clickCommit')}</li>
              <li>{t('details.tips.studio')}</li>
            </ul>
          </section>
        </PaneSlot>
        <NothingToShow />
      </>
    )
  }
  if (selected.length > 1) return <MultiSelection shas={selected} />
  return <SingleCommit key={selected[0]} sha={selected[0]} focus={focus?.sha === selected[0] ? focus : null} />
}

/** Painéis de arquivos e de diff quando não há um único commit (ou as alterações) para mostrar. */
function NothingToShow() {
  return (
    <>
      <PaneSlot id="commit.files">
        <p className="empty">{t('details.pickOne')}</p>
      </PaneSlot>
      <PaneSlot id="commit.diff">
        <p className="empty">{t('details.pickOne')}</p>
      </PaneSlot>
    </>
  )
}

function MultiSelection({ shas }: { shas: string[] }) {
  const { openStudio } = useApp()
  const actions = useActions()
  return (
    <>
      <PaneSlot id="commit.message">
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
      </PaneSlot>
      <NothingToShow />
    </>
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

  /** Mostra o diff do arquivo no painel do diff (trazendo-o à frente, se estiver escondido). */
  const showDiff = (file: ChangedFile) => {
    setActive(file)
    revealView('commit.diff')
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
      { label: t('history.files.copyPath'), onClick: () => copyText(file.path) }
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

  if (!details) {
    return (
      <>
        <PaneSlot id="commit.message">
          <section className="details">
            <span className="spinner" />
          </section>
        </PaneSlot>
        <NothingToShow />
      </>
    )
  }

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

  const messagePane = (
    <section className="details">
      {head && (
        <div className="commit-actions sticky-actions">
          <button className="primary" onClick={() => actions.cherryPickCommits(head, [sha], details.subject)}>
            🍒 {t('details.cherryPickInto', { target: head })}
          </button>
        </div>
      )}
      <div className="commit-header">
        <h3>{details.subject}</h3>
        {details.body && <p className="commit-body pre-line">{details.body}</p>}
        <div className="commit-meta">
          <span>
            {details.author} &lt;{details.email}&gt;
          </span>
          <span>{fullDate(details.date)}</span>
          <code title={t('common.clickToCopy')} onClick={() => copyText(details.sha)}>
            {shortSha(details.sha)}
          </code>
          {details.parents.length > 1 && <span className="tag">merge</span>}
        </div>
      </div>
    </section>
  )

  const filesPane = (
    <section className="details">
      <div className="group-header">
        <strong>{t('common.fileList')}</strong> <span className="count">{details.files.length}</span>
        <span className="toolbar-spacer" />
        {head && checked.size > 0 && (
          <button onClick={() => actions.filesOntoBranch(sha, pathsOf(details.files.filter((f) => checked.has(f.path))), head)}>
            {t('details.takeChecked', { count: checked.size, target: head })}
          </button>
        )}
        <FileViewToggle />
      </div>
      <ul className="file-list">
        <FileEntries
          items={details.files}
          pathOf={(f) => f.path}
          oldPathOf={(f) => f.oldPath}
          statusOf={(f) => f.status}
          render={(file, { label, style }) => (
            <li
              key={file.path}
              style={style}
              data-path={file.path}
              tabIndex={-1}
              data-copy={file.path}
              data-copy-what="path"
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
  )

  return (
    <>
      <PaneSlot id="commit.message">{messagePane}</PaneSlot>
      <PaneSlot id="commit.files">{filesPane}</PaneSlot>
      <PaneSlot id="commit.diff">
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
          ) : active ? (
            <p className="empty">
              <span className="spinner" />
            </p>
          ) : (
            <p className="empty">{t('changes.selectFile')}</p>
          )}
        </section>
      </PaneSlot>
    </>
  )
}

/**
 * Detalhes das alterações ainda não commitadas (aberto ao clicar num arquivo da primeira linha do
 * histórico): a lista dos arquivos e, embaixo, o diff do escolhido — igual ao de um commit.
 */
function WipPanes({ focus }: { focus: WipFocus }) {
  const { data, toast, setView, openConflict, openDiffWindow } = useApp()
  const { status } = data
  const [fullFile] = useFullFile()
  type Area = 'unstaged' | 'staged'
  const [active, setActive] = useState<{ area: Area; path: string } | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const entries: ChangeEntry[] = buildEntries(status)
  const areaOf = (e: ChangeEntry): Area => (e.unstaged ? 'unstaged' : 'staged')
  /** Escolhe o arquivo e traz o painel do diff à frente, se estava escondido. */
  const select = (next: { area: Area; path: string }) => {
    setActive(next)
    revealView('commit.diff')
  }

  // Abre o arquivo pedido de fora (cada clique no histórico traz um `n` novo).
  useEffect(() => {
    const entry = buildEntries(data.status).find((e) => e.path === focus.path)
    if (entry) setActive({ area: entry.unstaged ? 'unstaged' : 'staged', path: entry.path })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.n])

  // O arquivo ativo pode ter saído da lista (foi commitado) ou trocado de lado (foi para o stage).
  useEffect(() => {
    if (!active) return
    const inList = (area: Area) => status[area].some((f) => f.path === active.path)
    if (inList(active.area)) return
    const other: Area = active.area === 'unstaged' ? 'staged' : 'unstaged'
    setActive(inList(other) ? { area: other, path: active.path } : null)
  }, [status, active])

  useEffect(() => {
    if (!active) {
      setDiff(null)
      return
    }
    let cancelled = false
    git.diff({ kind: active.area, path: active.path, fullFile }).then(
      (files) => {
        if (cancelled) return
        const next = files.find((f) => f.path === active.path || f.oldPath === active.path) ?? files[0] ?? null
        setDiff((prev) => (prev && next && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      },
      (e) => !cancelled && toast('error', errorMessage(e))
    )
    return () => {
      cancelled = true
    }
  }, [active, status, toast, fullFile])

  const ordered = entries.map((e) => ({ area: areaOf(e), path: e.path }))
  const position = active ? ordered.findIndex((f) => f.path === active.path) : -1
  const fileNav = {
    index: Math.max(0, position),
    count: ordered.length,
    go: (delta: 1 | -1) => {
      const next = ordered[stepIndex(position, delta, ordered.length)]
      if (next) setActive(next)
    }
  }
  const both = !!active && status.unstaged.some((f) => f.path === active.path) && status.staged.some((f) => f.path === active.path)
  const openWindow = (path: string, area: Area) => openDiffWindow({ source: { kind: area }, path, title: `${path} · ${t('history.wip.title')}` })
  const codeOf = (e: ChangeEntry) => (e.unstaged ? (e.unstaged.untracked ? '?' : e.unstaged.worktree) : e.staged!.index)

  const files = (
    <section className="details">
      <div className="group-header">
        <strong>{t('common.fileList')}</strong> <span className="count">{entries.length + status.conflicted.length}</span>
        <span className="toolbar-spacer" />
        <FileViewToggle />
      </div>
      {status.conflicted.length > 0 && (
        <ul className="file-list">
          {status.conflicted.map((f) => (
            <li key={f.path} className="file-item" onClick={() => openConflict(f.path)} title={t('changes.conflictedHint')}>
              <span className="status status-U">U</span>
              <span className="file-label" data-status="U">
                <span className="file-name">{f.path}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && status.conflicted.length === 0 ? (
        <p className="empty small">{t('history.wip.clean')}</p>
      ) : (
        <ul className="file-list">
          <FileEntries
            items={entries}
            pathOf={(e) => e.path}
            oldPathOf={(e) => e.origPath}
            statusOf={codeOf}
            render={(e, { label, style }) => {
              const code = codeOf(e)
              return (
                <li
                  key={e.path}
                  style={style}
                  className={`file-item ${active?.path === e.path ? 'active' : ''}`}
                  onClick={() => select({ area: areaOf(e), path: e.path })}
                  onDoubleClick={() => openWindow(e.path, areaOf(e))}
                  title={t('history.wip.fileHelp')}
                >
                  <span className={`status status-${code}`} title={statusLabel(code)}>
                    {code === '?' ? 'N' : code}
                  </span>
                  {label}
                  <LineStats stats={sumStats(e.staged, e.unstaged)} />
                  {e.staged && !e.unstaged && <span className="wip-chip ok">{t('history.wip.stagedTag')}</span>}
                  {e.staged && e.unstaged && <span className="wip-chip">{t('history.wip.partialTag')}</span>}
                </li>
              )
            }}
          />
        </ul>
      )}
    </section>
  )

  return (
    <>
      <PaneSlot id="commit.message">
        <section className="details">
          <div className="commit-header">
            <h3>{t('history.wip.title')}</h3>
            <p className="muted">{t('history.wip.openHelp')}</p>
            <div className="commit-actions">
              <button onClick={() => setView('changes')}>{t('history.wip.open')} →</button>
            </div>
          </div>
        </section>
      </PaneSlot>
      <PaneSlot id="commit.files">{files}</PaneSlot>
      <PaneSlot id="commit.diff">
        <section className="details">
          {diff && active ? (
            <div className="diff-panel">
              <div className="selection-bar">
                {both && (
                  <div className="segmented" role="group" dir="ltr">
                    {(['unstaged', 'staged'] as const).map((area) => (
                      <button key={area} className={active.area === area ? 'active' : ''} aria-pressed={active.area === area} onClick={() => setActive({ area, path: active.path })}>
                        {t(area === 'staged' ? 'changes.sections.staged' : 'changes.sections.unstaged')}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => openWindow(active.path, active.area)} title={t('diffExtra.openWindowHelp')}>
                  ⧉ {t('diffExtra.openWindow')}
                </button>
              </div>
              <DiffView file={diff} fileNav={fileNav} />
            </div>
          ) : active ? (
            <p className="empty">
              <span className="spinner" />
            </p>
          ) : (
            <p className="empty">{t('changes.selectFile')}</p>
          )}
        </section>
      </PaneSlot>
    </>
  )
}
