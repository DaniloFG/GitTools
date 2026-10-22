import { useEffect, useState } from 'react'
import type { ChangedFile, CommitDetails, FileDiff, LineKey } from '../../../shared/types'
import { buildEntries, sumStats, type ChangeEntry } from '../changeEntries'
import { useActions } from '../actions'
import { useApp } from '../context'
import { endDrag, startDrag } from '../dnd'
import { errorMessage, fullDate, shortSha, statusLabel } from '../format'
import { git } from '../git'
import { t } from '../i18n'
import { useLayout } from '../layout'
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

/** Arquivo não commitado a mostrar no painel (clicado na linha de alterações do histórico). */
export interface WipFocus {
  path: string
  n: number
}

type InfoShow = 'both' | 'message' | 'files'
type InfoOrientation = 'column' | 'row'
const parseShow = (v: unknown): InfoShow => (v === 'message' || v === 'files' ? v : 'both')
const parseOrientation = (v: unknown): InfoOrientation => (v === 'row' ? 'row' : 'column')

/** O que o painel de cima mostra (descrição e/ou arquivos) e como (um sobre o outro ou lado a lado); fica lembrado. */
function useInfoView() {
  const [show, setShow] = useLayout<InfoShow>('pref.details.show', parseShow)
  const [orientation, setOrientation] = useLayout<InfoOrientation>('pref.details.orientation', parseOrientation)
  return { show, orientation, setShow: (v: InfoShow) => setShow(v === 'both' ? undefined : v), setOrientation: (v: InfoOrientation) => setOrientation(v === 'column' ? undefined : v) }
}

function InfoControls({ view, children }: { view: ReturnType<typeof useInfoView>; children?: React.ReactNode }) {
  const shows: { id: InfoShow; label: string }[] = [
    { id: 'both', label: t('details.view.both') },
    { id: 'message', label: t('details.view.message') },
    { id: 'files', label: t('details.view.files') }
  ]
  const directions: { id: InfoOrientation; label: string; icon: string }[] = [
    { id: 'column', label: t('details.view.stacked'), icon: '⬒' },
    { id: 'row', label: t('details.view.side'), icon: '◫' }
  ]
  return (
    <div className="details-bar">
      <div className="segmented" role="group" aria-label={t('details.view.label')} title={t('details.view.label')} dir="ltr">
        {shows.map((o) => (
          <button key={o.id} className={view.show === o.id ? 'active' : ''} aria-pressed={view.show === o.id} onClick={() => view.setShow(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {view.show === 'both' && (
        <div className="segmented" role="group" dir="ltr">
          {directions.map((o) => (
            <button key={o.id} className={view.orientation === o.id ? 'active' : ''} aria-pressed={view.orientation === o.id} title={o.label} onClick={() => view.setOrientation(o.id)}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      )}
      <span className="toolbar-spacer" />
      {children}
    </div>
  )
}

export function CommitDetailsPanel({ selected, focus, wip }: { selected: string[]; focus?: FileFocus | null; wip?: WipFocus | null }) {
  if (selected.length === 0 && wip) return <WipDetails focus={wip} />
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
  const view = useInfoView()

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

  const messagePane = (
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
    // Em cima, a descrição e/ou os arquivos (um sobre o outro ou lado a lado, à escolha); embaixo, o diff.
    <Split id="commit-details" direction="column" initial={0.4} min={[80, 120]}>
      <div className="details-info">
        <InfoControls view={view}>
          {head && (
            <button className="primary" onClick={() => actions.cherryPickCommits(head, [sha], details.subject)}>
              🍒 {t('details.cherryPickInto', { target: head })}
            </button>
          )}
        </InfoControls>
        {view.show === 'message' ? (
          messagePane
        ) : view.show === 'files' ? (
          filesPane
        ) : (
          <Split id="commit-info" direction={view.orientation} initial={0.5} min={[110, 110]} arrangeable={false}>
            {messagePane}
            {filesPane}
          </Split>
        )}
      </div>
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

/**
 * Detalhes das alterações ainda não commitadas (aberto ao clicar num arquivo da primeira linha do
 * histórico): a lista dos arquivos e, embaixo, o diff do escolhido — igual ao de um commit.
 */
function WipDetails({ focus }: { focus: WipFocus }) {
  const { data, toast, setView, openConflict, openDiffWindow } = useApp()
  const { status } = data
  const [fullFile] = useFullFile()
  type Area = 'unstaged' | 'staged'
  const [active, setActive] = useState<{ area: Area; path: string } | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const entries: ChangeEntry[] = buildEntries(status)
  const areaOf = (e: ChangeEntry): Area => (e.unstaged ? 'unstaged' : 'staged')

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

  return (
    <Split id="wip-details" direction="column" initial={0.4} min={[80, 120]}>
      <section className="details">
        <div className="group-header">
          <strong>{t('history.wip.title')}</strong> <span className="count">{entries.length + status.conflicted.length}</span>
          <span className="toolbar-spacer" />
          <button onClick={() => setView('changes')} title={t('history.wip.openHelp')}>
            {t('history.wip.open')} →
          </button>
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
                    onClick={() => setActive({ area: areaOf(e), path: e.path })}
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
